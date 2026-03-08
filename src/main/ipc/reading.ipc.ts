import { ipcMain, BrowserWindow } from 'electron';
import { PapersRepository } from '@db';
import {
  ReadingService,
  type ChatMessage,
  type PaperAnalysisStage,
} from '../services/reading.service';

interface AnalysisJobStatus {
  jobId: string;
  paperId: string;
  paperShortId: string | null;
  paperTitle: string | null;
  active: boolean;
  stage: PaperAnalysisStage;
  partialText: string;
  message: string;
  error: string | null;
  noteId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let readingService: ReadingService | null = null;
const activeChats = new Map<string, AbortController>();
const activeAnalyses = new Map<string, { controller: AbortController; paperId: string }>();
const activeAnalysisJobByPaperId = new Map<string, string>();
const analysisJobs = new Map<string, AnalysisJobStatus>();
const MAX_ANALYSIS_JOBS = 20;

function getReadingService() {
  if (!readingService) readingService = new ReadingService();
  return readingService;
}

function broadcastToAll(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function listAnalysisJobs(): AnalysisJobStatus[] {
  return Array.from(analysisJobs.values()).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function pruneAnalysisJobs() {
  const keepIds = new Set(
    listAnalysisJobs()
      .slice(0, MAX_ANALYSIS_JOBS)
      .map((job) => job.jobId),
  );
  for (const [jobId, job] of analysisJobs.entries()) {
    if (!job.active && !keepIds.has(jobId)) {
      analysisJobs.delete(jobId);
    }
  }
}

function saveAnalysisJob(job: AnalysisJobStatus) {
  analysisJobs.set(job.jobId, job);
  pruneAnalysisJobs();
  broadcastToAll('analysis:status', job);
  return job;
}

function updateAnalysisJob(jobId: string, patch: Partial<AnalysisJobStatus>) {
  const current = analysisJobs.get(jobId);
  if (!current) return null;
  return saveAnalysisJob({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.name === 'AbortError' || /aborted|cancelled/i.test(error.message);
  }
  return /aborted|cancelled/i.test(String(error));
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

  ipcMain.handle('reading:delete', async (_, id: string) => {
    return getReadingService().delete(id);
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

  ipcMain.handle(
    'reading:analyze',
    async (_, input: { sessionId?: string; paperId: string; pdfUrl?: string }) => {
      const papersRepository = new PapersRepository();
      const paper = await papersRepository.findById(input.paperId);
      if (!paper) {
        throw new Error('Paper not found');
      }

      const existingJobId = activeAnalysisJobByPaperId.get(input.paperId);
      if (existingJobId) {
        const existingJob = analysisJobs.get(existingJobId);
        if (existingJob?.active) {
          return {
            jobId: existingJobId,
            sessionId: existingJobId,
            started: false,
            alreadyRunning: true,
          };
        }
      }

      const jobId = input.sessionId ?? `analysis-${Date.now()}`;
      const now = new Date().toISOString();
      const controller = new AbortController();

      activeAnalyses.set(jobId, { controller, paperId: input.paperId });
      activeAnalysisJobByPaperId.set(input.paperId, jobId);

      saveAnalysisJob({
        jobId,
        paperId: input.paperId,
        paperShortId: paper.shortId,
        paperTitle: paper.title,
        active: true,
        stage: 'preparing',
        partialText: '',
        message: 'Preparing paper context…',
        error: null,
        noteId: null,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      });

      void (async () => {
        try {
          const result = await getReadingService().analyzePaper(
            { paperId: input.paperId, pdfUrl: input.pdfUrl },
            (chunk) => {
              const current = analysisJobs.get(jobId);
              updateAnalysisJob(jobId, {
                active: true,
                stage: 'streaming',
                partialText: `${current?.partialText ?? ''}${chunk}`,
                message: 'Analyzing paper…',
                error: null,
              });
              broadcastToAll('analysis:output', {
                jobId,
                sessionId: jobId,
                paperId: input.paperId,
                chunk,
              });
            },
            controller.signal,
            (stage, message) => {
              updateAnalysisJob(jobId, {
                active: true,
                stage,
                message,
                error: null,
              });
            },
          );

          updateAnalysisJob(jobId, {
            active: false,
            stage: 'done',
            partialText: '',
            message: 'Analysis complete',
            error: null,
            noteId: result.noteId,
            completedAt: new Date().toISOString(),
          });
          broadcastToAll('analysis:done', {
            jobId,
            sessionId: jobId,
            paperId: input.paperId,
            ...result,
          });
        } catch (err) {
          const aborted = isAbortError(err);
          const message = err instanceof Error ? err.message : String(err);
          updateAnalysisJob(jobId, {
            active: false,
            stage: aborted ? 'cancelled' : 'error',
            message: aborted ? 'Analysis cancelled' : `Analysis failed: ${message}`,
            error: aborted ? null : message,
            completedAt: new Date().toISOString(),
          });
          broadcastToAll('analysis:error', {
            jobId,
            sessionId: jobId,
            paperId: input.paperId,
            error: aborted ? 'Analysis cancelled' : message,
          });
        } finally {
          activeAnalyses.delete(jobId);
          if (activeAnalysisJobByPaperId.get(input.paperId) === jobId) {
            activeAnalysisJobByPaperId.delete(input.paperId);
          }
          pruneAnalysisJobs();
        }
      })();

      return { jobId, sessionId: jobId, started: true };
    },
  );

  ipcMain.handle('reading:analysisJobs', async () => listAnalysisJobs());

  ipcMain.handle('reading:analyzeKill', async (_, jobId: string) => {
    const entry = activeAnalyses.get(jobId);
    if (entry) {
      entry.controller.abort();
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
