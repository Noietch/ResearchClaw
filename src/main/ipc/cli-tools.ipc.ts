import { ipcMain, BrowserWindow } from 'electron';
import { detectAllCliTools, runCliToWindow, getShellPath } from '../services/cli-runner.service';
import { execSync } from 'child_process';
import { getCliTools, saveCliTools, type CliConfig } from '../store/cli-tools-store';

const activeProcesses = new Map<string, { kill: () => void }>();

export function setupCliToolsIpc() {
  // ─── CLI Tool Config Persistence ───────────────────────────────────────────

  ipcMain.handle('cliTools:list', async () => {
    return getCliTools();
  });

  ipcMain.handle('cliTools:save', async (_, tools: CliConfig[]) => {
    saveCliTools(tools);
    return { success: true };
  });

  // ─── CLI Detection & Execution ─────────────────────────────────────────────

  ipcMain.handle('cli:detect', async () => {
    return detectAllCliTools();
  });

  /** Test a CLI tool by running `<command> [extraArgs] -p "ping"` and checking output */
  ipcMain.handle('cli:test', async (_, command: string, extraArgs?: string, envVars?: string) => {
    try {
      const env: Record<string, string | undefined> = { ...process.env, PATH: getShellPath() };
      delete env.CLAUDECODE;
      // Inject extra env vars (space-separated KEY=value pairs)
      if (envVars) {
        for (const pair of envVars.trim().split(/\s+/)) {
          const eq = pair.indexOf('=');
          if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
      const args = extraArgs ? `${extraArgs} ` : '';
      const output = execSync(`${command} ${args}-p "Reply with just the word: pong"`, {
        env,
        timeout: 20000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: output.trim().slice(0, 300) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg.slice(0, 300) };
    }
  });

  ipcMain.handle(
    'cli:run',
    async (
      event,
      options: {
        tool: string;
        args: string[];
        sessionId: string;
        cwd?: string;
        envVars?: string; // space-separated KEY=value pairs
        useProxy?: boolean;
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { error: 'No window found' };

      // Kill existing session if any
      const existing = activeProcesses.get(options.sessionId);
      if (existing) existing.kill();

      // Parse env vars string into object
      const parsedEnv: Record<string, string> = {};
      if (options.envVars) {
        for (const pair of options.envVars.trim().split(/\s+/)) {
          const eq = pair.indexOf('=');
          if (eq > 0) parsedEnv[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }

      const proc = runCliToWindow(win, options.tool, options.args, {
        cwd: options.cwd,
        env: parsedEnv,
        useProxy: options.useProxy,
      });

      activeProcesses.set(options.sessionId, proc);
      return { sessionId: options.sessionId, started: true };
    },
  );

  ipcMain.handle('cli:kill', async (_, sessionId: string) => {
    const proc = activeProcesses.get(sessionId);
    if (proc) {
      proc.kill();
      activeProcesses.delete(sessionId);
      return { killed: true };
    }
    return { killed: false };
  });
}
