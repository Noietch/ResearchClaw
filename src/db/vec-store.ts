import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import { getStorageDir } from '../main/store/storage-path';

export interface VecEntry {
  chunkId: string;
  embedding: Float32Array;
}

export interface VecSearchHit {
  chunkId: string;
  distance: number;
}

interface VecStoreData {
  version: number;
  dimension: number;
  model: string;
  entries: Array<{
    chunkId: string;
    embedding: number[]; // Stored as regular array for JSON serialization
  }>;
}

const STORE_VERSION = 1;

/**
 * Pure JavaScript vector store using cosine similarity search.
 * Provides vector storage and KNN search without native dependencies.
 */
export class VecStore {
  private entries: Map<string, Float32Array> = new Map();
  private dimension: number = 0;
  private model: string = '';
  private initialized: boolean = false;
  private dataDir: string;

  constructor(dataDir?: string) {
    // Use provided directory or default to storage directory
    this.dataDir =
      dataDir || (getStorageDir ? getStorageDir() : join(app.getPath('userData'), 'storage'));
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getStorePath(): string {
    return join(this.dataDir, 'vec-store.json');
  }

  private getMetaPath(): string {
    return join(this.dataDir, 'vec-meta.json');
  }

  /**
   * Load store from disk
   */
  load(): void {
    const storePath = this.getStorePath();
    const metaPath = this.getMetaPath();

    // Load metadata
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        this.dimension = meta.dimension || 0;
        this.model = meta.model || '';
      } catch {
        // Ignore corrupt meta file
      }
    }

    // Load entries
    this.entries.clear();
    if (existsSync(storePath)) {
      try {
        const data: VecStoreData = JSON.parse(readFileSync(storePath, 'utf-8'));
        if (data.version === STORE_VERSION && Array.isArray(data.entries)) {
          for (const entry of data.entries) {
            this.entries.set(entry.chunkId, new Float32Array(entry.embedding));
          }
          this.dimension = data.dimension;
          this.model = data.model;
          this.initialized = this.dimension > 0;
          console.log(`[VecStore] Loaded ${this.entries.size} vectors (dim=${this.dimension})`);
        }
      } catch (err) {
        console.warn('[VecStore] Failed to load store:', err);
      }
    }
  }

  /**
   * Save store to disk
   */
  save(): void {
    this.ensureDir();

    const data: VecStoreData = {
      version: STORE_VERSION,
      dimension: this.dimension,
      model: this.model,
      entries: Array.from(this.entries.entries()).map(([chunkId, embedding]) => ({
        chunkId,
        embedding: Array.from(embedding),
      })),
    };

    try {
      writeFileSync(this.getStorePath(), JSON.stringify(data, null, 0), 'utf-8');
      writeFileSync(
        this.getMetaPath(),
        JSON.stringify({ dimension: this.dimension, model: this.model }),
        'utf-8',
      );
    } catch (err) {
      console.error('[VecStore] Failed to save store:', err);
    }
  }

  /**
   * Initialize the store with dimension and model
   */
  initialize(dimension: number, model: string): void {
    // If dimension changed, clear existing data
    if (this.dimension > 0 && this.dimension !== dimension) {
      console.log(`[VecStore] Dimension changed ${this.dimension} → ${dimension}, clearing data`);
      this.entries.clear();
    }

    // If model changed, also clear
    if (this.model && this.model !== model) {
      console.log(`[VecStore] Model changed ${this.model} → ${model}, clearing data`);
      this.entries.clear();
    }

    this.dimension = dimension;
    this.model = model;
    this.initialized = true;
    this.save();
    console.log(`[VecStore] Initialized (dimension=${dimension}, model=${model})`);
  }

  /**
   * Check if store is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current dimension
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get entry count
   */
  getCount(): number {
    return this.entries.size;
  }

  /**
   * Insert or update a vector entry
   */
  upsert(chunkId: string, embedding: Float32Array): void {
    if (embedding.length !== this.dimension) {
      throw new Error(`Dimension mismatch: expected ${this.dimension}, got ${embedding.length}`);
    }
    this.entries.set(chunkId, new Float32Array(embedding));
  }

  /**
   * Delete a vector entry by chunk ID
   */
  delete(chunkId: string): void {
    this.entries.delete(chunkId);
  }

  /**
   * Delete multiple entries by chunk IDs
   */
  deleteMany(chunkIds: string[]): void {
    for (const id of chunkIds) {
      this.entries.delete(id);
    }
  }

  /**
   * Delete entries by paper ID (chunk IDs are prefixed with paperId)
   */
  deleteByPaperId(paperId: string): void {
    const prefix = paperId + '_';
    for (const chunkId of this.entries.keys()) {
      if (chunkId.startsWith(prefix)) {
        this.entries.delete(chunkId);
      }
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Search for k nearest neighbors using cosine similarity.
   * Returns results sorted by distance (ascending, 0 = identical).
   */
  searchKNN(queryEmbedding: Float32Array, k: number): VecSearchHit[] {
    if (queryEmbedding.length !== this.dimension) {
      return [];
    }

    const queryNorm = this.normalize(queryEmbedding);
    if (queryNorm === 0) return [];

    const results: VecSearchHit[] = [];

    for (const [chunkId, embedding] of this.entries) {
      const similarity = this.cosineSimilarity(queryEmbedding, embedding, queryNorm);
      // Convert similarity [-1, 1] to distance [0, 2] for compatibility with sqlite-vec
      const distance = 1 - similarity;
      results.push({ chunkId, distance });
    }

    // Sort by distance (ascending) and take top k
    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, k);
  }

  /**
   * Calculate cosine similarity between two vectors.
   * Returns value in range [-1, 1] where 1 means identical direction.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array, aNorm?: number): number {
    let dot = 0;
    let bNormSquared = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      bNormSquared += b[i] * b[i];
    }

    const normA = aNorm ?? Math.sqrt(this.dotProduct(a, a));
    const normB = Math.sqrt(bNormSquared);

    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }

  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private normalize(vec: Float32Array): number {
    return Math.sqrt(this.dotProduct(vec, vec));
  }

  /**
   * Get all entries (for rebuilding/reindexing)
   */
  getAllEntries(): VecEntry[] {
    return Array.from(this.entries.entries()).map(([chunkId, embedding]) => ({
      chunkId,
      embedding: new Float32Array(embedding),
    }));
  }

  /**
   * Batch insert entries (for rebuilding)
   */
  batchInsert(entries: VecEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.chunkId, new Float32Array(entry.embedding));
    }
  }
}

// Singleton instance
let store: VecStore | null = null;

export function getVecStore(): VecStore {
  if (!store) {
    store = new VecStore();
    store.load();
  }
  return store;
}

export function closeVecStore(): void {
  if (store) {
    store.save();
    store = null;
  }
}

// For testing
export function resetVecStore(): void {
  store = null;
}
