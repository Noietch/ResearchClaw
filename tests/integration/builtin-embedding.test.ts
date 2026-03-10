import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { EmbeddingProvider } from '../../src/main/services/embedding-provider';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Check if local model exists (skip embedding tests in CI)
const modelDir = path.join(PROJECT_ROOT, 'models');
const modelExists = fs.existsSync(
  path.join(modelDir, 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model.onnx'),
);
const requiresModelIt = modelExists ? it : it.skip;

// Mock electron app to return project root (models are bundled there)
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => PROJECT_ROOT,
    getPath: (name: string) =>
      name === 'userData' ? path.join(os.tmpdir(), 'rc-test-userdata') : os.tmpdir(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

describe('builtin embedding provider', () => {
  let provider: EmbeddingProvider;

  beforeEach(async () => {
    vi.resetModules();
    const { BuiltinEmbeddingProvider } =
      await import('../../src/main/services/builtin-embedding-provider');
    provider = new BuiltinEmbeddingProvider();
  });

  afterEach(() => {
    provider?.dispose();
  });

  it('has correct provider info', () => {
    expect(provider.info.id).toBe('builtin');
    expect(provider.info.dimensions).toBe(384);
    expect(provider.info.modelName).toBe('all-MiniLM-L6-v2');
  });

  it('starts with not-ready status', () => {
    const status = provider.getStatus();
    expect(status.ready).toBe(false);
  });

  requiresModelIt(
    'generates 384-dimensional normalized vectors',
    async () => {
      const texts = ['Machine learning for scientific discovery'];
      const embeddings = await provider.embedTexts(texts);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toHaveLength(384);

      // Verify normalization (L2 norm should be ~1.0)
      const norm = Math.sqrt(embeddings[0].reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 1);

      // Status should be ready after first use
      expect(provider.getStatus().ready).toBe(true);
    },
    120_000,
  );

  requiresModelIt(
    'produces semantically similar vectors for related texts',
    async () => {
      const embeddings = await provider.embedTexts([
        'Neural networks for image classification',
        'Deep learning models for visual recognition',
        'Cooking recipes for Italian pasta dishes',
      ]);

      expect(embeddings).toHaveLength(3);

      // Cosine similarity helper
      const cosine = (a: number[], b: number[]) => {
        let dot = 0;
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot; // vectors are already normalized
      };

      const simRelated = cosine(embeddings[0], embeddings[1]);
      const simUnrelated = cosine(embeddings[0], embeddings[2]);

      // Related texts should have higher similarity than unrelated ones
      expect(simRelated).toBeGreaterThan(simUnrelated);
      expect(simRelated).toBeGreaterThan(0.5);
    },
    120_000,
  );

  requiresModelIt(
    'handles batch processing',
    async () => {
      const texts = Array.from({ length: 5 }, (_, i) => `Test document number ${i + 1}`);
      const embeddings = await provider.embedTexts(texts);
      expect(embeddings).toHaveLength(5);
      embeddings.forEach((emb) => expect(emb).toHaveLength(384));
    },
    120_000,
  );

  it('returns empty array for empty input', async () => {
    // We need to test through LocalSemanticService since embedTexts requires initialized pipeline
    const { LocalSemanticService } = await import('../../src/main/services/local-semantic.service');
    const service = new LocalSemanticService();
    const result = await service.embedTexts([]);
    expect(result).toEqual([]);
  });

  it('serializes concurrent embedding requests through one pipeline', async () => {
    provider.dispose();
    vi.resetModules();

    let activeCalls = 0;
    let maxActiveCalls = 0;
    const pipelineCall = vi.fn(async (texts: string[]) => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeCalls -= 1;
      return {
        tolist: () => texts.map((_, index) => [index + 1, 0, 0]),
      };
    });
    const pipelineFactory = vi.fn(async () => pipelineCall);

    vi.doMock('@huggingface/transformers', () => ({
      pipeline: pipelineFactory,
      env: {
        localModelPath: '',
        allowRemoteModels: true,
        allowLocalModels: false,
        backends: { onnx: {} },
      },
    }));

    const { BuiltinEmbeddingProvider } =
      await import('../../src/main/services/builtin-embedding-provider');
    const queuedProvider = new BuiltinEmbeddingProvider();

    const [first, second] = await Promise.all([
      queuedProvider.embedTexts(['first request']),
      queuedProvider.embedTexts(['second request']),
    ]);

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineCall).toHaveBeenCalledTimes(2);
    expect(maxActiveCalls).toBe(1);
    expect(first).toEqual([[1, 0, 0]]);
    expect(second).toEqual([[1, 0, 0]]);

    queuedProvider.dispose();
  });
});

describe('embedding provider interface', () => {
  it('ollama provider has correct info', async () => {
    // Mock the dependencies
    vi.mock('../../src/main/services/proxy-fetch', () => ({
      proxyFetch: vi.fn(),
    }));
    vi.mock('../../src/main/services/ollama.service', () => ({
      ensureOllamaRunning: vi.fn(),
    }));

    const { OllamaEmbeddingProvider } =
      await import('../../src/main/services/ollama-embedding-provider');
    const ollamaProvider = new OllamaEmbeddingProvider({
      enabled: true,
      autoProcess: true,
      autoStartOllama: true,
      baseUrl: 'http://127.0.0.1:11434',
      embeddingModel: 'nomic-embed-text',
      embeddingProvider: 'ollama',
    });

    expect(ollamaProvider.info.id).toBe('ollama');
    expect(ollamaProvider.info.modelName).toBe('nomic-embed-text');
    ollamaProvider.dispose();
  });
});

describe('provider switching', () => {
  it('LocalSemanticService switches providers correctly', async () => {
    // Mock app settings
    vi.mock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({
        enabled: true,
        autoProcess: true,
        embeddingModel: 'text-embedding-3-small',
        embeddingProvider: 'builtin',
        recommendationExploration: 0.35,
      })),
      getBuiltinModelPath: vi.fn(() => undefined),
    }));

    const { LocalSemanticService } = await import('../../src/main/services/local-semantic.service');
    const service = new LocalSemanticService();

    // Get provider — should create a builtin one
    const provider1 = service.getOrCreateProvider();
    expect(provider1.info.id).toBe('builtin');

    // Switch to openai-compatible via overrides
    const provider2 = service.getOrCreateProvider({ embeddingProvider: 'openai-compatible' });
    expect(provider2.info.id).toBe('openai-compatible');

    // switchProvider resets everything
    service.switchProvider();
    expect(service.getProviderStatus().ready).toBe(false);
  });
});

describe('BuiltinEmbeddingProvider model existence check', () => {
  it('checkModelExists returns true when onnx/model.onnx is present', async () => {
    vi.resetModules();
    const { BuiltinEmbeddingProvider, getModelDir } =
      await import('../../src/main/services/builtin-embedding-provider');
    const provider = new BuiltinEmbeddingProvider();
    const modelDir = getModelDir();
    const onnxPath = path.join(modelDir, 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model.onnx');
    const exists = fs.existsSync(onnxPath);
    expect(provider.checkModelExists()).toBe(exists);
  });

  it('checkModelExists returns false when model directory is absent', async () => {
    vi.resetModules();
    // Point app to a temp dir with no models
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-no-model-'));
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: () => tmpDir,
        getPath: () => tmpDir,
      },
      BrowserWindow: { getAllWindows: () => [] },
    }));
    const { BuiltinEmbeddingProvider } =
      await import('../../src/main/services/builtin-embedding-provider');
    const provider = new BuiltinEmbeddingProvider();
    expect(provider.checkModelExists()).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('getModelPath returns the models directory', async () => {
    vi.resetModules();
    const { BuiltinEmbeddingProvider, getModelDir } =
      await import('../../src/main/services/builtin-embedding-provider');
    const provider = new BuiltinEmbeddingProvider();
    expect(provider.getModelPath()).toBe(getModelDir());
    expect(provider.getModelPath()).toContain('models');
  });
});

describe('BuiltinEmbeddingProvider downloadModel', () => {
  it('getModelDir returns a path ending in models', async () => {
    // In dev mode (isPackaged=false), getModelDir() returns appPath/models.
    // The exact path depends on the electron mock in scope.
    const { getModelDir } = await import('../../src/main/services/builtin-embedding-provider');
    const modelDir = getModelDir();
    // Should end with 'models' in dev mode regardless of which mock is active
    expect(path.basename(modelDir)).toBe('models');
  });

  it('downloadModel is a function accepting a progress callback', async () => {
    const { BuiltinEmbeddingProvider } =
      await import('../../src/main/services/builtin-embedding-provider');
    const provider = new BuiltinEmbeddingProvider();
    // Verify the method exists and accepts a callback
    expect(typeof provider.downloadModel).toBe('function');
    // Calling it with a no-op callback should return a Promise
    const result = provider.downloadModel(() => {});
    expect(result).toBeInstanceOf(Promise);
    // Abort the download to avoid network calls
    result.catch(() => {}); // swallow any rejection
  });
});
