import { ipcMain } from 'electron';
import { PapersService } from '../services/papers.service';
import { DownloadService } from '../services/download.service';
import { AgenticSearchService, type AgenticSearchStep } from '../services/agentic-search.service';

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
  ipcMain.handle('papers:download', async (_, input: string, tags?: string[]) => {
    return getDownloadService().downloadFromInput(input, tags ?? []);
  });
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
    ) => {
      const result = await getPapersService().list(query);
      console.log('[papers:list] query:', query, 'result count:', result.length);
      return result;
    },
  );

  ipcMain.handle('papers:listToday', async () => {
    const result = await getPapersService().listToday();
    console.log('[papers:listToday] result count:', result.length);
    return result;
  });

  ipcMain.handle('papers:create', async (_, input) => {
    return getPapersService().create(input);
  });

  ipcMain.handle('papers:getById', async (_, id: string) => {
    return getPapersService().getById(id);
  });

  ipcMain.handle('papers:getByShortId', async (_, shortId: string) => {
    return getPapersService().getByShortId(shortId);
  });

  ipcMain.handle('papers:downloadPdf', async (_, paperId: string, pdfUrl: string) => {
    return getPapersService().downloadPdf(paperId, pdfUrl);
  });

  ipcMain.handle('papers:delete', async (_, id: string) => {
    return getPapersService().deleteById(id);
  });

  ipcMain.handle('papers:deleteMany', async (_, ids: string[]) => {
    return getPapersService().deleteMany(ids);
  });

  ipcMain.handle('papers:touch', async (_, id: string) => {
    return getPapersService().touchLastRead(id);
  });

  ipcMain.handle('papers:fixUrlTitles', async () => {
    return getPapersService().fixUrlTitles();
  });

  ipcMain.handle('papers:stripArxivIdPrefix', async () => {
    return getPapersService().stripArxivIdPrefix();
  });

  ipcMain.handle('papers:updateTags', async (_, id: string, tags: string[]) => {
    return getPapersService().updateTags(id, tags);
  });

  ipcMain.handle('papers:updateRating', async (_, id: string, rating: number | null) => {
    return getPapersService().updateRating(id, rating);
  });

  ipcMain.handle('papers:listTags', async () => {
    return getPapersService().listAllTags();
  });

  // Agentic Search with streaming steps
  ipcMain.handle('papers:agenticSearch', async (event, query: string) => {
    const steps: AgenticSearchStep[] = [];

    const result = await getAgenticSearchService().search(query, (step) => {
      steps.push(step);
      // Send step updates to renderer via IPC event
      event.sender.send('papers:agenticSearch:step', step);
    });

    return { steps: result.steps, papers: result.papers };
  });
}
