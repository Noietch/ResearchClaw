import { afterEach, describe, expect, it, vi } from 'vitest';

const proxyFetch = vi.fn();
const getSemanticSearchSettings = vi.fn();
const getEffectiveEmbeddingDimensions = vi.fn(
  (settings: { embeddingDimensions?: number; embeddingModel: string }) => {
    if (settings.embeddingDimensions) return settings.embeddingDimensions;
    if (settings.embeddingModel === 'text-embedding-v4') return 1024;
    return undefined;
  },
);
const getProxyAgentForScope = vi.fn(() => undefined);

vi.mock('../../src/main/services/proxy-fetch', () => ({
  proxyFetch,
}));

vi.mock('../../src/main/store/app-settings-store', () => ({
  getSemanticSearchSettings,
  getEffectiveEmbeddingDimensions,
}));

vi.mock('../../src/main/utils/proxy-env', () => ({
  getProxyAgentForScope,
}));

describe('local semantic service', () => {
  afterEach(() => {
    proxyFetch.mockReset();
    getSemanticSearchSettings.mockReset();
    getEffectiveEmbeddingDimensions.mockClear();
    getProxyAgentForScope.mockReset();
    getProxyAgentForScope.mockReturnValue(undefined);
    vi.resetModules();
  });

  it('recreates the embedding provider when overrides change the config', async () => {
    getSemanticSearchSettings.mockReturnValue({
      enabled: true,
      autoProcess: true,
      autoEnrich: true,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingProvider: 'openai-compatible',
      embeddingApiBase: 'https://old.example/v1',
      recommendationExploration: 0.35,
    });

    proxyFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
    });

    const { localSemanticService } = await import('../../src/main/services/local-semantic.service');

    await localSemanticService.embedTexts(['first request']);
    await localSemanticService.embedTexts(['second request'], {
      embeddingProvider: 'openai-compatible',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 3072,
      embeddingApiBase: 'https://new.example/v1/',
      embeddingApiKey: 'sk-test',
    });

    expect(proxyFetch).toHaveBeenCalledTimes(2);

    const firstCall = proxyFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(firstCall[0]).toBe('https://old.example/v1/embeddings');
    expect((firstCall[1].headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(JSON.parse(firstCall[1].body as string)).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: 1536,
      input: ['first request'],
    });

    const secondCall = proxyFetch.mock.calls[1] as [string, Record<string, unknown>];
    expect(secondCall[0]).toBe('https://new.example/v1/embeddings');
    expect((secondCall[1].headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-test',
    );
    expect(JSON.parse(secondCall[1].body as string)).toMatchObject({
      model: 'text-embedding-3-large',
      dimensions: 3072,
      input: ['second request'],
    });
  });

  it('uses the default 1024 dimensions for text-embedding-v4 when unset', async () => {
    getSemanticSearchSettings.mockReturnValue({
      enabled: true,
      autoProcess: true,
      autoEnrich: true,
      embeddingModel: 'text-embedding-v4',
      embeddingProvider: 'openai-compatible',
      embeddingApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      recommendationExploration: 0.35,
    });

    proxyFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
    });

    const { localSemanticService } = await import('../../src/main/services/local-semantic.service');

    await localSemanticService.embedTexts(['dashscope request']);

    const firstCall = proxyFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.parse(firstCall[1].body as string)).toMatchObject({
      model: 'text-embedding-v4',
      dimensions: 1024,
      input: ['dashscope request'],
    });
  });
});
