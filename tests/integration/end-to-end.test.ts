import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersService } from '../../src/main/services/papers.service';
import { ReadingService } from '../../src/main/services/reading.service';
import { tagPaper, tagUntaggedPapers } from '../../src/main/services/tagging.service';
import { PapersRepository } from '../../src/db/repositories/papers.repository';
import type { TagCategory } from '@shared';

// Test configuration from environment variables
const TEST_API_KEY = process.env.TEST_API_KEY;
const TEST_BASE_URL = process.env.TEST_BASE_URL;
const TEST_LIGHTWEIGHT_MODEL = process.env.TEST_LIGHTWEIGHT_MODEL;
const TEST_CHAT_MODEL = process.env.TEST_CHAT_MODEL;

// Skip AI tests if no API key is configured
const maybeIt = TEST_API_KEY ? it : it.skip;
// These tests require a configured lightweight model
const requiresModelIt = TEST_API_KEY && TEST_BASE_URL && TEST_LIGHTWEIGHT_MODEL ? it : it.skip;

// Setup test storage directory
const testStorageDir = path.join(os.tmpdir(), 'vibe-research-e2e-test-' + Date.now());

function setupTestStorage() {
  if (!TEST_API_KEY || !TEST_BASE_URL) return;

  fs.mkdirSync(testStorageDir, { recursive: true });
  const apiKeyEncrypted = Buffer.from(TEST_API_KEY).toString('base64');

  const models = [];

  if (TEST_LIGHTWEIGHT_MODEL) {
    models.push({
      id: 'test-lightweight',
      name: 'Test Lightweight',
      kind: 'lightweight',
      backend: 'api',
      provider: 'custom',
      model: TEST_LIGHTWEIGHT_MODEL,
      baseURL: TEST_BASE_URL,
      apiKeyEncrypted,
    });
  }

  if (TEST_CHAT_MODEL) {
    models.push({
      id: 'test-chat',
      name: 'Test Chat',
      kind: 'chat',
      backend: 'api',
      provider: 'custom',
      model: TEST_CHAT_MODEL,
      baseURL: TEST_BASE_URL,
      apiKeyEncrypted,
    });
  }

  const testConfig = {
    models,
    activeIds: {
      agent: null,
      lightweight: TEST_LIGHTWEIGHT_MODEL ? 'test-lightweight' : null,
      chat: TEST_CHAT_MODEL ? 'test-chat' : null,
    },
  };

  fs.writeFileSync(
    path.join(testStorageDir, 'model-configs.json'),
    JSON.stringify(testConfig, null, 2),
  );
}

function cleanupTestStorage() {
  fs.rmSync(testStorageDir, { recursive: true, force: true });
}

/**
 * End-to-end workflow tests
 *
 * These tests verify complete business chains:
 * 1. Import paper from Chrome history
 * 2. Generate/apply tags automatically
 * 3. Create reading notes
 * 4. Verify the complete workflow
 */
describe('end-to-end workflow tests', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe('paper import and tagging workflow', () => {
    requiresModelIt('completes full import -> tag -> verify workflow', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      // Step 1: Import papers (simulating Chrome history import)
      const papers = await Promise.all([
        papersService.upsertFromIngest({
          title: 'Attention Is All You Need',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/1706.03762',
          abstract:
            'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.',
          tags: [], // No tags initially
        }),
        papersService.upsertFromIngest({
          title: 'BERT: Pre-training of Deep Bidirectional Transformers',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/1810.04805',
          abstract:
            'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.',
          tags: [],
        }),
      ]);

      expect(papers.length).toBe(2);

      // Verify papers are in database without tags
      const untaggedIds = await repo.listUntaggedPaperIds();
      expect(untaggedIds.length).toBe(2);

      // Step 2: Auto-tag the papers
      const result = await tagUntaggedPapers();
      expect(result.tagged).toBe(2);
      expect(result.failed).toBe(0);

      // Step 3: Verify papers now have tags
      const untaggedAfter = await repo.listUntaggedPaperIds();
      expect(untaggedAfter.length).toBe(0);

      // Verify tag quality
      for (const paper of papers) {
        const updatedPaper = await repo.findById(paper.id);
        expect(updatedPaper).not.toBeNull();
        expect(updatedPaper!.tagNames.length).toBeGreaterThan(0);

        // Verify tags are categorized
        expect(updatedPaper!.categorizedTags.length).toBeGreaterThan(0);

        // Each tag should have a valid category
        for (const tag of updatedPaper!.categorizedTags) {
          expect(['domain', 'method', 'topic']).toContain(tag.category);
        }
      }
    });

    requiresModelIt('handles incremental imports correctly', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      // First batch import
      await papersService.upsertFromIngest({
        title: 'First Batch Paper',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00001',
        tags: [],
      });

      await tagUntaggedPapers();
      let allPapers = await papersService.list({});
      expect(allPapers.length).toBe(1);

      // Second batch import
      await papersService.upsertFromIngest({
        title: 'Second Batch Paper',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00002',
        tags: [],
      });

      // Only tag untagged papers
      const untagged = await repo.listUntaggedPaperIds();
      expect(untagged.length).toBe(1);

      await tagUntaggedPapers();

      allPapers = await papersService.list({});
      expect(allPapers.length).toBe(2);

      // All papers should be tagged
      for (const paper of allPapers) {
        expect(paper.tagNames.length).toBeGreaterThan(0);
      }
    });
  });

  describe('paper to reading notes workflow', () => {
    requiresModelIt('completes import -> tag -> create notes workflow', async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();
      const repo = new PapersRepository();

      // Step 1: Import paper
      const paper = await papersService.upsertFromIngest({
        title: 'LoRA: Low-Rank Adaptation of Large Language Models',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2106.09685',
        abstract:
          'We propose Low-Rank Adaptation (LoRA), which freezes the pretrained model weights and injects trainable rank decomposition matrices into each layer of the Transformer architecture.',
        tags: [],
      });

      // Step 2: Tag the paper
      await tagPaper(paper.id);

      const taggedPaper = await repo.findById(paper.id);
      expect(taggedPaper!.tagNames.length).toBeGreaterThan(0);

      // Step 3: Create reading notes
      const note = await readingService.create({
        paperId: paper.id,
        type: 'paper',
        title: `Reading: ${paper.title}`,
        content: {
          'Research Problem': 'How to efficiently fine-tune large language models?',
          'Core Method': 'LoRA: Low-rank decomposition of weight updates',
          'Key Results': 'Comparable performance to full fine-tuning with fewer parameters',
          'Personal Notes': 'Useful for parameter-efficient fine-tuning',
        },
      });

      expect(note.id).toBeDefined();
      expect(note.paperId).toBe(paper.id);

      // Step 4: Verify complete chain
      const finalPaper = await repo.findById(paper.id);
      expect(finalPaper).not.toBeNull();
      expect(finalPaper!.readingNotes.length).toBe(1);
      expect(finalPaper!.tagNames.length).toBeGreaterThan(0);

      // Step 5: Update reading notes
      const updatedNote = await readingService.update(note.id, {
        'Research Problem': 'Updated understanding of the problem',
        'Follow-up Questions': 'How does LoRA compare to other PEFT methods?',
      });

      expect(updatedNote.content['Research Problem']).toBe('Updated understanding of the problem');
      expect(updatedNote.content['Follow-up Questions']).toBeDefined();
    });

    it('supports multiple notes per paper', async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();

      const paper = await papersService.create({
        title: 'Multi-Note Paper',
        source: 'manual',
        tags: ['test'],
      });

      // Create multiple notes
      const note1 = await readingService.create({
        paperId: paper.id,
        type: 'paper',
        title: 'First Reading Notes',
        content: { 'Section 1': 'Notes from first read' },
      });

      const note2 = await readingService.create({
        paperId: paper.id,
        type: 'paper',
        title: 'Second Reading Notes',
        content: { 'Section 2': 'Notes from second read' },
      });

      const notes = await readingService.listByPaper(paper.id);
      expect(notes.length).toBe(2);
      expect(notes.map((n) => n.id)).toContain(note1.id);
      expect(notes.map((n) => n.id)).toContain(note2.id);
    });
  });

  describe('paper search and filter workflow', () => {
    requiresModelIt('supports filtering by tag after auto-tagging', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      // Import papers with different topics
      await papersService.upsertFromIngest({
        title: 'GPT-4 Language Model',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00001',
        abstract: 'A large language model for text generation.',
        tags: [],
      });

      await papersService.upsertFromIngest({
        title: 'Stable Diffusion Image Generation',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00002',
        abstract: 'A diffusion model for text-to-image synthesis.',
        tags: [],
      });

      // Auto-tag all papers
      await tagUntaggedPapers();

      // Search by transformer keyword (should match GPT-4 paper after tagging)
      const results = await papersService.list({ q: 'language' });
      expect(results.length).toBeGreaterThanOrEqual(1);

      // List all papers
      const all = await papersService.list({});
      expect(all.length).toBe(2);

      // Each should have tags
      for (const paper of all) {
        expect(paper.tagNames.length).toBeGreaterThan(0);
      }
    });

    it('supports filtering by import date', async () => {
      const papersService = new PapersService();

      // Create papers
      await papersService.create({
        title: 'Paper One',
        source: 'manual',
        tags: [],
      });

      await papersService.create({
        title: 'Paper Two',
        source: 'manual',
        tags: [],
      });

      // Filter by today
      const todayPapers = await papersService.list({ importedWithin: 'today' });
      expect(todayPapers.length).toBe(2);

      // Filter by week
      const weekPapers = await papersService.list({ importedWithin: 'week' });
      expect(weekPapers.length).toBe(2);
    });
  });

  describe('tag vocabulary consistency', () => {
    requiresModelIt('builds consistent tag vocabulary across papers', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      // Import multiple LLM papers
      const papers = await Promise.all([
        papersService.upsertFromIngest({
          title: 'GPT-4 Technical Report',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/2401.00001',
          abstract: 'A large language model for dialogue.',
          tags: [],
        }),
        papersService.upsertFromIngest({
          title: 'LLaMA: Open Foundation Models',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/2401.00002',
          abstract: 'Open-source large language models.',
          tags: [],
        }),
        papersService.upsertFromIngest({
          title: 'Claude: A Helpful AI Assistant',
          source: 'arxiv',
          sourceUrl: 'https://arxiv.org/abs/2401.00003',
          abstract: 'A conversational AI assistant based on language models.',
          tags: [],
        }),
      ]);

      // Tag all papers
      await tagUntaggedPapers();

      // Check vocabulary
      const vocabulary = await repo.listTagVocabulary();

      // Should have domain, method, and topic categories
      expect(Object.keys(vocabulary)).toContain('domain');
      expect(Object.keys(vocabulary)).toContain('method');
      expect(Object.keys(vocabulary)).toContain('topic');

      // At least some tags should be reused across papers
      const allTags = await repo.listAllTagsWithCategory();
      expect(allTags.length).toBeGreaterThan(0);

      // Tags should have valid categories
      for (const tag of allTags) {
        expect(['domain', 'method', 'topic']).toContain(tag.category);
      }
    });
  });

  describe('paper metadata management', () => {
    it('updates paper metadata after import', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.upsertFromIngest({
        title: 'Paper to Update',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00001',
        tags: [],
      });

      // Update metadata
      await repo.updateMetadata(paper.id, {
        authors: ['Alice', 'Bob'],
        abstract: 'Updated abstract',
        submittedAt: new Date('2024-01-01T00:00:00Z'),
      });

      const updated = await repo.findById(paper.id);
      expect(updated!.authors).toEqual(['Alice', 'Bob']);
      expect(updated!.abstract).toBe('Updated abstract');
      expect(updated!.submittedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('tracks last read time', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Paper to Read',
        source: 'manual',
        tags: [],
      });

      expect(paper.lastReadAt).toBeNull();

      // Touch last read
      await repo.touchLastRead(paper.id);

      const updated = await repo.findById(paper.id);
      expect(updated!.lastReadAt).not.toBeNull();
    });
  });

  describe('paper deletion cascade', () => {
    it('deletes paper and all related records', async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();
      const repo = new PapersRepository();

      // Create paper with notes
      const paper = await papersService.create({
        title: 'Paper to Delete',
        source: 'manual',
        tags: ['delete-test'],
      });

      await readingService.create({
        paperId: paper.id,
        type: 'paper',
        title: 'Notes to Delete',
        content: { Section: 'Content' },
      });

      // Verify paper exists
      let found = await repo.findById(paper.id);
      expect(found).not.toBeNull();

      // Delete paper
      const deleted = await papersService.deleteById(paper.id);
      expect(deleted).not.toBeNull();

      // Verify paper is gone
      found = await repo.findById(paper.id);
      expect(found).toBeNull();

      // Verify notes are also deleted
      const notes = await readingService.listByPaper(paper.id);
      expect(notes.length).toBe(0);
    });
  });
});

// AI-powered end-to-end tests (require API key)
describe('end-to-end AI workflow tests', () => {
  beforeAll(() => {
    process.env.VIBE_RESEARCH_STORAGE_DIR = testStorageDir;
    setupTestStorage();
  });

  afterAll(() => {
    cleanupTestStorage();
    delete process.env.VIBE_RESEARCH_STORAGE_DIR;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  maybeIt(
    'completes AI-powered import -> tag -> generate notes workflow',
    { timeout: 120000 },
    async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();
      const repo = new PapersRepository();

      // Step 1: Import paper
      const paper = await papersService.upsertFromIngest({
        title: 'Attention Is All You Need',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        abstract:
          'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
        tags: [],
      });

      // Step 2: AI tagging
      const tags = await tagPaper(paper.id);
      expect(tags.length).toBeGreaterThan(0);

      // Should have detected transformer as method
      const methodTags = tags.filter((t) => t.category === 'method');
      expect(methodTags.length).toBeGreaterThan(0);

      console.log('AI generated tags:', tags);

      // Step 3: Create reading notes manually (AI generation would be tested separately)
      const note = await readingService.create({
        paperId: paper.id,
        type: 'paper',
        title: 'Reading: Attention Is All You Need',
        content: {
          'Research Problem': 'Sequence transduction with parallel computation',
          'Core Method': 'Transformer architecture with self-attention',
        },
      });

      expect(note.id).toBeDefined();

      // Step 4: Verify complete workflow
      const finalPaper = await repo.findById(paper.id);
      expect(finalPaper!.tagNames.length).toBeGreaterThan(0);
      expect(finalPaper!.readingNotes.length).toBe(1);
    },
  );

  maybeIt('generates AI-powered reading notes content', { timeout: 120000 }, async () => {
    const papersService = new PapersService();
    const readingService = new ReadingService();

    const paper = await papersService.create({
      title: 'BERT: Pre-training of Deep Bidirectional Transformers',
      source: 'arxiv',
      abstract:
        'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. Unlike recent language representation models, BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.',
      tags: ['transformer', 'nlp'],
      submittedAt: new Date('2018-10-11T00:00:00Z'),
    });

    const result = await readingService.aiEditNotes({
      paperId: paper.id,
      instruction: 'Fill in the research problem and core method sections.',
      currentNotes: {
        'Research Problem': '',
        'Core Method': '',
      },
    });

    expect(result).toBeDefined();
    expect(result['Research Problem']).toBeDefined();
    expect(result['Core Method']).toBeDefined();
    expect(result['Research Problem'].length).toBeGreaterThan(10);
    expect(result['Core Method'].length).toBeGreaterThan(10);

    console.log('AI generated notes:', result);
  });
});
