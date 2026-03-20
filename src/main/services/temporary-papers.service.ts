/**
 * Temporary Papers Cleanup Service
 * Manages cleanup of temporarily imported papers from Discovery
 */

import { PapersRepository } from '@db';
import fs from 'fs';
import path from 'path';
import { getPapersBaseDir } from '../store/storage-path';

const papersRepository = new PapersRepository();

// Papers older than this are cleaned up
const TEMPORARY_PAPER_TTL_HOURS = 24;

/**
 * Clean up temporary papers older than TTL
 * Called on app startup
 */
export async function cleanupTemporaryPapers(): Promise<{
  deleted: number;
  errors: string[];
}> {
  const result = { deleted: 0, errors: [] as string[] };
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - TEMPORARY_PAPER_TTL_HOURS);

  try {
    // Find all temporary papers older than cutoff
    const temporaryPapers = await papersRepository.listExpiredTemporaryPapers(cutoffDate);

    console.log(
      `[temporary-papers] Found ${temporaryPapers.length} expired temporary papers to clean up`,
    );

    for (const paper of temporaryPapers) {
      try {
        // Delete paper folder (PDF, text files, etc.)
        const paperDir = path.join(getPapersBaseDir(), paper.shortId);
        if (fs.existsSync(paperDir)) {
          fs.rmSync(paperDir, { recursive: true, force: true });
        }

        // Delete from database
        await papersRepository.delete(paper.id);
        result.deleted++;
      } catch (e) {
        const errorMsg = `Failed to delete temporary paper ${paper.shortId}: ${e}`;
        console.error(`[temporary-papers] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log(`[temporary-papers] Cleaned up ${result.deleted} expired temporary papers`);
  } catch (e) {
    const errorMsg = `Failed to query temporary papers: ${e}`;
    console.error(`[temporary-papers] ${errorMsg}`);
    result.errors.push(errorMsg);
  }

  return result;
}

/**
 * Convert a temporary paper to permanent
 */
export async function makePaperPermanent(paperId: string): Promise<boolean> {
  try {
    await papersRepository.updateTemporaryStatus(paperId, false, null);
    return true;
  } catch (e) {
    console.error(`[temporary-papers] Failed to make paper permanent:`, e);
    return false;
  }
}
