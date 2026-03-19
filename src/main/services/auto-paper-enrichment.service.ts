import { PapersRepository, ReadingRepository } from '@db';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import { ReadingService } from './reading.service';
import { tagPaper, inferTitleAndAbstractFromExcerpt } from './tagging.service';
import { getPaperExcerptCached } from './paper-text.service';
import { BrowserWindow } from 'electron';

const AUTO_ENRICH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.VIBE_AUTO_ENRICH_CONCURRENCY ?? '8', 10) || 8,
);

const queue: string[] = [];
const queuedIds = new Set<string>();
const inFlightIds = new Set<string>();
let activeWorkers = 0;

// Metadata extraction state
let metadataExtractionActive = false;
let metadataExtractionProgress = { total: 0, completed: 0 };

function shouldSkipAutomaticEnrichment() {
  return process.env.VITEST === 'true' && process.env.VIBE_ENABLE_AUTO_ENRICH_IN_TESTS !== '1';
}

function broadcastMetadataExtractionStatus() {
  const wins = BrowserWindow ? BrowserWindow.getAllWindows() : [];
  for (const win of wins) {
    win.webContents.send('metadata:extractionStatus', {
      active: metadataExtractionActive,
      ...metadataExtractionProgress,
    });
  }
}

async function enrichPaper(paperId: string) {
  inFlightIds.add(paperId);

  try {
    const papersRepository = new PapersRepository();
    const readingRepository = new ReadingRepository();
    const readingService = new ReadingService();

    const paper = await papersRepository.findById(paperId);
    if (!paper) return;

    const existingNotes = await readingRepository.listByPaper(paperId);
    const hasAnalysis = existingNotes.some((note) => note.title.startsWith('Analysis:'));

    if (!hasAnalysis) {
      try {
        await readingService.analyzePaper(
          {
            paperId,
            pdfUrl: paper.pdfUrl ?? undefined,
          },
          () => undefined,
          undefined,
          () => undefined,
        );
      } catch (error) {
        console.error('[auto-enrich] Analysis failed:', paperId, error);
      }
    }

    if (!paper.tagNames?.length) {
      try {
        await tagPaper(paperId, { managedStatus: false });
      } catch (error) {
        console.error('[auto-enrich] Auto tag failed:', paperId, error);
      }
    }
  } finally {
    inFlightIds.delete(paperId);
  }
}

async function drainQueue() {
  while (activeWorkers < AUTO_ENRICH_CONCURRENCY && queue.length > 0) {
    activeWorkers += 1;
    void (async () => {
      try {
        while (queue.length > 0) {
          const paperId = queue.shift();
          if (!paperId) continue;
          queuedIds.delete(paperId);
          await enrichPaper(paperId);
        }
      } finally {
        activeWorkers -= 1;
        if (queue.length > 0) {
          void drainQueue();
        }
      }
    })();
  }
}

export function scheduleAutoPaperEnrichment(paperId: string) {
  if (shouldSkipAutomaticEnrichment()) return;
  const settings = getSemanticSearchSettings();
  if (!settings.autoEnrich) return;
  if (queuedIds.has(paperId) || inFlightIds.has(paperId)) return;
  queuedIds.add(paperId);
  queue.push(paperId);
  void drainQueue();
}

/**
 * Batch extract title and abstract from PDFs for papers that are missing them.
 * This runs with concurrency of 8 to speed up processing.
 */
export async function extractMissingMetadata(): Promise<{ extracted: number; failed: number }> {
  if (metadataExtractionActive) {
    throw new Error('Metadata extraction already in progress');
  }

  const repo = new PapersRepository();
  const papersMissingAbstract = await repo.listPapersMissingAbstract();

  if (papersMissingAbstract.length === 0) {
    return { extracted: 0, failed: 0 };
  }

  metadataExtractionActive = true;
  metadataExtractionProgress = { total: papersMissingAbstract.length, completed: 0 };
  broadcastMetadataExtractionStatus();

  let extracted = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    while (idx < papersMissingAbstract.length) {
      const paper = papersMissingAbstract[idx++];
      if (!paper) continue;

      try {
        // Get PDF excerpt
        const pdfExcerpt = await getPaperExcerptCached(
          paper.id,
          paper.shortId,
          paper.pdfUrl ?? undefined,
          paper.pdfPath ?? undefined,
          6000,
        );

        if (pdfExcerpt) {
          const inferred = inferTitleAndAbstractFromExcerpt(pdfExcerpt);
          if (inferred.abstract || inferred.title) {
            await repo.updateMetadata(paper.id, {
              ...(inferred.title ? { title: inferred.title } : {}),
              ...(inferred.abstract ? { abstract: inferred.abstract } : {}),
              metadataSource: 'pdf-extraction',
            });
            extracted++;
            console.log(`[metadata-extraction] Extracted metadata for: ${paper.title}`);
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (error) {
        console.error('[metadata-extraction] Failed for:', paper.id, error);
        failed++;
      }

      metadataExtractionProgress.completed++;
      broadcastMetadataExtractionStatus();
    }
  }

  // Run with concurrency
  await Promise.all(
    Array.from({ length: Math.min(AUTO_ENRICH_CONCURRENCY, papersMissingAbstract.length) }, worker),
  );

  metadataExtractionActive = false;
  broadcastMetadataExtractionStatus();

  return { extracted, failed };
}

export function getMetadataExtractionStatus() {
  return {
    active: metadataExtractionActive,
    ...metadataExtractionProgress,
  };
}
