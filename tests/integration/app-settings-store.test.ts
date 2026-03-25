import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

function makeStorageDir() {
  return path.join(os.tmpdir(), `researchclaw-settings-test-${Date.now()}-${Math.random()}`);
}

describe('app settings store embedding config sync', () => {
  afterEach(() => {
    if (
      process.env.RESEARCH_CLAW_STORAGE_DIR &&
      fs.existsSync(process.env.RESEARCH_CLAW_STORAGE_DIR)
    ) {
      fs.rmSync(process.env.RESEARCH_CLAW_STORAGE_DIR, { recursive: true, force: true });
    }
    delete process.env.RESEARCH_CLAW_STORAGE_DIR;
    vi.resetModules();
  });

  it('returns semantic embedding settings from the active embedding config', async () => {
    const storageDir = makeStorageDir();
    fs.mkdirSync(storageDir, { recursive: true });
    process.env.RESEARCH_CLAW_STORAGE_DIR = storageDir;

    fs.writeFileSync(
      path.join(storageDir, 'app-settings.json'),
      JSON.stringify(
        {
          editorCommand: 'code',
          semanticSearch: {
            enabled: true,
            autoProcess: true,
            autoEnrich: true,
            embeddingModel: 'text-embedding-3-small',
            embeddingProvider: 'openai-compatible',
            recommendationExploration: 0.35,
          },
          embeddingConfigs: [
            {
              id: 'cfg-active',
              name: 'Active Config',
              provider: 'openai-compatible',
              embeddingModel: 'text-embedding-3-large',
              embeddingDimensions: 1536,
              embeddingApiBase: 'https://embeddings.example.com/v1',
              embeddingApiKey: 'sk-active',
            },
          ],
          activeEmbeddingConfigId: 'cfg-active',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const { getSemanticSearchSettings } = await import('../../src/main/store/app-settings-store');
    const settings = getSemanticSearchSettings();

    expect(settings.embeddingModel).toBe('text-embedding-3-large');
    expect(settings.embeddingDimensions).toBe(1536);
    expect(settings.embeddingApiBase).toBe('https://embeddings.example.com/v1');
    expect(settings.embeddingApiKey).toBe('sk-active');
  });

  it('auto-activates the first saved embedding config when it is the only config', async () => {
    const storageDir = makeStorageDir();
    process.env.RESEARCH_CLAW_STORAGE_DIR = storageDir;

    const { getActiveEmbeddingConfigId, getSemanticSearchSettings, saveEmbeddingConfig } =
      await import('../../src/main/store/app-settings-store');

    saveEmbeddingConfig({
      id: 'cfg-first',
      name: 'First Config',
      provider: 'openai-compatible',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingApiBase: 'https://first.example.com/v1',
      embeddingApiKey: 'sk-first',
    });

    expect(getActiveEmbeddingConfigId()).toBe('cfg-first');

    const settings = getSemanticSearchSettings();
    expect(settings.embeddingDimensions).toBe(1536);
    expect(settings.embeddingApiBase).toBe('https://first.example.com/v1');
    expect(settings.embeddingApiKey).toBe('sk-first');
  });

  it('falls back to model defaults when embedding dimensions are not persisted', async () => {
    const storageDir = makeStorageDir();
    fs.mkdirSync(storageDir, { recursive: true });
    process.env.RESEARCH_CLAW_STORAGE_DIR = storageDir;

    fs.writeFileSync(
      path.join(storageDir, 'app-settings.json'),
      JSON.stringify(
        {
          editorCommand: 'code',
          semanticSearch: {
            enabled: true,
            autoProcess: true,
            autoEnrich: true,
            embeddingModel: 'text-embedding-v4',
            embeddingProvider: 'openai-compatible',
            recommendationExploration: 0.35,
          },
          embeddingConfigs: [
            {
              id: 'cfg-v4',
              name: 'DashScope',
              provider: 'openai-compatible',
              embeddingModel: 'text-embedding-v4',
              embeddingApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
          ],
          activeEmbeddingConfigId: 'cfg-v4',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const { getSemanticSearchSettings, getEffectiveEmbeddingDimensions } =
      await import('../../src/main/store/app-settings-store');
    const settings = getSemanticSearchSettings();

    expect(settings.embeddingDimensions).toBeUndefined();
    expect(getEffectiveEmbeddingDimensions(settings)).toBe(1024);
  });
});
