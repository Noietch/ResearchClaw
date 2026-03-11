import { ipcMain, BrowserWindow } from 'electron';
import { PapersRepository } from '@db';
import {
  ReadingService,
  type ChatMessage,
  type PaperAnalysisStage,
} from '../services/reading.service';

type ChatJobStage = 'preparing' | 'streaming' | 'done' | 'error' | 'cancelled';

interface ChatJobStatus {
  jobId: string;
  paperId: string;
  paperTitle: string | null;
  chatNoteId: string | null;
  active: boolean;
  stage: ChatJobStage;
  partialText: string;
  messages: ChatMessage[];
  message: string;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

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

// Chat job tracking
const activeChats = new Map<string, AbortController>();
const activeChatByPaperId = new Map<string, string>();
const chatJobs = new Map<string, ChatJobStatus>();
const MAX_CHAT_JOBS = 20;

// Analysis job tracking
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

// ─── Chat job helpers ─────────────────────────────────────────────────────────

function listChatJobs(): ChatJobStatus[] {
  return Array.from(chatJobs.values()).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function pruneChatJobs() {
  const keepIds = new Set(
    listChatJobs()
      .slice(0, MAX_CHAT_JOBS)
      .map((job) => job.jobId),
  );
  for (const [jobId, job] of chatJobs.entries()) {
    if (!job.active && !keepIds.has(jobId)) {
      chatJobs.delete(jobId);
    }
  }
}

function saveChatJob(job: ChatJobStatus) {
  chatJobs.set(job.jobId, job);
  pruneChatJobs();
  broadcastToAll('chat:status', job);
  return job;
}

function updateChatJob(jobId: string, patch: Partial<ChatJobStatus>) {
  const current = chatJobs.get(jobId);
  if (!current) return null;
  return saveChatJob({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

// ─── Analysis job helpers ─────────────────────────────────────────────────────

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

  ipcMain.handle('reading:listChatSessions', async (_, paperId: string) => {
    return getReadingService().listChatSessions(paperId);
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
      _,
      input: {
        sessionId: string;
        paperId: string;
        messages: ChatMessage[];
        pdfUrl?: string;
        chatNoteId?: string | null;
      },
    ) => {
      const papersRepository = new PapersRepository();
      const paper = await papersRepository.findById(input.paperId).catch(() => null);

      // Abort any existing active chat for this paper
      const existingJobId = activeChatByPaperId.get(input.paperId);
      if (existingJobId) {
        const existingController = activeChats.get(existingJobId);
        if (existingController) {
          existingController.abort();
          activeChats.delete(existingJobId);
        }
        updateChatJob(existingJobId, {
          active: false,
          stage: 'cancelled',
          message: 'Superseded by new chat request',
          completedAt: new Date().toISOString(),
        });
      }

      const jobId = `chat-${Date.now()}`;
      const now = new Date().toISOString();
      const controller = new AbortController();

      activeChats.set(jobId, controller);
      activeChatByPaperId.set(input.paperId, jobId);

      saveChatJob({
        jobId,
        paperId: input.paperId,
        paperTitle: paper?.title ?? null,
        chatNoteId: input.chatNoteId ?? null,
        active: true,
        stage: 'preparing',
        partialText: '',
        messages: input.messages,
        message: 'Preparing chat…',
        error: null,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      });

      // Fire and forget — work runs in background
      void (async () => {
        try {
          // Save user messages to DB first so they persist even on crash
          const saveResult = await getReadingService().saveChat({
            paperId: input.paperId,
            noteId: input.chatNoteId ?? null,
            messages: input.messages,
          });
          const chatNoteId = input.chatNoteId ?? saveResult.id;
          updateChatJob(jobId, { chatNoteId });

          const fullText = await getReadingService().chat(
            {
              paperId: input.paperId,
              messages: input.messages,
              pdfUrl: input.pdfUrl,
            },
            (chunk) => {
              const current = chatJobs.get(jobId);
              updateChatJob(jobId, {
                stage: 'streaming',
                partialText: `${current?.partialText ?? ''}${chunk}`,
                message: 'Streaming response…',
              });
            },
            controller.signal,
          );

          // Append assistant message and save to DB
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: fullText.trim(),
            ts: Date.now(),
          };
          const finalMessages = [...input.messages, assistantMsg];
          await getReadingService().saveChat({
            paperId: input.paperId,
            noteId: chatNoteId,
            messages: finalMessages,
          });

          updateChatJob(jobId, {
            active: false,
            stage: 'done',
            partialText: '',
            messages: finalMessages,
            chatNoteId,
            message: 'Chat complete',
            error: null,
            completedAt: new Date().toISOString(),
          });
        } catch (err) {
          const aborted = isAbortError(err);
          const message = err instanceof Error ? err.message : String(err);

          // If aborted with partial text, save partial as stopped message
          const current = chatJobs.get(jobId);
          if (aborted && current?.partialText?.trim()) {
            const stoppedMsg: ChatMessage = {
              role: 'assistant',
              content: current.partialText.trim() + ' [stopped]',
              ts: Date.now(),
            };
            const finalMessages = [...input.messages, stoppedMsg];
            if (current.chatNoteId) {
              await getReadingService()
                .saveChat({
                  paperId: input.paperId,
                  noteId: current.chatNoteId,
                  messages: finalMessages,
                })
                .catch(() => undefined);
            }
            updateChatJob(jobId, {
              active: false,
              stage: 'cancelled',
              messages: finalMessages,
              message: 'Chat cancelled',
              error: null,
              completedAt: new Date().toISOString(),
            });
          } else {
            updateChatJob(jobId, {
              active: false,
              stage: aborted ? 'cancelled' : 'error',
              message: aborted ? 'Chat cancelled' : `Chat failed: ${message}`,
              error: aborted ? null : message,
              completedAt: new Date().toISOString(),
            });
          }
        } finally {
          activeChats.delete(jobId);
          if (activeChatByPaperId.get(input.paperId) === jobId) {
            activeChatByPaperId.delete(input.paperId);
          }
          pruneChatJobs();
        }
      })();

      return { jobId, sessionId: jobId, started: true };
    },
  );

  ipcMain.handle('reading:chatKill', async (_, jobId: string) => {
    const controller = activeChats.get(jobId);
    if (controller) {
      controller.abort();
      return { killed: true };
    }
    return { killed: false };
  });

  ipcMain.handle('reading:chatJobs', async () => listChatJobs());

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

  ipcMain.handle('reading:generateNotesFromAllChats', async (_, paperId: string) => {
    return getReadingService().generateNotesFromAllChats(paperId);
  });
}
