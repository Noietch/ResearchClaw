/**
 * IPC handlers for arXiv daily discovery feature
 */

import { ipcMain } from 'electron';
import {
  fetchNewPapers,
  ARXIV_CATEGORIES,
  type DiscoveredPaper,
  type DiscoveryResult,
} from '../services/arxiv-discovery.service';
import { batchEvaluatePapers } from '../services/paper-quality.service';
import { getLanguage } from '../store/app-settings-store';

// Store for discovery results
let lastDiscoveryResult: DiscoveryResult | null = null;
let evaluatedPapers: DiscoveredPaper[] = [];

export function setupDiscoveryIpc() {
  // Get available categories
  ipcMain.handle('discovery:getCategories', () => {
    return ARXIV_CATEGORIES;
  });

  // Fetch new papers
  ipcMain.handle(
    'discovery:fetch',
    async (
      _event,
      params: {
        categories: string[];
        maxResults?: number;
        daysBack?: number;
      },
    ) => {
      const { categories, maxResults = 50, daysBack = 7 } = params;

      try {
        const result = await fetchNewPapers(categories, maxResults, daysBack);
        lastDiscoveryResult = result;
        evaluatedPapers = []; // Reset evaluated papers

        return {
          success: true,
          papers: result.papers,
          total: result.total,
          fetchedAt: result.fetchedAt.toISOString(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
  );

  // Evaluate papers with AI
  ipcMain.handle(
    'discovery:evaluate',
    async (
      event,
      params: {
        paperIds?: string[]; // If provided, only evaluate these papers
      },
    ) => {
      try {
        const papers = lastDiscoveryResult?.papers ?? [];
        const toEvaluate =
          params.paperIds && params.paperIds.length > 0
            ? papers.filter((p) => params.paperIds!.includes(p.arxivId))
            : papers;

        if (toEvaluate.length === 0) {
          return { success: true, papers: [] };
        }

        const language = getLanguage();

        // Progress callback
        const onProgress = (evaluated: number, total: number) => {
          event.sender.send('discovery:evaluateProgress', { evaluated, total });
        };

        evaluatedPapers = await batchEvaluatePapers(toEvaluate, language, onProgress);

        return {
          success: true,
          papers: evaluatedPapers,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
  );

  // Get last discovery result
  ipcMain.handle('discovery:getLastResult', () => {
    if (!lastDiscoveryResult) {
      return null;
    }

    return {
      papers: evaluatedPapers.length > 0 ? evaluatedPapers : lastDiscoveryResult.papers,
      total: lastDiscoveryResult.total,
      fetchedAt: lastDiscoveryResult.fetchedAt.toISOString(),
      categories: lastDiscoveryResult.categories,
    };
  });

  // Clear discovery cache
  ipcMain.handle('discovery:clear', () => {
    lastDiscoveryResult = null;
    evaluatedPapers = [];
    return { success: true };
  });
}
