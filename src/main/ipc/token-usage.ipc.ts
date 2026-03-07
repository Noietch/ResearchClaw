import { ipcMain } from 'electron';
import {
  getTokenUsageSummary,
  getTokenUsageRecords,
  clearTokenUsage,
  type TokenUsageSummary,
  type TokenUsageRecord,
} from '../store/token-usage-store';

export function setupTokenUsageIpc() {
  ipcMain.handle('tokenUsage:getSummary', async (): Promise<TokenUsageSummary> => {
    return getTokenUsageSummary();
  });

  ipcMain.handle('tokenUsage:getRecords', async (): Promise<TokenUsageRecord[]> => {
    return getTokenUsageRecords();
  });

  ipcMain.handle('tokenUsage:clear', async () => {
    clearTokenUsage();
    return { success: true };
  });
}
