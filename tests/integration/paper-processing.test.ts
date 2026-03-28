import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function waitFor(check: () => void, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  check();
}

describe('paper processing concurrency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.VITEST;
    delete process.env.VIBE_PAPER_PROCESSING_CONCURRENCY;
  });

  afterEach(() => {
    delete process.env.VITEST;
    delete process.env.VIBE_PAPER_PROCESSING_CONCURRENCY;
  });

  it('processes paper with title and abstract successfully', async () => {
    const updateProcessingState = vi.fn().mockResolvedValue(undefined);
    const generateEmbeddings = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn(async (paperId: string) => ({
          id: paperId,
          shortId: 'local-123',
          title: 'Test Paper Title',
          source: 'manual',
          pdfPath: null,
          pdfUrl: null,
          sourceUrl: null,
          authors: [],
          abstract: 'This is a test abstract.',
          submittedAt: null,
          metadataSource: null,
        }));
        updateProcessingState = updateProcessingState;
        updateMetadata = vi.fn().mockResolvedValue(undefined);
        listPendingSemanticPaperIds = vi.fn().mockResolvedValue([]);
      }
      class PaperEmbeddingRepository {}
      return { PapersRepository, PaperEmbeddingRepository };
    });
    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({
        enabled: true,
        autoProcess: true,
        autoStartOllama: true,
        baseUrl: 'http://127.0.0.1:11434',
        embeddingModel: 'all-MiniLM-L6-v2',
        embeddingProvider: 'builtin',
      })),
    }));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      generateEmbeddings,
    }));

    const { retryPaperProcessing } =
      await import('../../src/main/services/paper-processing.service');

    await retryPaperProcessing('paper-a');

    expect(generateEmbeddings).toHaveBeenCalledWith('paper-a');
    await waitFor(() =>
      expect(updateProcessingState).toHaveBeenCalledWith(
        'paper-a',
        expect.objectContaining({
          processingStatus: 'completed',
        }),
      ),
    );
  });

  it('processes paper with title only (no abstract)', async () => {
    const updateProcessingState = vi.fn().mockResolvedValue(undefined);
    const generateEmbeddings = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn(async (paperId: string) => ({
          id: paperId,
          shortId: 'local-456',
          title: 'Paper Without Abstract',
          source: 'manual',
          pdfPath: null,
          pdfUrl: null,
          sourceUrl: null,
          authors: [],
          abstract: null,
          submittedAt: null,
          metadataSource: null,
        }));
        updateProcessingState = updateProcessingState;
        updateMetadata = vi.fn().mockResolvedValue(undefined);
        listPendingSemanticPaperIds = vi.fn().mockResolvedValue([]);
      }
      class PaperEmbeddingRepository {}
      return { PapersRepository, PaperEmbeddingRepository };
    });
    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({
        enabled: true,
        autoProcess: true,
        autoStartOllama: true,
        baseUrl: 'http://127.0.0.1:11434',
        embeddingModel: 'all-MiniLM-L6-v2',
        embeddingProvider: 'builtin',
      })),
    }));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      generateEmbeddings,
    }));

    const { retryPaperProcessing } =
      await import('../../src/main/services/paper-processing.service');

    await retryPaperProcessing('paper-b');

    // Should still generate embeddings (title only)
    expect(generateEmbeddings).toHaveBeenCalledWith('paper-b');
    await waitFor(() =>
      expect(updateProcessingState).toHaveBeenCalledWith(
        'paper-b',
        expect.objectContaining({
          processingStatus: 'completed',
        }),
      ),
    );
  });

  it('marks paper as failed when generateEmbeddings throws', async () => {
    const updateProcessingState = vi.fn().mockResolvedValue(undefined);
    const generateEmbeddings = vi
      .fn()
      .mockRejectedValue(new Error('Embedding service unavailable'));

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn(async (paperId: string) => ({
          id: paperId,
          shortId: paperId,
          title: 'Test Paper',
          source: 'manual',
          pdfPath: '/tmp/mock.pdf',
          pdfUrl: null,
          sourceUrl: null,
          authors: [],
          abstract: 'This paper studies transformer alignment.',
          submittedAt: null,
          metadataSource: null,
        }));
        updateProcessingState = updateProcessingState;
        updateMetadata = vi.fn().mockResolvedValue(undefined);
        listPendingSemanticPaperIds = vi.fn().mockResolvedValue([]);
      }
      class PaperEmbeddingRepository {}
      return { PapersRepository, PaperEmbeddingRepository };
    });
    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({
        enabled: true,
        autoProcess: true,
        autoStartOllama: true,
        baseUrl: 'http://127.0.0.1:11434',
        embeddingModel: 'all-MiniLM-L6-v2',
        embeddingProvider: 'builtin',
      })),
    }));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      generateEmbeddings,
    }));

    const { retryPaperProcessing } =
      await import('../../src/main/services/paper-processing.service');

    await retryPaperProcessing('paper-c');

    expect(generateEmbeddings).toHaveBeenCalledWith('paper-c');
    await waitFor(() =>
      expect(updateProcessingState).toHaveBeenCalledWith(
        'paper-c',
        expect.objectContaining({
          processingStatus: 'failed',
          processingError: 'Embedding service unavailable',
        }),
      ),
    );
  });

  it('returns queued: false when called', async () => {
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn(async () => ({
          id: 'test',
          shortId: 'test',
          title: 'Test',
          source: 'manual',
          abstract: 'Abstract',
          authors: [],
        }));
        updateProcessingState = vi.fn().mockResolvedValue(undefined);
      }
      class PaperEmbeddingRepository {}
      return { PapersRepository, PaperEmbeddingRepository };
    });
    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({ enabled: true })),
    }));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      generateEmbeddings: vi.fn().mockResolvedValue(undefined),
    }));

    const { retryPaperProcessing } =
      await import('../../src/main/services/paper-processing.service');

    const result = await retryPaperProcessing('test');
    expect(result).toEqual({ queued: false });
  });

  it('treats matching model names with different dimensions as rebuild-required', async () => {
    const clearAllIndexedAt = vi.fn().mockResolvedValue(undefined);
    const listPendingSemanticPaperIds = vi.fn().mockResolvedValue([]);
    const clearAndReinitialize = vi.fn();

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        clearAllIndexedAt = clearAllIndexedAt;
        listPendingSemanticPaperIds = listPendingSemanticPaperIds;
      }
      class PaperEmbeddingRepository {}
      return { PapersRepository, PaperEmbeddingRepository };
    });
    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({
        enabled: true,
        autoProcess: true,
        autoEnrich: true,
        embeddingModel: 'text-embedding-v4',
        embeddingDimensions: 1536,
        embeddingProvider: 'openai-compatible',
        recommendationExploration: 0.35,
      })),
      getEffectiveEmbeddingDimensions: vi.fn(() => 1536),
    }));
    vi.doMock('../../src/main/services/vec-index.service', () => ({
      getStatus: vi.fn(() => ({
        initialized: true,
        count: 2,
        dimension: 1024,
        model: 'text-embedding-v4',
      })),
      clearAndReinitialize,
      clear: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn(),
      save: vi.fn(),
    }));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      generateEmbeddings: vi.fn().mockResolvedValue(undefined),
    }));

    const { rebuildAllEmbeddings } =
      await import('../../src/main/services/paper-processing.service');

    const result = await rebuildAllEmbeddings();

    expect(result).toEqual({
      queued: 0,
      dimensionMatch: false,
      currentDimension: 1024,
      newDimension: 1536,
    });
    expect(clearAllIndexedAt).toHaveBeenCalledTimes(1);
    expect(listPendingSemanticPaperIds).toHaveBeenCalledTimes(1);
    expect(clearAndReinitialize).toHaveBeenCalledWith('text-embedding-v4', 1536);
  });
});
