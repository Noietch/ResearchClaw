import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  papers: [] as any[],
  localPapers: [] as any[],
  feedback: [] as any[],
  candidates: new Map<string, any>(),
  results: new Map<string, any>(),
}));

const mocks = vi.hoisted(() => ({
  listPapers: vi.fn(async () => mockState.papers),
  listAllPapers: vi.fn(async () => mockState.localPapers),
  listRecentFeedback: vi.fn(async () => mockState.feedback),
  getStatusMap: vi.fn(async () => new Map<string, string>()),
  semanticKeywordSearch: vi.fn(async () => []),
  semanticSeedSearch: vi.fn(async () => []),
  arxivSearch: vi.fn(async () => []),
  embedTexts: vi.fn(async (_texts: string[]) => [] as number[][]),
  semanticEnabled: vi.fn(() => true),
}));

vi.mock('@db', () => {
  class PapersRepository {
    list = mocks.listPapers;
    listAll = mocks.listAllPapers;
  }

  class RecommendationsRepository {
    upsertCandidate = vi.fn(async (input: any) => {
      const record = {
        id: `candidate-${input.externalId}`,
        source: input.source,
        externalId: input.externalId,
        arxivId: input.arxivId ?? null,
        doi: input.doi ?? null,
        title: input.title,
        titleNormalized: input.titleNormalized,
        authorsJson: JSON.stringify(input.authors),
        abstract: input.abstract ?? null,
        sourceUrl: input.sourceUrl ?? null,
        pdfUrl: input.pdfUrl ?? null,
        publishedAt: input.publishedAt ?? null,
        venue: input.venue ?? null,
        citationCount: input.citationCount ?? null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
      };
      mockState.candidates.set(record.id, record);
      return {
        ...record,
        authors: input.authors,
        metadata: input.metadata ?? {},
      };
    });

    upsertResult = vi.fn(async (input: any) => {
      const candidate = mockState.candidates.get(input.candidateId);
      const row = {
        id: `result-${input.candidateId}`,
        candidateId: input.candidateId,
        score: input.score,
        relevanceScore: input.relevanceScore,
        freshnessScore: input.freshnessScore,
        noveltyScore: input.noveltyScore,
        qualityScore: input.qualityScore,
        semanticScore: input.semanticScore ?? null,
        explorationNote: input.explorationNote ?? null,
        reason: input.reason,
        triggerPaperTitle: input.triggerPaperTitle ?? null,
        triggerPaperId: input.triggerPaperId ?? null,
        status: input.status ?? 'new',
        generatedAt: input.generatedAt,
        updatedAt: input.generatedAt,
        candidate,
      };
      mockState.results.set(input.candidateId, row);
      return row;
    });

    getStatusMap = mocks.getStatusMap;
    listRecentFeedback = mocks.listRecentFeedback;
    listResults = vi.fn(async () =>
      [...mockState.results.values()].sort((left, right) => right.score - left.score),
    );
    findCandidateById = vi.fn(
      async (candidateId: string) => mockState.candidates.get(candidateId) ?? null,
    );
    markStatus = vi.fn(async () => undefined);
    createFeedback = vi.fn(async () => undefined);
  }

  return { PapersRepository, RecommendationsRepository };
});

vi.mock('../../src/main/services/papers.service', () => ({
  PapersService: class PapersService {},
}));

vi.mock('../../src/main/services/download.service', () => ({
  DownloadService: class DownloadService {},
}));

vi.mock('../../src/main/services/recommendation-sources/semantic-scholar-source', () => ({
  SemanticScholarRecommendationSource: class SemanticScholarRecommendationSource {
    searchByKeywords = mocks.semanticKeywordSearch;
    searchBySeedTitles = mocks.semanticSeedSearch;
  },
}));

vi.mock('../../src/main/services/recommendation-sources/arxiv-source', () => ({
  ArxivRecommendationSource: class ArxivRecommendationSource {
    searchByKeywords = mocks.arxivSearch;
  },
}));

const settingsMocks = vi.hoisted(() => ({
  getSemanticSearchSettings: vi.fn(() => ({
    enabled: true,
    autoProcess: true,
    autoEnrich: true,
    autoStartOllama: true,
    baseUrl: 'http://127.0.0.1:11434',
    embeddingModel: 'test-model',
    embeddingProvider: 'builtin',
    recommendationExploration: 0.35,
  })),
}));

vi.mock('../../src/main/store/app-settings-store', () => ({
  getSemanticSearchSettings: settingsMocks.getSemanticSearchSettings,
}));

vi.mock('../../src/main/services/local-semantic.service', () => ({
  localSemanticService: {
    isEnabled: mocks.semanticEnabled,
    embedTexts: mocks.embedTexts,
  },
}));

import { RecommendationService } from '../../src/main/services/recommendation.service';

describe('RecommendationService hybrid recall and reranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.papers = [
      {
        id: 'paper-seed-1',
        shortId: 'seed-1',
        title: 'Attention Is All You Need',
        abstract: 'Transformer attention architectures for sequence modeling.',
        authors: ['Ashish Vaswani'],
        tagNames: ['sequence-modeling', 'deep-learning'],
        readingNotes: [{ id: 'note-1' }],
        rating: 5,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        lastReadAt: new Date('2026-03-01T00:00:00Z'),
        sourceUrl: 'https://example.com/seed',
      },
    ];
    mockState.localPapers = mockState.papers;
    mockState.feedback = [];
    mockState.candidates = new Map();
    mockState.results = new Map();
    mocks.semanticEnabled.mockReturnValue(true);
    settingsMocks.getSemanticSearchSettings.mockReturnValue({
      enabled: true,
      autoProcess: true,
      autoEnrich: true,
      autoStartOllama: true,
      baseUrl: 'http://127.0.0.1:11434',
      embeddingModel: 'test-model',
      embeddingProvider: 'builtin',
      recommendationExploration: 0.35,
    });
    mocks.semanticKeywordSearch.mockResolvedValue([]);
    mocks.semanticSeedSearch.mockResolvedValue([]);
    mocks.arxivSearch.mockResolvedValue([]);
    mocks.getStatusMap.mockResolvedValue(new Map());
  });

  it('adds semanticScore, reranks candidates, and exposes it through listRecommendations', async () => {
    mocks.semanticKeywordSearch.mockImplementation(async (queries: string[]) => {
      if (
        queries.some((query) => query.includes('machine learning')) ||
        queries.some((query) => query.includes('transformer'))
      ) {
        return [
          {
            source: 'semantic_scholar',
            externalId: 'semantic-match',
            title: 'Transformer reasoning with sparse attention',
            authors: ['Researcher A'],
            abstract: 'Sparse transformer attention improves reasoning.',
            sourceUrl: 'https://example.com/match',
            pdfUrl: null,
            publishedAt: new Date('2025-12-01T00:00:00Z'),
            venue: 'ACL',
            citationCount: 8,
            metadata: {},
          },
          {
            source: 'semantic_scholar',
            externalId: 'semantic-miss',
            title: 'Cell membrane signaling pathways',
            authors: ['Researcher B'],
            abstract: 'Biology pathway analysis across membrane proteins.',
            sourceUrl: 'https://example.com/miss',
            pdfUrl: null,
            publishedAt: new Date('2025-12-01T00:00:00Z'),
            venue: 'ACL',
            citationCount: 8,
            metadata: {},
          },
        ];
      }
      return [];
    });

    mocks.embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((text) => {
        const value = text.toLowerCase();
        if (value.includes('attention is all you need')) return [1, 0, 0];
        if (value.includes('transformer')) return [1, 0, 0];
        if (value.includes('biology') || value.includes('membrane')) return [-1, 0, 0];
        return [0, 1, 0];
      }),
    );

    const service = new RecommendationService();
    const refresh = await service.generateRecommendations(10);
    const items = await service.listRecommendations();

    expect(refresh.count).toBe(2);
    expect(mocks.embedTexts).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain('Transformer reasoning');
    expect(items[0].semanticScore).toBeCloseTo(1, 6);
    expect(items[0].reason).toBe('Semantically close to papers you recently read.');
    expect(items[0].explorationNote).toBeNull();
    expect(items[1].semanticScore).toBe(0);
  });

  it('uses semantic expansion queries to fetch additional candidates', async () => {
    mocks.semanticKeywordSearch.mockImplementation(async (queries: string[]) => {
      if (queries.some((query) => query.includes('transformer architectures modeling deep'))) {
        return [
          {
            source: 'semantic_scholar',
            externalId: 'expansion-only',
            title: 'Transformer reasoning for deep learning systems',
            authors: ['Researcher E'],
            abstract: 'A systems paper discovered only from the semantic expansion query.',
            sourceUrl: 'https://example.com/expansion-only',
            pdfUrl: null,
            publishedAt: new Date('2025-08-01T00:00:00Z'),
            venue: 'ICML',
            citationCount: 3,
            metadata: {},
          },
        ];
      }
      return [];
    });

    mocks.embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((text) => {
        const value = text.toLowerCase();
        if (value.includes('attention is all you need')) return [1, 0, 0];
        if (value.includes('transformer reasoning')) return [1, 0, 0];
        return [0.5, 0, 0];
      }),
    );

    const service = new RecommendationService();
    const refresh = await service.generateRecommendations(10);
    const items = await service.listRecommendations();

    expect(refresh.count).toBe(1);
    expect(items[0].title).toContain('Transformer reasoning for deep learning systems');
    expect(mocks.semanticKeywordSearch).toHaveBeenNthCalledWith(
      2,
      ['transformer architectures modeling deep'],
      5,
    );
    expect(mocks.arxivSearch).toHaveBeenNthCalledWith(
      2,
      ['transformer architectures modeling deep'],
      4,
    );
  });

  it('diversifies top recommendations across multiple trigger papers', async () => {
    mockState.papers = [
      {
        id: 'paper-seed-1',
        shortId: 'seed-1',
        title: 'Attention Is All You Need',
        abstract: 'Transformer attention architectures for sequence modeling.',
        authors: ['Ashish Vaswani'],
        tagNames: ['transformers', 'attention'],
        readingNotes: [{ id: 'note-1' }],
        rating: 5,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        lastReadAt: new Date('2026-03-01T00:00:00Z'),
        sourceUrl: 'https://example.com/seed-1',
      },
      {
        id: 'paper-seed-2',
        shortId: 'seed-2',
        title: 'Retrieval Augmented Generation Systems',
        abstract: 'Retrieval generation pipelines for grounded answers.',
        authors: ['Researcher Seed'],
        tagNames: ['retrieval', 'generation'],
        readingNotes: [{ id: 'note-2' }],
        rating: 4,
        createdAt: new Date('2025-02-01T00:00:00Z'),
        lastReadAt: new Date('2026-02-20T00:00:00Z'),
        sourceUrl: 'https://example.com/seed-2',
      },
    ];
    mockState.localPapers = mockState.papers;

    mocks.semanticKeywordSearch.mockResolvedValue([
      {
        source: 'semantic_scholar',
        externalId: 'seed1-a',
        title: 'Transformer routing with sparse attention',
        authors: ['Researcher X'],
        abstract: 'Transformer attention routing for language systems.',
        sourceUrl: 'https://example.com/seed1-a',
        pdfUrl: null,
        publishedAt: new Date('2025-12-01T00:00:00Z'),
        venue: 'ACL',
        citationCount: 8,
        metadata: {},
      },
      {
        source: 'semantic_scholar',
        externalId: 'seed1-b',
        title: 'Transformer scaling with efficient attention',
        authors: ['Researcher Y'],
        abstract: 'Attention scaling for efficient transformers.',
        sourceUrl: 'https://example.com/seed1-b',
        pdfUrl: null,
        publishedAt: new Date('2025-11-01T00:00:00Z'),
        venue: 'NeurIPS',
        citationCount: 7,
        metadata: {},
      },
      {
        source: 'semantic_scholar',
        externalId: 'seed2-a',
        title: 'Retrieval generation memory systems',
        authors: ['Researcher Z'],
        abstract: 'Retrieval generation systems with memory-aware ranking.',
        sourceUrl: 'https://example.com/seed2-a',
        pdfUrl: null,
        publishedAt: new Date('2025-10-01T00:00:00Z'),
        venue: 'ICML',
        citationCount: 6,
        metadata: {},
      },
    ]);

    mocks.embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((text) => {
        const value = text.toLowerCase();
        if (value.includes('attention is all you need')) return [1, 0, 0];
        if (value.includes('retrieval augmented generation systems')) return [0, 1, 0];
        if (value.includes('transformer routing') || value.includes('efficient attention'))
          return [1, 0, 0];
        if (value.includes('retrieval generation memory systems')) return [0, 1, 0];
        return [0.5, 0.5, 0];
      }),
    );

    const service = new RecommendationService();
    await service.generateRecommendations(2);
    const items = await service.listRecommendations();

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.triggerPaperId)).size).toBe(2);
    expect(items.map((item) => item.triggerPaperTitle)).toEqual(
      expect.arrayContaining([
        'Attention Is All You Need',
        'Retrieval Augmented Generation Systems',
      ]),
    );
  });

  it('reduces near-duplicate candidates within the same seed cluster', async () => {
    mocks.semanticKeywordSearch.mockResolvedValue([
      {
        source: 'semantic_scholar',
        externalId: 'dup-a',
        title: 'Transformer routing with sparse attention',
        authors: ['Researcher X'],
        abstract: 'Sparse transformer routing for language systems.',
        sourceUrl: 'https://example.com/dup-a',
        pdfUrl: null,
        publishedAt: new Date('2025-12-01T00:00:00Z'),
        venue: 'ACL',
        citationCount: 10,
        metadata: {},
      },
      {
        source: 'semantic_scholar',
        externalId: 'dup-b',
        title: 'Transformer routing with efficient sparse attention',
        authors: ['Researcher Y'],
        abstract: 'Efficient sparse transformer routing for language systems.',
        sourceUrl: 'https://example.com/dup-b',
        pdfUrl: null,
        publishedAt: new Date('2025-11-15T00:00:00Z'),
        venue: 'EMNLP',
        citationCount: 9,
        metadata: {},
      },
      {
        source: 'semantic_scholar',
        externalId: 'alt-c',
        title: 'Transformer planning with memory routing',
        authors: ['Researcher Z'],
        abstract: 'Memory-guided planning for transformer systems.',
        sourceUrl: 'https://example.com/alt-c',
        pdfUrl: null,
        publishedAt: new Date('2025-09-01T00:00:00Z'),
        venue: 'ICLR',
        citationCount: 5,
        metadata: {},
      },
    ]);

    mocks.embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((text) => {
        const value = text.toLowerCase();
        if (value.includes('attention is all you need')) return [1, 0, 0];
        if (value.includes('sparse attention')) return [1, 0, 0];
        if (value.includes('efficient sparse')) return [0.99, 0.01, 0];
        if (value.includes('memory routing')) return [0.75, 0.45, 0];
        return [0.4, 0.4, 0];
      }),
    );

    const service = new RecommendationService();
    await service.generateRecommendations(2);
    const items = await service.listRecommendations();

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.title)).toContain('Transformer planning with memory routing');
    expect(
      items.find((item) => item.title === 'Transformer planning with memory routing')
        ?.explorationNote,
    ).toBeNull();
    expect(
      items.map((item) => item.title).filter((title) => title.includes('sparse attention')),
    ).toHaveLength(1);
  });

  it('increases novelty pressure when exploration is higher', async () => {
    settingsMocks.getSemanticSearchSettings.mockReturnValue({
      enabled: true,
      autoProcess: true,
      autoEnrich: true,
      autoStartOllama: true,
      baseUrl: 'http://127.0.0.1:11434',
      embeddingModel: 'test-model',
      embeddingProvider: 'builtin',
      recommendationExploration: 1,
    });

    mocks.semanticKeywordSearch.mockResolvedValue([
      {
        source: 'semantic_scholar',
        externalId: 'dup-high-a',
        title: 'Transformer routing with sparse attention',
        authors: ['Researcher X'],
        abstract: 'Sparse transformer routing for language systems.',
        sourceUrl: 'https://example.com/dup-high-a',
        pdfUrl: null,
        publishedAt: new Date('2025-12-01T00:00:00Z'),
        venue: 'ACL',
        citationCount: 10,
        metadata: {},
      },
      {
        source: 'semantic_scholar',
        externalId: 'dup-high-b',
        title: 'Transformer routing with efficient sparse attention',
        authors: ['Researcher Y'],
        abstract: 'Efficient sparse transformer routing for language systems.',
        sourceUrl: 'https://example.com/dup-high-b',
        pdfUrl: null,
        publishedAt: new Date('2025-11-15T00:00:00Z'),
        venue: 'EMNLP',
        citationCount: 9,
        metadata: {},
      },
      {
        source: 'semantic_scholar',
        externalId: 'novel-high-c',
        title: 'Transformer planning with memory routing',
        authors: ['Researcher Z'],
        abstract: 'Memory-guided planning for transformer systems.',
        sourceUrl: 'https://example.com/novel-high-c',
        pdfUrl: null,
        publishedAt: new Date('2025-09-01T00:00:00Z'),
        venue: 'ICLR',
        citationCount: 5,
        metadata: {},
      },
    ]);

    mocks.embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((text) => {
        const value = text.toLowerCase();
        if (value.includes('attention is all you need')) return [1, 0, 0];
        if (value.includes('sparse attention')) return [1, 0, 0];
        if (value.includes('efficient sparse')) return [0.995, 0.005, 0];
        if (value.includes('memory routing')) return [0.75, 0.45, 0];
        return [0.4, 0.4, 0];
      }),
    );

    const service = new RecommendationService();
    await service.generateRecommendations(2);
    const items = await service.listRecommendations();

    expect(items.map((item) => item.title)).toContain('Transformer planning with memory routing');
    expect(
      items.find((item) => item.title === 'Transformer planning with memory routing')
        ?.explorationNote,
    ).toContain('Exploration is turned up');
  });

  it('falls back to rule-only ranking when embeddings fail', async () => {
    mocks.semanticKeywordSearch.mockResolvedValue([
      {
        source: 'semantic_scholar',
        externalId: 'fallback-candidate',
        title: 'Transformers for long context retrieval',
        authors: ['Researcher C'],
        abstract: 'Long context transformer retrieval improvements.',
        sourceUrl: 'https://example.com/fallback',
        pdfUrl: null,
        publishedAt: new Date('2025-10-10T00:00:00Z'),
        venue: 'NeurIPS',
        citationCount: 12,
        metadata: {},
      },
    ]);
    mocks.embedTexts.mockRejectedValue(new Error('embedding offline'));

    const service = new RecommendationService();
    await expect(service.generateRecommendations(10)).resolves.toEqual(
      expect.objectContaining({ count: 1 }),
    );

    const items = await service.listRecommendations();
    expect(items[0].semanticScore).toBe(0);
    expect(items[0].score).toBeGreaterThan(0);
  });

  it('skips semantic expansion and scoring entirely when semantic search is disabled', async () => {
    mocks.semanticEnabled.mockReturnValue(false);
    mocks.semanticKeywordSearch.mockResolvedValue([
      {
        source: 'semantic_scholar',
        externalId: 'disabled-candidate',
        title: 'Attention routing for language models',
        authors: ['Researcher D'],
        abstract: 'Attention routing methods for language models.',
        sourceUrl: 'https://example.com/disabled',
        pdfUrl: null,
        publishedAt: new Date('2025-11-05T00:00:00Z'),
        venue: 'ICLR',
        citationCount: 4,
        metadata: {},
      },
    ]);

    const service = new RecommendationService();
    await service.generateRecommendations(10);
    const items = await service.listRecommendations();

    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(mocks.semanticKeywordSearch).toHaveBeenCalledTimes(1);
    expect(mocks.arxivSearch).toHaveBeenCalledTimes(1);
    expect(items[0].semanticScore).toBe(0);
  });
});
