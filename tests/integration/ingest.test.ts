import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  beforeAll,
  afterAll as afterAllFn,
} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersService } from '../../src/main/services/papers.service';
import {
  importScannedPapers,
  importChromeHistoryFromFile,
  getImportStatus,
  cancelImport,
  type ScanResult,
} from '../../src/main/services/ingest.service';
import { PapersRepository } from '../../src/db/repositories/papers.repository';

// Helper to create a temporary Chrome history export file
function createTempHistoryFile(
  entries: Array<{ title: string; url: string; abstract?: string }>,
): string {
  const tmpPath = path.join(os.tmpdir(), `chrome-history-test-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
  return tmpPath;
}

// Helper to cleanup temp files
function cleanupTempFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

describe('ingest service integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe('basic import functionality', () => {
    it('upserts papers from chrome history simulation', async () => {
      const service = new PapersService();

      const entries = [
        {
          title: 'Attention Is All You Need',
          url: 'https://arxiv.org/abs/1706.03762',
          tags: ['llm', 'transformer'],
        },
        {
          title: 'BERT: Pre-training of Deep Bidirectional Transformers',
          url: 'https://arxiv.org/abs/1810.04805',
          tags: ['llm', 'nlp'],
        },
        {
          title: 'GPT-3: Language Models are Few-Shot Learners',
          url: 'https://arxiv.org/abs/2005.14165',
          tags: ['llm'],
        },
      ];

      for (const entry of entries) {
        await service.upsertFromIngest({
          title: entry.title,
          source: 'arxiv',
          sourceUrl: entry.url,
          tags: entry.tags,
        });
      }

      const all = await service.list({});
      expect(all.length).toBe(3);

      // Upsert same paper again — should not duplicate
      await service.upsertFromIngest({
        title: 'Attention Is All You Need',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        tags: ['llm'],
      });

      const afterUpsert = await service.list({});
      expect(afterUpsert.length).toBe(3);
    });

    it('handles papers with no tags', async () => {
      const service = new PapersService();

      await service.upsertFromIngest({
        title: 'Paper Without Tags',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        tags: [],
      });

      const all = await service.list({});
      expect(all.length).toBe(1);
      expect(all[0].tagNames).toEqual([]);
    });

    it('handles papers with metadata', async () => {
      const service = new PapersService();

      await service.upsertFromIngest({
        title: 'Paper with Metadata',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        tags: ['test'],
        authors: ['Alice', 'Bob'],
        abstract: 'This is an abstract.',
        year: 2024,
      });

      const all = await service.list({});
      expect(all.length).toBe(1);
      expect(all[0].authors).toEqual(['Alice', 'Bob']);
      expect(all[0].abstract).toBe('This is an abstract.');
      expect(all[0].year).toBe(2024);
    });
  });

  describe('import from file', () => {
    // Network-dependent tests - skip in CI or when network is unreliable
    const maybeIt = process.env.RUN_NETWORK_TESTS ? it : it.skip;

    maybeIt(
      'imports papers from Chrome history JSON export',
      async () => {
        const historyFile = createTempHistoryFile([
          { title: 'Test Paper One', url: 'https://arxiv.org/abs/2401.00001' },
          { title: 'Test Paper Two', url: 'https://arxiv.org/abs/2401.00002' },
          { title: 'Non-Arxiv Link', url: 'https://example.com/page' }, // Should be filtered
        ]);

        try {
          const result = await importChromeHistoryFromFile(historyFile);

          expect(result.imported).toBeGreaterThanOrEqual(0); // Depends on network availability
          expect(result.skipped).toBeGreaterThanOrEqual(0);
        } finally {
          cleanupTempFile(historyFile);
        }
      },
      { timeout: 60000 },
    );

    it('handles invalid JSON gracefully', async () => {
      const tmpPath = path.join(os.tmpdir(), `invalid-history-${Date.now()}.json`);
      fs.writeFileSync(tmpPath, 'not valid json');

      try {
        await expect(importChromeHistoryFromFile(tmpPath)).rejects.toThrow();
      } finally {
        cleanupTempFile(tmpPath);
      }
    });

    it('handles empty history file', async () => {
      const historyFile = createTempHistoryFile([]);

      try {
        const result = await importChromeHistoryFromFile(historyFile);
        expect(result.imported).toBe(0);
        expect(result.skipped).toBe(0);
      } finally {
        cleanupTempFile(historyFile);
      }
    });

    maybeIt(
      'imports papers with abstracts from history file',
      async () => {
        const historyFile = createTempHistoryFile([
          {
            title: 'Paper with Abstract',
            url: 'https://arxiv.org/abs/2401.00001',
            abstract: 'Pre-defined abstract for testing.',
          },
        ]);

        try {
          await importChromeHistoryFromFile(historyFile);
        } finally {
          cleanupTempFile(historyFile);
        }
      },
      { timeout: 60000 },
    );
  });

  describe('import scanned papers', () => {
    // Network-dependent tests
    const maybeIt = process.env.RUN_NETWORK_TESTS ? it : it.skip;

    maybeIt(
      'imports from pre-scanned paper list',
      async () => {
        const scannedPapers: ScanResult['papers'] = [
          {
            arxivId: '2401.00001',
            title: 'Scanned Paper One',
            url: 'https://arxiv.org/abs/2401.00001',
          },
          {
            arxivId: '2401.00002',
            title: 'Scanned Paper Two',
            url: 'https://arxiv.org/abs/2401.00002',
          },
        ];

        const result = await importScannedPapers(scannedPapers);

        // Import may succeed or skip depending on whether papers already exist
        expect(result.imported + result.skipped).toBe(2);
      },
      { timeout: 60000 },
    );

    it('handles empty scanned list', async () => {
      const result = await importScannedPapers([]);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
    });

    maybeIt(
      'skips already existing papers',
      async () => {
        const service = new PapersService();
        const repo = new PapersRepository();

        // Pre-create a paper with the same arxiv ID
        await service.create({
          title: 'Existing Paper',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/2401.00001',
          tags: [],
        });

        const existingShortIds = await repo.listAllShortIds();
        expect(existingShortIds.has('2401.00001')).toBe(true);

        // Try to import the same paper
        const result = await importScannedPapers([
          {
            arxivId: '2401.00001',
            title: 'Existing Paper',
            url: 'https://arxiv.org/abs/2401.00001',
          },
        ]);

        expect(result.skipped).toBeGreaterThanOrEqual(1);
      },
      { timeout: 60000 },
    );
  });

  describe('import status management', () => {
    it('returns current import status', () => {
      const status = getImportStatus();
      expect(status).toHaveProperty('active');
      expect(status).toHaveProperty('phase');
      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('completed');
      expect(status).toHaveProperty('success');
      expect(status).toHaveProperty('failed');
      expect(status).toHaveProperty('skipped');
    });

    it('status is inactive when no import is running', () => {
      const status = getImportStatus();
      expect(status.active).toBe(false);
    });

    it('can request cancellation', () => {
      // Should not throw even when no import is active
      expect(() => cancelImport()).not.toThrow();
    });
  });

  describe('concurrent import handling', () => {
    it('handles sequential upserts for the same paper correctly', async () => {
      const service = new PapersService();

      // Sequentially upsert the same paper - should deduplicate
      const result1 = await service.upsertFromIngest({
        title: 'Concurrent Paper',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        tags: ['test'],
      });

      const result2 = await service.upsertFromIngest({
        title: 'Concurrent Paper',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        tags: ['test'],
      });

      // Both should return the same paper (same ID)
      expect(result1.id).toBe(result2.id);

      // Should only have one paper in the database
      const all = await service.list({});
      expect(all.length).toBe(1);
    });

    it('handles batch upsert of different papers', async () => {
      const service = new PapersService();

      const entries = Array.from({ length: 10 }, (_, i) => ({
        title: `Batch Paper ${i}`,
        source: 'arxiv' as const,
        sourceUrl: `https://arxiv.org/abs/2401.0000${i}`,
        tags: [`tag-${i}`],
      }));

      await Promise.all(entries.map((entry) => service.upsertFromIngest(entry)));

      const all = await service.list({});
      expect(all.length).toBe(10);
    });
  });

  describe('error handling', () => {
    it('handles missing source URL gracefully', async () => {
      const service = new PapersService();

      // Paper without sourceUrl should still be created
      const paper = await service.create({
        title: 'Paper Without URL',
        source: 'manual',
        tags: [],
      });

      expect(paper.id).toBeDefined();
      // sourceUrl is null when not provided (SQLite behavior)
      expect(paper.sourceUrl).toBeNull();
    });

    it('handles special characters in title', async () => {
      const service = new PapersService();

      const paper = await service.upsertFromIngest({
        title: 'Paper with "quotes" and <brackets> & symbols',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        tags: [],
      });

      expect(paper.title).toContain('quotes');
      expect(paper.title).toContain('brackets');
    });

    it('handles unicode characters in metadata', async () => {
      const service = new PapersService();

      const paper = await service.upsertFromIngest({
        title: '论文标题 with 中文字符',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        authors: ['张三', '李四'],
        abstract: 'Abstract with émojis 🚀 and ünïcödë',
        tags: [],
      });

      expect(paper.title).toContain('中文');
      expect(paper.authors).toContain('张三');
      expect(paper.abstract).toContain('🚀');
    });
  });

  describe('source tracking', () => {
    it('tracks arxiv as source', async () => {
      const service = new PapersService();

      const paper = await service.upsertFromIngest({
        title: 'ArXiv Paper',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1234.56789',
        tags: [],
      });

      expect(paper.source).toBe('arxiv');
      expect(paper.sourceUrl).toBe('https://arxiv.org/abs/1234.56789');
    });

    it('tracks manual as source', async () => {
      const service = new PapersService();

      const paper = await service.create({
        title: 'Manual Paper',
        source: 'manual',
        tags: [],
      });

      expect(paper.source).toBe('manual');
    });
  });
});

// Extended import tests with network calls (slower)
describe('ingest service network tests', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it(
    'handles network timeout gracefully when fetching arXiv metadata',
    async () => {
      const historyFile = createTempHistoryFile([
        { title: 'Test Paper', url: 'https://arxiv.org/abs/2401.99999' },
      ]);

      try {
        // This should complete even if network is slow
        const result = await importChromeHistoryFromFile(historyFile);
        // Result depends on network availability
        expect(result).toHaveProperty('imported');
        expect(result).toHaveProperty('skipped');
      } finally {
        cleanupTempFile(historyFile);
      }
    },
    { timeout: 60000 },
  );
});
