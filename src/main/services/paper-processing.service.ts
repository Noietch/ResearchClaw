import { BrowserWindow } from 'electron';
import { PapersRepository } from '@db';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import { sanitizeSemanticText } from './semantic-utils';
import { rebuildSearchUnitsForPaper } from './search-unit-sync.service';

export type PaperProcessingStatus =
  | 'idle'
  | 'queued'
  | 'extracting_text'
  | 'extracting_metadata'
  | 'chunking'
  | 'embedding'
  | 'completed'
  | 'failed';

function broadcastProcessingStatus(payload: {
  paperId: string;
  status: PaperProcessingStatus;
  error?: string | null;
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('papers:processingStatus', payload);
  }
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

  const abstractText = sanitizeSemanticText(paper.abstract ?? '');
  if (!abstractText.trim()) {
    await updateStatus(repo, paperId, 'failed', {
      processingError: 'No abstract available for indexing.',
      indexedAt: null,
    });
    return;
  }

  try {
    await updateStatus(repo, paperId, 'embedding', { processingError: null });

    await rebuildSearchUnitsForPaper(paperId);

    await updateStatus(repo, paperId, 'completed', {
      processingError: null,
      processedAt: new Date(),
      indexedAt: new Date(),
      metadataSource: paper.metadataSource ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStatus(repo, paperId, 'failed', {
      processingError: message,
      indexedAt: null,
    });
  }
}

export async function resumeAutomaticPaperProcessing() {
  return { queued: 0 };
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
