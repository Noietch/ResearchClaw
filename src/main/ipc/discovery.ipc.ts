/**
 * IPC handlers for arXiv daily discovery feature
 */

import { ipcMain } from 'electron';
import fs from 'fs';
import {
  fetchNewPapers,
  ARXIV_CATEGORIES,
  type DiscoveredPaper,
  type DiscoveryResult,
} from '../services/arxiv-discovery.service';
import { batchEvaluatePapers } from '../services/paper-quality.service';
import { calculateRelevanceScores } from '../services/discovery-relevance.service';
import { getLanguage } from '../store/app-settings-store';
import { getDiscoveryCachePath } from '../store/storage-path';

// In-memory store for discovery results
let lastDiscoveryResult: DiscoveryResult | null = null;
let evaluatedPapers: DiscoveredPaper[] = [];

interface CachedDiscovery {
  papers: DiscoveredPaper[];
  evaluatedPapers: DiscoveredPaper[];
  fetchedAt: string;
  categories: string[];
}

/**
 * Save discovery cache to disk
 */
function saveCache(): void {
  try {
    const cache: CachedDiscovery = {
      papers: lastDiscoveryResult?.papers ?? [],
      evaluatedPapers,
      fetchedAt: lastDiscoveryResult?.fetchedAt?.toISOString() ?? new Date().toISOString(),
      categories: lastDiscoveryResult?.categories ?? [],
    };
    fs.writeFileSync(getDiscoveryCachePath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[discovery] Failed to save cache:', e);
  }
}

/**
 * Load discovery cache from disk
 */
function loadCache(): CachedDiscovery | null {
  try {
    const path = getDiscoveryCachePath();
    if (fs.existsSync(path)) {
      const data = fs.readFileSync(path, 'utf-8');
      return JSON.parse(data) as CachedDiscovery;
    }
  } catch (e) {
    console.error('[discovery] Failed to load cache:', e);
  }
  return null;
}

/**
 * Check if cache is from today
 */
function isCacheFromToday(fetchedAt: string): boolean {
  const cachedDate = new Date(fetchedAt);
  const today = new Date();
  return (
    cachedDate.getFullYear() === today.getFullYear() &&
    cachedDate.getMonth() === today.getMonth() &&
    cachedDate.getDate() === today.getDate()
  );
}

export function setupDiscoveryIpc() {
  // Load cached results on startup
  const cached = loadCache();
  if (cached) {
    lastDiscoveryResult = {
      papers: cached.papers,
      total: cached.papers.length,
      fetchedAt: new Date(cached.fetchedAt),
      categories: cached.categories,
    };
    evaluatedPapers = cached.evaluatedPapers ?? [];
    console.log('[discovery] Loaded cached results from', cached.fetchedAt);
  }

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

        // Save to cache
        saveCache();

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

        // Update papers with evaluation results
        if (lastDiscoveryResult) {
          const evaluatedMap = new Map(evaluatedPapers.map((p) => [p.arxivId, p]));
          lastDiscoveryResult.papers = lastDiscoveryResult.papers.map((p) => {
            const evaluated = evaluatedMap.get(p.arxivId);
            return evaluated ?? p;
          });
        }

        // Save to cache
        saveCache();

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

  // Calculate relevance scores based on user's library
  ipcMain.handle('discovery:calculateRelevance', async () => {
    try {
      const papers = lastDiscoveryResult?.papers ?? [];
      if (papers.length === 0) {
        return { success: true, papers: [] };
      }

      const papersWithRelevance = await calculateRelevanceScores(papers);

      // Update stored papers with relevance scores
      lastDiscoveryResult = {
        ...lastDiscoveryResult!,
        papers: papersWithRelevance,
      };

      // Also update evaluated papers if they exist
      if (evaluatedPapers.length > 0) {
        const relevanceMap = new Map(papersWithRelevance.map((p) => [p.arxivId, p]));
        evaluatedPapers = evaluatedPapers.map((p) => {
          const withRel = relevanceMap.get(p.arxivId);
          return withRel ?? p;
        });
      }

      // Save to cache
      saveCache();

      return {
        success: true,
        papers: papersWithRelevance,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[discovery:calculateRelevance] Error:', message);
      return { success: false, error: message };
    }
  });

  // Get last discovery result
  ipcMain.handle('discovery:getLastResult', () => {
    if (!lastDiscoveryResult) {
      return null;
    }

    const result = {
      papers: evaluatedPapers.length > 0 ? evaluatedPapers : lastDiscoveryResult.papers,
      total: lastDiscoveryResult.total,
      fetchedAt: lastDiscoveryResult.fetchedAt.toISOString(),
      categories: lastDiscoveryResult.categories,
      isFromToday: isCacheFromToday(lastDiscoveryResult.fetchedAt.toISOString()),
    };
    return result;
  });

  // Clear discovery cache
  ipcMain.handle('discovery:clear', () => {
    lastDiscoveryResult = null;
    evaluatedPapers = [];

    // Delete cache file
    try {
      const path = getDiscoveryCachePath();
      if (fs.existsSync(path)) {
        fs.unlinkSync(path);
      }
    } catch (e) {
      console.error('[discovery] Failed to delete cache file:', e);
    }

    return { success: true };
  });
}
