/**
 * Simplified semantic search service
 * Searches only on paper title and abstract embeddings (no full-text chunks)
 */

import { PapersRepository } from '@db';
import type { TagCategory } from '@shared';
import { localSemanticService } from './local-semantic.service';
import * as vecIndex from './vec-index.service';

export interface SemanticSearchPaper {
  id: string;
  shortId: string;
  title: string;
  authors?: string[];
  submittedAt?: string | null;
  tagNames?: string[];
  abstract?: string | null;
  similarityScore: number;
  finalScore: number;
  matchType: 'title' | 'abstract' | 'both';
}

export interface SemanticSearchResult {
  mode: 'semantic' | 'fallback';
  papers: SemanticSearchPaper[];
  fallbackReason?: string;
}

const papersRepository = new PapersRepository();

/**
 * Semantic search on paper titles and abstracts
 * @param query Search query
 * @param limit Maximum number of results
 */
export async function search(query: string, limit = 20): Promise<SemanticSearchResult> {
  try {
    // Check if vector index is initialized
    const status = vecIndex.getStatus();
    if (!status.initialized || status.count === 0) {
      return fallbackToLexical(query, limit, 'Vector index not initialized');
    }

    // Generate query embedding
    const [queryEmbedding] = await localSemanticService.embedTexts([query]);

    // KNN search (search for more results than needed to allow for deduplication)
    const vecHits = vecIndex.searchKNN(new Float32Array(queryEmbedding), limit * 3);

    if (vecHits.length === 0) {
      return fallbackToLexical(query, limit, 'No vector matches found');
    }

    // Aggregate hits by paper ID
    const paperScores = aggregateByPaper(vecHits);

    // Load papers from database
    const paperIds = Object.keys(paperScores);
    if (paperIds.length === 0) {
      return fallbackToLexical(query, limit, 'No papers found for vector hits');
    }

    const papers = await papersRepository.findByIds(paperIds);

    // Score and rank papers
    const scored = papers.map((paper) => {
      const { semanticScore, matchType } = paperScores[paper.id];
      const finalScore = computeFinalScore(paper, query, semanticScore);

      return {
        id: paper.id,
        shortId: paper.shortId,
        title: paper.title,
        authors: paper.authors,
        submittedAt:
          typeof paper.submittedAt === 'string'
            ? paper.submittedAt
            : (paper.submittedAt?.toISOString() ?? null),
        tagNames: paper.tagNames,
        abstract: paper.abstract,
        similarityScore: semanticScore,
        finalScore,
        matchType,
      };
    });

    // Rank by final score, then trim irrelevant tail using adaptive gap detection.
    // OpenAI text-embedding-3-small produces relatively low absolute cosine
    // similarities, so a fixed threshold doesn't work well. Instead we keep
    // the top cluster of results and cut where the score drops sharply.
    const sorted = scored.sort((a, b) => b.finalScore - a.finalScore);

    let cutoff = sorted.length;
    if (sorted.length >= 2) {
      const topScore = sorted[0].finalScore;
      // Always keep results within 60% of the top score
      const minAcceptable = topScore * 0.4;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].finalScore < minAcceptable) {
          cutoff = i;
          break;
        }
        // Also cut at large relative gaps (> 30% drop from previous)
        const gap = sorted[i - 1].finalScore - sorted[i].finalScore;
        if (gap > sorted[i - 1].finalScore * 0.3 && i >= 2) {
          cutoff = i;
          break;
        }
      }
    }

    const ranked = sorted.slice(0, Math.min(cutoff, limit));

    // Re-map scores to a human-friendly 0-100% range relative to the result set.
    // The top result maps to ~95%, others scale proportionally.
    // This avoids confusingly low absolute scores from the embedding model.
    if (ranked.length > 0) {
      const topRaw = ranked[0].finalScore;
      const botRaw = ranked.length > 1 ? ranked[ranked.length - 1].finalScore : topRaw * 0.5;
      const range = topRaw - botRaw || 0.01; // avoid division by zero
      for (const paper of ranked) {
        const pct = (paper.finalScore - botRaw) / range; // 0..1 within result set
        paper.finalScore = 0.45 + pct * 0.5; // map to 45%..95%
      }
    }

    return {
      mode: 'semantic',
      papers: ranked,
    };
  } catch (error) {
    console.error('[SemanticSearch] Error during semantic search:', error);
    return fallbackToLexical(
      query,
      limit,
      `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

interface PaperScoreInfo {
  semanticScore: number;
  matchType: 'title' | 'abstract' | 'both';
}

/**
 * Aggregate vector hits by paper ID
 * Key format: paper:{paperId}:title or paper:{paperId}:abstract
 */
function aggregateByPaper(
  vecHits: Array<{ key: string; similarity: number }>,
): Record<string, PaperScoreInfo> {
  const paperScores: Record<string, PaperScoreInfo> = {};

  for (const hit of vecHits) {
    // Parse key: paper:{paperId}:title or paper:{paperId}:abstract
    const parts = hit.key.split(':');
    if (parts.length !== 3 || parts[0] !== 'paper') continue;

    const paperId = parts[1];
    const field = parts[2] as 'title' | 'abstract';

    if (!paperScores[paperId]) {
      paperScores[paperId] = {
        semanticScore: hit.similarity,
        matchType: field,
      };
    } else {
      // Paper matched on both title and abstract - use max similarity
      if (hit.similarity > paperScores[paperId].semanticScore) {
        paperScores[paperId].semanticScore = hit.similarity;
      }
      paperScores[paperId].matchType = 'both';
    }
  }

  return paperScores;
}

/**
 * Normalize raw cosine similarity into a perceptual 0-1 relevance score.
 *
 * OpenAI text-embedding-3-small produces relatively low raw cosine
 * similarities — a short query vs. a long abstract typically lands in
 * the 0.25–0.55 range. Displaying these raw numbers makes everything
 * look irrelevant. This sigmoid-based rescaling maps the model's
 * natural distribution into a human-friendly 0–100% range:
 *
 *   raw ~0.20 → ~5%   (noise)
 *   raw ~0.35 → ~40%  (loosely related)
 *   raw ~0.45 → ~65%  (relevant)
 *   raw ~0.55 → ~85%  (highly relevant)
 *   raw ~0.70 → ~97%  (near-exact)
 */
function normalizeScore(raw: number): number {
  // Sigmoid centered at 0.40, steepness 12
  const s = 1 / (1 + Math.exp(-12 * (raw - 0.4)));
  return Math.min(Math.max(s, 0), 1);
}

/**
 * Compute final score with lexical boosting
 * @param paper Paper to score
 * @param query Search query
 * @param semanticScore Base semantic similarity score (0-1)
 * @returns Final score with boosts applied
 */
function computeFinalScore(
  paper: {
    title: string;
    tagNames?: string[];
    abstract?: string | null;
  },
  query: string,
  semanticScore: number,
): number {
  let score = normalizeScore(semanticScore);

  const queryLower = query.toLowerCase();
  const titleLower = paper.title.toLowerCase();

  // Exact title match: +15%
  if (titleLower.includes(queryLower)) {
    score += 0.15;
  }

  // Exact tag match: +10%
  if (paper.tagNames?.some((tag) => tag.toLowerCase() === queryLower)) {
    score += 0.1;
  }

  // Title starts with query: +5%
  if (titleLower.startsWith(queryLower)) {
    score += 0.05;
  }

  return Math.min(score, 1.0); // Cap at 1.0
}

/**
 * Fallback to simple lexical search when semantic search fails
 */
async function fallbackToLexical(
  query: string,
  limit: number,
  reason: string,
): Promise<SemanticSearchResult> {
  console.warn(`[SemanticSearch] Falling back to lexical search: ${reason}`);

  const papers = await papersRepository.list({ q: query, limit });

  return {
    mode: 'fallback',
    papers: papers.map((paper) => ({
      id: paper.id,
      shortId: paper.shortId,
      title: paper.title,
      authors: paper.authors,
      submittedAt:
        typeof paper.submittedAt === 'string'
          ? paper.submittedAt
          : (paper.submittedAt?.toISOString() ?? null),
      tagNames: paper.tagNames,
      abstract: paper.abstract,
      similarityScore: 0,
      finalScore: 0,
      matchType: 'title' as const,
    })),
    fallbackReason: reason,
  };
}

// ─── Class Wrapper for IPC Compatibility ─────────────────────────────────────

/**
 * Class wrapper for backward compatibility with IPC handlers
 */
export class SemanticSearchService {
  async search(query: string, limit?: number): Promise<SemanticSearchResult> {
    return search(query, limit);
  }
}
