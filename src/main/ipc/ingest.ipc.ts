import { ipcMain } from 'electron';
import {
  importChromeHistoryFromFile,
  importChromeHistoryAuto,
  scanLocalPapersDir,
  scanChromeHistory,
  importScannedPapers,
  cancelImport,
  getImportStatus,
} from '../services/ingest.service';
import type { ScanResult } from '../services/ingest.service';
import { FilePathSchema, validate } from './validate';
import { type IpcResult, ok, err } from '@shared';

export function setupIngestIpc() {
  ipcMain.handle(
    'ingest:chromeHistoryFromFile',
    (_, filePath: unknown): IpcResult<{ started: boolean }> => {
      // Validate input
      const result = validate(FilePathSchema, filePath);
      if (!result.success) {
        return err(`Invalid file path: ${result.error}`);
      }

      // Fire-and-forget — progress is pushed via ingest:status events
      importChromeHistoryFromFile(result.data).catch((e) => {
        console.error(
          '[ingest:chromeHistoryFromFile] Error:',
          e instanceof Error ? e.message : String(e),
        );
      });
      return ok({ started: true });
    },
  );

  ipcMain.handle(
    'ingest:chromeHistoryAuto',
    (_, days: number | null = 1): IpcResult<{ started: boolean }> => {
      // Fire-and-forget — progress is pushed via ingest:status events
      importChromeHistoryAuto(days).catch((e) => {
        console.error(
          '[ingest:chromeHistoryAuto] Error:',
          e instanceof Error ? e.message : String(e),
        );
      });
      return ok({ started: true });
    },
  );

  ipcMain.handle('ingest:scanLocalDir', (_, dir: string): IpcResult<{ started: boolean }> => {
    scanLocalPapersDir(dir).catch((e) => {
      console.error('[ingest:scanLocalDir] Error:', e instanceof Error ? e.message : String(e));
    });
    return ok({ started: true });
  });

  // New: Scan Chrome history and return results without importing
  ipcMain.handle(
    'ingest:scan',
    async (_, days: number | null = 1): Promise<IpcResult<ScanResult>> => {
      try {
        const result = await scanChromeHistory(days);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[ingest:scan] Error:', msg);
        return err(msg);
      }
    },
  );

  // New: Import papers from a pre-scanned list
  ipcMain.handle(
    'ingest:importScanned',
    (_, papers: ScanResult['papers']): IpcResult<{ started: boolean }> => {
      importScannedPapers(papers).catch((e) => {
        console.error('[ingest:importScanned] Error:', e instanceof Error ? e.message : String(e));
      });
      return ok({ started: true });
    },
  );

  // New: Cancel ongoing import
  ipcMain.handle('ingest:cancel', (): IpcResult<{ cancelled: boolean }> => {
    try {
      cancelImport();
      return ok({ cancelled: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[ingest:cancel] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('ingest:status', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = getImportStatus();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[ingest:status] Error:', msg);
      return err(msg);
    }
  });
}
