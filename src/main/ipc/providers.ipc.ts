import { ipcMain, dialog, shell } from 'electron';
import { spawn } from 'child_process';
import { providersService } from '../services/providers.service';
import { getShellPath } from '../services/cli-runner.service';

export function setupProvidersIpc() {
  ipcMain.handle('providers:list', async () => {
    return providersService.listProviders();
  });

  ipcMain.handle(
    'providers:save',
    async (_, config: Parameters<typeof providersService.save>[0]) => {
      return providersService.save(config);
    },
  );

  ipcMain.handle('providers:getActive', async () => {
    return providersService.getActiveId();
  });

  ipcMain.handle('providers:setActive', async (_, id: string) => {
    return providersService.setActive(id);
  });

  ipcMain.handle('providers:getApiKey', async (_, providerId: string) => {
    return providersService.getMaskedApiKey(providerId);
  });

  ipcMain.handle('settings:get', async () => {
    return providersService.getSettings();
  });

  ipcMain.handle('settings:setPapersDir', async (_, dir: string) => {
    return providersService.setPapersDir(dir);
  });

  ipcMain.handle('settings:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Papers Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('settings:setEditor', async (_, cmd: string) => {
    return providersService.setEditor(cmd);
  });

  ipcMain.handle('settings:setProxy', async (_, proxy: string | undefined) => {
    return providersService.setProxy(proxy);
  });

  ipcMain.handle('settings:getStorageRoot', async () => {
    return providersService.getStorageRoot();
  });

  ipcMain.handle('shell:openInEditor', async (_, dirPath: string) => {
    const cmd = providersService.getEditor();
    const env = { ...process.env, PATH: getShellPath() };

    // Helper to run command with spawn (avoids command injection)
    const runSpawn = (binary: string, args: string[]): Promise<{ success: boolean; error?: string }> => {
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
        return openResult;
      }
      // On other platforms, use Electron's shell.openPath
      try {
        await shell.openPath(dirPath);
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }

    return result;
  });
}
