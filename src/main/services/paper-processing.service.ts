import { BrowserWindow } from 'electron';
import { PapersRepository } from '@db';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import * as paperEmbeddingService from './paper-embedding.service';

export type PaperProcessingStatus =
  | 'idle'
  | 'queued'
  | 'extracting_metadata'
  | 'embedding'
  | 'completed'
  | 'failed';

export interface EmbeddingRebuildStatus {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  currentPaperId?: string;
  currentPaperTitle?: string;
  error?: string;
}

export interface RebuildCheckResult {
  queued: number;
  dimensionMatch?: boolean;
  currentDimension?: number;
  newDimension?: number;
}

/* ─── Broadcasting ──────────────────────────────────────────────────────────── */

function broadcastProcessingStatus(payload: {
  paperId: string;
  status: PaperProcessingStatus;
  error?: string | null;
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('papers:processingStatus', payload);
  }
}

function broadcastRebuildStatus(status: EmbeddingRebuildStatus) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('embedding:rebuildStatus', status);
  }
}

/* ─── Per-paper helpers ─────────────────────────────────────────────────────── */

async function updateStatus(
  repo: PapersRepository,
  paperId: string,
  status: PaperProcessingStatus,
  extra: {
    processingError?: string | null;
    processedAt?: Date | null;
    indexedAt?: Date | null;
    metadataSource?: string | null;
  } = {},
) {
  await repo.updateProcessingState(paperId, {
    processingStatus: status,
    ...extra,
  });
  broadcastProcessingStatus({ paperId, status, error: extra.processingError });
}

/** Returns true if paper was successfully indexed, false otherwise. */
async function processPaper(paperId: string): Promise<boolean> {
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) return false;

  try {
    await updateStatus(repo, paperId, 'embedding', { processingError: null });

    // Generate embeddings for title and abstract
    await paperEmbeddingService.generateEmbeddings(paperId);

    await updateStatus(repo, paperId, 'completed', {
      processingError: null,
      processedAt: new Date(),
      indexedAt: new Date(),
      metadataSource: paper.metadataSource ?? null,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[paper-processing] Failed to process "${paper.title}": ${message}`);
    await updateStatus(repo, paperId, 'failed', {
      processingError: message,
      indexedAt: null,
    });
    return false;
  }
}

/* ─── Batch embedding (concurrent, single-runner) ───────────────────────────── */

const CONCURRENCY = 5;
let cancelled = false;
let pendingBatch: string[] | null = null;
let rebuildStatus: EmbeddingRebuildStatus = {
  active: false,
  total: 0,
  completed: 0,
  failed: 0,
};
let batchRunning = false;

function shouldSkip(): boolean {
  return !!process.env.VITEST;
}

/**
 * Single-runner batch processor with paper-level concurrency.
 * Only one batch instance runs at a time. If called while already running,
 * the new paperIds are queued and start after the current batch finishes/cancels.
 */
async function runBatch(paperIds: string[]) {
  if (batchRunning) {
    cancelled = true;
    pendingBatch = paperIds;
    console.log(`[paper-processing] Queued ${paperIds.length} papers (waiting for current batch)`);
    return;
  }

  batchRunning = true;
  cancelled = false;
  pendingBatch = null;

  rebuildStatus = {
    active: true,
    total: paperIds.length,
    completed: 0,
    failed: 0,
  };
  broadcastRebuildStatus(rebuildStatus);

  try {
    let index = 0;

    const worker = async (): Promise<void> => {
      while (!cancelled) {
        const i = index++;
        if (i >= paperIds.length) break;
        const paperId = paperIds[i];

        // Look up title for progress
        let title: string | undefined;
        try {
          const repo = new PapersRepository();
          const paper = await repo.findById(paperId);
          title = paper?.title;
        } catch {
          // ignore
        }

        rebuildStatus = {
          ...rebuildStatus,
          currentPaperId: paperId,
          currentPaperTitle: title,
        };
        broadcastRebuildStatus(rebuildStatus);

        if (cancelled) break;

        const success = await processPaper(paperId);
        if (success) {
          rebuildStatus = { ...rebuildStatus, completed: rebuildStatus.completed + 1 };
        } else {
          rebuildStatus = { ...rebuildStatus, failed: rebuildStatus.failed + 1 };
        }
        broadcastRebuildStatus(rebuildStatus);
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, paperIds.length) }, () => worker());
    await Promise.all(workers);
  } finally {
    batchRunning = false;
    rebuildStatus = {
      ...rebuildStatus,
      active: false,
      currentPaperId: undefined,
      currentPaperTitle: undefined,
    };
    broadcastRebuildStatus(rebuildStatus);
    console.log(
      `[paper-processing] Batch complete: ${rebuildStatus.completed} indexed, ${rebuildStatus.failed} failed${cancelled ? ' (cancelled)' : ''}`,
    );

    // If a new batch was queued while we were running, start it now
    if (pendingBatch) {
      const next = pendingBatch;
      pendingBatch = null;
      void runBatch(next);
    }
  }
}

/* ─── Public API ────────────────────────────────────────────────────────────── */

export async function resumeAutomaticPaperProcessing() {
  if (shouldSkip()) return { queued: 0 };

  const settings = getSemanticSearchSettings();
  if (!settings.enabled) return { queued: 0 };

  const repo = new PapersRepository();
  const paperIds = await repo.listPendingSemanticPaperIds();

  if (paperIds.length > 0) {
    console.log(`[paper-processing] Queued ${paperIds.length} papers for embedding`);
    void runBatch(paperIds);
  }

  return { queued: paperIds.length };
}

export async function rebuildAllEmbeddings(
  options: { force?: boolean } = {},
): Promise<RebuildCheckResult> {
  const settings = getSemanticSearchSettings();
  if (!settings.enabled) return { queued: 0 };

  // Check if model hasn't changed (skip rebuild if same model and has indexed data)
  if (!options.force) {
    const indexStatus = vecIndex.getStatus();
    const currentModel = indexStatus.model;
    const newModel = settings.embeddingModel;

    if (currentModel && currentModel === newModel && indexStatus.rowCount > 0) {
      console.log(
        `[paper-processing] Model unchanged (${currentModel}), rebuild may not be needed`,
      );
      return {
        queued: 0,
        dimensionMatch: true,
        currentDimension: indexStatus.dimension ?? 0,
        newDimension: indexStatus.dimension ?? 0,
      };
    }
  }

  const repo = new PapersRepository();
  await repo.clearAllIndexedAt();
  const paperIds = await repo.listPendingSemanticPaperIds();

  if (paperIds.length > 0) {
    console.log(`[paper-processing] Rebuild all: queued ${paperIds.length} papers`);
    // runBatch handles stopping the previous batch internally
    void runBatch(paperIds);
  }

  return { queued: paperIds.length };
}

export async function rebuildSelectedEmbeddings(paperIds: string[]): Promise<{ queued: number }> {
  const settings = getSemanticSearchSettings();
  if (!settings.enabled) return { queued: 0 };
  if (paperIds.length === 0) return { queued: 0 };

  // Reset indexedAt for selected papers only
  const repo = new PapersRepository();
  for (const id of paperIds) {
    await repo.updateProcessingState(id, { processingStatus: 'idle', indexedAt: null });
  }

  console.log(`[paper-processing] Rebuild selected: queued ${paperIds.length} papers`);
  void runBatch(paperIds);
  return { queued: paperIds.length };
}

export function cancelEmbeddingRebuild(): { cancelled: boolean } {
  if (!batchRunning) return { cancelled: false };
  cancelled = true;
  pendingBatch = null; // Don't start any queued batch
  // Immediately broadcast inactive so UI responds right away
  rebuildStatus = {
    ...rebuildStatus,
    active: false,
    currentPaperId: undefined,
    currentPaperTitle: undefined,
  };
  broadcastRebuildStatus(rebuildStatus);
  return { cancelled: true };
}

export function getEmbeddingRebuildStatus(): EmbeddingRebuildStatus {
  return { ...rebuildStatus };
}

export async function retryPaperProcessing(paperId: string) {
  const settings = getSemanticSearchSettings();
  if (!settings.enabled) return { queued: false };
  await processPaper(paperId);
  return { queued: false };
}

export async function getPaperProcessingStatus(paperId: string) {
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) return null;
  return {
    paperId,
    processingStatus: paper.processingStatus,
    processingError: paper.processingError,
    processedAt: paper.processedAt,
    indexedAt: paper.indexedAt,
    metadataSource: paper.metadataSource,
  };
}

export function schedulePaperProcessing(_paperId: string, _options: { force?: boolean } = {}) {
  // No-op: automatic background processing removed; indexing is now on-demand only.
}
