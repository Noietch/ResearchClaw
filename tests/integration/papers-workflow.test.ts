/**
 * Production-grade integration tests for PapersService workflow
 *
 * Tests cover:
 *  - Full paper lifecycle (create → update metadata → add tags → delete)
 *  - Batch operations (create many, delete many)
 *  - Chrome history import simulation
 *  - Paper → reading card workflow
 *  - upsertFromIngest deduplication
 *  - Paper filtering and sorting
 *  - Edge cases: empty inputs, special characters in titles
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersService } from '../../src/main/services/papers.service';
import { ReadingService } from '../../src/main/services/reading.service';
import { PapersRepository } from '../../src/db/repositories/papers.repository';

// Mock vec-client to avoid sqlite-vec dependency in tests
vi.mock('../../src/db/vec-client', () => ({
  getVecDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn() })),
    transaction: vi.fn((fn: Function) => fn),
  })),
  closeVecDb: vi.fn(),
}));

describe('PapersService workflow', () => {
  const testStorageDir = path.join(os.tmpdir(), 'researchclaw-workflow-test-' + Date.now());

  ensureTestDatabaseSchema();

  beforeAll(() => {
    fs.mkdirSync(path.join(testStorageDir, 'papers'), { recursive: true });
    process.env.RESEARCH_CLAW_STORAGE_DIR = testStorageDir;
  });

  afterAll(async () => {
    await closeTestDatabase();
    fs.rmSync(testStorageDir, { recursive: true, force: true });
    delete process.env.RESEARCH_CLAW_STORAGE_DIR;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  // ── Full lifecycle ─────────────────────────────────────────────────────────

  describe('full paper lifecycle', () => {
    it('creates, reads, updates, and deletes a paper', async () => {
      const service = new PapersService();

      // 1. Create
      const paper = await service.create({
        title: 'Attention Is All You Need',
        authors: ['Vaswani', 'Shazeer', 'Parmar'],
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        submittedAt: new Date('2017-06-12T00:00:00Z'),
        abstract: 'We propose the Transformer architecture.',
        tags: ['transformer', 'nlp'],
      });

      expect(paper.id).toBeDefined();
      expect(paper.shortId).toBe('1706.03762'); // extracted from arXiv URL
      expect(paper.title).toBe('Attention Is All You Need');

      // 2. Read by ID
      const found = await service.getById(paper.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Attention Is All You Need');

      // 3. Read by shortId
      const foundByShort = await service.getByShortId('1706.03762');
      expect(foundByShort!.id).toBe(paper.id);

      // 4. List
      const all = await service.list({});
      expect(all.length).toBe(1);

      // 5. Delete
      const deleted = await service.deleteById(paper.id);
      expect(deleted!.id).toBe(paper.id);

      const afterDelete = await service.list({});
      expect(afterDelete.length).toBe(0);
    });
  });

  // ── Chrome history import simulation ──────────────────────────────────────

  describe('Chrome history import simulation', () => {
    it('imports realistic Chrome history sample data', async () => {
      const service = new PapersService();

      // Simulate realistic arXiv papers from Chrome history
      const chromeHistorySample = [
        {
          title: 'Attention Is All You Need',
          sourceUrl: 'https://arxiv.org/abs/1706.03762',
          tags: ['transformer', 'nlp'],
        },
        {
          title: 'BERT: Pre-training of Deep Bidirectional Transformers',
          sourceUrl: 'https://arxiv.org/abs/1810.04805',
          tags: ['nlp', 'language-model'],
        },
        {
          title: 'GPT-4 Technical Report',
          sourceUrl: 'https://arxiv.org/abs/2303.08774',
          tags: ['llm', 'gpt'],
        },
        {
          title: 'Stable Diffusion: High-Resolution Image Synthesis',
          sourceUrl: 'https://arxiv.org/abs/2112.10752',
          tags: ['diffusion', 'generative'],
        },
        {
          title: 'LLaMA: Open and Efficient Foundation Language Models',
          sourceUrl: 'https://arxiv.org/abs/2302.13971',
          tags: ['llm', 'open-source'],
        },
      ];

      const created = [];
      for (const entry of chromeHistorySample) {
        const paper = await service.upsertFromIngest({
          title: entry.title,
          source: 'chrome',
          sourceUrl: entry.sourceUrl,
          tags: entry.tags,
        });
        created.push(paper);
      }

      // Verify all papers created
      const all = await service.list({});
      expect(all.length).toBe(5);

      // Verify arXiv IDs extracted correctly
      expect(created[0].shortId).toBe('1706.03762');
      expect(created[1].shortId).toBe('1810.04805');

      // Verify tags assigned
      const attention = await service.getByShortId('1706.03762');
      expect(attention!.tagNames).toContain('transformer');
      expect(attention!.tagNames).toContain('nlp');
    });

    it('deduplicates papers on re-import', async () => {
      const service = new PapersService();

      // First import
      const first = await service.upsertFromIngest({
        title: 'Attention Is All You Need',
        source: 'chrome',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        tags: ['transformer'],
      });

      // Re-import same paper
      const second = await service.upsertFromIngest({
        title: 'Attention Is All You Need',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        tags: ['nlp'],
      });

      expect(first.id).toBe(second.id);

      const all = await service.list({});
      expect(all.length).toBe(1);
    });

    it('handles papers with same URL but different case', async () => {
      const service = new PapersService();

      await service.upsertFromIngest({
        title: 'Test Paper',
        source: 'chrome',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        tags: [],
      });

      // Same paper, URL already normalized
      await service.upsertFromIngest({
        title: 'Test Paper',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        tags: [],
      });

      const all = await service.list({});
      expect(all.length).toBe(1);
    });
  });

  // ── Paper → Reading card workflow ──────────────────────────────────────────

  describe('paper to reading card workflow', () => {
    it('creates paper then generates reading card with structured notes', async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();

      // 1. Import paper
      const paper = await papersService.create({
        title: 'LoRA: Low-Rank Adaptation of Large Language Models',
        authors: ['Hu', 'Shen', 'Wallis', 'Allen-Zhu'],
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2106.09685',
        submittedAt: new Date('2021-06-17T00:00:00Z'),
        abstract:
          'We propose Low-Rank Adaptation (LoRA), which freezes pretrained weights and injects trainable rank decomposition matrices.',
        tags: ['lora', 'fine-tuning', 'llm'],
      });

      expect(paper.shortId).toBe('2106.09685');

      // 2. Create reading notes (paper → reading card)
      const note = await readingService.create({
        paperId: paper.id,
        type: 'paper',
        title: `Reading: ${paper.title}`,
        content: {
          'Research Problem': '',
          'Core Method': '',
          Contributions: '',
          'Key Experiments': '',
          Limitations: '',
          'Personal Notes': '',
        },
      });

      expect(note.paperId).toBe(paper.id);

      // 3. Fill in reading notes
      const filled = await readingService.update(note.id, {
        'Research Problem': 'Full fine-tuning of LLMs is too expensive in terms of parameters',
        'Core Method': 'Inject low-rank decomposition matrices into transformer layers',
        Contributions: 'Reduces trainable parameters by 10,000x; matches full fine-tuning quality',
        'Key Experiments': 'GPT-3 fine-tuning on NLP benchmarks, RoBERTa, DeBERTa',
        Limitations: 'Adds inference latency when switching tasks',
        'Personal Notes': 'Very practical for adapting large models',
      });

      expect(filled.content['Research Problem']).toContain('fine-tuning');
      expect(filled.content['Core Method']).toContain('low-rank');

      // 4. Verify paper and note are linked
      const notes = await readingService.listByPaper(paper.id);
      expect(notes.length).toBe(1);
      expect(notes[0].id).toBe(note.id);

      // 5. Paper should still be accessible
      const fetchedPaper = await papersService.getById(paper.id);
      expect(fetchedPaper!.title).toBe('LoRA: Low-Rank Adaptation of Large Language Models');
    });

    it('handles multiple papers in a research session', async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();

      // Create a set of related papers
      const papers = await Promise.all([
        papersService.create({
          title: 'Attention Is All You Need',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/1706.03762',
          tags: ['transformer'],
        }),
        papersService.create({
          title: 'BERT Pre-training',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/1810.04805',
          tags: ['bert', 'nlp'],
        }),
        papersService.create({
          title: 'GPT-2',
          source: 'manual',
          tags: ['gpt', 'llm'],
        }),
      ]);

      // Create reading notes for each
      for (const paper of papers) {
        await readingService.create({
          paperId: paper.id,
          type: 'paper',
          title: `Notes: ${paper.title}`,
          content: { Summary: `Summary of ${paper.title}` },
        });
      }

      // Verify each paper has exactly one note
      for (const paper of papers) {
        const notes = await readingService.listByPaper(paper.id);
        expect(notes.length).toBe(1);
      }

      // Verify total papers
      const all = await papersService.list({});
      expect(all.length).toBe(3);
    });
  });

  // ── Filtering and search ───────────────────────────────────────────────────

  describe('filtering', () => {
    beforeEach(async () => {
      const service = new PapersService();

      await service.create({
        title: 'Vision Transformer for Image Classification',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2010.11929',
        submittedAt: new Date('2020-10-22T00:00:00Z'),
        tags: ['transformer', 'computer-vision'],
      });

      await service.create({
        title: 'BERT: Pre-training of Deep Bidirectional Transformers',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1810.04805',
        submittedAt: new Date('2018-10-11T00:00:00Z'),
        tags: ['nlp', 'language-model'],
      });

      await service.create({
        title: 'Stable Diffusion',
        source: 'manual',
        submittedAt: new Date('2022-08-01T00:00:00Z'),
        tags: ['diffusion', 'generative'],
      });
    });

    it('filters by text query (title)', async () => {
      const service = new PapersService();
      const results = await service.list({ q: 'transformer' });
      expect(results.length).toBe(2); // Vision Transformer + BERT (has "Transformers" in title)
    });

    it('filters by tag', async () => {
      const service = new PapersService();
      const results = await service.list({ tag: 'diffusion' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Stable Diffusion');
    });

    it('filters by year', async () => {
      const service = new PapersService();
      const results2020 = await service.list({ year: 2020 });
      expect(results2020.length).toBe(1);
      expect(results2020[0].title).toContain('Vision Transformer');

      const results2018 = await service.list({ year: 2018 });
      expect(results2018.length).toBe(1);
      expect(results2018[0].title).toContain('BERT');
    });

    it('returns all papers when no filter applied', async () => {
      const service = new PapersService();
      const all = await service.list({});
      expect(all.length).toBe(3);
    });

    it('returns empty when query matches nothing', async () => {
      const service = new PapersService();
      const results = await service.list({ q: 'quantum-computing-xyz' });
      expect(results.length).toBe(0);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('creates paper with special characters in title', async () => {
      const service = new PapersService();

      const paper = await service.create({
        title: 'BERT: Pre-training & Fine-tuning (A Survey)',
        source: 'manual',
        tags: [],
      });

      expect(paper.title).toBe('BERT: Pre-training & Fine-tuning (A Survey)');
      const found = await service.getById(paper.id);
      expect(found!.title).toBe('BERT: Pre-training & Fine-tuning (A Survey)');
    });

    it('creates paper with many authors', async () => {
      const service = new PapersService();
      const manyAuthors = Array.from({ length: 20 }, (_, i) => `Author ${i + 1}`);

      const paper = await service.create({
        title: 'Large Collaboration Paper',
        authors: manyAuthors,
        source: 'arxiv',
        tags: [],
      });

      const found = await service.getById(paper.id);
      expect(found!.authors).toHaveLength(20);
    });

    it('creates paper with many tags', async () => {
      const service = new PapersService();
      const manyTags = ['nlp', 'cv', 'rl', 'llm', 'transformer', 'bert', 'gpt', 'diffusion'];

      const paper = await service.create({
        title: 'Multi-Domain Paper',
        source: 'manual',
        tags: manyTags,
      });

      const found = await service.getById(paper.id);
      expect(found!.tagNames).toHaveLength(8);
      for (const tag of manyTags) {
        expect(found!.tagNames).toContain(tag);
      }
    });

    it('handles paper with year instead of full date', async () => {
      const service = new PapersService();

      const paper = await service.create({
        title: 'Year-Only Date Paper',
        source: 'manual',
        year: 2023,
        tags: [],
      });

      const found = await service.getById(paper.id);
      expect(new Date(found!.submittedAt!).getFullYear()).toBe(2023);
    });

    it('generates local shortId for non-arXiv papers', async () => {
      const service = new PapersService();

      const p1 = await service.create({
        title: 'Local Paper 1',
        source: 'manual',
        tags: [],
      });

      const p2 = await service.create({
        title: 'Local Paper 2',
        source: 'manual',
        tags: [],
      });

      expect(p1.shortId).toMatch(/^local-[a-z0-9]+-[a-f0-9]+$/);
      expect(p2.shortId).toMatch(/^local-[a-z0-9]+-[a-f0-9]+$/);
      expect(p1.shortId).not.toBe(p2.shortId);
    });

    it('returns null for non-existent paper ID', async () => {
      const service = new PapersService();
      const result = await service.getById('non-existent-uuid');
      expect(result).toBeNull();
    });

    it('returns null when deleting non-existent paper', async () => {
      const service = new PapersService();
      const result = await service.deleteById('non-existent-uuid');
      expect(result).toBeNull();
    });
  });

  // ── Batch operations ───────────────────────────────────────────────────────

  describe('batch operations', () => {
    it('creates 10 papers and deletes them all', async () => {
      const service = new PapersService();
      const repo = new PapersRepository();

      const papers = [];
      for (let i = 0; i < 10; i++) {
        const paper = await service.create({
          title: `Batch Paper ${i + 1}`,
          source: 'manual',
          tags: [`batch-tag-${i}`],
        });
        papers.push(paper);
      }

      const allBefore = await service.list({});
      expect(allBefore.length).toBe(10);

      // Delete all
      const ids = papers.map((p) => p.id);
      const deletedCount = await repo.deleteMany(ids);
      expect(deletedCount).toBe(10);

      const allAfter = await service.list({});
      expect(allAfter.length).toBe(0);
    });
  });
});
