import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersRepository } from '../../src/db/repositories/papers.repository';
import { PapersService } from '../../src/main/services/papers.service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.resolve(__dirname, '..', 'tmp', 'integration.sqlite');
let vecDb: Database.Database | undefined;

vi.mock('../../src/db/vec-client', () => ({
  getVecDb: () => {
    if (!vecDb) {
      vecDb = new Database(testDbPath);
      vecDb.pragma('journal_mode = WAL');
      sqliteVec.load(vecDb);
      vecDb.exec(`
        CREATE TABLE IF NOT EXISTS vec_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    }
    return vecDb;
  },
  closeVecDb: () => {
    if (vecDb) {
      try {
        vecDb.close();
      } catch {
        /* ignore */
      }
      vecDb = undefined;
    }
  },
}));

describe('semantic repository integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    if (vecDb) {
      try {
        vecDb.close();
      } catch {
        /* ignore */
      }
      vecDb = undefined;
    }
    await closeTestDatabase();
  });

  it('stores processing metadata and semantic chunks', async () => {
    const service = new PapersService();
    const repo = new PapersRepository();

    const paper = await service.create({
      title: 'Semantic Indexing for PDFs',
      source: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/2501.12345',
      pdfUrl: 'https://arxiv.org/pdf/2501.12345.pdf',
      tags: ['search'],
    });

    const processedAt = new Date('2026-03-08T10:00:00Z');
    const indexedAt = new Date('2026-03-08T10:01:00Z');

    await repo.updateProcessingState(paper.id, {
      processingStatus: 'completed',
      processingError: null,
      processedAt,
      indexedAt,
      metadataSource: 'ollama',
    });
    await repo.replaceChunks(paper.id, [
      {
        chunkIndex: 0,
        content: 'first chunk content',
        contentPreview: 'first chunk content',
        embedding: [0.1, 0.2, 0.3],
      },
      {
        chunkIndex: 1,
        content: 'second chunk content',
        contentPreview: 'second chunk content',
        embedding: [0.3, 0.2, 0.1],
      },
    ]);

    const updated = await repo.findById(paper.id);
    expect(updated?.processingStatus).toBe('completed');
    expect(updated?.metadataSource).toBe('ollama');
    expect(updated?.processedAt).toEqual(processedAt);
    expect(updated?.indexedAt).toEqual(indexedAt);

    const chunks = await repo.listChunksForSemanticSearch();
    expect(chunks).toHaveLength(2);
    expect(chunks[0].paperId).toBe(paper.id);
    expect(await repo.getChunkCountForPaper(paper.id)).toBe(2);
    expect(await repo.listIndexedPaperIds()).toContain(paper.id);
  });

  it('lists pending semantic papers and clears chunks on delete', async () => {
    const service = new PapersService();
    const repo = new PapersRepository();

    const pending = await service.create({
      title: 'Pending Semantic Paper',
      source: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/2502.54321',
      pdfUrl: 'https://arxiv.org/pdf/2502.54321.pdf',
      tags: [],
    });

    await service.create({
      title: 'Manual Note Only',
      source: 'manual',
      tags: [],
    });

    await repo.replaceChunks(pending.id, [
      {
        chunkIndex: 0,
        content: 'pending chunk',
        contentPreview: 'pending chunk',
        embedding: [1, 0, 0],
      },
    ]);

    expect(await repo.listPendingSemanticPaperIds()).toContain(pending.id);

    await repo.deleteMany([pending.id]);
    expect(await repo.getChunkCountForPaper(pending.id)).toBe(0);
  });
});
