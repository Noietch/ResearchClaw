import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersService } from '../../src/main/services/papers.service';
import { ReadingService } from '../../src/main/services/reading.service';

// Test configuration from environment variables only
const TEST_API_KEY = process.env.TEST_API_KEY;
const TEST_BASE_URL = process.env.TEST_BASE_URL;
const TEST_CHAT_MODEL = process.env.TEST_CHAT_MODEL;

// Skip AI tests if no API key is configured
const maybeIt = TEST_API_KEY ? it : it.skip;

// Setup test model config store for AI chat tests
const testStorageDir = path.join(os.tmpdir(), 'vibe-research-reading-test-' + Date.now());

function setupTestStorage() {
  if (!TEST_API_KEY || !TEST_BASE_URL || !TEST_CHAT_MODEL) return;

  fs.mkdirSync(testStorageDir, { recursive: true });
  const apiKeyEncrypted = Buffer.from(TEST_API_KEY).toString('base64');

  const testConfig = {
    models: [
      {
        id: 'test-chat',
        name: 'Test Chat',
        backend: 'api',
        provider: 'custom',
        model: TEST_CHAT_MODEL,
        baseURL: TEST_BASE_URL,
        apiKeyEncrypted,
      },
    ],
    activeIds: {
      agent: null,
      lightweight: null,
      chat: 'test-chat',
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

describe('reading service integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('creates and retrieves a reading note', async () => {
    const papersService = new PapersService();
    const readingService = new ReadingService();

    const paper = await papersService.create({
      title: 'Test Paper',
      source: 'manual',
      tags: [],
    });

    const note = await readingService.create({
      paperId: paper.id,
      type: 'paper',
      title: 'Reading: Test Paper',
      content: {
        'Research Problem': 'What problem does this solve?',
        'Core Method': 'The proposed method',
      },
    });

    expect(note.id).toBeDefined();
    expect(note.content['Research Problem']).toBe('What problem does this solve?');

    const notes = await readingService.listByPaper(paper.id);
    expect(notes.length).toBe(1);
    expect(notes[0].id).toBe(note.id);
  });

  it('updates a reading note', async () => {
    const papersService = new PapersService();
    const readingService = new ReadingService();

    const paper = await papersService.create({
      title: 'Paper to Update',
      source: 'manual',
      tags: [],
    });

    const note = await readingService.create({
      paperId: paper.id,
      type: 'paper',
      title: 'Reading Note',
      content: { 'Research Problem': 'Initial content' },
    });

    const updated = await readingService.update(note.id, {
      'Research Problem': 'Updated content',
      'Core Method': 'New section',
    });

    expect(updated.content['Research Problem']).toBe('Updated content');
    expect(updated.content['Core Method']).toBe('New section');
  });
});

// AI Chat tests - require API key via environment variables
describe('reading service AI chat', () => {
  beforeAll(() => {
    process.env.VIBE_RESEARCH_STORAGE_DIR = testStorageDir;
    setupTestStorage();
  });

  afterAll(() => {
    cleanupTestStorage();
    delete process.env.VIBE_RESEARCH_STORAGE_DIR;
  });

  maybeIt(
    'aiEditNotes generates reading notes content via chat model',
    async () => {
      const papersService = new PapersService();
      const readingService = new ReadingService();

      const paper = await papersService.create({
        title: 'Attention Is All You Need',
        source: 'manual',
        tags: ['transformer', 'nlp'],
        abstract:
          'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.',
        submittedAt: new Date('2017-06-12T00:00:00Z'),
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
    },
    { timeout: 60000 },
  );
});
