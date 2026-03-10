import { BrowserWindow } from 'electron';
import * as http from 'node:http';
import * as https from 'node:https';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import {
  getSemanticSearchSettings,
  type SemanticSearchSettings,
} from '../store/app-settings-store';
import { appendLog, getLogFilePath } from './app-log.service';
import { getShellPath } from './cli-runner.service';
import { proxyFetch } from './proxy-fetch';

let ollamaProcess: ChildProcess | null = null;
let startedByApp = false;
let startupPromise: Promise<void> | null = null;

export interface SemanticModelPullJob {
  id: string;
  kind: 'embedding';
  model: string;
  baseUrl: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
  detail?: string;
  progress?: number;
  completedBytes?: number;
  totalBytes?: number;
  lastUpdatedAt: string;
  recentEvents?: string[];
  startedAt: string;
  finishedAt?: string;
}

const pullJobs = new Map<string, SemanticModelPullJob>();

const STALE_PULL_JOB_MS = 30_000;

function trimTrailingSlash(value: string | undefined): string {
  return (value ?? '').replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(hostname);
}

function resolveSemanticSettings(
  overrides: Partial<SemanticSearchSettings> = {},
): SemanticSearchSettings {
  return {
    ...getSemanticSearchSettings(),
    ...overrides,
  };
}

function getConfiguredBaseUrl(settings = getSemanticSearchSettings()): string {
  return trimTrailingSlash(settings.baseUrl);
}

function broadcastPullJob(job: SemanticModelPullJob): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('settings:semanticModelPullStatus', job);
  }
}

async function streamOllamaPull(
  baseUrl: string,
  model: string,
  onProgress: (payload: { status?: string; completed?: number; total?: number }) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const parsed = new URL(`${baseUrl}/api/pull`);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ResearchClaw/1.0)',
        },
        timeout: 10 * 60 * 1000,
      },
      (res) => {
        let buffer = '';
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const payload = JSON.parse(trimmed) as {
                status?: string;
                error?: string;
                completed?: number;
                total?: number;
              };
              if (payload.error) {
                fail(new Error(payload.error));
                return;
              }
              onProgress(payload);
            } catch {
              // ignore non-json partial lines
            }
          }
        });
        res.on('end', () => {
          if (settled) return;
          if (buffer.trim()) {
            try {
              const payload = JSON.parse(buffer.trim()) as {
                status?: string;
                error?: string;
                completed?: number;
                total?: number;
              };
              if (payload.error) {
                settled = true;
                reject(new Error(payload.error));
                return;
              }
              onProgress(payload);
            } catch {
              // ignore trailing non-json
            }
          }
          if ((res.statusCode ?? 0) >= 400) {
            settled = true;
            reject(new Error(`Model pull failed with status ${res.statusCode ?? 0}`));
            return;
          }
          settled = true;
          resolve();
        });
        res.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('Model pull timed out.'));
    });
    req.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
    req.write(JSON.stringify({ model, stream: true }));
    req.end();
  });
}

function calcProgress(completed?: number, total?: number): number | undefined {
  if (!completed || !total || total <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function pushRecentEvent(job: SemanticModelPullJob, event: string): string[] {
  const compact = event.replace(/\s+/g, ' ').trim();
  if (!compact) return job.recentEvents ?? [];
  const next = [...(job.recentEvents ?? []), compact];
  return next.slice(-8);
}

function updatePullJob(
  id: string,
  patch: Partial<SemanticModelPullJob>,
): SemanticModelPullJob | null {
  const current = pullJobs.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, lastUpdatedAt: new Date().toISOString() };
  pullJobs.set(id, next);
  broadcastPullJob(next);
  return next;
}

export function listSemanticModelPullJobs(): SemanticModelPullJob[] {
  return Array.from(pullJobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function canAutoStartOllama(baseUrl = getConfiguredBaseUrl()): boolean {
  try {
    const parsed = new URL(baseUrl);
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

async function isOllamaHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await proxyFetch(`${baseUrl}/api/tags`, {
      timeoutMs: 1500,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(baseUrl: string, timeoutMs = 12000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isOllamaHealthy(baseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Ollama did not become ready at ${baseUrl} within ${timeoutMs}ms.`);
}

function formatSpawnError(error: Error): string {
  const lower = error.message.toLowerCase();
  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('spawn ollama')) {
    return 'The `ollama` CLI was not found in PATH. Please install Ollama or disable auto-start.';
  }
  return error.message;
}

function attachProcessLogs(processRef: ChildProcess) {
  const stdoutLog = getLogFilePath('ollama.stdout.log');
  const stderrLog = getLogFilePath('ollama.stderr.log');

  processRef.stdout?.on('data', (chunk) => {
    fs.appendFileSync(stdoutLog, chunk);
  });
  processRef.stderr?.on('data', (chunk) => {
    fs.appendFileSync(stderrLog, chunk);
  });

  return { stdoutLog, stderrLog };
}

export async function ensureOllamaRunning(
  options: {
    trigger?: string;
    timeoutMs?: number;
    settings?: Partial<SemanticSearchSettings>;
    ignoreEnabled?: boolean;
  } = {},
): Promise<boolean> {
  const settings = resolveSemanticSettings(options.settings);
  const baseUrl = getConfiguredBaseUrl(settings);
  const timeoutMs = options.timeoutMs ?? 12000;

  if (!options.ignoreEnabled && !settings.enabled) {
    return false;
  }

  if (await isOllamaHealthy(baseUrl)) {
    return false;
  }

  if (!settings.autoStartOllama || !canAutoStartOllama(baseUrl)) {
    return false;
  }

  if (startupPromise) {
    await startupPromise;
    return true;
  }

  startupPromise = (async () => {
    if (ollamaProcess && !ollamaProcess.killed) {
      await waitForHealthy(baseUrl, timeoutMs);
      return;
    }

    let spawnError: Error | null = null;
    const spawned = spawn('ollama', ['serve'], {
      env: {
        ...process.env,
        PATH: getShellPath(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    ollamaProcess = spawned;
    startedByApp = true;
    const { stdoutLog, stderrLog } = attachProcessLogs(spawned);

    spawned.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error));
      appendLog(
        'ollama',
        'autostart:error',
        {
          trigger: options.trigger,
          baseUrl,
          error: formatSpawnError(spawnError),
          stdoutLog,
          stderrLog,
        },
        'agent.log',
      );
    });

    spawned.once('exit', (code, signal) => {
      appendLog(
        'ollama',
        'autostart:exit',
        {
          trigger: options.trigger,
          baseUrl,
          pid: spawned.pid,
          code,
          signal,
          stdoutLog,
          stderrLog,
        },
        'agent.log',
      );
      if (ollamaProcess === spawned) {
        ollamaProcess = null;
        startedByApp = false;
      }
    });

    appendLog(
      'ollama',
      'autostart:spawn',
      {
        trigger: options.trigger,
        baseUrl,
        pid: spawned.pid,
        stdoutLog,
        stderrLog,
      },
      'agent.log',
    );

    try {
      await waitForHealthy(baseUrl, timeoutMs);
      appendLog(
        'ollama',
        'autostart:ready',
        {
          trigger: options.trigger,
          baseUrl,
          pid: spawned.pid,
        },
        'agent.log',
      );
    } catch (error) {
      if (spawnError) {
        throw new Error(formatSpawnError(spawnError));
      }
      throw error;
    }
  })().finally(() => {
    startupPromise = null;
  });

  await startupPromise;
  return true;
}

export async function warmupOllamaService(
  trigger = 'startup',
  settings?: Partial<SemanticSearchSettings>,
): Promise<boolean> {
  try {
    return await ensureOllamaRunning({ trigger, settings });
  } catch (error) {
    appendLog(
      'ollama',
      'autostart:warmupFailed',
      {
        trigger,
        error: error instanceof Error ? error.message : String(error),
      },
      'agent.log',
    );
    return false;
  }
}

export function startSemanticModelPull(
  settingsOverrides: Partial<SemanticSearchSettings> = {},
): SemanticModelPullJob {
  const settings = resolveSemanticSettings(settingsOverrides);
  const model = settings.embeddingModel.trim();
  if (!model) {
    throw new Error('Embedding model name is empty.');
  }

  const baseUrl = getConfiguredBaseUrl(settings);
  const existing = listSemanticModelPullJobs().find(
    (job) =>
      job.model === model && job.baseUrl === baseUrl && ['queued', 'running'].includes(job.status),
  );
  if (existing) {
    const lastUpdatedMs = new Date(existing.lastUpdatedAt).getTime();
    const isStale =
      existing.status === 'queued' &&
      Number.isFinite(lastUpdatedMs) &&
      Date.now() - lastUpdatedMs > STALE_PULL_JOB_MS;

    if (!isStale) return existing;

    updatePullJob(existing.id, {
      status: 'failed',
      message: 'Previous download job became stale before starting. Restarting…',
      detail: 'Stale queued job',
      finishedAt: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const job: SemanticModelPullJob = {
    id: `semantic-pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'embedding',
    model,
    baseUrl,
    status: 'queued',
    message: `Queued download for ${model}`,
    detail: 'Waiting to start',
    progress: 0,
    recentEvents: ['Queued download request'],
    lastUpdatedAt: now,
    startedAt: now,
  };
  pullJobs.set(job.id, job);
  broadcastPullJob(job);

  void (async () => {
    updatePullJob(job.id, {
      status: 'running',
      message: `Preparing download for ${model}…`,
      detail: 'Connecting to Ollama',
      progress: 0,
      recentEvents: ['Connecting to Ollama'],
    });
    try {
      await warmupOllamaService('settings-pull-model', settings);
      await streamOllamaPull(baseUrl, model, (payload) => {
        const current = pullJobs.get(job.id);
        const rawEvent = JSON.stringify(payload);
        updatePullJob(job.id, {
          status: 'running',
          message: payload.status || `Downloading ${model}…`,
          detail: payload.status || undefined,
          completedBytes: payload.completed,
          totalBytes: payload.total,
          progress: calcProgress(payload.completed, payload.total),
          recentEvents: current ? pushRecentEvent(current, rawEvent) : [rawEvent],
        });
      });
      updatePullJob(job.id, {
        status: 'completed',
        message: `Downloaded ${model}`,
        detail: 'Download complete',
        progress: 100,
        recentEvents: pushRecentEvent(pullJobs.get(job.id) ?? job, '{"status":"success"}'),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      updatePullJob(job.id, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        detail: 'Download failed',
        recentEvents: pushRecentEvent(
          pullJobs.get(job.id) ?? job,
          error instanceof Error ? error.message : String(error),
        ),
        finishedAt: new Date().toISOString(),
      });
    }
  })();

  return job;
}

export function stopOllamaService(): void {
  if (!ollamaProcess || ollamaProcess.killed || !startedByApp) {
    return;
  }

  appendLog(
    'ollama',
    'autostart:stop',
    { pid: ollamaProcess.pid, baseUrl: getConfiguredBaseUrl() },
    'agent.log',
  );
  ollamaProcess.kill('SIGTERM');
  ollamaProcess = null;
  startedByApp = false;
}
