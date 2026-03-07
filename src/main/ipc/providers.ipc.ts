import { ipcMain, dialog, shell } from 'electron';
import { spawn } from 'child_process';
import { providersService } from '../services/providers.service';
import { getShellPath } from '../services/cli-runner.service';
import { type IpcResult, ok, err } from '@shared';

export function setupProvidersIpc() {
  ipcMain.handle('providers:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.listProviders();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[providers:list] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'providers:save',
    async (_, config: Parameters<typeof providersService.save>[0]): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.save(config);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[providers:save] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('providers:getActive', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getActiveId();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[providers:getActive] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('providers:setActive', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.setActive(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[providers:setActive] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'providers:getApiKey',
    async (_, providerId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.getMaskedApiKey(providerId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[providers:getApiKey] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:get', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getSettings();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:get] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:setPapersDir', async (_, dir: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.setPapersDir(dir);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:setPapersDir] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:selectFolder', async (): Promise<IpcResult<string | null>> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Papers Folder',
      });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:selectFolder] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:setEditor', async (_, cmd: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.setEditor(cmd);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:setEditor] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:setProxy',
    async (_, proxy: string | undefined): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setProxy(proxy);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setProxy] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:getStorageRoot', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getStorageRoot();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getStorageRoot] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'shell:openInEditor',
    async (_, dirPath: string): Promise<IpcResult<{ success: boolean; error?: string }>> => {
      try {
        const cmd = providersService.getEditor();
        const env = { ...process.env, PATH: getShellPath() };

        // Helper to run command with spawn (avoids command injection)
        const runSpawn = (
          binary: string,
          args: string[],
        ): Promise<{ success: boolean; error?: string }> => {
          return new Promise((resolve) => {
            const proc = spawn(binary, args, { env });
            let stderr = '';

            proc.stderr.on('data', (data) => {
              stderr += data.toString();
            });

            proc.on('error', (err) => {
              resolve({ success: false, error: err.message });
            });

            proc.on('close', (code) => {
              if (code === 0) {
                resolve({ success: true });
              } else {
                resolve({ success: false, error: stderr || `Exited with code ${code}` });
              }
            });

            // Timeout after 5 seconds - assume success if still running
            setTimeout(() => {
              resolve({ success: true });
            }, 5000);
          });
        };

        // First try to open with the configured editor
        const cmdParts = cmd.trim().split(/\s+/);
        const binary = cmdParts[0];
        const args = [...cmdParts.slice(1), dirPath];
        const result = await runSpawn(binary, args);

        // If editor command fails, fall back to macOS 'open' or Electron shell
        if (!result.success) {
          // On macOS, use 'open' command which works for both apps and folders
          if (process.platform === 'darwin') {
            const openResult = await runSpawn('open', [dirPath]);
            return ok(openResult);
          }
          // On other platforms, use Electron's shell.openPath
          try {
            await shell.openPath(dirPath);
            return ok({ success: true });
          } catch (shellErr) {
            return ok({ success: false, error: String(shellErr) });
          }
        }

        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[shell:openInEditor] Error:', msg);
        return err(msg);
      }
    },
  );
}
