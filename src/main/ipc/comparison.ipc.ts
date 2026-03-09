import { ipcMain, BrowserWindow } from 'electron';
import { ComparisonService } from '../services/comparison.service';
import { ComparisonsRepository, PapersRepository } from '@db';
import type { ComparisonNoteItem, ComparisonChatMessage } from '@shared';

type ComparisonJobStage = 'preparing' | 'streaming' | 'done' | 'error' | 'cancelled';

interface ComparisonJobStatus {
  jobId: string;
  paperIds: string[];
  active: boolean;
  stage: ComparisonJobStage;
  partialText: string;
  message: string;
  error: string | null;
  savedId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

type TranslationJobStage = 'streaming' | 'done' | 'error' | 'cancelled';

interface TranslationJobStatus {
  jobId: string;
  comparisonId: string;
  active: boolean;
  stage: TranslationJobStage;
  partialText: string;
  message: string;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

let comparisonService: ComparisonService | null = null;

const activeComparisons = new Map<string, AbortController>();
const comparisonJobs = new Map<string, ComparisonJobStatus>();
const MAX_COMPARISON_JOBS = 10;

const activeTranslations = new Map<string, AbortController>();
const translationJobs = new Map<string, TranslationJobStatus>();

type ChatJobStage = 'streaming' | 'done' | 'error' | 'cancelled';

interface ChatJobStatus {
  jobId: string;
  comparisonId: string;
  active: boolean;
  stage: ChatJobStage;
  partialText: string;
  message: string;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const activeChatJobs = new Map<string, AbortController>();
const chatJobs = new Map<string, ChatJobStatus>();

function getComparisonService() {
  if (!comparisonService) comparisonService = new ComparisonService();
  return comparisonService;
}

function broadcastToAll(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function listComparisonJobs(): ComparisonJobStatus[] {
  return Array.from(comparisonJobs.values()).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function pruneComparisonJobs() {
  const keepIds = new Set(
    listComparisonJobs()
      .slice(0, MAX_COMPARISON_JOBS)
      .map((job) => job.jobId),
  );
  for (const [jobId, job] of comparisonJobs.entries()) {
    if (!job.active && !keepIds.has(jobId)) {
      comparisonJobs.delete(jobId);
    }
  }
}

function saveComparisonJob(job: ComparisonJobStatus) {
  comparisonJobs.set(job.jobId, job);
  pruneComparisonJobs();
  broadcastToAll('comparison:status', job);
  return job;
}

function updateComparisonJob(jobId: string, patch: Partial<ComparisonJobStatus>) {
  const current = comparisonJobs.get(jobId);
  if (!current) return null;
  return saveComparisonJob({
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

export function setupComparisonIpc() {
  const repo = new ComparisonsRepository();
  const papersRepo = new PapersRepository();

  ipcMain.handle(
    'comparison:start',
    async (_, input: { sessionId: string; paperIds: string[] }) => {
      const jobId = input.sessionId ?? `comparison-${Date.now()}`;
      const now = new Date().toISOString();
      const controller = new AbortController();

      activeComparisons.set(jobId, controller);

      // Immediately persist to DB so it appears in history
      let savedId: string | null = null;
      try {
        const papers = await Promise.all(input.paperIds.map((id) => papersRepo.findById(id)));
        const titles = papers.map((p) => p.title);
        const row = await repo.create({
          paperIds: input.paperIds,
          titles,
          contentMd: '',
        });
        savedId = row.id;
      } catch {
        // Non-fatal — comparison still runs, just won't be in history until done
      }

      saveComparisonJob({
        jobId,
        paperIds: input.paperIds,
        active: true,
        stage: 'preparing',
        partialText: '',
        message: 'Preparing comparison…',
        error: null,
        savedId,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      });

      void (async () => {
        try {
          await getComparisonService().comparePapers(
            { paperIds: input.paperIds },
            (chunk) => {
              const current = comparisonJobs.get(jobId);
              updateComparisonJob(jobId, {
                stage: 'streaming',
                partialText: `${current?.partialText ?? ''}${chunk}`,
                message: 'Generating comparison…',
              });
            },
            controller.signal,
            (progressMessage) => {
              updateComparisonJob(jobId, {
                stage: 'preparing',
                message: progressMessage,
              });
            },
          );

          const finalJob = comparisonJobs.get(jobId);
          // Update DB with final content
          if (savedId && finalJob?.partialText) {
            await repo
              .update(savedId, {
                contentMd: finalJob.partialText,
                translatedContentMd: null,
                chatMessagesJson: '[]',
              })
              .catch(() => undefined);
          }

          updateComparisonJob(jobId, {
            active: false,
            stage: 'done',
            message: 'Comparison complete',
            error: null,
            completedAt: new Date().toISOString(),
          });
        } catch (err) {
          const aborted = isAbortError(err);
          const message = err instanceof Error ? err.message : String(err);

          // Save partial content on error/cancel too
          const finalJob = comparisonJobs.get(jobId);
          if (savedId && finalJob?.partialText) {
            await repo
              .update(savedId, {
                contentMd: finalJob.partialText,
                translatedContentMd: null,
                chatMessagesJson: '[]',
              })
              .catch(() => undefined);
          }
          // Delete empty DB record if cancelled with no content
          if (savedId && !finalJob?.partialText && aborted) {
            await repo.delete(savedId).catch(() => undefined);
          }

          updateComparisonJob(jobId, {
            active: false,
            stage: aborted ? 'cancelled' : 'error',
            message: aborted ? 'Comparison cancelled' : `Comparison failed: ${message}`,
            error: aborted ? null : message,
            savedId: !finalJob?.partialText && aborted ? null : savedId,
            completedAt: new Date().toISOString(),
          });
        } finally {
          activeComparisons.delete(jobId);
          pruneComparisonJobs();
        }
      })();

      return { jobId, savedId, started: true };
    },
  );

  ipcMain.handle('comparison:getActiveJobs', async (): Promise<ComparisonJobStatus[]> => {
    return listComparisonJobs();
  });

  ipcMain.handle('comparison:kill', async (_, jobId: string) => {
    const controller = activeComparisons.get(jobId);
    if (controller) {
      controller.abort();
      return { killed: true };
    }
    return { killed: false };
  });

  // ── Persistence handlers ──────────────────────────────────────────────────

  ipcMain.handle('comparison:list', async (): Promise<ComparisonNoteItem[]> => {
    const rows = await repo.list();
    return rows.map((row) => ({
      id: row.id,
      paperIds: JSON.parse(row.paperIdsJson) as string[],
      titles: JSON.parse(row.titlesJson) as string[],
      contentMd: row.contentMd,
      translatedContentMd: row.translatedContentMd ?? null,
      chatMessages: JSON.parse(row.chatMessagesJson) as ComparisonChatMessage[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  });

  ipcMain.handle('comparison:delete', async (_, id: string): Promise<{ success: boolean }> => {
    await repo.delete(id);
    return { success: true };
  });

  // ── Translation handlers ──────────────────────────────────────────────────

  ipcMain.handle(
    'comparison:translate',
    async (_, input: { comparisonId: string }): Promise<{ jobId: string; started: boolean }> => {
      const { comparisonId } = input;

      // Check if already translating this comparison
      const existing = translationJobs.get(comparisonId);
      if (existing?.active) {
        return { jobId: existing.jobId, started: false };
      }

      // Load the comparison from DB
      const row = await repo.getById(comparisonId);
      if (!row || !row.contentMd) {
        throw new Error('Comparison not found or has no content');
      }

      // If already translated, return immediately
      if (row.translatedContentMd) {
        return { jobId: comparisonId, started: false };
      }

      const jobId = comparisonId;
      const now = new Date().toISOString();
      const controller = new AbortController();
      activeTranslations.set(jobId, controller);

      const job: TranslationJobStatus = {
        jobId,
        comparisonId,
        active: true,
        stage: 'streaming',
        partialText: '',
        message: 'Translating…',
        error: null,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      };
      translationJobs.set(jobId, job);
      broadcastToAll('comparison:translateStatus', job);

      void (async () => {
        try {
          await getComparisonService().translateComparison(
            row.contentMd,
            (chunk) => {
              const current = translationJobs.get(jobId);
              if (!current) return;
              const updated: TranslationJobStatus = {
                ...current,
                partialText: current.partialText + chunk,
                updatedAt: new Date().toISOString(),
              };
              translationJobs.set(jobId, updated);
              broadcastToAll('comparison:translateStatus', updated);
            },
            controller.signal,
          );

          const finalJob = translationJobs.get(jobId);
          if (finalJob?.partialText) {
            await repo
              .update(comparisonId, { translatedContentMd: finalJob.partialText })
              .catch(() => undefined);
          }

          const doneJob: TranslationJobStatus = {
            ...(translationJobs.get(jobId) ?? job),
            active: false,
            stage: 'done',
            message: 'Translation complete',
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          translationJobs.set(jobId, doneJob);
          broadcastToAll('comparison:translateStatus', doneJob);
        } catch (err) {
          const aborted = isAbortError(err);
          const message = err instanceof Error ? err.message : String(err);

          const errJob: TranslationJobStatus = {
            ...(translationJobs.get(jobId) ?? job),
            active: false,
            stage: aborted ? 'cancelled' : 'error',
            message: aborted ? 'Translation cancelled' : `Translation failed: ${message}`,
            error: aborted ? null : message,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          translationJobs.set(jobId, errJob);
          broadcastToAll('comparison:translateStatus', errJob);
        } finally {
          activeTranslations.delete(jobId);
        }
      })();

      return { jobId, started: true };
    },
  );

  ipcMain.handle(
    'comparison:getActiveTranslationJobs',
    async (): Promise<TranslationJobStatus[]> => {
      return Array.from(translationJobs.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    },
  );

  ipcMain.handle('comparison:killTranslation', async (_, jobId: string) => {
    const controller = activeTranslations.get(jobId);
    if (controller) {
      controller.abort();
      return { killed: true };
    }
    return { killed: false };
  });

  // ── Chat handlers ────────────────────────────────────────────────────────

  ipcMain.handle(
    'comparison:chat',
    async (
      _,
      input: { comparisonId: string; messages: ComparisonChatMessage[] },
    ): Promise<{ jobId: string; started: boolean }> => {
      const { comparisonId, messages } = input;

      // Kill any existing chat job for this comparison
      const existingController = activeChatJobs.get(comparisonId);
      if (existingController) {
        existingController.abort();
        activeChatJobs.delete(comparisonId);
      }

      const row = await repo.getById(comparisonId);
      if (!row || !row.contentMd) {
        throw new Error('Comparison not found or has no content');
      }

      const titles: string[] = JSON.parse(row.titlesJson);
      const jobId = `chat-${comparisonId}-${Date.now()}`;
      const now = new Date().toISOString();
      const controller = new AbortController();
      activeChatJobs.set(comparisonId, controller);

      const job: ChatJobStatus = {
        jobId,
        comparisonId,
        active: true,
        stage: 'streaming',
        partialText: '',
        message: 'Thinking…',
        error: null,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      };
      chatJobs.set(comparisonId, job);
      broadcastToAll('comparison:chatStatus', job);

      void (async () => {
        try {
          await getComparisonService().chatAboutComparison(
            {
              comparisonContentMd: row.contentMd,
              paperTitles: titles,
              messages,
            },
            (chunk) => {
              const current = chatJobs.get(comparisonId);
              if (!current) return;
              const updated: ChatJobStatus = {
                ...current,
                partialText: current.partialText + chunk,
                message: 'Responding…',
                updatedAt: new Date().toISOString(),
              };
              chatJobs.set(comparisonId, updated);
              broadcastToAll('comparison:chatStatus', updated);
            },
            controller.signal,
          );

          // Save messages + assistant response to DB
          const finalJob = chatJobs.get(comparisonId);
          if (finalJob?.partialText) {
            const allMessages: ComparisonChatMessage[] = [
              ...messages,
              { role: 'assistant', content: finalJob.partialText },
            ];
            await repo
              .update(comparisonId, { chatMessagesJson: JSON.stringify(allMessages) })
              .catch(() => undefined);
          }

          const doneJob: ChatJobStatus = {
            ...(chatJobs.get(comparisonId) ?? job),
            active: false,
            stage: 'done',
            message: 'Done',
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          chatJobs.set(comparisonId, doneJob);
          broadcastToAll('comparison:chatStatus', doneJob);
        } catch (err) {
          const aborted = isAbortError(err);
          const message = err instanceof Error ? err.message : String(err);

          const errJob: ChatJobStatus = {
            ...(chatJobs.get(comparisonId) ?? job),
            active: false,
            stage: aborted ? 'cancelled' : 'error',
            message: aborted ? 'Chat cancelled' : `Chat failed: ${message}`,
            error: aborted ? null : message,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          chatJobs.set(comparisonId, errJob);
          broadcastToAll('comparison:chatStatus', errJob);
        } finally {
          activeChatJobs.delete(comparisonId);
        }
      })();

      return { jobId, started: true };
    },
  );

  ipcMain.handle('comparison:chatJobs', async (): Promise<ChatJobStatus[]> => {
    return Array.from(chatJobs.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

  ipcMain.handle('comparison:chatKill', async (_, comparisonId: string) => {
    const controller = activeChatJobs.get(comparisonId);
    if (controller) {
      controller.abort();
      return { killed: true };
    }
    return { killed: false };
  });
}
