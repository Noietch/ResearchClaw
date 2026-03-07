import { spawn, exec } from 'child_process';
import { BrowserWindow } from 'electron';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { getProxy } from '../store/app-settings-store';

export type CliToolName = 'claude' | 'codex' | 'gemini';

export interface CliTool {
  name: CliToolName;
  displayName: string;
  command: string;
  isInstalled: boolean;
  version?: string;
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

export interface RunCliOptions {
  cwd?: string;
  env?: Record<string, string>;
  useProxy?: boolean;
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  onDone?: (code: number | null) => void;
}

/** Run a CLI tool and stream output via callbacks */
export function runCli(
  command: string,
  args: string[],
  options: RunCliOptions = {},
): { kill: () => void } {
  const proxyUrl = getProxy();
  const proxyEnv: Record<string, string> = {};

  // Inject proxy env vars if useProxy is true and proxy is configured
  if (options.useProxy && proxyUrl) {
    // Set common proxy environment variables
    proxyEnv.HTTP_PROXY = proxyUrl;
    proxyEnv.HTTPS_PROXY = proxyUrl;
    proxyEnv.http_proxy = proxyUrl;
    proxyEnv.https_proxy = proxyUrl;
    // Some tools also respect ALL_PROXY
    proxyEnv.ALL_PROXY = proxyUrl;
    proxyEnv.all_proxy = proxyUrl;
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: getShellPath(),
    ...proxyEnv,
    ...(options.env ?? {}),
  };
  // Unset CLAUDECODE so nested claude invocations don't fail with "nested session" error
  delete env.CLAUDECODE;
  const cwd = options.cwd ?? os.homedir();

  const proc = spawn(command, args, { env, cwd, shell: false });

  proc.stdout.on('data', (data: Buffer) => {
    options.onOutput?.(data.toString());
  });

  proc.stderr.on('data', (data: Buffer) => {
    options.onError?.(data.toString());
  });

  proc.on('close', (code) => {
    options.onDone?.(code);
  });

  return {
    kill: () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
  };
}

/** Run CLI and stream output to a BrowserWindow via IPC */
export function runCliToWindow(
  win: BrowserWindow,
  command: string,
  args: string[],
  options: Omit<RunCliOptions, 'onOutput' | 'onError' | 'onDone'> = {},
): { kill: () => void } {
  return runCli(command, args, {
    ...options,
    onOutput: (data) => win.webContents.send('cli:output', data),
    onError: (data) => win.webContents.send('cli:error', data),
    onDone: (code) => win.webContents.send('cli:done', { code }),
  });
}
