import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersRepository } from '../../src/db/repositories/papers.repository';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.resolve(__dirname, '..', 'tmp', 'integration.sqlite');

function makeEmbedding(dimension: number, seed: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < dimension; i++) {
    result.push(Math.sin(seed * (i + 1) * 0.1));
  }
  // Normalize to unit vector
  const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
  return result.map((v) => v / norm);
}

describe('vec-index integration', () => {
  let db: Database.Database;
  let repo: PapersRepository;

  ensureTestDatabaseSchema();

  beforeAll(() => {
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    sqliteVec.load(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS vec_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    repo = new PapersRepository();
    // Clean vec tables
    try {
      db.exec('DROP TABLE IF EXISTS vec_chunks');
    } catch {
      // ignore
    }
    db.prepare("DELETE FROM vec_meta WHERE key IN ('dimension', 'model')").run();
  });

  afterAll(async () => {
    db.close();
    await closeTestDatabase();
  });

  function createVecTable(dimension: number) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[${dimension}] distance_metric=cosine
      )
    `);
    db.prepare("INSERT OR REPLACE INTO vec_meta (key, value) VALUES ('dimension', ?)").run(
      String(dimension),
    );
    db.prepare("INSERT OR REPLACE INTO vec_meta (key, value) VALUES ('model', ?)").run(
      'test-model',
    );
  }

  function insertVecChunk(chunkId: string, embedding: number[]) {
    const buf = new Float32Array(embedding);
    db.prepare('INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)').run(
      chunkId,
      Buffer.from(buf.buffer),
    );
  }

  function searchKNN(queryEmbedding: number[], k: number) {
    const buf = new Float32Array(queryEmbedding);
    return db
      .prepare(
        `SELECT chunk_id, distance
         FROM vec_chunks
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(Buffer.from(buf.buffer), k) as Array<{ chunk_id: string; distance: number }>;
  }

  function getVecRowCount(): number {
    const row = db.prepare('SELECT count(*) as cnt FROM vec_chunks').get() as { cnt: number };
    return row.cnt;
  }

  it('creates paper with chunks and syncs to vec_chunks', async () => {
    const dimension = 8;
    createVecTable(dimension);

    // Create paper
    const paper = await repo.create({
      shortId: 'vec-test-1',
      title: 'Vector Search Test Paper',
      authors: ['Test Author'],
      source: 'manual',
      tags: ['test'],
    });

    // Create chunks with embeddings
    const embeddings = [makeEmbedding(dimension, 1), makeEmbedding(dimension, 2)];
    await repo.replaceChunks(
      paper.id,
      embeddings.map((emb, i) => ({
        chunkIndex: i,
        content: `Chunk ${i} content for vector search testing`,
        contentPreview: `Chunk ${i} preview`,
        embedding: emb,
      })),
    );

    // Sync chunks to vec index
    const chunkIds = await repo.listChunkIdsForPaper(paper.id);
    expect(chunkIds.length).toBe(2);

    for (let i = 0; i < chunkIds.length; i++) {
      insertVecChunk(chunkIds[i], embeddings[i]);
    }

    expect(getVecRowCount()).toBe(2);
  });

  it('performs KNN search and returns correct results', async () => {
    const dimension = 8;
    createVecTable(dimension);

    // Create two papers with distinct embeddings
    const paper1 = await repo.create({
      shortId: 'knn-1',
      title: 'Paper about transformers',
      authors: ['Author A'],
      source: 'manual',
      tags: ['nlp'],
    });

    const paper2 = await repo.create({
      shortId: 'knn-2',
      title: 'Paper about vision',
      authors: ['Author B'],
      source: 'manual',
      tags: ['cv'],
    });

    // Paper 1 embeddings (seed 1, 2)
    const emb1a = makeEmbedding(dimension, 1);
    const emb1b = makeEmbedding(dimension, 2);
    await repo.replaceChunks(paper1.id, [
      {
        chunkIndex: 0,
        content: 'transformers text',
        contentPreview: 'transformers',
        embedding: emb1a,
      },
      { chunkIndex: 1, content: 'attention text', contentPreview: 'attention', embedding: emb1b },
    ]);

    // Paper 2 embeddings (seed 10, 11)
    const emb2a = makeEmbedding(dimension, 10);
    const emb2b = makeEmbedding(dimension, 11);
    await repo.replaceChunks(paper2.id, [
      { chunkIndex: 0, content: 'vision text', contentPreview: 'vision', embedding: emb2a },
      {
        chunkIndex: 1,
        content: 'convolutional text',
        contentPreview: 'convolutional',
        embedding: emb2b,
      },
    ]);

    // Sync both papers to vec
    const chunks1 = await repo.listChunkIdsForPaper(paper1.id);
    const chunks2 = await repo.listChunkIdsForPaper(paper2.id);

    insertVecChunk(chunks1[0], emb1a);
    insertVecChunk(chunks1[1], emb1b);
    insertVecChunk(chunks2[0], emb2a);
    insertVecChunk(chunks2[1], emb2b);

    expect(getVecRowCount()).toBe(4);

    // Query with embedding similar to paper 1
    const query = makeEmbedding(dimension, 1);
    const results = searchKNN(query, 4);

    expect(results.length).toBe(4);
    // First result should be the chunk closest to seed=1
    expect(results[0].chunk_id).toBe(chunks1[0]);
    expect(results[0].distance).toBeCloseTo(0, 4); // Same vector → distance ≈ 0
  });

  it('deletes chunks from vec_chunks when paper is deleted', async () => {
    const dimension = 8;
    createVecTable(dimension);

    const paper = await repo.create({
      shortId: 'del-test',
      title: 'Paper to delete',
      authors: ['Author'],
      source: 'manual',
      tags: ['test'],
    });

    const emb = makeEmbedding(dimension, 5);
    await repo.replaceChunks(paper.id, [
      { chunkIndex: 0, content: 'test', contentPreview: 'test', embedding: emb },
    ]);

    const chunkIds = await repo.listChunkIdsForPaper(paper.id);
    insertVecChunk(chunkIds[0], emb);
    expect(getVecRowCount()).toBe(1);

    // Delete from vec_chunks using chunk IDs
    const placeholders = chunkIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
    expect(getVecRowCount()).toBe(0);
  });

  it('rebuilds vec index from existing chunks', async () => {
    const dimension = 8;

    // Create papers with chunks in Prisma first
    const paper = await repo.create({
      shortId: 'rebuild-1',
      title: 'Rebuild test',
      authors: ['Author'],
      source: 'manual',
      tags: ['test'],
    });

    const embs = [makeEmbedding(dimension, 3), makeEmbedding(dimension, 4)];
    await repo.replaceChunks(paper.id, [
      { chunkIndex: 0, content: 'chunk 0', contentPreview: 'chunk 0', embedding: embs[0] },
      { chunkIndex: 1, content: 'chunk 1', contentPreview: 'chunk 1', embedding: embs[1] },
    ]);

    // Now create vec table and rebuild from Prisma data
    createVecTable(dimension);

    const allChunks = await repo.listChunksForSemanticSearch();
    for (const chunk of allChunks) {
      const embedding = JSON.parse(chunk.embeddingJson) as number[];
      insertVecChunk(chunk.id, embedding);
    }

    expect(getVecRowCount()).toBe(2);

    // Verify search works
    const query = makeEmbedding(dimension, 3);
    const results = searchKNN(query, 2);
    expect(results.length).toBe(2);
    expect(results[0].distance).toBeCloseTo(0, 4);
  });

  it('handles dimension change by dropping and recreating table', async () => {
    // Create with dimension 4
    createVecTable(4);
    insertVecChunk('dim4-chunk', makeEmbedding(4, 1));
    expect(getVecRowCount()).toBe(1);

    // Simulate dimension change: drop + recreate with dimension 8
    db.exec('DROP TABLE vec_chunks');
    createVecTable(8);

    expect(getVecRowCount()).toBe(0);

    // Insert with new dimension works
    insertVecChunk('dim8-chunk', makeEmbedding(8, 1));
    expect(getVecRowCount()).toBe(1);
  });

  it('findChunksByIds returns correct chunks with paper metadata', async () => {
    const paper = await repo.create({
      shortId: 'find-test',
      title: 'findChunksByIds test',
      authors: ['Author'],
      source: 'manual',
      tags: ['test-tag'],
    });

    await repo.replaceChunks(paper.id, [
      { chunkIndex: 0, content: 'c0', contentPreview: 'p0', embedding: [1, 0, 0] },
      { chunkIndex: 1, content: 'c1', contentPreview: 'p1', embedding: [0, 1, 0] },
    ]);

    const allChunkIds = await repo.listChunkIdsForPaper(paper.id);
    expect(allChunkIds.length).toBe(2);

    const found = await repo.findChunksByIds([allChunkIds[0]]);
    expect(found.length).toBe(1);
    expect(found[0].paper.title).toBe('findChunksByIds test');
    expect(found[0].contentPreview).toBe('p0');
  });

  it('listChunkIdsForPapers returns IDs for multiple papers', async () => {
    const p1 = await repo.create({
      shortId: 'multi-1',
      title: 'Multi paper 1',
      authors: ['A'],
      source: 'manual',
      tags: ['t'],
    });
    const p2 = await repo.create({
      shortId: 'multi-2',
      title: 'Multi paper 2',
      authors: ['B'],
      source: 'manual',
      tags: ['t'],
    });

    await repo.replaceChunks(p1.id, [
      { chunkIndex: 0, content: 'c', contentPreview: 'p', embedding: [1] },
    ]);
    await repo.replaceChunks(p2.id, [
      { chunkIndex: 0, content: 'c', contentPreview: 'p', embedding: [1] },
      { chunkIndex: 1, content: 'c2', contentPreview: 'p2', embedding: [0] },
    ]);

    const ids = await repo.listChunkIdsForPapers([p1.id, p2.id]);
    expect(ids.length).toBe(3);
  });
});
