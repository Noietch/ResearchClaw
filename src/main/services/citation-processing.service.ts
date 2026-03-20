/**
 * Background citation extraction service.
 * Automatically extracts citation relationships for papers that haven't been processed yet.
 * Follows the same queue pattern as paper-processing.service.ts.
 */
import { PapersRepository } from '@db';
import { CitationExtractionError, CitationExtractionService } from './citation-extraction.service';

const queue: string[] = [];
const queuedIds = new Set<string>();
let running = false;

function shouldSkip(): boolean {
  return !!process.env.VITEST;
}

async function processPaper(paperId: string) {
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) return;

  // Skip if already extracted
  if (paper.citationsExtractedAt) return;

  const extractionService = new CitationExtractionService();

  try {
    console.log(`[citation-processing] Extracting citations for "${paper.title}"...`);
    const result = await extractionService.extractForPaper({
      id: paper.id,
      shortId: paper.shortId,
      title: paper.title,
      sourceUrl: paper.sourceUrl,
    });

    await repo.markCitationsExtracted(paperId);
    console.log(
      `[citation-processing] Done: ${result.referencesFound} refs, ${result.citationsFound} cits, ${result.matched} matched`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[citation-processing] Failed for "${paper.title}": ${message}`);
    if (error instanceof CitationExtractionError && error.retryable) {
      console.warn(
        `[citation-processing] Will retry later for "${paper.title}" (transient upstream error)`,
      );
      return;
    }

    await repo.markCitationsExtracted(paperId);
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
      // Delay between API calls to avoid rate limiting (429 errors)
      if (queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    // After processing all papers, try resolving previously unmatched citations
    try {
      const extractionService = new CitationExtractionService();
      const resolved = await extractionService.resolveUnmatched();
      if (resolved > 0) {
        console.log(`[citation-processing] Resolved ${resolved} previously unmatched citations`);
      }
    } catch {
      // Non-critical, ignore
    }
  } finally {
    running = false;
  }
}

export function scheduleCitationExtraction(paperId: string) {
  if (shouldSkip()) return;
  if (queuedIds.has(paperId)) return;

  queuedIds.add(paperId);
  queue.push(paperId);
  void drainQueue();
}

export async function resumeAutomaticCitationExtraction() {
  if (shouldSkip()) return { queued: 0 };

  const repo = new PapersRepository();
  const paperIds = await repo.listPendingCitationPaperIds();

  for (const paperId of paperIds) {
    scheduleCitationExtraction(paperId);
  }

  console.log(`[citation-processing] Queued ${paperIds.length} papers for citation extraction`);
  return { queued: paperIds.length };
}
