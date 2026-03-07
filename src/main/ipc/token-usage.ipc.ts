import { ipcMain } from 'electron';
import {
  getTokenUsageSummary,
  getTokenUsageRecords,
  clearTokenUsage,
  type TokenUsageSummary,
  type TokenUsageRecord,
} from '../store/token-usage-store';
import { type IpcResult, ok, err } from '@shared';

export function setupTokenUsageIpc() {
  ipcMain.handle('tokenUsage:getSummary', async (): Promise<IpcResult<TokenUsageSummary>> => {
    try {
      const result = getTokenUsageSummary();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tokenUsage:getSummary] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('tokenUsage:getRecords', async (): Promise<IpcResult<TokenUsageRecord[]>> => {
    try {
      const result = getTokenUsageRecords();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tokenUsage:getRecords] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('tokenUsage:clear', async (): Promise<IpcResult<{ success: boolean }>> => {
    try {
      clearTokenUsage();
      return ok({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tokenUsage:clear] Error:', msg);
      return err(msg);
    }
  });
}
