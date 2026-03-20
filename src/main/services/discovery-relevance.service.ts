/**
 * Smart relevance scoring for discovered papers
 * Calculates how relevant a new paper is to the user's existing library
 */

import { PaperEmbeddingRepository } from '@db';
import { localSemanticService } from './local-semantic.service';

const paperEmbeddingRepository = new PaperEmbeddingRepository();

// Cache for user interest vector
let cachedInterestVector: number[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Calculate the average vector from a list of embeddings
 */
function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];

  const dimension = vectors[0].length;
  const sum = new Array(dimension).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dimension; i++) {
      sum[i] += vec[i];
    }
  }

  return sum.map((s) => s / vectors.length);
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Get the user's interest vector (average of all paper embeddings)
 * Cached for performance
 */
export async function getUserInterestVector(): Promise<number[] | null> {
  // Check cache
  if (cachedInterestVector && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedInterestVector;
  }

  const embeddings = await paperEmbeddingRepository.listAll();

  if (embeddings.length === 0) {
    return null;
  }

  // Collect all abstract embeddings (more informative than titles)
  const abstractVectors: number[][] = [];
  const titleVectors: number[][] = [];

  for (const emb of embeddings) {
    if (emb.abstractEmbedding) {
      abstractVectors.push(JSON.parse(emb.abstractEmbedding));
    }
    if (emb.titleEmbedding) {
      titleVectors.push(JSON.parse(emb.titleEmbedding));
    }
  }

  // Prefer abstract embeddings, fall back to titles
  const vectors = abstractVectors.length > 0 ? abstractVectors : titleVectors;

  if (vectors.length === 0) {
    return null;
  }

  cachedInterestVector = averageVectors(vectors);
  cacheTimestamp = Date.now();

  return cachedInterestVector;
}

/**
 * Calculate relevance scores for discovered papers
 * @param papers List of discovered papers (must have title and abstract)
 * @returns Papers with relevanceScore added (0-100)
 */
export async function calculateRelevanceScores<T extends { title: string; abstract?: string }>(
  papers: T[],
): Promise<(T & { relevanceScore: number })[]> {
  const interestVector = await getUserInterestVector();

  // If no user papers, return 0 relevance for all
  if (!interestVector) {
    return papers.map((p) => ({ ...p, relevanceScore: 0 }));
  }

  // Generate embeddings for all discovered papers
  const texts = papers.map((p) => {
    // Combine title and abstract for better matching
    const text = p.abstract ? `${p.title}\n\n${p.abstract}` : p.title;
    return text;
  });

  let paperEmbeddings: number[][];
  try {
    paperEmbeddings = await localSemanticService.embedTexts(texts);
  } catch (error) {
    console.error('[DiscoveryRelevance] Failed to generate embeddings:', error);
    return papers.map((p) => ({ ...p, relevanceScore: 0 }));
  }

  // Calculate similarity for each paper
  return papers.map((paper, index) => {
    const embedding = paperEmbeddings[index];
    if (!embedding) {
      return { ...paper, relevanceScore: 0 };
    }

    const similarity = cosineSimilarity(interestVector, embedding);

    // Convert similarity to 0-100 score
    // Cosine similarity is typically between -1 and 1, but for embeddings usually 0.3 to 1
    // We map it to a more intuitive 0-100 scale
    const normalizedScore = Math.max(0, Math.min(100, Math.round((similarity + 0.2) * 100)));

    return { ...paper, relevanceScore: normalizedScore };
  });
}

/**
 * Clear the interest vector cache (call after adding/removing papers)
 */
export function clearInterestCache(): void {
  cachedInterestVector = null;
  cacheTimestamp = 0;
}
