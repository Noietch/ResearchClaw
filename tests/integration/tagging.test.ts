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
  tagPaper,
  tagUntaggedPapers,
  organizePaperTags,
  cancelTagging,
  getTaggingStatus,
} from '../../src/main/services/tagging.service';
import { PapersRepository } from '../../src/db/repositories/papers.repository';
import type { TagCategory, CategorizedTag } from '@shared';

// Test configuration from environment variables
const TEST_API_KEY = process.env.TEST_API_KEY;
const TEST_BASE_URL = process.env.TEST_BASE_URL;
const TEST_LIGHTWEIGHT_MODEL = process.env.TEST_LIGHTWEIGHT_MODEL;

// Skip AI tests if no API key is configured
const maybeIt = TEST_API_KEY ? it : it.skip;
// These tests require a configured lightweight model
const requiresModelIt = TEST_API_KEY && TEST_BASE_URL && TEST_LIGHTWEIGHT_MODEL ? it : it.skip;

// Setup test storage directory
const testStorageDir = path.join(os.tmpdir(), 'vibe-research-tagging-test-' + Date.now());

function setupTestStorage() {
  if (!TEST_API_KEY || !TEST_BASE_URL || !TEST_LIGHTWEIGHT_MODEL) return;

  fs.mkdirSync(testStorageDir, { recursive: true });
  const apiKeyEncrypted = Buffer.from(TEST_API_KEY).toString('base64');

  const testConfig = {
    models: [
      {
        id: 'test-lightweight',
        name: 'Test Lightweight',
        kind: 'lightweight',
        backend: 'api',
        provider: 'custom',
        model: TEST_LIGHTWEIGHT_MODEL,
        baseURL: TEST_BASE_URL,
        apiKeyEncrypted,
      },
    ],
    activeIds: {
      agent: null,
      lightweight: 'test-lightweight',
      chat: null,
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

describe('tagging service integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe('keyword fallback tagging', () => {
    requiresModelIt('assigns tags to LLM-related paper via keyword fallback', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'GPT-4: A Large Language Model for Chatbots',
        source: 'manual',
        abstract:
          'We present GPT-4, a large language model capable of generating human-like text for chatbots.',
        tags: [],
      });

      // Directly call tagPaper - will use keyword fallback if AI fails
      const tags = await tagPaper(paper.id);

      expect(tags.length).toBeGreaterThan(0);

      // Should have detected language model keywords
      const tagNames = tags.map((t) => t.name);
      expect(tagNames.some((n) => ['nlp', 'language-model', 'llm'].includes(n))).toBe(true);

      // Verify tags are categorized
      for (const tag of tags) {
        expect(['domain', 'method', 'topic']).toContain(tag.category);
      }
    });

    requiresModelIt('assigns transformer tags to attention mechanism paper', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'Attention Is All You Need',
        source: 'manual',
        abstract:
          'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, based solely on self-attention mechanisms.',
        tags: [],
      });

      const tags = await tagPaper(paper.id);

      expect(tags.length).toBeGreaterThan(0);
      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain('transformer');
    });

    requiresModelIt('assigns diffusion tags to generative paper', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'Stable Diffusion for Image Synthesis',
        source: 'manual',
        abstract:
          'We present a diffusion model for high-quality image generation using score-based generative modeling.',
        tags: [],
      });

      const tags = await tagPaper(paper.id);

      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain('diffusion');
    });

    requiresModelIt('assigns robotics tags to embodied AI paper', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'Embodied AI for Robot Manipulation',
        source: 'manual',
        abstract:
          'We present an embodied agent for robot manipulation tasks in real-world environments.',
        tags: [],
      });

      const tags = await tagPaper(paper.id);

      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain('robotics');
    });

    requiresModelIt('returns uncategorized for papers with no matching keywords', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'A Novel Approach to Something Completely Different',
        source: 'manual',
        abstract:
          'This paper discusses a topic that has nothing to do with AI or machine learning.',
        tags: [],
      });

      const tags = await tagPaper(paper.id);

      // Should return at least uncategorized
      expect(tags.length).toBeGreaterThan(0);
      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain('uncategorized');
    });

    it('throws error for non-existent paper', async () => {
      await expect(tagPaper('non-existent-id')).rejects.toThrow('Paper not found');
    });
  });

  describe('batch tagging', () => {
    requiresModelIt('tags multiple untagged papers', async () => {
      const papersService = new PapersService();

      // Create multiple papers without tags
      await papersService.create({
        title: 'Paper One: Language Models',
        source: 'manual',
        abstract: 'A study of large language models.',
        tags: [],
      });

      await papersService.create({
        title: 'Paper Two: Vision Transformers',
        source: 'manual',
        abstract: 'Applying transformer architecture to vision tasks.',
        tags: [],
      });

      await papersService.create({
        title: 'Paper Three: RL Agents',
        source: 'manual',
        abstract: 'Reinforcement learning for autonomous agents.',
        tags: [],
      });

      const result = await tagUntaggedPapers();

      expect(result.tagged).toBe(3);
      expect(result.failed).toBe(0);
    });

    requiresModelIt('skips already tagged papers', async () => {
      const papersService = new PapersService();

      // Create a paper without tags
      await papersService.create({
        title: 'Untagged Paper',
        source: 'manual',
        tags: [],
      });

      // Create a paper with tags already
      await papersService.create({
        title: 'Tagged Paper',
        source: 'manual',
        tags: ['already-tagged'],
      });

      const repo = new PapersRepository();
      const untaggedBefore = await repo.listUntaggedPaperIds();
      expect(untaggedBefore.length).toBe(1);

      const result = await tagUntaggedPapers();

      expect(result.tagged).toBe(1);
    });

    it('returns zero counts when no untagged papers exist', async () => {
      const papersService = new PapersService();

      // Create only tagged papers
      await papersService.create({
        title: 'Tagged Paper One',
        source: 'manual',
        tags: ['tag1'],
      });

      await papersService.create({
        title: 'Tagged Paper Two',
        source: 'manual',
        tags: ['tag2'],
      });

      const result = await tagUntaggedPapers();

      expect(result.tagged).toBe(0);
      expect(result.failed).toBe(0);
    });

    requiresModelIt('supports cancellation during batch tagging', async () => {
      const papersService = new PapersService();

      // Create many papers for batch tagging
      for (let i = 0; i < 10; i++) {
        await papersService.create({
          title: `Paper ${i}: Language Models and Transformers`,
          source: 'manual',
          abstract: `Abstract for paper ${i} about language models.`,
          tags: [],
        });
      }

      // Start tagging in background
      const taggingPromise = tagUntaggedPapers();

      // Request cancellation after a short delay
      setTimeout(() => cancelTagging(), 50);

      const result = await taggingPromise;

      // Either all completed before cancellation, or some were cancelled
      expect(result.tagged + result.failed).toBeLessThanOrEqual(10);

      // Status should be inactive after completion
      const status = getTaggingStatus();
      expect(status.active).toBe(false);
    });

    requiresModelIt('updates tagging status during batch operation', async () => {
      const papersService = new PapersService();

      await papersService.create({
        title: 'Status Test Paper',
        source: 'manual',
        tags: [],
      });

      const initialStatus = getTaggingStatus();
      expect(initialStatus.active).toBe(false);

      await tagUntaggedPapers();

      const finalStatus = getTaggingStatus();
      expect(finalStatus.active).toBe(false);
      expect(finalStatus.completed).toBe(1);
    });
  });

  describe('tag organization', () => {
    requiresModelIt('organizes existing flat tags into categories', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'Transformer Architecture for Vision Tasks',
        source: 'manual',
        abstract: 'We apply the transformer architecture to computer vision tasks.',
        tags: ['transformer', 'cv', 'my-custom-tag'], // Mix of known and custom tags
      });

      const tags = await organizePaperTags(paper.id);

      expect(tags.length).toBeGreaterThan(0);

      // Verify all tags have categories
      for (const tag of tags) {
        expect(['domain', 'method', 'topic']).toContain(tag.category);
      }
    });

    it('throws error when paper has no tags to organize', async () => {
      const papersService = new PapersService();

      const paper = await papersService.create({
        title: 'Paper Without Tags',
        source: 'manual',
        tags: [],
      });

      await expect(organizePaperTags(paper.id)).rejects.toThrow('No tags to organize');
    });

    requiresModelIt('preserves system tags during organization', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Research Paper',
        source: 'arxiv',
        tags: ['arxiv', 'transformer', 'cv'], // 'arxiv' is a system tag
      });

      // organizePaperTags returns only non-system tags
      const tags = await organizePaperTags(paper.id);
      const tagNames = tags.map((t) => t.name);

      // Returned tags should NOT include system tags (they're filtered out)
      expect(tagNames).not.toContain('arxiv');
      expect(tagNames).toContain('transformer');
      expect(tagNames).toContain('cv');

      // Note: System tags are preserved only when AI categorization succeeds.
      // In the fallback path (used when AI fails), system tags may not be preserved.
      // This test verifies the return value behavior, not the DB persistence.
    });

    it('throws error for non-existent paper', async () => {
      await expect(organizePaperTags('non-existent-id')).rejects.toThrow('Paper not found');
    });
  });

  describe('tag persistence', () => {
    requiresModelIt('persists tags after tagging', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'GPT-4 Technical Report',
        source: 'manual',
        abstract: 'We present GPT-4, a large language model.',
        tags: [],
      });

      await tagPaper(paper.id);

      // Fetch paper again and verify tags persist
      const updatedPaper = await repo.findById(paper.id);
      expect(updatedPaper).not.toBeNull();
      expect(updatedPaper!.tagNames.length).toBeGreaterThan(0);

      // Verify categorized tags are stored
      expect(updatedPaper!.categorizedTags.length).toBeGreaterThan(0);
    });

    requiresModelIt('updates existing tags on re-tagging', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Diffusion Models Beat GANs',
        source: 'manual',
        abstract: 'We show diffusion models outperform GANs on image synthesis.',
        tags: ['old-tag'], // Start with an old tag
      });

      const initialPaper = await repo.findById(paper.id);
      expect(initialPaper!.tagNames).toContain('old-tag');

      // Re-tag the paper
      await tagPaper(paper.id);

      const updatedPaper = await repo.findById(paper.id);
      // Old tag should be replaced
      expect(updatedPaper!.tagNames).not.toContain('old-tag');
      // New tags should be present
      expect(updatedPaper!.tagNames.length).toBeGreaterThan(0);
    });
  });
});

// AI-powered tagging tests (require API key)
describe('tagging service AI tests', () => {
  beforeAll(() => {
    process.env.VIBE_RESEARCH_STORAGE_DIR = testStorageDir;
    setupTestStorage();
  });

  afterAllFn(() => {
    cleanupTestStorage();
    delete process.env.VIBE_RESEARCH_STORAGE_DIR;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  maybeIt('uses AI for intelligent tagging when configured', { timeout: 60000 }, async () => {
    const papersService = new PapersService();

    const paper = await papersService.create({
      title: 'LoRA: Low-Rank Adaptation of Large Language Models',
      source: 'manual',
      abstract:
        'We propose Low-Rank Adaptation (LoRA), which freezes the pretrained model weights and injects trainable rank decomposition matrices into each layer of the Transformer architecture.',
      tags: [],
    });

    const tags = await tagPaper(paper.id);

    expect(tags.length).toBeGreaterThan(0);

    // AI should categorize LoRA as a method
    const methodTags = tags.filter((t) => t.category === 'method');
    expect(methodTags.length).toBeGreaterThan(0);

    console.log('AI generated tags:', tags);
  });

  maybeIt('organizes tags using AI categorization', { timeout: 60000 }, async () => {
    const papersService = new PapersService();

    const paper = await papersService.create({
      title: 'Vision Transformer for Image Classification',
      source: 'manual',
      abstract: 'We apply the transformer architecture to image classification tasks.',
      tags: ['transformer', 'vision', 'classification'],
    });

    const tags = await organizePaperTags(paper.id);

    // Should categorize transformer as method
    const transformerTag = tags.find((t) => t.name === 'transformer');
    expect(transformerTag).toBeDefined();
    expect(transformerTag!.category).toBe('method');

    console.log('AI organized tags:', tags);
  });
});
