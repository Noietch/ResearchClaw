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
import { fetchTrendingPapers } from '../services/alphaxiv-trending.service';
import { batchEvaluatePapers } from '../services/paper-quality.service';
import { calculateRelevanceScores } from '../services/discovery-relevance.service';
import { getLanguage } from '../store/app-settings-store';
import { getDiscoveryCachePath } from '../store/storage-path';

// In-memory store for discovery results
let lastDiscoveryResult: DiscoveryResult | null = null;
let evaluatedPapers: DiscoveredPaper[] = [];

// Abort controllers for cancellable operations
let evaluationAbortController: AbortController | null = null;
let relevanceAbortController: AbortController | null = null;

interface DiscoveryCacheEntry {
  papers: DiscoveredPaper[];
  evaluatedPapers: DiscoveredPaper[];
  fetchedAt: string;
  categories: string[];
}

// Legacy single-entry format (for migration)
interface LegacyCachedDiscovery {
  papers: DiscoveredPaper[];
  evaluatedPapers: DiscoveredPaper[];
  fetchedAt: string;
  categories: string[];
}

const HISTORY_MAX_DAYS = 14;

/**
 * Get the date key (YYYY-MM-DD) from an ISO date string
 */
function getDateKey(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Save discovery cache to disk (upsert by date, prune >7 days)
 */
function saveCache(): void {
  try {
    const fetchedAt = lastDiscoveryResult?.fetchedAt?.toISOString() ?? new Date().toISOString();
    const dateKey = getDateKey(fetchedAt);

    const newEntry: DiscoveryCacheEntry = {
      papers: lastDiscoveryResult?.papers ?? [],
      evaluatedPapers,
      fetchedAt,
      categories: lastDiscoveryResult?.categories ?? [],
    };

    // Load existing history
    let history = loadAllHistory();

    // Upsert: replace if same date, append if new
    const existingIdx = history.findIndex((e) => getDateKey(e.fetchedAt) === dateKey);
    if (existingIdx >= 0) {
      history[existingIdx] = newEntry;
    } else {
      history.push(newEntry);
    }

    // Sort by date descending (newest first)
    history.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());

    // Prune entries older than 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
    history = history.filter((e) => new Date(e.fetchedAt).getTime() >= cutoff.getTime());

    fs.writeFileSync(getDiscoveryCachePath(), JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) {
    console.error('[discovery] Failed to save cache:', e);
  }
}

/**
 * Load all history entries from disk, with migration from legacy format
 */
function loadAllHistory(): DiscoveryCacheEntry[] {
  try {
    const path = getDiscoveryCachePath();
    if (!fs.existsSync(path)) return [];

    const data = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(data);

    // Migrate legacy single-entry format (object with papers/fetchedAt)
    if (!Array.isArray(parsed) && parsed.papers && parsed.fetchedAt) {
      const legacy = parsed as LegacyCachedDiscovery;
      const migrated: DiscoveryCacheEntry[] = [
        {
          papers: legacy.papers,
          evaluatedPapers: legacy.evaluatedPapers ?? [],
          fetchedAt: legacy.fetchedAt,
          categories: legacy.categories ?? [],
        },
      ];
      // Write back migrated format
      fs.writeFileSync(getDiscoveryCachePath(), JSON.stringify(migrated, null, 2), 'utf-8');
      console.log('[discovery] Migrated legacy cache to history format');
      return migrated;
    }

    return parsed as DiscoveryCacheEntry[];
  } catch (e) {
    console.error('[discovery] Failed to load cache:', e);
    return [];
  }
}

/**
 * Load the most recent cache entry
 */
function loadCache(): DiscoveryCacheEntry | null {
  const history = loadAllHistory();
  return history.length > 0 ? history[0] : null;
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
      const { categories, maxResults = 50, daysBack = 14 } = params;

      try {
        const result = await fetchNewPapers(categories, maxResults, daysBack);

        // Incremental merge: keep existing papers with their scores,
        // only add genuinely new papers
        if (lastDiscoveryResult && lastDiscoveryResult.papers.length > 0) {
          const existingMap = new Map(lastDiscoveryResult.papers.map((p) => [p.arxivId, p]));
          let newCount = 0;
          for (const paper of result.papers) {
            if (!existingMap.has(paper.arxivId)) {
              lastDiscoveryResult.papers.push(paper);
              newCount++;
            }
            // Existing papers keep their qualityScore/relevanceScore/alphaxivMetrics
          }
          lastDiscoveryResult.fetchedAt = result.fetchedAt;
          lastDiscoveryResult.categories = categories;
          lastDiscoveryResult.total = lastDiscoveryResult.papers.length;
          console.log(
            `[discovery:fetch] ${newCount} new papers added, ${lastDiscoveryResult.papers.length} total`,
          );
        } else {
          lastDiscoveryResult = result;
        }

        // Prune papers older than daysBack
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);
        lastDiscoveryResult.papers = lastDiscoveryResult.papers.filter(
          (p) => new Date(p.publishedAt) >= cutoff,
        );
        lastDiscoveryResult.total = lastDiscoveryResult.papers.length;

        // Save to cache
        saveCache();

        return {
          success: true,
          papers: lastDiscoveryResult.papers,
          total: lastDiscoveryResult.total,
          fetchedAt: lastDiscoveryResult.fetchedAt.toISOString(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
  );

  // Fetch trending papers from AlphaXiv
  // Merges into lastDiscoveryResult so evaluate/relevance can score all papers.
  ipcMain.handle('discovery:fetchTrending', async () => {
    try {
      const papers = await fetchTrendingPapers();
      const withSource = papers.map((p) => ({ ...p, source: 'alphaxiv-trending' as const }));

      // Merge into existing result (append new papers, skip duplicates)
      if (lastDiscoveryResult) {
        const existingIds = new Set(lastDiscoveryResult.papers.map((p) => p.arxivId));
        for (const paper of withSource) {
          if (!existingIds.has(paper.arxivId)) {
            lastDiscoveryResult.papers.push(paper);
          } else {
            // Merge alphaxivMetrics into the existing paper
            const existing = lastDiscoveryResult.papers.find((p) => p.arxivId === paper.arxivId);
            if (existing) {
              existing.alphaxivMetrics = paper.alphaxivMetrics;
              existing.source = 'alphaxiv-trending';
            }
          }
        }
        lastDiscoveryResult.total = lastDiscoveryResult.papers.length;
        saveCache();
      }

      return {
        success: true,
        papers: withSource,
        total: withSource.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[discovery:fetchTrending] Error:', message);
      return { success: false, error: message };
    }
  });

  // Evaluate papers with AI
  ipcMain.handle(
    'discovery:evaluate',
    async (
      event,
      params: {
        paperIds?: string[]; // If provided, only evaluate these papers
      },
    ) => {
      // Cancel any existing evaluation
      if (evaluationAbortController) {
        evaluationAbortController.abort();
      }
      evaluationAbortController = new AbortController();
      const { signal } = evaluationAbortController;

      try {
        const papers = lastDiscoveryResult?.papers ?? [];
        let candidates =
          params.paperIds && params.paperIds.length > 0
            ? papers.filter((p) => params.paperIds!.includes(p.arxivId))
            : papers;

        // Skip papers that already have quality scores (incremental evaluation)
        const toEvaluate = candidates.filter((p) => !p.qualityScore);
        const alreadyEvaluated = candidates.length - toEvaluate.length;
        if (alreadyEvaluated > 0) {
          console.log(`[discovery:evaluate] Skipping ${alreadyEvaluated} already-evaluated papers`);
        }

        if (toEvaluate.length === 0) {
          return { success: true, papers: lastDiscoveryResult?.papers ?? [] };
        }

        const language = getLanguage();

        // Progress callback
        const onProgress = (evaluated: number, total: number) => {
          event.sender.send('discovery:evaluateProgress', { evaluated, total });
        };

        evaluatedPapers = await batchEvaluatePapers(toEvaluate, language, onProgress, signal);

        if (signal.aborted) {
          // Still update with partial results
          if (lastDiscoveryResult && evaluatedPapers.length > 0) {
            const evaluatedMap = new Map(evaluatedPapers.map((p) => [p.arxivId, p]));
            lastDiscoveryResult.papers = lastDiscoveryResult.papers.map((p) => {
              const evaluated = evaluatedMap.get(p.arxivId);
              return evaluated ?? p;
            });
            saveCache();
          }
          return { success: true, papers: lastDiscoveryResult?.papers ?? [], cancelled: true };
        }

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
      } finally {
        evaluationAbortController = null;
      }
    },
  );

  // Calculate relevance scores based on user's library
  ipcMain.handle('discovery:calculateRelevance', async () => {
    // Cancel any existing relevance calculation
    if (relevanceAbortController) {
      relevanceAbortController.abort();
    }
    relevanceAbortController = new AbortController();

    try {
      const papers = lastDiscoveryResult?.papers ?? [];
      if (papers.length === 0) {
        return { success: true, papers: [] };
      }

      // Only calculate for papers without existing relevance scores
      const needsRelevance = papers.filter(
        (p) => p.relevanceScore === null || p.relevanceScore === undefined,
      );
      const alreadyScored = papers.length - needsRelevance.length;
      if (alreadyScored > 0) {
        console.log(
          `[discovery:calculateRelevance] Skipping ${alreadyScored} already-scored papers`,
        );
      }

      if (needsRelevance.length === 0) {
        return { success: true, papers };
      }

      const scored = await calculateRelevanceScores(
        needsRelevance,
        relevanceAbortController.signal,
      );

      // Merge scores back into all papers
      const scoredMap = new Map(scored.map((p) => [p.arxivId, p]));
      lastDiscoveryResult!.papers = papers.map((p) => {
        const withScore = scoredMap.get(p.arxivId);
        return withScore ?? p;
      });

      // Save to cache
      saveCache();

      return {
        success: true,
        papers: lastDiscoveryResult!.papers,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[discovery:calculateRelevance] Cancelled by user');
        return { success: false, error: 'cancelled' };
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('[discovery:calculateRelevance] Error:', message);
      return { success: false, error: message };
    } finally {
      relevanceAbortController = null;
    }
  });

  // Cancel evaluation
  ipcMain.handle('discovery:cancelEvaluation', () => {
    if (evaluationAbortController) {
      evaluationAbortController.abort();
      console.log('[discovery] Evaluation cancelled by user');
      return { success: true };
    }
    return { success: false };
  });

  // Cancel relevance calculation
  ipcMain.handle('discovery:cancelRelevance', () => {
    if (relevanceAbortController) {
      relevanceAbortController.abort();
      console.log('[discovery] Relevance calculation cancelled by user');
      return { success: true };
    }
    return { success: false };
  });

  // Get last discovery result
  ipcMain.handle('discovery:getLastResult', () => {
    if (!lastDiscoveryResult) {
      return null;
    }

    // Always return lastDiscoveryResult.papers which has all papers
    // (arXiv + trending) with evaluation/relevance scores already merged in.
    const result = {
      papers: lastDiscoveryResult.papers,
      total: lastDiscoveryResult.total,
      fetchedAt: lastDiscoveryResult.fetchedAt.toISOString(),
      categories: lastDiscoveryResult.categories,
      isFromToday: isCacheFromToday(lastDiscoveryResult.fetchedAt.toISOString()),
    };
    return result;
  });

  // Get history summary (dates + paper counts, no full paper data)
  ipcMain.handle('discovery:getHistory', () => {
    const history = loadAllHistory();
    return history.map((entry) => ({
      date: getDateKey(entry.fetchedAt),
      fetchedAt: entry.fetchedAt,
      paperCount: entry.papers.length,
      categories: entry.categories,
    }));
  });

  // Load a specific history entry by date key (YYYY-MM-DD)
  ipcMain.handle('discovery:loadHistoryEntry', (_event, date: string) => {
    const history = loadAllHistory();
    const entry = history.find((e) => getDateKey(e.fetchedAt) === date);
    if (!entry) {
      return null;
    }

    // Set as current active result
    lastDiscoveryResult = {
      papers: entry.papers,
      total: entry.papers.length,
      fetchedAt: new Date(entry.fetchedAt),
      categories: entry.categories,
    };
    evaluatedPapers = entry.evaluatedPapers ?? [];

    return {
      papers: lastDiscoveryResult.papers,
      total: entry.papers.length,
      fetchedAt: entry.fetchedAt,
      categories: entry.categories,
      isFromToday: isCacheFromToday(entry.fetchedAt),
    };
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
