import { afterEach, describe, expect, it, vi } from 'vitest';

const getSemanticSearchSettings = vi.fn();
const setSemanticSearchSettings = vi.fn();
const setActiveEmbeddingConfigId = vi.fn();
const getEffectiveEmbeddingDimensions = vi.fn();
const switchProvider = vi.fn();
const clearIndexedAt = vi.fn().mockResolvedValue(undefined);
const vecClear = vi.fn();

vi.mock('../../src/main/store/app-settings-store', () => ({
  getProviders: vi.fn(() => []),
  saveProvider: vi.fn(),
  getActiveProviderId: vi.fn(() => 'default'),
  setActiveProvider: vi.fn(),
  getDecryptedApiKey: vi.fn(() => undefined),
  getAppSettings: vi.fn(() => ({})),
  setEditorCommand: vi.fn(),
  getEditorCommand: vi.fn(() => 'code'),
  getProxy: vi.fn(() => undefined),
  setProxy: vi.fn(),
  getProxyEnabled: vi.fn(() => false),
  setProxyEnabled: vi.fn(),
  getProxyScope: vi.fn(() => ({ pdfDownload: true, aiApi: true, cliTools: true })),
  setProxyScope: vi.fn(),
  getSemanticSearchSettings,
  setSemanticSearchSettings,
  getStorageRoot: vi.fn(() => '/tmp'),
  getEmbeddingConfigs: vi.fn(() => []),
  saveEmbeddingConfig: vi.fn(),
  deleteEmbeddingConfig: vi.fn(),
  getActiveEmbeddingConfigId: vi.fn(() => null),
  setActiveEmbeddingConfigId,
  getDevMode: vi.fn(() => false),
  setDevMode: vi.fn(),
  getLanguage: vi.fn(() => 'zh'),
  setLanguage: vi.fn(),
  hasLanguagePreference: vi.fn(() => true),
  getEffectiveEmbeddingDimensions,
}));

vi.mock('../../src/main/store/provider-store', () => ({
  getProviders: vi.fn(() => []),
  saveProvider: vi.fn(),
  getActiveProviderId: vi.fn(() => 'default'),
  setActiveProvider: vi.fn(),
  getDecryptedApiKey: vi.fn(() => undefined),
}));

vi.mock('../../src/main/store/storage-path', () => ({
  getStorageDir: vi.fn(() => '/tmp'),
  setStorageDir: vi.fn(),
  migrateStorageDir: vi.fn(() => ({ success: true })),
}));

vi.mock('../../src/main/services/proxy-test.service', () => ({
  testProxy: vi.fn(),
}));

vi.mock('../../src/main/services/local-semantic.service', () => ({
  localSemanticService: {
    switchProvider,
    embedTexts: vi.fn(),
  },
}));

vi.mock('../../src/main/services/ollama.service', () => ({
  listSemanticModelPullJobs: vi.fn(() => []),
  startSemanticModelPull: vi.fn(),
}));

vi.mock('../../src/main/services/ai-provider.service', () => ({
  getSelectedModelInfo: vi.fn(() => null),
}));

vi.mock('../../src/main/services/vec-index.service', () => ({
  clear: vecClear,
}));

vi.mock('../../src/main/utils/proxy-env', () => ({
  getProxyAgentForScope: vi.fn(() => undefined),
}));

vi.mock('../../src/db/repositories/papers.repository', () => ({
  PapersRepository: class PapersRepository {
    clearAllIndexedAt = clearIndexedAt;
  },
}));

describe('ProvidersService embedding dimensions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('resets embeddings when switching to the same model with a different dimension', async () => {
    getSemanticSearchSettings.mockReturnValue({
      enabled: true,
      autoProcess: true,
      autoEnrich: true,
      embeddingProvider: 'openai-compatible',
      embeddingModel: 'text-embedding-v4',
      embeddingDimensions: 1024,
      embeddingApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      recommendationExploration: 0.35,
    });
    getEffectiveEmbeddingDimensions.mockReturnValueOnce(1024).mockReturnValueOnce(1536);

    const { ProvidersService } = await import('../../src/main/services/providers.service');
    const service = new ProvidersService();

    await service.switchEmbeddingConfig({
      id: 'cfg-v4-1536',
      name: 'DashScope 1536',
      provider: 'openai-compatible',
      embeddingModel: 'text-embedding-v4',
      embeddingDimensions: 1536,
      embeddingApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });

    expect(setActiveEmbeddingConfigId).toHaveBeenCalledWith('cfg-v4-1536');
    expect(setSemanticSearchSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingModel: 'text-embedding-v4',
        embeddingDimensions: 1536,
      }),
    );
    expect(switchProvider).toHaveBeenCalledTimes(1);
    expect(vecClear).toHaveBeenCalledTimes(1);
    expect(clearIndexedAt).toHaveBeenCalledTimes(1);
  });
});
