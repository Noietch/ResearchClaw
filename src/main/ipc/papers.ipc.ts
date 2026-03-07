import { ipcMain } from 'electron';
import { PapersService } from '../services/papers.service';
import { DownloadService } from '../services/download.service';
import { AgenticSearchService, type AgenticSearchStep } from '../services/agentic-search.service';
import { type IpcResult, ok, err } from '@shared';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let papersService: PapersService | null = null;
let downloadService: DownloadService | null = null;
let agenticSearchService: AgenticSearchService | null = null;

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

  ipcMain.handle('papers:fixUrlTitles', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().fixUrlTitles();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:fixUrlTitles] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:stripArxivIdPrefix', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().stripArxivIdPrefix();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:stripArxivIdPrefix] Error:', msg);
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
