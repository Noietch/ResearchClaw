import { ipcMain, BrowserWindow } from 'electron';
import { ReadingService, type ChatMessage } from '../services/reading.service';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let readingService: ReadingService | null = null;
const activeChats = new Map<string, AbortController>();

function getReadingService() {
  if (!readingService) readingService = new ReadingService();
  return readingService;
}

export function setupReadingIpc() {
  ipcMain.handle('reading:create', async (_, input) => {
    return getReadingService().create(input);
  });

  ipcMain.handle('reading:update', async (_, id: string, content: Record<string, unknown>) => {
    return getReadingService().update(id, content);
  });

  ipcMain.handle('reading:getById', async (_, id: string) => {
    return getReadingService().getById(id);
  });

  ipcMain.handle('reading:listByPaper', async (_, paperId: string) => {
    return getReadingService().listByPaper(paperId);
  });

  ipcMain.handle(
    'reading:saveChat',
    async (_, input: { paperId: string; noteId: string | null; messages: unknown[] }) => {
      return getReadingService().saveChat(input);
    },
  );

  ipcMain.handle(
    'reading:aiEdit',
    async (
      _,
      input: {
        paperId: string;
        instruction: string;
        currentNotes: Record<string, string>;
        pdfUrl?: string;
      },
    ) => {
      return getReadingService().aiEditNotes(input);
    },
  );

  // Chat with streaming output
  ipcMain.handle(
    'reading:chat',
    async (
      event,
      input: {
        sessionId: string;
        paperId: string;
        messages: ChatMessage[];
        pdfUrl?: string;
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { error: 'No window found' };

      // Cancel existing session if any
      const existing = activeChats.get(input.sessionId);
      if (existing) existing.abort();

      const controller = new AbortController();
      activeChats.set(input.sessionId, controller);

      try {
        await getReadingService().chat(
          {
            paperId: input.paperId,
            messages: input.messages,
            pdfUrl: input.pdfUrl,
          },
          (chunk) => {
            win.webContents.send('chat:output', chunk);
          },
          controller.signal,
        );
        win.webContents.send('chat:done');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        win.webContents.send('chat:error', msg);
      } finally {
        activeChats.delete(input.sessionId);
      }

      return { sessionId: input.sessionId, started: true };
    },
  );

  ipcMain.handle('reading:chatKill', async (_, sessionId: string) => {
    const controller = activeChats.get(sessionId);
    if (controller) {
      controller.abort();
      activeChats.delete(sessionId);
      return { killed: true };
    }
    return { killed: false };
  });

  ipcMain.handle('reading:extractPdfUrl', async (_, paperId: string) => {
    return getReadingService().extractPdfUrl(paperId);
  });

  ipcMain.handle('reading:generateNotes', async (_, chatNoteId: string) => {
    return getReadingService().generateNotesFromChat(chatNoteId);
  });
}
