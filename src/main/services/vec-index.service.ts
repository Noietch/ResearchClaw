import { getVecDb } from '../../db/vec-client';

export interface VecSearchHit {
  chunkId: string;
  distance: number;
}

export interface VecIndexStatus {
  initialized: boolean;
  dimension: number | null;
  model: string | null;
  rowCount: number;
}

let currentDimension: number | null = null;
let initialized = false;

function getMeta(key: string): string | null {
  const db = getVecDb();
  const row = db.prepare('SELECT value FROM vec_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setMeta(key: string, value: string): void {
  const db = getVecDb();
  db.prepare('INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?, ?)').run(key, value);
}

function vecTableExists(): boolean {
  const db = getVecDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_chunks'")
    .get() as { name: string } | undefined;
  return !!row;
}

function createVecTable(dimension: number): void {
  const db = getVecDb();
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[${dimension}] distance_metric=cosine
    )
  `);
}

function dropVecTable(): void {
  const db = getVecDb();
  if (vecTableExists()) {
    db.exec('DROP TABLE vec_chunks');
  }
}

export function initialize(dimension: number, model: string): void {
  const storedDim = getMeta('dimension');
  const storedModel = getMeta('model');

  if (storedDim && Number(storedDim) !== dimension) {
    // Dimension changed — rebuild
    console.log(`[vec-index] Dimension changed ${storedDim} → ${dimension}, rebuilding vec table`);
    dropVecTable();
  }

  if (storedModel && storedModel !== model) {
    console.log(`[vec-index] Model changed ${storedModel} → ${model}, rebuilding vec table`);
    dropVecTable();
  }

  createVecTable(dimension);
  setMeta('dimension', String(dimension));
  setMeta('model', model);
  currentDimension = dimension;
  initialized = true;
  console.log(`[vec-index] Initialized (dimension=${dimension}, model=${model})`);
}

export function isInitialized(): boolean {
  return initialized;
}

export function syncChunksForPaper(
  paperId: string,
  chunks: Array<{ id: string; embedding: number[] }>,
): void {
  if (!initialized) return;

  const db = getVecDb();

  // Auto-detect dimension from first embedding if not yet set
  if (!currentDimension && chunks.length > 0) {
    const dim = chunks[0].embedding.length;
    if (dim > 0) {
      initialize(dim, getMeta('model') ?? 'unknown');
    }
  }

  const deleteStmt = db.prepare(
    'DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM PaperChunk WHERE paperId = ?)',
  );
  const insertStmt = db.prepare('INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)');

  const sync = db.transaction(() => {
    deleteStmt.run(paperId);
    for (const chunk of chunks) {
      const buf = new Float32Array(chunk.embedding);
      insertStmt.run(chunk.id, Buffer.from(buf.buffer));
    }
  });

  sync();
}

export function deleteChunksByPaperId(paperId: string): void {
  if (!initialized) return;
  const db = getVecDb();
  db.prepare(
    'DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM PaperChunk WHERE paperId = ?)',
  ).run(paperId);
}

export function deleteChunksByIds(ids: string[]): void {
  if (!initialized || ids.length === 0) return;
  const db = getVecDb();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`).run(...ids);
}

export function searchKNN(queryEmbedding: number[], k: number): VecSearchHit[] {
  if (!initialized) return [];

  const db = getVecDb();
  const buf = new Float32Array(queryEmbedding);

  const rows = db
    .prepare(
      `SELECT chunk_id, distance
       FROM vec_chunks
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    )
    .all(Buffer.from(buf.buffer), k) as Array<{ chunk_id: string; distance: number }>;

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    distance: row.distance,
  }));
}

export async function rebuildFromPrisma(): Promise<number> {
  // Use better-sqlite3 (already open) instead of Prisma to avoid loading 19k+ large
  // embeddingJson rows through Prisma's tokio runtime, which triggers Electron malloc guard.
  const db = getVecDb();
  const chunks = db
    .prepare('SELECT id, embeddingJson FROM PaperChunk ORDER BY paperId ASC, chunkIndex ASC')
    .all() as { id: string; embeddingJson: string }[];

  if (chunks.length === 0) return 0;

  // Detect dimension from first chunk
  const firstEmbedding = JSON.parse(chunks[0].embeddingJson) as number[];
  const dimension = firstEmbedding.length;
  if (dimension === 0) return 0;

  const model = getMeta('model') ?? 'unknown';

  // Rebuild: drop + recreate
  dropVecTable();
  createVecTable(dimension);
  setMeta('dimension', String(dimension));
  currentDimension = dimension;
  initialized = true;

  const insertStmt = db.prepare('INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)');

  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const insertBatch = db.transaction(() => {
      for (const chunk of batch) {
        try {
          const embedding = JSON.parse(chunk.embeddingJson) as number[];
          if (embedding.length !== dimension) continue;
          const buf = new Float32Array(embedding);
          insertStmt.run(chunk.id, Buffer.from(buf.buffer));
          inserted++;
        } catch {
          // Skip malformed embeddings
        }
      }
    });
    insertBatch();
  }

  console.log(
    `[vec-index] Rebuilt index: ${inserted}/${chunks.length} chunks (dimension=${dimension}, model=${model})`,
  );
  return inserted;
}

export function getStatus(): VecIndexStatus {
  if (!initialized) {
    return { initialized: false, dimension: null, model: null, rowCount: 0 };
  }

  const db = getVecDb();
  let rowCount = 0;
  try {
    const row = db.prepare('SELECT count(*) as cnt FROM vec_chunks').get() as { cnt: number };
    rowCount = row.cnt;
  } catch {
    // Table might not exist yet
  }

  return {
    initialized,
    dimension: currentDimension,
    model: getMeta('model'),
    rowCount,
  };
}

export function resetIndex(): void {
  dropVecTable();
  const db = getVecDb();
  db.prepare("DELETE FROM vec_meta WHERE key IN ('dimension', 'model')").run();
  currentDimension = null;
  initialized = false;
  console.log('[vec-index] Index reset');
}
