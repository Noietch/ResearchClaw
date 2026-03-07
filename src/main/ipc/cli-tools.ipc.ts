import { ipcMain, BrowserWindow } from 'electron';
import { detectAllCliTools, runCliToWindow, getShellPath } from '../services/cli-runner.service';
import { spawnSync } from 'child_process';
import { getCliTools, saveCliTools, type CliConfig } from '../store/cli-tools-store';
import { CliRunOptionsSchema, EnvVarsStringSchema, parseEnvVars, validate } from './validate';
import { type IpcResult, ok, err } from '@shared';

const activeProcesses = new Map<string, { kill: () => void }>();

export function setupCliToolsIpc() {
  // ─── CLI Tool Config Persistence ───────────────────────────────────────────

  ipcMain.handle('cliTools:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = getCliTools();
      return ok(result);
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

  // ─── CLI Detection & Execution ─────────────────────────────────────────────

  ipcMain.handle('cli:detect', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await detectAllCliTools();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[cli:detect] Error:', msg);
      return err(msg);
    }
  });

  /** Test a CLI tool by running `<command> [extraArgs] -p "ping"` and checking output */
  ipcMain.handle(
    'cli:test',
    async (
      _,
      command: string,
      extraArgs?: string,
      envVars?: string,
    ): Promise<IpcResult<{ output?: string }>> => {
      try {
        // Validate command
        if (!command || typeof command !== 'string') {
          return err('Command is required');
        }

        // Validate envVars if provided
        if (envVars) {
          const envResult = validate(EnvVarsStringSchema, envVars);
          if (!envResult.success) {
            return err(`Invalid environment variables: ${envResult.error}`);
          }
        }

        const env: Record<string, string | undefined> = { ...process.env, PATH: getShellPath() };
        delete env.CLAUDECODE;
        // Inject extra env vars using safe parser
        if (envVars) {
          Object.assign(env, parseEnvVars(envVars));
        }

        // Parse command into binary and args to avoid command injection
        const cmdParts = command.trim().split(/\s+/);
        const binary = cmdParts[0];
        const extraArgsList = extraArgs ? extraArgs.trim().split(/\s+/) : [];
        const args = [
          ...cmdParts.slice(1),
          ...extraArgsList,
          '-p',
          'Reply with just the word: pong',
        ];

        const result = spawnSync(binary, args, {
          env,
          timeout: 20000,
          encoding: 'utf-8',
        });

        if (result.error) {
          return err(result.error.message.slice(0, 300));
        }

        if (result.status !== 0 && result.stderr) {
          return err(result.stderr.slice(0, 300));
        }

        return ok({ output: result.stdout.trim().slice(0, 300) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg.slice(0, 300));
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
        // Validate input
        const validation = validate(CliRunOptionsSchema, options);
        if (!validation.success) {
          return err(`Invalid options: ${validation.error}`);
        }

        const opts = validation.data;
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return err('No window found');

        // Kill existing session if any
        const existing = activeProcesses.get(opts.sessionId);
        if (existing) existing.kill();

        // Parse env vars string into object using safe parser
        const parsedEnv = parseEnvVars(opts.envVars || '');

        const proc = runCliToWindow(win, opts.tool, opts.args ?? [], {
          cwd: opts.cwd,
          env: parsedEnv,
          useProxy: opts.useProxy,
        });

        activeProcesses.set(opts.sessionId, proc);
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
          activeProcesses.delete(sessionId);
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
