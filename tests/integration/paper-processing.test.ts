import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

  it('processes multiple queued papers without waiting for the previous one', async () => {
    process.env.VIBE_PAPER_PROCESSING_CONCURRENCY = '2';

    const textGateA = createDeferred<string>();
    const textGateB = createDeferred<string>();
    const replaceChunks = vi.fn().mockResolvedValue(undefined);
    const updateProcessingState = vi.fn().mockResolvedValue(undefined);
    const updateMetadata = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn(async (paperId: string) => ({
          id: paperId,
          shortId: paperId,
          source: 'manual',
          pdfPath: '/tmp/mock.pdf',
          pdfUrl: null,
          sourceUrl: null,
          authors: [],
          abstract: null,
          submittedAt: null,
          metadataSource: null,
        }));
        updateProcessingState = updateProcessingState;
        updateMetadata = updateMetadata;
        replaceChunks = replaceChunks;
        listChunkIdsForPaper = vi.fn(async (paperId: string) => [`${paperId}-chunk-0`]);
        listPendingSemanticPaperIds = vi.fn().mockResolvedValue([]);
      }
      return { PapersRepository };
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
    vi.doMock('../../src/main/services/paper-text.service', () => ({
      getPaperText: vi.fn((paperId: string) =>
        paperId === 'paper-a' ? textGateA.promise : textGateB.promise,
      ),
    }));
    vi.doMock('../../src/main/services/paper-metadata.service', () => ({
      extractPaperMetadata: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('../../src/main/services/local-semantic.service', () => ({
      localSemanticService: {
        embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
      },
    }));
    vi.doMock('../../src/main/services/semantic-utils', () => ({
      sanitizeSemanticText: vi.fn((text: string) => text),
      splitTextIntoChunks: vi.fn((text: string) => [
        { chunkIndex: 0, content: text, contentPreview: text.slice(0, 20) },
      ]),
    }));
    vi.doMock('../../src/main/services/vec-index.service', () => ({
      isInitialized: vi.fn(() => false),
      syncChunksForPaper: vi.fn(),
    }));

    const { schedulePaperProcessing } =
      await import('../../src/main/services/paper-processing.service');

    schedulePaperProcessing('paper-a');
    schedulePaperProcessing('paper-b');

    await waitFor(() =>
      expect(updateProcessingState).toHaveBeenCalledWith('paper-a', expect.any(Object)),
    );
    await waitFor(() =>
      expect(updateProcessingState).toHaveBeenCalledWith('paper-b', expect.any(Object)),
    );

    textGateB.resolve('paper b text');

    await waitFor(() => expect(replaceChunks).toHaveBeenCalledWith('paper-b', expect.any(Array)));
    expect(replaceChunks).not.toHaveBeenCalledWith('paper-a', expect.any(Array));

    textGateA.resolve('paper a text');
    await waitFor(() => expect(replaceChunks).toHaveBeenCalledWith('paper-a', expect.any(Array)));
  });

  it('does not block embeddings on metadata extraction', async () => {
    const metadataGate = createDeferred<{
      title?: string;
      authors?: string[];
      abstract?: string;
      submittedAt?: Date;
    }>();
    const replaceChunks = vi.fn().mockResolvedValue(undefined);
    const updateMetadata = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn(async (paperId: string) => ({
          id: paperId,
          shortId: paperId,
          source: 'manual',
          pdfPath: '/tmp/mock.pdf',
          pdfUrl: null,
          sourceUrl: null,
          authors: [],
          abstract: null,
          submittedAt: null,
          metadataSource: null,
        }));
        updateProcessingState = vi.fn().mockResolvedValue(undefined);
        updateMetadata = updateMetadata;
        replaceChunks = replaceChunks;
        listChunkIdsForPaper = vi.fn(async (paperId: string) => [`${paperId}-chunk-0`]);
        listPendingSemanticPaperIds = vi.fn().mockResolvedValue([]);
      }
      return { PapersRepository };
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
    vi.doMock('../../src/main/services/paper-text.service', () => ({
      getPaperText: vi.fn().mockResolvedValue('paper text'),
    }));
    vi.doMock('../../src/main/services/paper-metadata.service', () => ({
      extractPaperMetadata: vi.fn(() => metadataGate.promise),
    }));
    vi.doMock('../../src/main/services/local-semantic.service', () => ({
      localSemanticService: {
        embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
      },
    }));
    vi.doMock('../../src/main/services/semantic-utils', () => ({
      sanitizeSemanticText: vi.fn((text: string) => text),
      splitTextIntoChunks: vi.fn((text: string) => [
        { chunkIndex: 0, content: text, contentPreview: text.slice(0, 20) },
      ]),
    }));
    vi.doMock('../../src/main/services/vec-index.service', () => ({
      isInitialized: vi.fn(() => false),
      syncChunksForPaper: vi.fn(),
    }));

    const { retryPaperProcessing } =
      await import('../../src/main/services/paper-processing.service');

    await retryPaperProcessing('paper-a');

    await waitFor(() => expect(replaceChunks).toHaveBeenCalledWith('paper-a', expect.any(Array)));
    expect(updateMetadata).not.toHaveBeenCalled();

    metadataGate.resolve({ title: 'Resolved later' });
    await waitFor(() =>
      expect(updateMetadata).toHaveBeenCalledWith(
        'paper-a',
        expect.objectContaining({ title: 'Resolved later' }),
      ),
    );
  });
});
