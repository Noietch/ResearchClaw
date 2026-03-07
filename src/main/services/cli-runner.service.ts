import { spawn, exec, execSync } from 'child_process';
import { BrowserWindow } from 'electron';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { getProxy, getProxyScope } from '../store/app-settings-store';
import { makeTimestampedLogName, writeDebugFile } from './app-log.service';

export type CliToolName = 'claude' | 'codex' | 'gemini';

export interface CliTool {
  name: CliToolName;
  displayName: string;
  command: string;
  isInstalled: boolean;
  version?: string;
}

export interface CliUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
}

export interface CliTestDiagnostics {
  command: string;
  args: string[];
  shellCommand?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  structuredOutput?: string;
  stdoutFile?: string;
  stderrFile?: string;
  structuredOutputFile?: string;
}

/** Resolve PATH including common install locations */
export function getShellPath(): string {
  const base = process.env.PATH ?? '';
  const extras = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    path.join(os.homedir(), '.local/bin'),
    path.join(os.homedir(), '.npm-global/bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ];
  const parts = new Set([...base.split(':'), ...extras]);
  return Array.from(parts).join(':');
}

export async function detectCli(
  command: string,
): Promise<{ installed: boolean; version?: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getShellPath() };
    exec(`${command} --version`, { env }, (err, stdout) => {
      if (err) {
        resolve({ installed: false });
      } else {
        resolve({ installed: true, version: stdout.trim().split('\n')[0] });
      }
    });
  });
}

export async function detectAllCliTools(): Promise<CliTool[]> {
  const tools: Array<{ name: CliToolName; displayName: string; command: string }> = [
    { name: 'claude', displayName: 'Claude Code', command: 'claude' },
    { name: 'codex', displayName: 'OpenAI Codex', command: 'codex' },
    { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini' },
  ];

  const results = await Promise.all(
    tools.map(async (t) => {
      const { installed, version } = await detectCli(t.command);
      return { ...t, isInstalled: installed, version };
    }),
  );

  return results;
}

function getCliProvider(command: string): 'codex' | 'claude' | 'unknown' {
  if (command === 'codex') return 'codex';
  if (command === 'claude') return 'claude';
  return 'unknown';
}

export function classifyCliTestError(command: string, raw: string): string {
  const message = raw.trim();
  const lower = message.toLowerCase();

  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('spawn ')) {
    return `${command} is not installed or not available in PATH.`;
  }

  if (command === 'codex') {
    if (lower.includes('login') || lower.includes('auth') || lower.includes('authentication')) {
      return 'Codex is installed, but login/auth is missing. Please sign in or provide valid Codex auth content.';
    }
    if (lower.includes('api key')) {
      return 'Codex needs a valid API key or auth configuration before it can run.';
    }
  }

  if (command === 'claude') {
    if (lower.includes('login') || lower.includes('auth') || lower.includes('authentication')) {
      return 'Claude Code is installed, but login/auth is missing. Please sign in or provide valid Claude configuration.';
    }
    if (lower.includes('api key')) {
      return 'Claude Code needs a valid API key or authenticated session before it can run.';
    }
    if (lower.includes('timed out')) {
      return 'Claude Code did not finish the health check in time. This often means login, network, or model response is slow.';
    }
  }

  if (lower.includes('timed out')) {
    return 'The CLI health check timed out. Please verify login, network access, and model responsiveness.';
  }

  if (
    lower.includes('network') ||
    lower.includes('econn') ||
    lower.includes('socket') ||
    lower.includes('timeout')
  ) {
    return 'The CLI appears installed, but the network request failed. Please verify connectivity or proxy settings.';
  }

  return message.slice(0, 300);
}

function parseEnvVarsString(envVars?: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!envVars) return parsed;

  for (const pair of envVars.trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  return parsed;
}

function createTempHome(
  homeFiles?: Array<{ relativePath: string; content: string }>,
): string | null {
  if (!homeFiles || homeFiles.length === 0) return null;

  const tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-agent-home-'));
  for (const file of homeFiles) {
    const destination = path.join(tempHomeDir, file.relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content, 'utf-8');
  }

  return tempHomeDir;
}

function shellEscapeArg(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\''`)}'`;
}

function getLoginShell(): string {
  return process.env.SHELL || '/bin/zsh';
}

function buildShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellEscapeArg).join(' ');
}

function cleanupTempHome(tempHomeDir: string | null) {
  if (!tempHomeDir) return;
  try {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

export async function testCliCommand(options: {
  command: string;
  extraArgs?: string;
  envVars?: string;
  homeFiles?: Array<{ relativePath: string; content: string }>;
  prependArgs?: string[];
  useLoginShell?: boolean;
  debugFilePrefix?: string;
  timeoutMs?: number;
}): Promise<{
  success: boolean;
  output?: string;
  error?: string;
  usage?: CliUsageSummary;
  diagnostics?: CliTestDiagnostics;
}> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: getShellPath(),
    ...parseEnvVarsString(options.envVars),
  };
  delete env.CLAUDECODE;

  const cmdParts = options.command.trim().split(/\s+/).filter(Boolean);
  const binary = cmdParts[0];
  if (!binary) {
    return { success: false, error: 'CLI command is empty.' };
  }

  const extraArgsList = options.extraArgs
    ? options.extraArgs.trim().split(/\s+/).filter(Boolean)
    : [];
  const prompt = 'Reply with just the word: pong';
  const args = [
    ...cmdParts.slice(1),
    ...(options.prependArgs ?? []),
    ...extraArgsList,
    ...buildNonInteractiveCliArgs(binary, prompt),
  ];

  const tempHomeDir = createTempHome(options.homeFiles);
  if (tempHomeDir) {
    env.HOME = tempHomeDir;
    env.USERPROFILE = tempHomeDir;
  }

  const shellCommand = buildShellCommand(binary, args);
  const stdoutFile = options.debugFilePrefix
    ? writeDebugFile(makeTimestampedLogName(`${options.debugFilePrefix}-stdout`, 'jsonl'), '')
    : undefined;
  const stderrFile = options.debugFilePrefix
    ? writeDebugFile(makeTimestampedLogName(`${options.debugFilePrefix}-stderr`, 'log'), '')
    : undefined;

  try {
    return await new Promise<{
      success: boolean;
      output?: string;
      error?: string;
      usage?: CliUsageSummary;
      diagnostics?: CliTestDiagnostics;
    }>((resolve) => {
      const proc = options.useLoginShell
        ? spawn(getLoginShell(), ['-lic', shellCommand], { env, shell: false })
        : spawn(binary, args, { env, shell: false });
      let stdout = '';
      let stderr = '';
      let finished = false;
      const timeoutMs = options.timeoutMs ?? (binary === 'claude' ? 60000 : 20000);

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
        cleanupTempHome(tempHomeDir);
        const parsed = parseStructuredCliOutput(binary, stdout);
        resolve({
          success: false,
          error: `CLI test timed out after ${Math.round(timeoutMs / 1000)}s`,
          diagnostics: {
            command: binary,
            args,
            shellCommand,
            timedOut: true,
            stdout: stdout.trim() || undefined,
            stderr: stderr.trim() || undefined,
            structuredOutput: parsed.text.trim() || undefined,
            stdoutFile,
            stderrFile,
          },
        });
      }, timeoutMs);

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (stdoutFile) {
          fs.appendFileSync(stdoutFile, chunk, 'utf8');
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (stderrFile) {
          fs.appendFileSync(stderrFile, chunk, 'utf8');
        }
      });

      proc.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanupTempHome(tempHomeDir);
        resolve({
          success: false,
          error: err.message,
          diagnostics: {
            command: binary,
            args,
            shellCommand,
            stdout: stdout.trim() || undefined,
            stderr: stderr.trim() || undefined,
            stdoutFile,
            stderrFile,
          },
        });
      });

      proc.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanupTempHome(tempHomeDir);

        const combined = stdout.trim() || stderr.trim();
        const parsed = parseStructuredCliOutput(binary, stdout);
        const diagnostics = {
          command: binary,
          args,
          shellCommand,
          exitCode: code,
          stdout: stdout.trim() || undefined,
          stderr: stderr.trim() || undefined,
          structuredOutput: parsed.text.trim() || undefined,
          stdoutFile,
          stderrFile,
        };

        if (code === 0) {
          resolve({
            success: true,
            output: parsed.text.trim() || combined || `${binary} responded successfully.`,
            usage: parsed.usage,
            diagnostics,
          });
          return;
        }

        resolve({
          success: false,
          error: combined || `Exited with code ${code}`,
          diagnostics,
        });
      });
    });
  } catch (err) {
    cleanupTempHome(tempHomeDir);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      diagnostics: {
        command: binary,
        args,
        shellCommand,
        stdoutFile,
        stderrFile,
      },
    };
  }
}

export function buildNonInteractiveCliArgs(command: string, prompt: string): string[] {
  if (command === 'codex') {
    return ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', prompt];
  }
  if (command === 'claude') {
    return [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--verbose',
    ];
  }
  return ['-p', prompt];
}

function extractUsageCandidate(value: unknown): CliUsageSummary | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const promptTokens =
    typeof record.prompt_tokens === 'number'
      ? record.prompt_tokens
      : typeof record.input_tokens === 'number'
        ? record.input_tokens
        : typeof record.promptTokens === 'number'
          ? record.promptTokens
          : typeof record.inputTokens === 'number'
            ? record.inputTokens
            : null;
  const completionTokens =
    typeof record.completion_tokens === 'number'
      ? record.completion_tokens
      : typeof record.output_tokens === 'number'
        ? record.output_tokens
        : typeof record.completionTokens === 'number'
          ? record.completionTokens
          : typeof record.outputTokens === 'number'
            ? record.outputTokens
            : null;
  const totalTokens =
    typeof record.total_tokens === 'number'
      ? record.total_tokens
      : typeof record.totalTokens === 'number'
        ? record.totalTokens
        : promptTokens !== null || completionTokens !== null
          ? (promptTokens ?? 0) + (completionTokens ?? 0)
          : null;

  if (promptTokens === null && completionTokens === null && totalTokens === null) return null;

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
    model:
      typeof record.model === 'string'
        ? record.model
        : typeof record.model_name === 'string'
          ? record.model_name
          : typeof record.modelName === 'string'
            ? record.modelName
            : undefined,
  };
}

function findUsage(value: unknown): CliUsageSummary | null {
  const direct = extractUsageCandidate(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUsage(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = findUsage(child);
      if (found) return found;
    }
  }
  return null;
}

function collectText(value: unknown, parts: string[] = []): string[] {
  if (typeof value === 'string') {
    parts.push(value);
    return parts;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return parts;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = ['text', 'delta', 'content', 'message'];
    for (const key of preferredKeys) {
      if (key in record) collectText(record[key], parts);
    }
  }
  return parts;
}

export function parseStructuredCliLine(
  command: string,
  line: string,
): {
  text?: string;
  usage?: CliUsageSummary;
} {
  const provider = getCliProvider(command);
  if (provider === 'unknown') return {};

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const usage = findUsage(parsed) ?? undefined;

    let text = '';
    if (provider === 'codex') {
      text = collectText(parsed).join('');
    } else if (provider === 'claude') {
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      if (
        type.includes('assistant') ||
        type.includes('result') ||
        type.includes('message') ||
        type.includes('delta')
      ) {
        text = collectText(parsed).join('');
      }
    }

    return {
      text: text || undefined,
      usage,
    };
  } catch {
    return {};
  }
}

export function parseStructuredCliOutput(
  command: string,
  output: string,
): {
  text: string;
  usage?: CliUsageSummary;
} {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let usage: CliUsageSummary | undefined;
  const textParts: string[] = [];

  for (const line of lines) {
    const parsed = parseStructuredCliLine(command, line);
    if (parsed.text) textParts.push(parsed.text);
    if (parsed.usage) usage = parsed.usage;
  }

  return {
    text: textParts.join(''),
    usage,
  };
}

export interface RunCliOptions {
  cwd?: string;
  env?: Record<string, string>;
  useProxy?: boolean;
  useLoginShell?: boolean;
  homeFiles?: Array<{ relativePath: string; content: string }>;
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  onUsage?: (usage: CliUsageSummary) => void;
  onDone?: (code: number | null) => void;
}

/** Run a CLI tool and stream output via callbacks */
export function runCli(
  command: string,
  args: string[],
  options: RunCliOptions = {},
): { kill: () => void } {
  const proxyUrl = getProxy();
  const proxyScope = getProxyScope();
  const proxyEnv: Record<string, string> = {};

  if (options.useProxy && proxyUrl && proxyScope.cliTools) {
    proxyEnv.HTTP_PROXY = proxyUrl;
    proxyEnv.HTTPS_PROXY = proxyUrl;
    proxyEnv.http_proxy = proxyUrl;
    proxyEnv.https_proxy = proxyUrl;
    proxyEnv.ALL_PROXY = proxyUrl;
    proxyEnv.all_proxy = proxyUrl;
  }

  let tempHomeDir: string | null = createTempHome(options.homeFiles);

  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: getShellPath(),
    ...proxyEnv,
    ...(options.env ?? {}),
  };
  if (tempHomeDir) {
    env.HOME = tempHomeDir;
    env.USERPROFILE = tempHomeDir;
  }
  delete env.CLAUDECODE;
  const cwd = options.cwd ?? os.homedir();

  const cleanup = () => {
    cleanupTempHome(tempHomeDir);
    tempHomeDir = null;
  };

  const shellCommand = buildShellCommand(command, args);
  const proc = options.useLoginShell
    ? spawn(getLoginShell(), ['-lic', shellCommand], { env, cwd, shell: false })
    : spawn(command, args, { env, cwd, shell: false });
  let stdoutBuffer = '';

  proc.stdout.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stdoutBuffer += chunk;

    const provider = getCliProvider(command);
    if (provider === 'unknown') {
      options.onOutput?.(chunk);
      return;
    }

    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseStructuredCliLine(command, trimmed);
      if (parsed.text) options.onOutput?.(parsed.text);
      if (parsed.usage) options.onUsage?.(parsed.usage);
    }
  });

  proc.stderr.on('data', (data: Buffer) => {
    options.onError?.(data.toString());
  });

  proc.on('close', (code) => {
    const remaining = stdoutBuffer.trim();
    if (remaining) {
      const parsed = parseStructuredCliLine(command, remaining);
      if (parsed.text) options.onOutput?.(parsed.text);
      else if (getCliProvider(command) === 'unknown') options.onOutput?.(stdoutBuffer);
      if (parsed.usage) options.onUsage?.(parsed.usage);
    }
    cleanup();
    options.onDone?.(code);
  });

  return {
    kill: () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      } finally {
        cleanup();
      }
    },
  };
}

/** Run CLI and stream output to a BrowserWindow via IPC */
export function runCliToWindow(
  win: BrowserWindow,
  command: string,
  args: string[],
  sessionId: string,
  options: Omit<RunCliOptions, 'onOutput' | 'onError'> = {},
): { kill: () => void } {
  return runCli(command, args, {
    ...options,
    onOutput: (data) => win.webContents.send('cli:output', { sessionId, data }),
    onError: (data) => win.webContents.send('cli:error', { sessionId, data }),
    onUsage: (usage) => {
      options.onUsage?.(usage);
      win.webContents.send('cli:usage', { sessionId, usage });
    },
    onDone: (code) => {
      options.onDone?.(code);
      win.webContents.send('cli:done', { sessionId, code });
    },
  });
}
