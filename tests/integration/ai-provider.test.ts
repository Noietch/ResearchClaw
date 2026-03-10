import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getLanguageModelFromConfig } from '../../src/main/services/ai-provider.service';
import type { ModelConfig } from '../../src/main/store/model-config-store';

// Test configuration from environment variables only
const TEST_API_KEY = process.env.TEST_API_KEY;
const TEST_BASE_URL = process.env.TEST_BASE_URL;
const TEST_LIGHTWEIGHT_MODEL = process.env.TEST_LIGHTWEIGHT_MODEL;
const TEST_CHAT_MODEL = process.env.TEST_CHAT_MODEL;

// Skip tests if no API key is configured
const maybeIt = TEST_API_KEY ? it : it.skip;

// Setup test model config store
const testStorageDir = path.join(os.tmpdir(), 'researchclaw-test-' + Date.now());

function setupTestStorage() {
  if (!TEST_API_KEY || !TEST_BASE_URL || !TEST_LIGHTWEIGHT_MODEL || !TEST_CHAT_MODEL) return;

  fs.mkdirSync(testStorageDir, { recursive: true });

  // Store API key as base64 (simulating non-encrypted storage for tests)
  const apiKeyEncrypted = Buffer.from(TEST_API_KEY).toString('base64');

  const testConfig = {
    models: [
      {
        id: 'test-lightweight',
        name: 'Test Lightweight',
        backend: 'api',
        provider: 'custom',
        model: TEST_LIGHTWEIGHT_MODEL,
        baseURL: TEST_BASE_URL,
        apiKeyEncrypted,
      },
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
      lightweight: 'test-lightweight',
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

describe('ai-provider service with model kind', () => {
  beforeAll(() => {
    // Set env var BEFORE any module that depends on it is imported
    process.env.RESEARCH_CLAW_STORAGE_DIR = testStorageDir;
    setupTestStorage();
  });

  afterAll(() => {
    cleanupTestStorage();
    delete process.env.RESEARCH_CLAW_STORAGE_DIR;
  });

  describe('getLanguageModelFromConfig', () => {
    maybeIt('creates language model from config', () => {
      const config: ModelConfig & { apiKey?: string } = {
        id: 'test',
        name: 'Test Model',
        backend: 'api',
        provider: 'custom',
        model: TEST_CHAT_MODEL!,
        baseURL: TEST_BASE_URL!,
        apiKey: TEST_API_KEY!,
      };

      const model = getLanguageModelFromConfig(config);
      expect(model).toBeDefined();
      expect(model.modelId).toBe(TEST_CHAT_MODEL);
    });
  });

  describe('generateWithModelKind (direct API test)', () => {
    // Test directly with the OpenAI SDK to verify the API key works
    maybeIt(
      'generates text with lightweight model via direct SDK call',
      { timeout: 60000 },
      async () => {
        const provider = createOpenAI({
          apiKey: TEST_API_KEY!,
          baseURL: TEST_BASE_URL!,
        });

        const model = provider(TEST_LIGHTWEIGHT_MODEL!);

        const result = await generateText({
          model,
          system: 'You are a helpful assistant that returns JSON.',
          prompt:
            'Return a JSON array with 3 tags for a paper about "transformer neural networks". Format: ["tag1", "tag2", "tag3"]',
          maxTokens: 1024,
        });

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(0);
        console.log('Direct SDK result:', result.text);
      },
    );

    maybeIt('generates text with chat model via direct SDK call', { timeout: 60000 }, async () => {
      const provider = createOpenAI({
        apiKey: TEST_API_KEY!,
        baseURL: TEST_BASE_URL!,
      });

      const model = provider(TEST_CHAT_MODEL!);

      const result = await generateText({
        model,
        system: 'You are a research paper summarizer.',
        prompt:
          'Summarize this paper concept in one sentence: "Attention Is All You Need - the transformer architecture."',
        maxTokens: 4096,
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(20);
      console.log('Direct SDK result:', result.text);
    });
  });
});
