import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersRepository } from '../../src/db/repositories/papers.repository';
import { PapersService } from '../../src/main/services/papers.service';
import * as vecIndex from '../../src/main/services/vec-index.service';
import * as searchUnitIndex from '../../src/main/services/search-unit-index.service';
import { rebuildSearchUnitsForPaper } from '../../src/main/services/search-unit-sync.service';

const { embedTexts } = vi.hoisted(() => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((text) => {
      const value = text.toLowerCase();
      if (value.includes('transformer')) return [1, 0, 0];
      if (value.includes('retrieval augmented generation') || value.includes('rag'))
        return [0, 1, 0];
      if (value.includes('alignment')) return [0, 0, 1];
      return [0.2, 0.2, 0.2];
    }),
  ),
}));

vi.mock('../../src/main/store/app-settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/store/app-settings-store')>();
  return {
    ...actual,
    getSemanticSearchSettings: () => ({
      ...actual.getSemanticSearchSettings(),
      enabled: true,
      autoProcess: true,
      embeddingProvider: 'builtin',
      embeddingModel: 'test-model',
    }),
  };
});

vi.mock('../../src/main/services/local-semantic.service', () => ({
  localSemanticService: {
    embedTexts,
    switchProvider: vi.fn(),
  },
}));

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
        // ignore
      }
      vecDb = undefined;
    }
  },
}));

describe('semantic search routing', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
    embedTexts.mockClear();
    if (vecDb) {
      try {
        vecDb.exec('DROP TABLE IF EXISTS vec_chunks');
        vecDb.exec('DROP TABLE IF EXISTS vec_search_units');
        vecDb.exec('DROP TABLE IF EXISTS paper_search_units_fts');
      } catch {
        // ignore
      }
      vecDb.prepare('DELETE FROM vec_meta').run();
    }
    vecIndex.resetIndex();
    searchUnitIndex.resetIndex();
  });

  afterAll(async () => {
    if (vecDb) {
      try {
        vecDb.close();
      } catch {
        // ignore
      }
      vecDb = undefined;
    }
    await closeTestDatabase();
  });

  async function seedPaper(params: {
    title: string;
    abstract?: string;
    tags?: string[];
    chunkContent: string;
    chunkEmbedding: number[];
    units: Array<{
      unitType: 'title' | 'abstract' | 'sentence';
      content: string;
      embedding: number[];
    }>;
  }) {
    const service = new PapersService();
    const repo = new PapersRepository();
    const paper = await service.create({
      title: params.title,
      source: 'manual',
      abstract: params.abstract,
      tags: params.tags ?? [],
    });

    await repo.updateProcessingState(paper.id, {
      processingStatus: 'completed',
      indexedAt: new Date('2026-03-09T10:00:00Z'),
      processedAt: new Date('2026-03-09T10:00:00Z'),
    });
    await repo.replaceChunks(paper.id, [
      {
        chunkIndex: 0,
        content: params.chunkContent,
        contentPreview: params.chunkContent.slice(0, 120),
        embedding: params.chunkEmbedding,
      },
    ]);
    await repo.replaceSearchUnits(
      paper.id,
      params.units.map((unit, index) => ({
        unitType: unit.unitType,
        sourceChunkIndex: unit.unitType === 'sentence' ? 0 : null,
        unitIndex: index,
        content: unit.content,
        contentPreview: unit.content.slice(0, 120),
        normalizedText: unit.content.toLowerCase(),
        embedding: unit.embedding,
      })),
    );

    const chunkIds = await repo.listChunkIdsForPaper(paper.id);
    vecIndex.initialize(3, 'test-model');
    vecIndex.syncChunksForPaper(
      paper.id,
      chunkIds.map((id) => ({ id, embedding: params.chunkEmbedding })),
    );

    const unitRows = await repo.listSearchUnitsForPaper(paper.id);
    searchUnitIndex.initialize(3, 'test-model');
    const embeddingByKey = new Map(
      params.units.map((unit, index) => [
        `${unit.unitType}:${unit.unitType === 'sentence' ? 0 : 'root'}:${index}`,
        unit.embedding,
      ]),
    );
    searchUnitIndex.syncUnitsForPaper(
      paper.id,
      unitRows.map((row) => ({
        id: row.id,
        unitType: row.unitType,
        content: row.content,
        normalizedText: row.normalizedText,
        embedding: embeddingByKey.get(
          `${row.unitType}:${row.sourceChunkIndex ?? 'root'}:${row.unitIndex}`,
        ) ?? [0.2, 0.2, 0.2],
      })),
    );

    return paper;
  }

  it('prefers exact title evidence for single-term queries and blocks chunk-only drift', async () => {
    await seedPaper({
      title: 'Transformer Systems for Search',
      abstract: 'A paper about transformer-based retrieval.',
      chunkContent: 'This section explains sparse attention and retrieval.',
      chunkEmbedding: [1, 0, 0],
      units: [
        { unitType: 'title', content: 'Transformer Systems for Search', embedding: [1, 0, 0] },
        {
          unitType: 'sentence',
          content: 'Transformer systems are effective for semantic retrieval.',
          embedding: [1, 0, 0],
        },
      ],
    });

    const driftPaper = await seedPaper({
      title: 'Sequence Models for Search',
      abstract: 'Architecture details without the keyword.',
      chunkContent: 'Sequence models improve ranking in production systems.',
      chunkEmbedding: [1, 0, 0],
      units: [
        { unitType: 'title', content: 'Sequence Models for Search', embedding: [0, 1, 0] },
        {
          unitType: 'sentence',
          content: 'Ranking systems benefit from sequence modeling.',
          embedding: [0, 1, 0],
        },
      ],
    });

    const { SemanticSearchService } =
      await import('../../src/main/services/semantic-search.service');
    const service = new SemanticSearchService();
    const result = await service.search('transformer', 10);

    expect(result.mode).toBe('semantic');
    expect(result.papers[0]?.title).toContain('Transformer');
    expect(result.papers.some((paper) => paper.id === driftPaper.id)).toBe(false);
  });

  it('prefers sentence evidence over broad chunk similarity for short phrases', async () => {
    await seedPaper({
      title: 'Grounded Generation Notes',
      abstract: 'Practical notes on grounded generation.',
      chunkContent: 'This chunk is mostly about general evaluation and reliability.',
      chunkEmbedding: [0, 1, 0],
      units: [
        { unitType: 'title', content: 'Grounded Generation Notes', embedding: [0.2, 0.2, 0.2] },
        {
          unitType: 'sentence',
          content: 'Retrieval augmented generation improves factual grounding for assistants.',
          embedding: [0, 1, 0],
        },
      ],
    });

    await seedPaper({
      title: 'General Retrieval Notes',
      abstract: 'A broad paper.',
      chunkContent: 'General retrieval systems and ranking pipelines are discussed here.',
      chunkEmbedding: [0, 1, 0],
      units: [
        { unitType: 'title', content: 'General Retrieval Notes', embedding: [0.2, 0.2, 0.2] },
        {
          unitType: 'sentence',
          content: 'This paper discusses document ranking and retrieval evaluation.',
          embedding: [0.2, 0.2, 0.2],
        },
      ],
    });

    const { SemanticSearchService } =
      await import('../../src/main/services/semantic-search.service');
    const service = new SemanticSearchService();
    const result = await service.search('retrieval augmented generation', 10);

    expect(result.mode).toBe('semantic');
    expect(result.papers[0]?.relevanceReason?.toLowerCase()).toContain(
      'retrieval augmented generation',
    );
    expect(result.papers[0]?.matchSignals).toContain('sentence');
  });

  it('rebuilds search units after title updates', async () => {
    const papersService = new PapersService();
    const repo = new PapersRepository();
    const paper = await papersService.create({
      title: 'Old Working Title',
      source: 'manual',
      tags: [],
    });

    await repo.updateProcessingState(paper.id, {
      processingStatus: 'completed',
      indexedAt: new Date('2026-03-09T10:00:00Z'),
      processedAt: new Date('2026-03-09T10:00:00Z'),
    });
    await repo.replaceChunks(paper.id, [
      {
        chunkIndex: 0,
        content: 'Alignment techniques improve model behavior over time.',
        contentPreview: 'Alignment techniques improve model behavior over time.',
        embedding: [0, 0, 1],
      },
    ]);
    vecIndex.initialize(3, 'test-model');
    const chunkIds = await repo.listChunkIdsForPaper(paper.id);
    vecIndex.syncChunksForPaper(
      paper.id,
      chunkIds.map((id) => ({ id, embedding: [0, 0, 1] })),
    );

    await repo.updateTitle(paper.id, 'Alignment Handbook');
    await rebuildSearchUnitsForPaper(paper.id);

    const { SemanticSearchService } =
      await import('../../src/main/services/semantic-search.service');
    const service = new SemanticSearchService();
    const result = await service.search('alignment', 10);

    expect(result.mode).toBe('semantic');
    expect(result.papers[0]?.id).toBe(paper.id);
    expect(result.papers[0]?.relevanceReason).toContain('Alignment Handbook');
  });
});
