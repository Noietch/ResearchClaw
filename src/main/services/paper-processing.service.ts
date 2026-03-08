import { BrowserWindow } from 'electron';
import { PapersRepository } from '@db';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import { getPaperText } from './paper-text.service';
import { localSemanticService } from './local-semantic.service';
import { extractPaperMetadata } from './paper-metadata.service';
import { sanitizeSemanticText, splitTextIntoChunks } from './semantic-utils';
import * as vecIndex from './vec-index.service';

export type PaperProcessingStatus =
  | 'idle'
  | 'queued'
  | 'extracting_text'
  | 'extracting_metadata'
  | 'chunking'
  | 'embedding'
  | 'completed'
  | 'failed';

const queue: string[] = [];
const queuedIds = new Set<string>();
let running = false;

function inferPdfUrl(paper: {
  pdfUrl?: string | null;
  sourceUrl?: string | null;
  shortId: string;
}): string | undefined {
  if (paper.pdfUrl) return paper.pdfUrl;
  if (paper.sourceUrl) {
    const absMatch = paper.sourceUrl.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/i);
    if (absMatch) return `https://arxiv.org/pdf/${absMatch[1]}`;
  }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.shortId)) {
    return `https://arxiv.org/pdf/${paper.shortId}`;
  }
  return undefined;
}

function broadcastProcessingStatus(payload: {
  paperId: string;
  status: PaperProcessingStatus;
  error?: string | null;
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('papers:processingStatus', payload);
  }
}

function shouldSkipAutomaticProcessing(): boolean {
  return !!process.env.VITEST;
}

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

async function processPaper(paperId: string) {
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) return;

  const pdfUrl = inferPdfUrl(paper);
  if (!paper.pdfPath && !pdfUrl) {
    await updateStatus(repo, paperId, 'failed', {
      processingError: 'No PDF or downloadable PDF URL available for semantic processing.',
      indexedAt: null,
    });
    return;
  }

  try {
    await updateStatus(repo, paperId, 'extracting_text', { processingError: null });
    const rawText = await getPaperText(
      paper.id,
      paper.shortId,
      pdfUrl,
      paper.pdfPath ?? undefined,
      {
        maxChars: 220_000,
      },
    );
    const text = sanitizeSemanticText(rawText);
    if (!text.trim()) {
      throw new Error('Could not extract text from PDF.');
    }

    let metadataSource: string | null = paper.metadataSource ?? null;
    try {
      await updateStatus(repo, paperId, 'extracting_metadata', { processingError: null });
      const extracted = await extractPaperMetadata(text);
      const nextTitle = paper.source === 'manual' ? extracted.title?.trim() : undefined;
      const nextAuthors = !paper.authors?.length ? extracted.authors : undefined;
      const nextAbstract = !paper.abstract?.trim() ? extracted.abstract?.trim() : undefined;
      const nextSubmittedAt =
        !paper.submittedAt && extracted.submittedAt ? extracted.submittedAt : undefined;
      if (nextTitle || nextAuthors || nextAbstract || nextSubmittedAt) {
        await repo.updateMetadata(paperId, {
          title: nextTitle,
          authors: nextAuthors,
          abstract: nextAbstract,
          submittedAt: nextSubmittedAt,
          metadataSource: 'lightweight-model',
        });
        metadataSource = 'lightweight-model';
      }
    } catch (error) {
      console.warn('[paper-processing] metadata extraction failed:', error);
    }

    await updateStatus(repo, paperId, 'chunking', { processingError: null, metadataSource });
    const chunks = splitTextIntoChunks(text, { chunkSize: 1600, overlap: 220 });
    if (chunks.length === 0) {
      throw new Error('Paper text was empty after chunking.');
    }

    await updateStatus(repo, paperId, 'embedding', { processingError: null, metadataSource });
    const embeddings = await localSemanticService.embedTexts(chunks.map((chunk) => chunk.content));
    if (embeddings.length !== chunks.length) {
      throw new Error('Embedding count did not match chunk count.');
    }

    await repo.replaceChunks(
      paperId,
      chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index],
      })),
    );

    // Sync vec index (non-blocking — failure does not affect main flow)
    try {
      if (vecIndex.isInitialized()) {
        const chunkIds = await repo.listChunkIdsForPaper(paperId);
        vecIndex.syncChunksForPaper(
          paperId,
          chunkIds.map((id, i) => ({ id, embedding: embeddings[i] })),
        );
      }
    } catch (vecErr) {
      console.warn('[paper-processing] vec index sync failed:', vecErr);
    }

    await updateStatus(repo, paperId, 'completed', {
      processingError: null,
      processedAt: new Date(),
      indexedAt: new Date(),
      metadataSource,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStatus(repo, paperId, 'failed', {
      processingError: message,
      indexedAt: null,
    });
  }
}

async function drainQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const paperId = queue.shift();
      if (!paperId) continue;
      queuedIds.delete(paperId);
      await processPaper(paperId);
    }
  } finally {
    running = false;
  }
}

export function schedulePaperProcessing(paperId: string, options: { force?: boolean } = {}) {
  if (shouldSkipAutomaticProcessing()) return;

  const settings = getSemanticSearchSettings();
  if (!settings.enabled) return;
  if (!settings.autoProcess && !options.force) return;

  if (!options.force && queuedIds.has(paperId)) return;
  queuedIds.add(paperId);
  queue.push(paperId);

  const repo = new PapersRepository();
  void repo
    .updateProcessingState(paperId, {
      processingStatus: 'queued',
      processingError: null,
    })
    .catch(() => undefined)
    .finally(() => broadcastProcessingStatus({ paperId, status: 'queued' }));

  void drainQueue();
}

export async function resumeAutomaticPaperProcessing() {
  if (shouldSkipAutomaticProcessing()) return { queued: 0 };

  const settings = getSemanticSearchSettings();
  if (!settings.enabled || !settings.autoProcess) {
    return { queued: 0 };
  }

  const repo = new PapersRepository();
  const paperIds = await repo.listPendingSemanticPaperIds();
  for (const paperId of paperIds) {
    schedulePaperProcessing(paperId);
  }

  return { queued: paperIds.length };
}

export async function retryPaperProcessing(paperId: string) {
  schedulePaperProcessing(paperId, { force: true });
  return { queued: true };
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
