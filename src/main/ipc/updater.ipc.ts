import { ipcMain } from 'electron';
import {
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getUpdateStatus,
} from '../services/auto-updater.service';

export function setupUpdaterIpc() {
  ipcMain.handle('updater:getStatus', () => {
    return getUpdateStatus();
  });

  ipcMain.handle('updater:checkForUpdates', async () => {
    try {
      const result = await checkForUpdates();
      if (result === null) {
        // Dev mode: autoUpdater skips check and returns null
        return { state: 'not-available' as const, info: { version: 'dev' } };
      }
    } catch (err) {
      return {
        state: 'error' as const,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
    return getUpdateStatus();
  });

  ipcMain.handle('updater:downloadUpdate', async () => {
    await downloadUpdate();
    return { success: true };
  });

  ipcMain.handle('updater:quitAndInstall', () => {
    quitAndInstall();
  });
}
