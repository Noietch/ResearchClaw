import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { PapersService } from '../services/papers.service';
import { DownloadService } from '../services/download.service';
import { AgenticSearchService, type AgenticSearchStep } from '../services/agentic-search.service';
import { SemanticSearchService } from '../services/semantic-search.service';
import {
  getPaperProcessingStatus,
  retryPaperProcessing,
} from '../services/paper-processing.service';
import { type IpcResult, ok, err } from '@shared';
import { getBibtexBatch } from '../services/bibtex.service';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let papersService: PapersService | null = null;
let downloadService: DownloadService | null = null;
let agenticSearchService: AgenticSearchService | null = null;
let semanticSearchService: SemanticSearchService | null = null;

function getPapersService() {
  if (!papersService) papersService = new PapersService();
  return papersService;
}

function getDownloadService() {
  if (!downloadService) downloadService = new DownloadService();
  return downloadService;
}

function getAgenticSearchService() {
  if (!agenticSearchService) agenticSearchService = new AgenticSearchService();
  return agenticSearchService;
}

function getSemanticSearchService() {
  if (!semanticSearchService) semanticSearchService = new SemanticSearchService();
  return semanticSearchService;
}

export function setupPapersIpc() {
  ipcMain.handle(
    'papers:download',
    async (_, input: string, tags?: string[]): Promise<IpcResult<unknown>> => {
      try {
        const result = await getDownloadService().downloadFromInput(input, tags ?? []);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:download] Error:', msg);
        return err(msg);
      }
    },
  );
  ipcMain.handle(
    'papers:list',
    async (
      _,
      query: {
        q?: string;
        year?: number;
        tag?: string;
        importedWithin?: 'today' | 'week' | 'month' | 'all';
      } = {},
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().list(query);
        console.log('[papers:list] query:', query, 'result count:', result.length);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:list] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:listToday', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().listToday();
      console.log('[papers:listToday] result count:', result.length);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:listToday] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:create', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().create(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:create] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:importLocalPdf',
    async (_, filePath: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().importLocalPdf(filePath);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:importLocalPdf] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:importLocalPdfs',
    async (_, filePaths: string[]): Promise<IpcResult<unknown>> => {
      try {
        const total = filePaths.length;
        const results: Array<{ file: string; success: boolean; error?: string }> = [];

        const broadcast = (completed: number, message: string) => {
          const wins = BrowserWindow.getAllWindows();
          for (const win of wins) {
            win.webContents.send('papers:importLocalPdfs:progress', {
              total,
              completed,
              success: results.filter((r) => r.success).length,
              failed: results.filter((r) => !r.success).length,
              message,
            });
          }
        };

        for (let i = 0; i < filePaths.length; i++) {
          const filePath = filePaths[i];
          const fileName = path.basename(filePath);
          broadcast(i, `Importing ${fileName} (${i + 1}/${total})...`);
          try {
            await getPapersService().importLocalPdf(filePath);
            results.push({ file: filePath, success: true });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[papers:importLocalPdfs] Error importing ${filePath}:`, msg);
            results.push({ file: filePath, success: false, error: msg });
          }
        }

        const successCount = results.filter((r) => r.success).length;
        const failedCount = results.filter((r) => !r.success).length;
        broadcast(
          total,
          `Import complete: ${successCount} succeeded, ${failedCount} failed out of ${total}`,
        );

        return ok({ total, success: successCount, failed: failedCount, results });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:importLocalPdfs] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:getById', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().getById(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:getById] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:getByShortId', async (_, shortId: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().getByShortId(shortId);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:getByShortId] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:downloadPdf',
    async (_, paperId: string, pdfUrl: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().downloadPdf(paperId, pdfUrl);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:downloadPdf] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().deleteById(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:delete] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:deleteMany', async (_, ids: string[]): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().deleteMany(ids);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:deleteMany] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:touch', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().touchLastRead(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:touch] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:updateTags',
    async (_, id: string, tags: string[]): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().updateTags(id, tags);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:updateTags] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:updateRating',
    async (_, id: string, rating: number | null): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().updateRating(id, rating);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:updateRating] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:listTags', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().listAllTags();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:listTags] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:getSourceEvents',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().getSourceEvents(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:getSourceEvents] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:getProcessingStatus',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPaperProcessingStatus(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:getProcessingStatus] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:retryProcessing',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await retryPaperProcessing(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:retryProcessing] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:semanticSearch',
    async (_, query: string, limit?: number): Promise<IpcResult<unknown>> => {
      try {
        const result = await getSemanticSearchService().search(query, limit);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:semanticSearch] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:exportBibtex',
    async (_, paperIds: string[]): Promise<IpcResult<string>> => {
      try {
        const service = getPapersService();
        const papers = await Promise.all(paperIds.map((id) => service.getById(id)));
        const validPapers = papers.filter(
          (p): p is NonNullable<typeof p> => p !== null && p !== undefined,
        );
        const bibtex = await getBibtexBatch(
          validPapers.map((p) => ({
            title: p.title,
            authors: p.authors,
            submittedAt: p.submittedAt ? String(p.submittedAt) : undefined,
            sourceUrl: p.sourceUrl ?? undefined,
            shortId: p.shortId,
          })),
        );
        return ok(bibtex);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:exportBibtex] Error:', msg);
        return err(msg);
      }
    },
  );

  // Agentic Search with streaming steps
  ipcMain.handle(
    'papers:agenticSearch',
    async (
      event,
      query: string,
    ): Promise<IpcResult<{ steps: AgenticSearchStep[]; papers: unknown }>> => {
      try {
        const steps: AgenticSearchStep[] = [];

        const result = await getAgenticSearchService().search(query, (step) => {
          steps.push(step);
          // Send step updates to renderer via IPC event
          event.sender.send('papers:agenticSearch:step', step);
        });

        return ok({ steps: result.steps, papers: result.papers });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:agenticSearch] Error:', msg);
        return err(msg);
      }
    },
  );
}
