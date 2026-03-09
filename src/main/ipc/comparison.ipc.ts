import { ipcMain, BrowserWindow } from 'electron';
import { ComparisonService } from '../services/comparison.service';
import { ComparisonsRepository } from '@db';
import type { ComparisonNoteItem } from '@shared';

type ComparisonJobStage = 'preparing' | 'streaming' | 'done' | 'error' | 'cancelled';

interface ComparisonJobStatus {
  jobId: string;
  paperIds: string[];
  active: boolean;
  stage: ComparisonJobStage;
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
  ipcMain.handle(
    'comparison:start',
    async (_, input: { sessionId: string; paperIds: string[] }) => {
      const jobId = input.sessionId ?? `comparison-${Date.now()}`;
      const now = new Date().toISOString();
      const controller = new AbortController();

      activeComparisons.set(jobId, controller);

      saveComparisonJob({
        jobId,
        paperIds: input.paperIds,
        active: true,
        stage: 'preparing',
        partialText: '',
        message: 'Preparing comparison…',
        error: null,
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
          );

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
          updateComparisonJob(jobId, {
            active: false,
            stage: aborted ? 'cancelled' : 'error',
            message: aborted ? 'Comparison cancelled' : `Comparison failed: ${message}`,
            error: aborted ? null : message,
            completedAt: new Date().toISOString(),
          });
        } finally {
          activeComparisons.delete(jobId);
          pruneComparisonJobs();
        }
      })();

      return { jobId, started: true };
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

  const repo = new ComparisonsRepository();

  ipcMain.handle(
    'comparison:save',
    async (
      _,
      input: { paperIds: string[]; titles: string[]; contentMd: string },
    ): Promise<ComparisonNoteItem> => {
      const row = await repo.create(input);
      return {
        id: row.id,
        paperIds: JSON.parse(row.paperIdsJson) as string[],
        titles: JSON.parse(row.titlesJson) as string[],
        contentMd: row.contentMd,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  ipcMain.handle('comparison:list', async (): Promise<ComparisonNoteItem[]> => {
    const rows = await repo.list();
    return rows.map((row) => ({
      id: row.id,
      paperIds: JSON.parse(row.paperIdsJson) as string[],
      titles: JSON.parse(row.titlesJson) as string[],
      contentMd: row.contentMd,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  });

  ipcMain.handle('comparison:delete', async (_, id: string): Promise<{ success: boolean }> => {
    await repo.delete(id);
    return { success: true };
  });
}
