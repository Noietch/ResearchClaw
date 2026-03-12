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

describe('auto paper enrichment service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VIBE_ENABLE_AUTO_ENRICH_IN_TESTS = '1';
  });

  afterEach(() => {
    delete process.env.VIBE_ENABLE_AUTO_ENRICH_IN_TESTS;
  });

  it('deduplicates queued enrich jobs and runs analyze + tag once', async () => {
    const analyzePaper = vi.fn().mockResolvedValue({ noteId: 'note-1', content: {} });
    const tagPaper = vi.fn().mockResolvedValue([{ name: 'llm', category: 'topic' }]);

    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({ autoEnrich: true })),
    }));

    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn().mockResolvedValue({
          id: 'paper-1',
          title: 'Paper 1',
          pdfUrl: 'https://example.com/paper.pdf',
          pdfPath: null,
          tagNames: [],
        });
      }

      class ReadingRepository {
        listByPaper = vi.fn().mockResolvedValue([]);
      }

      return { PapersRepository, ReadingRepository };
    });

    vi.doMock('../../src/main/services/reading.service', () => ({
      ReadingService: class {
        analyzePaper = analyzePaper;
      },
    }));

    vi.doMock('../../src/main/services/tagging.service', () => ({
      tagPaper,
    }));

    const { scheduleAutoPaperEnrichment } =
      await import('../../src/main/services/auto-paper-enrichment.service');

    scheduleAutoPaperEnrichment('paper-1');
    scheduleAutoPaperEnrichment('paper-1');

    await waitFor(() => expect(analyzePaper).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(tagPaper).toHaveBeenCalledTimes(1));
    expect(tagPaper).toHaveBeenCalledWith('paper-1', { managedStatus: false });
  });

  it('skips analyze and tag when paper is already enriched', async () => {
    const analyzePaper = vi.fn().mockResolvedValue({ noteId: 'note-1', content: {} });
    const tagPaper = vi.fn().mockResolvedValue([]);

    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({ autoEnrich: true })),
    }));

    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn().mockResolvedValue({
          id: 'paper-2',
          title: 'Paper 2',
          pdfUrl: null,
          pdfPath: null,
          tagNames: ['existing-tag'],
        });
      }

      class ReadingRepository {
        listByPaper = vi.fn().mockResolvedValue([{ id: 'note-1', title: 'Analysis: Paper 2' }]);
      }

      return { PapersRepository, ReadingRepository };
    });

    vi.doMock('../../src/main/services/reading.service', () => ({
      ReadingService: class {
        analyzePaper = analyzePaper;
      },
    }));

    vi.doMock('../../src/main/services/tagging.service', () => ({
      tagPaper,
    }));

    const { scheduleAutoPaperEnrichment } =
      await import('../../src/main/services/auto-paper-enrichment.service');

    scheduleAutoPaperEnrichment('paper-2');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(analyzePaper).not.toHaveBeenCalled();
    expect(tagPaper).not.toHaveBeenCalled();
  });

  it('does not enqueue work when auto enrich is disabled', async () => {
    const analyzePaper = vi.fn().mockResolvedValue({ noteId: 'note-1', content: {} });
    const tagPaper = vi.fn().mockResolvedValue([]);

    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getSemanticSearchSettings: vi.fn(() => ({ autoEnrich: false })),
    }));

    vi.doMock('@db', () => {
      class PapersRepository {
        findById = vi.fn().mockResolvedValue({
          id: 'paper-3',
          title: 'Paper 3',
          pdfUrl: 'https://example.com/paper.pdf',
          pdfPath: null,
          tagNames: [],
        });
      }

      class ReadingRepository {
        listByPaper = vi.fn().mockResolvedValue([]);
      }

      return { PapersRepository, ReadingRepository };
    });

    vi.doMock('../../src/main/services/reading.service', () => ({
      ReadingService: class {
        analyzePaper = analyzePaper;
      },
    }));

    vi.doMock('../../src/main/services/tagging.service', () => ({
      tagPaper,
    }));

    const { scheduleAutoPaperEnrichment } =
      await import('../../src/main/services/auto-paper-enrichment.service');

    scheduleAutoPaperEnrichment('paper-3');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(analyzePaper).not.toHaveBeenCalled();
    expect(tagPaper).not.toHaveBeenCalled();
  });
});

describe('papers service auto enrichment hooks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VIBE_ENABLE_AUTO_ENRICH_IN_TESTS = '1';
  });

  afterEach(() => {
    delete process.env.VIBE_ENABLE_AUTO_ENRICH_IN_TESTS;
  });

  it('schedules auto enrichment when creating a paper', async () => {
    const createPaper = vi.fn().mockResolvedValue({ id: 'paper-3', shortId: '1234.5678' });
    const createEvent = vi.fn().mockResolvedValue(undefined);
    const schedulePaperProcessing = vi.fn();
    const scheduleCitationExtraction = vi.fn();
    const scheduleAutoPaperEnrichment = vi.fn();

    vi.doMock('fs/promises', () => ({
      default: {
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    }));

    vi.doMock('@db', () => {
      class PapersRepository {
        countByShortIdPrefix = vi.fn().mockResolvedValue(0);
        create = createPaper;
        updatePdfPath = vi.fn().mockResolvedValue(undefined);
      }

      class SourceEventsRepository {
        create = createEvent;
      }

      return { PapersRepository, SourceEventsRepository };
    });

    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getPapersDir: vi.fn(() => '/tmp/papers'),
    }));

    vi.doMock('../../src/main/services/paper-processing.service', () => ({
      schedulePaperProcessing,
    }));
    vi.doMock('../../src/main/services/citation-processing.service', () => ({
      scheduleCitationExtraction,
    }));
    vi.doMock('../../src/main/services/auto-paper-enrichment.service', () => ({
      scheduleAutoPaperEnrichment,
    }));
    vi.doMock('../../src/main/services/vec-index.service', () => ({}));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      deleteEmbeddings: vi.fn().mockResolvedValue(undefined),
      generateEmbeddings: vi.fn().mockResolvedValue(undefined),
    }));

    const { PapersService } = await import('../../src/main/services/papers.service');
    const service = new PapersService();

    await service.create({
      title: 'Test Paper',
      source: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/1234.5678',
      pdfUrl: 'https://arxiv.org/pdf/1234.5678.pdf',
    });

    expect(schedulePaperProcessing).toHaveBeenCalledWith('paper-3');
    expect(scheduleCitationExtraction).toHaveBeenCalledWith('paper-3');
    expect(scheduleAutoPaperEnrichment).toHaveBeenCalledWith('paper-3');
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('schedules auto enrichment when importing a local pdf', async () => {
    const createPaper = vi.fn().mockResolvedValue({ id: 'paper-4', shortId: 'local-001' });
    const createEvent = vi.fn().mockResolvedValue(undefined);
    const schedulePaperProcessing = vi.fn();
    const scheduleCitationExtraction = vi.fn();
    const scheduleAutoPaperEnrichment = vi.fn();

    vi.doMock('fs/promises', () => ({
      default: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        stat: vi.fn().mockResolvedValue({ isFile: () => true }),
        copyFile: vi.fn().mockResolvedValue(undefined),
      },
    }));

    vi.doMock('@db', () => {
      class PapersRepository {
        countByShortIdPrefix = vi.fn().mockResolvedValue(0);
        create = createPaper;
      }

      class SourceEventsRepository {
        create = createEvent;
      }

      return { PapersRepository, SourceEventsRepository };
    });

    vi.doMock('../../src/main/store/app-settings-store', () => ({
      getPapersDir: vi.fn(() => '/tmp/papers'),
    }));

    vi.doMock('../../src/main/services/paper-processing.service', () => ({
      schedulePaperProcessing,
    }));
    vi.doMock('../../src/main/services/citation-processing.service', () => ({
      scheduleCitationExtraction,
    }));
    vi.doMock('../../src/main/services/auto-paper-enrichment.service', () => ({
      scheduleAutoPaperEnrichment,
    }));
    vi.doMock('../../src/main/services/vec-index.service', () => ({}));
    vi.doMock('../../src/main/services/paper-embedding.service', () => ({
      deleteEmbeddings: vi.fn().mockResolvedValue(undefined),
      generateEmbeddings: vi.fn().mockResolvedValue(undefined),
    }));

    const { PapersService } = await import('../../src/main/services/papers.service');
    const service = new PapersService();

    await service.importLocalPdf('/tmp/input.pdf');

    expect(schedulePaperProcessing).toHaveBeenCalledWith('paper-4');
    expect(scheduleCitationExtraction).toHaveBeenCalledWith('paper-4');
    expect(scheduleAutoPaperEnrichment).toHaveBeenCalledWith('paper-4');
    expect(createEvent).toHaveBeenCalledTimes(1);
  });
});
