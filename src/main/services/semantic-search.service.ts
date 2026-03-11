import { PapersRepository } from '@db';
import type { TagCategory } from '@shared';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import { localSemanticService } from './local-semantic.service';
import { normalizeWhitespace, semanticLexicalBoost } from './semantic-utils';
import * as vecIndex from './vec-index.service';
import * as searchUnitIndex from './search-unit-index.service';

type MatchSignal = 'title' | 'tag' | 'abstract' | 'sentence' | 'chunk';
type QueryKind = 'single_term' | 'short_phrase' | 'long_query';

export interface SemanticSearchSnippet {
  type: MatchSignal;
  text: string;
  score: number;
}

export interface SemanticSearchPaper {
  id: string;
  shortId: string;
  title: string;
  authors?: string[];
  submittedAt?: string | null;
  tagNames?: string[];
  abstract?: string | null;
  relevanceReason?: string;
  similarityScore: number;
  matchedChunks: string[];
  processingStatus?: string;
  processingError?: string | null;
  matchSignals?: MatchSignal[];
  matchedSnippets?: SemanticSearchSnippet[];
}

export interface SemanticSearchResult {
  mode: 'semantic' | 'fallback';
  papers: SemanticSearchPaper[];
  fallbackReason?: string;
}

interface RankedCandidate {
  paperId: string;
  rank: number;
  score: number;
  signal: MatchSignal;
  snippet: string;
  channel: 'lexical' | 'unit' | 'chunk';
}

interface PaperEvidence {
  paper: ReturnType<typeof mapPaper>;
  lexical: RankedCandidate[];
  unitSemantic: RankedCandidate[];
  chunkSemantic: RankedCandidate[];
  exactTitle: boolean;
  titlePrefix: boolean;
  exactTag: boolean;
  exactAbstractOrSentence: boolean;
}

function mapPaper(chunkPaper: {
  id: string;
  shortId: string;
  title: string;
  authorsJson: string;
  submittedAt: Date | string | null;
  abstract: string | null;
  processingStatus: string;
  processingError?: string | null;
  tags: Array<{ tag: { name: string; category: string } }>;
}) {
  return {
    id: chunkPaper.id,
    shortId: chunkPaper.shortId,
    title: chunkPaper.title,
    authors: JSON.parse(chunkPaper.authorsJson) as string[],
    submittedAt:
      typeof chunkPaper.submittedAt === 'string'
        ? chunkPaper.submittedAt
        : (chunkPaper.submittedAt?.toISOString() ?? null),
    abstract: chunkPaper.abstract,
    tagNames: chunkPaper.tags.map((item) => item.tag.name),
    categorizedTags: chunkPaper.tags.map((item) => ({
      name: item.tag.name,
      category: item.tag.category as TagCategory,
    })),
    processingStatus: chunkPaper.processingStatus,
    processingError: chunkPaper.processingError,
  };
}

function tokenize(query: string): string[] {
  return normalizeWhitespace(query).toLowerCase().split(/\s+/).filter(Boolean);
}

function classifyQuery(query: string): QueryKind {
  const tokens = tokenize(query);
  if (tokens.length <= 1 || (!query.includes(' ') && query.trim().length <= 20))
    return 'single_term';
  if (tokens.length <= 4 && query.trim().length <= 40) return 'short_phrase';
  return 'long_query';
}

function unitThreshold(kind: QueryKind): number {
  return kind === 'single_term' ? 0.32 : kind === 'short_phrase' ? 0.3 : 0.26;
}

function chunkThreshold(kind: QueryKind): number {
  return kind === 'single_term' ? 0.38 : kind === 'short_phrase' ? 0.34 : 0.3;
}

function rrf(rank: number, k = 60): number {
  return 1 / (k + rank);
}

function pushCandidate(
  map: Map<string, PaperEvidence>,
  candidate: RankedCandidate,
  paper: ReturnType<typeof mapPaper>,
) {
  const entry =
    map.get(candidate.paperId) ??
    ({
      paper,
      lexical: [],
      unitSemantic: [],
      chunkSemantic: [],
      exactTitle: false,
      titlePrefix: false,
      exactTag: false,
      exactAbstractOrSentence: false,
    } satisfies PaperEvidence);

  if (candidate.channel === 'chunk') entry.chunkSemantic.push(candidate);
  else if (candidate.channel === 'unit') entry.unitSemantic.push(candidate);
  else entry.lexical.push(candidate);
  map.set(candidate.paperId, entry);
}

function computeLexicalFlags(entry: PaperEvidence, query: string) {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const normalizedTitle = normalizeWhitespace(entry.paper.title).toLowerCase();
  const normalizedAbstract = normalizeWhitespace(entry.paper.abstract ?? '').toLowerCase();
  const tagNames = entry.paper.tagNames?.map((tag) => normalizeWhitespace(tag).toLowerCase()) ?? [];

  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const compactTitle = normalizedTitle.replace(/\s+/g, '');
  entry.exactTitle =
    normalizedTitle.includes(normalizedQuery) || compactTitle.includes(compactQuery);
  entry.titlePrefix =
    normalizedTitle.startsWith(normalizedQuery) || compactTitle.startsWith(compactQuery);
  entry.exactTag = tagNames.some((tag) => tag === normalizedQuery);
  entry.exactAbstractOrSentence =
    normalizedAbstract.includes(normalizedQuery) ||
    entry.unitSemantic.some((candidate) =>
      candidate.snippet.toLowerCase().includes(normalizedQuery),
    ) ||
    entry.lexical.some((candidate) => candidate.snippet.toLowerCase().includes(normalizedQuery));
}

function makeReason(entry: PaperEvidence): string | undefined {
  if (entry.exactTitle) return entry.paper.title;
  if (entry.exactTag) return `Tag match: ${entry.paper.tagNames?.find(Boolean) ?? ''}`.trim();

  const sentence = [...entry.lexical, ...entry.unitSemantic].find(
    (candidate) => candidate.signal === 'sentence',
  );
  if (sentence) return sentence.snippet;
  const abstract = [...entry.lexical, ...entry.unitSemantic].find(
    (candidate) => candidate.signal === 'abstract',
  );
  if (abstract) return abstract.snippet;
  return entry.chunkSemantic[0]?.snippet;
}

function toPaperResult(entry: PaperEvidence, fusedScore: number): SemanticSearchPaper {
  const snippets = [...entry.lexical, ...entry.unitSemantic, ...entry.chunkSemantic]
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((candidate) => ({
      type: candidate.signal,
      text: candidate.snippet,
      score: candidate.score,
    }));

  return {
    ...entry.paper,
    similarityScore: fusedScore,
    relevanceReason: makeReason(entry),
    matchedChunks: entry.chunkSemantic.slice(0, 3).map((candidate) => candidate.snippet),
    matchSignals: Array.from(new Set(snippets.map((snippet) => snippet.type))),
    matchedSnippets: snippets,
  };
}

export class SemanticSearchService {
  private papersRepository = new PapersRepository();

  async search(query: string, limit = 20): Promise<SemanticSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return { mode: 'semantic', papers: [] };

    const settings = getSemanticSearchSettings();
    if (!settings.enabled) {
      return {
        mode: 'fallback',
        papers: [],
        fallbackReason: 'Local semantic search is disabled in Settings.',
      };
    }

    // Check if embedding provider is properly configured
    if (!localSemanticService.hasValidConfig()) {
      return {
        mode: 'fallback',
        papers: [],
        fallbackReason:
          'Embedding provider is not configured. Please set up your OpenAI-compatible API key or base URL in Settings.',
      };
    }

    let queryEmbedding: number[];
    try {
      [queryEmbedding] = await localSemanticService.embedTexts([trimmed]);
    } catch (error) {
      return {
        mode: 'fallback',
        papers: [],
        fallbackReason:
          error instanceof Error ? error.message : 'Local semantic model is unavailable.',
      };
    }

    const kind = classifyQuery(trimmed);
    const evidence = new Map<string, PaperEvidence>();

    await this.collectLexicalCandidates(trimmed, evidence);
    await this.collectUnitSemanticCandidates(trimmed, queryEmbedding, kind, evidence, limit);
    await this.collectChunkCandidates(trimmed, queryEmbedding, kind, evidence, limit);

    for (const entry of evidence.values()) {
      computeLexicalFlags(entry, trimmed);
    }

    const ranked = Array.from(evidence.values())
      .map((entry) => {
        const lexicalRrf = entry.lexical.reduce((sum, candidate) => sum + rrf(candidate.rank), 0);
        const unitRrf = entry.unitSemantic.reduce((sum, candidate) => sum + rrf(candidate.rank), 0);
        const chunkRrf = entry.chunkSemantic.reduce(
          (sum, candidate) => sum + rrf(candidate.rank),
          0,
        );
        const fused = lexicalRrf + unitRrf + chunkRrf;

        const lexicalBoost =
          (entry.exactTitle ? 0.15 : 0) +
          (entry.exactTag ? 0.1 : 0) +
          (entry.titlePrefix ? 0.08 : 0) +
          (entry.exactAbstractOrSentence ? 0.05 : 0);
        const bestUnit = Math.max(...entry.unitSemantic.map((candidate) => candidate.score), 0);
        const bestChunk = Math.max(...entry.chunkSemantic.map((candidate) => candidate.score), 0);
        const finalScore = bestUnit * 0.7 + lexicalBoost + fused * 0.15 + bestChunk * 0.05;

        return { entry, finalScore };
      })
      .filter(({ entry }) => {
        if (kind !== 'single_term') return true;
        const hasSupport =
          entry.lexical.length > 0 ||
          entry.unitSemantic.length > 0 ||
          entry.exactTitle ||
          entry.exactTag;
        return hasSupport;
      })
      .sort((left, right) => right.finalScore - left.finalScore)
      .slice(0, limit)
      .map(({ entry, finalScore }) => toPaperResult(entry, finalScore));

    if (ranked.length === 0) {
      return {
        mode: 'fallback',
        papers: [],
        fallbackReason:
          'No semantic matches cleared the route-aware relevance checks, so normal search should be used.',
      };
    }

    return { mode: 'semantic', papers: ranked };
  }

  private async collectLexicalCandidates(
    query: string,
    evidence: Map<string, PaperEvidence>,
  ): Promise<void> {
    const hits = await searchUnitIndex.searchLexical(query, 40);
    const units = await this.papersRepository.findSearchUnitsByIds(hits.map((hit) => hit.unitId));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    hits.forEach((hit, index) => {
      const unit = unitById.get(hit.unitId);
      if (!unit) return;
      pushCandidate(
        evidence,
        {
          paperId: unit.paperId,
          rank: index + 1,
          score:
            Math.max(0, 1 / (Math.abs(hit.rank) + 1)) + semanticLexicalBoost(query, [unit.content]),
          signal: unit.unitType === 'sentence' ? 'sentence' : unit.unitType,
          snippet: unit.contentPreview,
          channel: 'lexical',
        },
        mapPaper(unit.paper),
      );
    });

    const indexedPapers = await this.papersRepository.listIndexedPapersForSemanticSearch();
    const normalizedQuery = normalizeWhitespace(query).toLowerCase();
    let exactRank = hits.length + 1;

    for (const paper of indexedPapers) {
      const mappedPaper = mapPaper(paper);
      const title = normalizeWhitespace(paper.title).toLowerCase();
      const abstract = normalizeWhitespace(paper.abstract ?? '').toLowerCase();
      const tags = paper.tags.map((item) => item.tag.name.toLowerCase());

      const compactQuery = normalizedQuery.replace(/\s+/g, '');
      if (title.includes(normalizedQuery) || title.replace(/\s+/g, '').includes(compactQuery)) {
        pushCandidate(
          evidence,
          {
            paperId: paper.id,
            rank: exactRank++,
            score: 0.6,
            signal: 'title',
            snippet: paper.title,
            channel: 'lexical',
          },
          mappedPaper,
        );
      }
      if (tags.some((tag) => tag === normalizedQuery)) {
        pushCandidate(
          evidence,
          {
            paperId: paper.id,
            rank: exactRank++,
            score: 0.58,
            signal: 'tag',
            snippet:
              paper.tags.find((item) => item.tag.name.toLowerCase() === normalizedQuery)?.tag
                .name ?? normalizedQuery,
            channel: 'lexical',
          },
          mappedPaper,
        );
      }
      if (abstract.includes(normalizedQuery)) {
        pushCandidate(
          evidence,
          {
            paperId: paper.id,
            rank: exactRank++,
            score: 0.45,
            signal: 'abstract',
            snippet: (paper.abstract ?? '').slice(0, 240),
            channel: 'lexical',
          },
          mappedPaper,
        );
      }
    }
  }

  private async collectUnitSemanticCandidates(
    query: string,
    queryEmbedding: number[],
    kind: QueryKind,
    evidence: Map<string, PaperEvidence>,
    limit: number,
  ): Promise<void> {
    if (!searchUnitIndex.isInitialized()) return;
    const hits = searchUnitIndex.searchKNN(queryEmbedding, 40);
    const units = await this.papersRepository.findSearchUnitsByIds(hits.map((hit) => hit.unitId));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    hits.forEach((hit, index) => {
      const unit = unitById.get(hit.unitId);
      if (!unit) return;
      const score = 1 - hit.distance;
      if (score < unitThreshold(kind)) return;
      pushCandidate(
        evidence,
        {
          paperId: unit.paperId,
          rank: index + 1,
          score,
          signal: unit.unitType === 'sentence' ? 'sentence' : unit.unitType,
          snippet: unit.contentPreview,
          channel: 'unit',
        },
        mapPaper(unit.paper),
      );
    });
  }

  private async collectChunkCandidates(
    query: string,
    queryEmbedding: number[],
    kind: QueryKind,
    evidence: Map<string, PaperEvidence>,
    limit: number,
  ): Promise<void> {
    const k = kind === 'long_query' ? 60 : 40;
    let hits: Array<{ chunkId: string; distance: number }> = [];

    if (vecIndex.isInitialized()) {
      try {
        hits = vecIndex.searchKNN(queryEmbedding, Math.max(k, limit * 3));
      } catch (err) {
        console.warn('[semantic-search] vec KNN search failed, chunk support skipped:', err);
      }
    }
    if (hits.length === 0) return;

    const chunks = await this.papersRepository.findChunksByIds(hits.map((hit) => hit.chunkId));
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    hits.forEach((hit, index) => {
      const chunk = chunkById.get(hit.chunkId);
      if (!chunk) return;
      const score = 1 - hit.distance;
      if (score < chunkThreshold(kind)) return;
      if (kind === 'single_term') {
        const chunkText =
          `${chunk.paper.title} ${chunk.paper.abstract ?? ''} ${chunk.content}`.toLowerCase();
        const token = normalizeWhitespace(query).toLowerCase();
        if (!chunkText.includes(token)) return;
      }
      pushCandidate(
        evidence,
        {
          paperId: chunk.paperId,
          rank: index + 1,
          score,
          signal: 'chunk',
          snippet: chunk.contentPreview,
          channel: 'chunk',
        },
        mapPaper(chunk.paper),
      );
    });
  }
}
