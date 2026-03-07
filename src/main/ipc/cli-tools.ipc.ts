import { ipcMain, BrowserWindow } from 'electron';
import {
  buildNonInteractiveCliArgs,
  detectAllCliTools,
  runCliToWindow,
  getShellPath,
  type CliUsageSummary,
} from '../services/cli-runner.service';
import { spawn } from 'child_process';
import { getCliTools, saveCliTools, type CliConfig } from '../store/cli-tools-store';
import { recordTokenUsage } from '../store/token-usage-store';
import { CliRunOptionsSchema, EnvVarsStringSchema, parseEnvVars, validate } from './validate';
import { type IpcResult, ok, err } from '@shared';

const activeProcesses = new Map<string, { kill: () => void }>();
const sessionUsage = new Map<
  string,
  { provider: string; model: string; usage?: CliUsageSummary }
>();

function finalizeSessionUsage(sessionId: string) {
  const usageState = sessionUsage.get(sessionId);
  if (usageState?.usage) {
    recordTokenUsage({
      timestamp: new Date().toISOString(),
      provider: usageState.provider,
      model: usageState.usage.model ?? usageState.model,
      promptTokens: usageState.usage.promptTokens,
      completionTokens: usageState.usage.completionTokens,
      totalTokens: usageState.usage.totalTokens,
      kind: 'agent',
    });
  }
  sessionUsage.delete(sessionId);
  activeProcesses.delete(sessionId);
}

function classifyCliTestError(command: string, raw: string): string {
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

export function setupCliToolsIpc() {
  ipcMain.handle('cliTools:list', async (): Promise<IpcResult<unknown>> => {
    try {
      return ok(getCliTools());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[cliTools:list] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'cliTools:save',
    async (_, tools: CliConfig[]): Promise<IpcResult<{ success: boolean }>> => {
      try {
        saveCliTools(tools);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[cliTools:save] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('cli:detect', async (): Promise<IpcResult<unknown>> => {
    try {
      return ok(await detectAllCliTools());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[cli:detect] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'cli:test',
    async (
      _,
      command: string,
      extraArgs?: string,
      envVars?: string,
    ): Promise<IpcResult<{ success: boolean; output?: string; error?: string }>> => {
      try {
        if (!command || typeof command !== 'string') {
          return ok({ success: false, error: 'Command is required' });
        }

        if (envVars) {
          const envResult = validate(EnvVarsStringSchema, envVars);
          if (!envResult.success) {
            return ok({ success: false, error: `Invalid environment variables: ${envResult.error}` });
          }
        }

        const env: Record<string, string | undefined> = { ...process.env, PATH: getShellPath() };
        delete env.CLAUDECODE;
        if (envVars) {
          Object.assign(env, parseEnvVars(envVars));
        }

        const cmdParts = command.trim().split(/\s+/);
        const binary = cmdParts[0];
        const extraArgsList = extraArgs ? extraArgs.trim().split(/\s+/) : [];
        const args = [
          ...cmdParts.slice(1),
          ...extraArgsList,
          ...buildNonInteractiveCliArgs(binary, 'Reply with just the word: pong'),
        ];

        const result = await new Promise<{ success: boolean; output?: string; error?: string }>(
          (resolve) => {
            const proc = spawn(binary, args, { env, shell: false });
            let stdout = '';
            let stderr = '';
            let finished = false;
            const timeoutMs = binary === 'claude' ? 60000 : 20000;

            const timer = setTimeout(() => {
              if (finished) return;
              finished = true;
              try {
                proc.kill('SIGTERM');
              } catch {
                // ignore
              }
              resolve({
                success: false,
                error: classifyCliTestError(
                  binary,
                  `CLI test timed out after ${Math.round(timeoutMs / 1000)}s`,
                ),
              });
            }, timeoutMs);

            proc.stdout.on('data', (data: Buffer) => {
              stdout += data.toString();
            });
            proc.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
            proc.on('error', (spawnError) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              resolve({
                success: false,
                error: classifyCliTestError(binary, spawnError.message),
              });
            });
            proc.on('close', (code) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              if (code === 0) {
                resolve({ success: true, output: stdout.trim().slice(0, 300) });
              } else {
                resolve({
                  success: false,
                  error: classifyCliTestError(
                    binary,
                    (stderr || stdout).trim() || `Exited with code ${code}`,
                  ),
                });
              }
            });
          },
        );

        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const binary = command.trim().split(/\s+/)[0] || 'cli';
        return ok({ success: false, error: classifyCliTestError(binary, msg) });
      }
    },
  );

  ipcMain.handle(
    'cli:run',
    async (
      event,
      options: unknown,
    ): Promise<IpcResult<{ sessionId: string; started: boolean }>> => {
      try {
        const validation = validate(CliRunOptionsSchema, options);
        if (!validation.success) {
          return err(`Invalid options: ${validation.error}`);
        }

        const opts = validation.data;
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return err('No window found');

        const existing = activeProcesses.get(opts.sessionId);
        if (existing) existing.kill();

        const parsedEnv = parseEnvVars(opts.envVars || '');
        const cmdParts = opts.tool.trim().split(/\s+/);
        const command = cmdParts[0];
        const commandArgs = [...cmdParts.slice(1), ...(opts.args ?? [])];

        sessionUsage.set(opts.sessionId, {
          provider: command,
          model: opts.displayLabel || opts.tool,
        });

        const proc = runCliToWindow(win, command, commandArgs, opts.sessionId, {
          cwd: opts.cwd,
          env: parsedEnv,
          useProxy: opts.useProxy,
          homeFiles: opts.homeFiles,
          onUsage: (usage) => {
            const existingUsage = sessionUsage.get(opts.sessionId);
            if (!existingUsage) return;
            sessionUsage.set(opts.sessionId, {
              ...existingUsage,
              usage,
              model: usage.model ?? existingUsage.model,
            });
          },
          onDone: () => {
            finalizeSessionUsage(opts.sessionId);
          },
        });

        const wrappedProc = {
          kill: () => {
            proc.kill();
            finalizeSessionUsage(opts.sessionId);
          },
        };

        activeProcesses.set(opts.sessionId, wrappedProc);
        return ok({ sessionId: opts.sessionId, started: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[cli:run] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'cli:kill',
    async (_, sessionId: string): Promise<IpcResult<{ killed: boolean }>> => {
      try {
        const proc = activeProcesses.get(sessionId);
        if (proc) {
          proc.kill();
          return ok({ killed: true });
        }
        return ok({ killed: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[cli:kill] Error:', msg);
        return err(msg);
      }
    },
  );
}
