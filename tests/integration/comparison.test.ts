import { describe, expect, it, vi } from 'vitest';
import {
  buildComparisonUserPrompt,
  COMPARISON_SYSTEM_PROMPT,
  type ComparisonPaperInput,
  type ComparisonNoteItem,
} from '@shared';

// ─── Prompt builder tests ───────────────────────────────────────────────────

describe('comparison prompt', () => {
  it('buildComparisonUserPrompt formats 2 papers correctly', () => {
    const papers: ComparisonPaperInput[] = [
      {
        title: 'Attention Is All You Need',
        authors: ['Vaswani et al.'],
        year: 2017,
        abstract: 'We propose a new architecture based on attention mechanisms.',
      },
      {
        title: 'BERT: Pre-training of Deep Bidirectional Transformers',
        authors: ['Devlin et al.'],
        year: 2019,
        abstract: 'We introduce BERT for language understanding.',
      },
    ];

    const prompt = buildComparisonUserPrompt(papers);

    expect(prompt).toContain('Paper 1: Attention Is All You Need');
    expect(prompt).toContain('Paper 2: BERT');
    expect(prompt).toContain('Vaswani et al.');
    expect(prompt).toContain('Year: 2017');
    expect(prompt).toContain('Year: 2019');
    expect(prompt).toContain('We propose a new architecture');
    expect(prompt).toContain('We introduce BERT');
  });

  it('buildComparisonUserPrompt formats 3 papers correctly', () => {
    const papers: ComparisonPaperInput[] = [
      { title: 'Paper A' },
      { title: 'Paper B' },
      { title: 'Paper C' },
    ];

    const prompt = buildComparisonUserPrompt(papers);

    expect(prompt).toContain('Paper 1: Paper A');
    expect(prompt).toContain('Paper 2: Paper B');
    expect(prompt).toContain('Paper 3: Paper C');
  });

  it('handles papers with missing fields gracefully', () => {
    const papers: ComparisonPaperInput[] = [
      { title: 'Paper without abstract', authors: [], year: null },
      { title: 'Minimal paper' },
    ];

    const prompt = buildComparisonUserPrompt(papers);

    expect(prompt).toContain('Paper 1: Paper without abstract');
    expect(prompt).toContain('Paper 2: Minimal paper');
    // Should not contain "Authors:" or "Year:" for empty/null fields
    expect(prompt).not.toContain('Authors:');
    expect(prompt).not.toContain('Year: null');
  });

  it('includes PDF excerpt when provided', () => {
    const papers: ComparisonPaperInput[] = [
      {
        title: 'Paper with excerpt',
        pdfExcerpt: 'This is the first page content of the paper...',
      },
      { title: 'Paper without excerpt' },
    ];

    const prompt = buildComparisonUserPrompt(papers);

    expect(prompt).toContain('Excerpt:');
    expect(prompt).toContain('This is the first page content');
  });

  it('system prompt contains all required sections', () => {
    expect(COMPARISON_SYSTEM_PROMPT).toContain('## Overview');
    expect(COMPARISON_SYSTEM_PROMPT).toContain('## Similarities');
    expect(COMPARISON_SYSTEM_PROMPT).toContain('## Differences');
    expect(COMPARISON_SYSTEM_PROMPT).toContain('## Methodology Comparison');
    expect(COMPARISON_SYSTEM_PROMPT).toContain('## Research Gaps');
    expect(COMPARISON_SYSTEM_PROMPT).toContain('## Synthesis');
  });
});

// ─── Service tests (mocked LLM) ────────────────────────────────────────────

const mockStreamChunks = ['## Overview\n', 'Paper 1 focuses on...', '\n## Similarities\n'];

vi.mock('../../src/main/services/ai-provider.service', () => ({
  getLanguageModelFromConfig: vi.fn(() => ({})),
  streamText: vi.fn(() => ({
    textStream: (async function* () {
      for (const chunk of mockStreamChunks) yield chunk;
    })(),
  })),
}));

vi.mock('../../src/main/store/model-config-store', () => ({
  getActiveModel: vi.fn(() => ({ id: 'test-model', name: 'Test' })),
  getModelWithKey: vi.fn(() => ({ id: 'test-model', apiKey: 'test-key' })),
}));

vi.mock('../../src/main/services/paper-text.service', () => ({
  getPaperExcerptCached: vi.fn(async () => 'PDF excerpt text'),
}));

vi.mock('@db', () => ({
  PapersRepository: class {
    findById = vi.fn(async (id: string) => ({
      id,
      shortId: `short-${id}`,
      title: `Paper ${id}`,
      authors: ['Author A'],
      abstract: 'Test abstract',
      submittedAt: '2024-01-01',
      pdfUrl: null,
      pdfPath: null,
    }));
  },
}));

describe('ComparisonService', () => {
  it('streams chunks via onChunk callback', async () => {
    const { ComparisonService } = await import('../../src/main/services/comparison.service');
    const service = new ComparisonService();
    const chunks: string[] = [];

    const result = await service.comparePapers({ paperIds: ['p1', 'p2'] }, (chunk) =>
      chunks.push(chunk),
    );

    expect(chunks).toEqual(mockStreamChunks);
    expect(result).toBe(mockStreamChunks.join(''));
  });

  it('rejects fewer than 2 papers', async () => {
    const { ComparisonService } = await import('../../src/main/services/comparison.service');
    const service = new ComparisonService();

    await expect(service.comparePapers({ paperIds: ['p1'] }, () => undefined)).rejects.toThrow(
      'Comparison requires 2 or 3 papers',
    );
  });

  it('rejects more than 3 papers', async () => {
    const { ComparisonService } = await import('../../src/main/services/comparison.service');
    const service = new ComparisonService();

    await expect(
      service.comparePapers({ paperIds: ['p1', 'p2', 'p3', 'p4'] }, () => undefined),
    ).rejects.toThrow('Comparison requires 2 or 3 papers');
  });
});

// ─── ComparisonNoteItem type tests ──────────────────────────────────────────

describe('ComparisonNoteItem type', () => {
  it('has the expected shape for serialized comparison notes', () => {
    const note: ComparisonNoteItem = {
      id: 'test-id',
      paperIds: ['p1', 'p2'],
      titles: ['Paper 1', 'Paper 2'],
      contentMd: '## Overview\nComparison result...',
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    };

    expect(note.paperIds).toHaveLength(2);
    expect(note.titles).toHaveLength(2);
    expect(note.contentMd).toContain('## Overview');
  });

  it('supports 3-paper comparisons', () => {
    const note: ComparisonNoteItem = {
      id: 'test-id-3',
      paperIds: ['p1', 'p2', 'p3'],
      titles: ['Paper A', 'Paper B', 'Paper C'],
      contentMd: '## Overview\nThree-way comparison...',
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    };

    expect(note.paperIds).toHaveLength(3);
    expect(note.titles).toHaveLength(3);
  });

  it('round-trips JSON serialization for paperIds and titles', () => {
    const paperIds = ['id-1', 'id-2'];
    const titles = ['Attention Is All You Need', 'BERT'];

    const json = JSON.stringify({ paperIds, titles });
    const parsed = JSON.parse(json) as { paperIds: string[]; titles: string[] };

    expect(parsed.paperIds).toEqual(paperIds);
    expect(parsed.titles).toEqual(titles);
  });
});
