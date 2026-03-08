import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import { appendLog, getLogFilePath } from './app-log.service';
import { getShellPath } from './cli-runner.service';
import { proxyFetch } from './proxy-fetch';

let ollamaProcess: ChildProcess | null = null;
let startedByApp = false;
let startupPromise: Promise<void> | null = null;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(hostname);
}

function getConfiguredBaseUrl(): string {
  return trimTrailingSlash(getSemanticSearchSettings().baseUrl);
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
  } = {},
): Promise<boolean> {
  const settings = getSemanticSearchSettings();
  const baseUrl = getConfiguredBaseUrl();
  const timeoutMs = options.timeoutMs ?? 12000;

  if (!settings.enabled) {
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

export async function warmupOllamaService(trigger = 'startup'): Promise<boolean> {
  try {
    return await ensureOllamaRunning({ trigger });
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
