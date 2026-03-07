import { ipcMain, BrowserWindow } from 'electron';
import { ReadingService, type ChatMessage } from '../services/reading.service';
import { type IpcResult, ok, err } from '@shared';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let readingService: ReadingService | null = null;
const activeChats = new Map<string, AbortController>();

function getReadingService() {
  if (!readingService) readingService = new ReadingService();
  return readingService;
}

export function setupReadingIpc() {
  ipcMain.handle('reading:create', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getReadingService().create(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[reading:create] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'reading:update',
    async (_, id: string, content: Record<string, unknown>): Promise<IpcResult<unknown>> => {
      try {
        const result = await getReadingService().update(id, content);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:update] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('reading:getById', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getReadingService().getById(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[reading:getById] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('reading:listByPaper', async (_, paperId: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getReadingService().listByPaper(paperId);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[reading:listByPaper] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('reading:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getReadingService().delete(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[reading:delete] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'reading:saveChat',
    async (
      _,
      input: { paperId: string; noteId: string | null; messages: unknown[] },
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getReadingService().saveChat(input);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:saveChat] Error:', msg);
        return err(msg);
      }
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
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getReadingService().aiEditNotes(input);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:aiEdit] Error:', msg);
        return err(msg);
      }
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
    ): Promise<IpcResult<{ sessionId: string; started: true }>> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return err('No window found');

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
        } catch (chatErr) {
          const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
          win.webContents.send('chat:error', msg);
        } finally {
          activeChats.delete(input.sessionId);
        }

        return ok({ sessionId: input.sessionId, started: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:chat] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reading:chatKill',
    async (_, sessionId: string): Promise<IpcResult<{ killed: boolean }>> => {
      try {
        const controller = activeChats.get(sessionId);
        if (controller) {
          controller.abort();
          activeChats.delete(sessionId);
          return ok({ killed: true });
        }
        return ok({ killed: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:chatKill] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reading:extractPdfUrl',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getReadingService().extractPdfUrl(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:extractPdfUrl] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reading:generateNotes',
    async (_, chatNoteId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getReadingService().generateNotesFromChat(chatNoteId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reading:generateNotes] Error:', msg);
        return err(msg);
      }
    },
  );
}
