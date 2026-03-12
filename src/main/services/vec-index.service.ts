/**
 * Simplified vector index service
 * Wrapper around VecStore for paper-level embeddings
 */

import { getVecStore } from '../../db/vec-store';
import { getAppSettings, OPENAI_EMBEDDING_MODELS } from '../store/app-settings-store';

const vecStore = getVecStore();

/**
 * Initialize vector store
 */
export async function initialize(): Promise<void> {
  vecStore.load();

  // Initialize with dimension from settings
  if (!vecStore.isInitialized()) {
    const settings = getAppSettings();
    const embeddingModel = settings.semanticSearch?.embeddingModel || 'text-embedding-3-small';

    // Get dimension from model config
    const modelConfig = OPENAI_EMBEDDING_MODELS.find((m) => m.id === embeddingModel);
    const dimension = modelConfig?.dimensions || 1536; // Default to 1536 for OpenAI models

    vecStore.initialize(dimension, embeddingModel);
  }
}

/**
 * Get vector store status
 */
export function getStatus(): {
  initialized: boolean;
  count: number;
  dimension: number;
  model: string;
} {
  return {
    initialized: vecStore.isInitialized(),
    count: vecStore.getCount(),
    dimension: vecStore.getDimension(),
    model: vecStore.getModel(),
  };
}

/**
 * Insert or update a vector
 * Key format: paper:{paperId}:title or paper:{paperId}:abstract
 */
export function upsert(key: string, embedding: Float32Array): void {
  vecStore.upsert(key, embedding);
}

/**
 * Remove a vector by key
 */
export function remove(key: string): void {
  vecStore.delete(key);
}

/**
 * Search for nearest neighbors
 * @param queryVec Query vector
 * @param k Number of results
 * @returns Array of {key, similarity} sorted by similarity descending
 */
export function searchKNN(
  queryVec: Float32Array,
  k: number,
): Array<{ key: string; similarity: number }> {
  const hits = vecStore.searchKNN(queryVec, k);

  // Convert from {chunkId, distance} to {key, similarity}
  return hits.map((hit) => ({
    key: hit.chunkId,
    similarity: 1 - hit.distance, // Distance to similarity
  }));
}

/**
 * Clear all vectors
 */
export function clear(): void {
  vecStore.clear();
}

/**
 * Save to disk
 */
export function save(): void {
  vecStore.save();
}
