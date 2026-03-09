import { PapersRepository, RecommendationsRepository } from '@db';
import { PapersService } from './papers.service';
import { DownloadService } from './download.service';
import type { RecommendationFeedbackAction, RecommendationItem } from '@shared';
import { SemanticScholarRecommendationSource } from './recommendation-sources/semantic-scholar-source';
import { ArxivRecommendationSource } from './recommendation-sources/arxiv-source';
import {
  normalizeTitle,
  type ExternalRecommendationCandidate,
} from './recommendation-sources/shared';
import { localSemanticService } from './local-semantic.service';
import { getSemanticSearchSettings } from '../store/app-settings-store';
import { cosineSimilarity } from './semantic-utils';

interface WeightedSignal {
  name: string;
  score: number;
}

interface InterestProfile {
  keywordQueries: string[];
  seedPapers: Array<{ id: string; title: string; abstract?: string | null; tagNames: string[] }>;
  tagWeights: WeightedSignal[];
  authorWeights: WeightedSignal[];
  positiveFeedbackTags: WeightedSignal[];
  negativeFeedbackTags: WeightedSignal[];
  positiveFeedbackAuthors: WeightedSignal[];
}

interface SemanticCandidateContext {
  semanticScore: number;
  triggerPaper: InterestProfile['seedPapers'][number] | null;
  candidateEmbedding: number[] | null;
}

interface ScoredCandidate {
  persistedCandidate: { id: string };
  candidateEmbedding: number[] | null;
  score: number;
  relevanceScore: number;
  freshnessScore: number;
  noveltyScore: number;
  qualityScore: number;
  semanticScore: number;
  feedbackBoost: number;
  reason: string;
  explorationNote: string | null;
  triggerPaperTitle: string | null;
  triggerPaperId: string | null;
}

const QUERY_STOP_WORDS = new Set([
  'about',
  'after',
  'attention',
  'between',
  'from',
  'into',
  'need',
  'over',
  'paper',
  'sequence',
  'such',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'using',
  'with',
]);

const BASE_NOVELTY_PENALTY_WEIGHT = 0.14;
const HIGH_SIMILARITY_THRESHOLD = 0.88;

const HYBRID_WEIGHTS = {
  relevance: 0.35,
  semantic: 0.25,
  freshness: 0.15,
  novelty: 0.12,
  quality: 0.08,
  feedback: 0.05,
} as const;

export class RecommendationService {
  private papersRepository = new PapersRepository();
  private recommendationsRepository = new RecommendationsRepository();
  private papersService = new PapersService();
  private downloadService = new DownloadService();
  private semanticScholar = new SemanticScholarRecommendationSource();
  private arxiv = new ArxivRecommendationSource();

  async generateRecommendations(limit = 20): Promise<{ generatedAt: string; count: number }> {
    const profile = await this.buildInterestProfile();
    const generatedAt = new Date();

    const semanticExpansionQueries = await this.buildSemanticExpansionQueries(profile);

    const [
      semanticKeywordCandidates,
      semanticExpansionCandidates,
      semanticSeedCandidates,
      arxivCandidates,
      arxivExpansionCandidates,
    ] = await Promise.all([
      this.semanticScholar.searchByKeywords(profile.keywordQueries, 8),
      semanticExpansionQueries.length > 0
        ? this.semanticScholar.searchByKeywords(semanticExpansionQueries, 5)
        : Promise.resolve([]),
      this.semanticScholar.searchBySeedTitles(
        profile.seedPapers.map((paper) => paper.title),
        4,
      ),
      this.arxiv.searchByKeywords(profile.keywordQueries, 6),
      semanticExpansionQueries.length > 0
        ? this.arxiv.searchByKeywords(semanticExpansionQueries, 4)
        : Promise.resolve([]),
    ]);

    const deduped = await this.dedupeCandidates([
      ...semanticKeywordCandidates,
      ...semanticExpansionCandidates,
      ...semanticSeedCandidates,
      ...arxivCandidates,
      ...arxivExpansionCandidates,
    ]);
    const semanticContext = await this.computeSemanticContext(deduped, profile);

    const scored = this.diversifyScoredCandidates(
      deduped
        .map((candidate) =>
          this.scoreCandidate(
            candidate,
            profile,
            generatedAt,
            semanticContext.get(candidate.persistedCandidate.id) ?? {
              semanticScore: 0,
              triggerPaper: null,
              candidateEmbedding: null,
            },
          ),
        )
        .sort((a, b) => b.score - a.score),
      limit,
    );

    const statusMap = await this.recommendationsRepository.getStatusMap(
      scored.map((item) => item.persistedCandidate.id),
    );

    for (const item of scored) {
      const currentStatus = statusMap.get(item.persistedCandidate.id);
      await this.recommendationsRepository.upsertResult({
        candidateId: item.persistedCandidate.id,
        score: item.score,
        relevanceScore: item.relevanceScore,
        freshnessScore: item.freshnessScore,
        noveltyScore: item.noveltyScore,
        qualityScore: item.qualityScore,
        semanticScore: item.semanticScore,
        reason: item.reason,
        explorationNote: item.explorationNote,
        triggerPaperTitle: item.triggerPaperTitle,
        triggerPaperId: item.triggerPaperId,
        status: currentStatus === 'ignored' || currentStatus === 'saved' ? currentStatus : 'new',
        generatedAt,
      });
    }

    return { generatedAt: generatedAt.toISOString(), count: scored.length };
  }

  async listRecommendations(filter?: {
    status?: 'new' | 'ignored' | 'saved';
  }): Promise<RecommendationItem[]> {
    const rows = await this.recommendationsRepository.listResults(filter);
    return rows.map((row) => ({
      candidateId: row.candidateId,
      title: row.candidate.title,
      authors: JSON.parse(row.candidate.authorsJson) as string[],
      abstract: row.candidate.abstract,
      source: row.candidate.source as RecommendationItem['source'],
      sourceUrl: row.candidate.sourceUrl,
      pdfUrl: row.candidate.pdfUrl,
      publishedAt: row.candidate.publishedAt?.toISOString() ?? null,
      venue: row.candidate.venue,
      citationCount: row.candidate.citationCount,
      score: row.score,
      relevanceScore: row.relevanceScore,
      freshnessScore: row.freshnessScore,
      noveltyScore: row.noveltyScore,
      qualityScore: row.qualityScore,
      semanticScore: row.semanticScore,
      reason: row.reason,
      explorationNote: row.explorationNote,
      triggerPaperTitle: row.triggerPaperTitle,
      triggerPaperId: row.triggerPaperId,
      status: row.status as RecommendationItem['status'],
      generatedAt: row.generatedAt.toISOString(),
      isInLibrary: row.status === 'saved',
    }));
  }

  async ignoreRecommendation(candidateId: string): Promise<void> {
    await this.recommendationsRepository.markStatus(candidateId, 'ignored');
    await this.recommendationsRepository.createFeedback(candidateId, 'ignored');
  }

  async trackRecommendationOpen(candidateId: string): Promise<void> {
    await this.recommendationsRepository.createFeedback(candidateId, 'opened');
  }

  async trackRecommendationPreference(
    candidateId: string,
    action: Extract<RecommendationFeedbackAction, 'more_like_this' | 'less_like_this'>,
  ): Promise<void> {
    if (action === 'less_like_this') {
      await this.recommendationsRepository.markStatus(candidateId, 'ignored');
    }
    await this.recommendationsRepository.createFeedback(candidateId, action);
  }

  async saveRecommendation(candidateId: string) {
    const candidate = await this.recommendationsRepository.findCandidateById(candidateId);
    if (!candidate) throw new Error(`Recommendation candidate not found: ${candidateId}`);

    let paper;
    const sourceUrl = candidate.sourceUrl ?? undefined;
    const inputForDownload = candidate.arxivId ?? sourceUrl ?? candidate.pdfUrl ?? undefined;
    const looksLikeArxiv = !!candidate.arxivId || !!sourceUrl?.includes('arxiv.org');

    if (looksLikeArxiv && inputForDownload) {
      const result = await this.downloadService.downloadFromInput(inputForDownload, [
        'recommended',
      ]);
      paper = result.paper;
    } else {
      paper = await this.papersService.create({
        title: candidate.title,
        source: candidate.source === 'arxiv' ? 'arxiv' : 'manual',
        sourceUrl,
        tags: ['recommended'],
        authors: candidate.authors,
        abstract: candidate.abstract ?? undefined,
        submittedAt: candidate.publishedAt ?? undefined,
        pdfUrl: candidate.pdfUrl ?? undefined,
      });
      if (candidate.pdfUrl) {
        await this.downloadService.downloadPdfById(paper.id, candidate.pdfUrl).catch(() => null);
      }
    }

    await this.recommendationsRepository.markStatus(candidateId, 'saved');
    await this.recommendationsRepository.createFeedback(candidateId, 'saved');
    return paper;
  }

  private async buildInterestProfile(): Promise<InterestProfile> {
    const papers = await this.papersRepository.list({});
    const tagScores = new Map<string, number>();
    const authorScores = new Map<string, number>();

    const sortedBySignal = [...papers].sort((a, b) => {
      const left = new Date(a.lastReadAt ?? a.createdAt ?? 0).getTime();
      const right = new Date(b.lastReadAt ?? b.createdAt ?? 0).getTime();
      return right - left;
    });

    for (const paper of sortedBySignal) {
      const recentBoost = paper.lastReadAt ? 3 : 1;
      const noteBoost = paper.readingNotes?.length ? 2 : 0;
      const ratingBoost = typeof paper.rating === 'number' ? Math.max(0, paper.rating - 2) : 0;
      const weight = recentBoost + noteBoost + ratingBoost;

      for (const tag of paper.tagNames ?? []) {
        tagScores.set(tag, (tagScores.get(tag) ?? 0) + weight);
      }
      for (const author of paper.authors ?? []) {
        authorScores.set(author, (authorScores.get(author) ?? 0) + weight);
      }
    }

    const feedback = await this.recommendationsRepository.listRecentFeedback();
    const positiveFeedbackTags = new Map<string, number>();
    const negativeFeedbackTags = new Map<string, number>();
    const positiveFeedbackAuthors = new Map<string, number>();

    for (const row of feedback) {
      const authors = JSON.parse(row.candidate.authorsJson) as string[];
      const text = `${row.candidate.title} ${row.candidate.abstract ?? ''}`.toLowerCase();
      const baseWeight =
        row.action === 'saved'
          ? 3
          : row.action === 'more_like_this'
            ? 4
            : row.action === 'opened'
              ? 1
              : row.action === 'less_like_this'
                ? -4
                : -3;

      for (const [tagName] of tagScores.entries()) {
        if (!text.includes(tagName.toLowerCase())) continue;
        if (baseWeight > 0) {
          positiveFeedbackTags.set(tagName, (positiveFeedbackTags.get(tagName) ?? 0) + baseWeight);
        } else {
          negativeFeedbackTags.set(
            tagName,
            (negativeFeedbackTags.get(tagName) ?? 0) + Math.abs(baseWeight),
          );
        }
      }

      if (baseWeight > 0) {
        for (const author of authors) {
          positiveFeedbackAuthors.set(
            author,
            (positiveFeedbackAuthors.get(author) ?? 0) + baseWeight,
          );
        }
      }
    }

    const topTags = this.topSignals(tagScores, 6);
    const topAuthors = this.topSignals(authorScores, 4);
    const feedbackTags = this.topSignals(positiveFeedbackTags, 4);
    const feedbackAuthors = this.topSignals(positiveFeedbackAuthors, 3);
    const feedbackAvoidTags = this.topSignals(negativeFeedbackTags, 4);
    const seedPapers = sortedBySignal
      .slice(0, 5)
      .filter((paper) => !!paper.title)
      .map((paper) => ({
        id: paper.id,
        title: paper.title,
        abstract: paper.abstract ?? null,
        tagNames: paper.tagNames ?? [],
      }));

    const keywordQueries = [
      [...topTags.slice(0, 2), ...feedbackTags.slice(0, 1)].map((item) => item.name).join(' '),
      topTags
        .slice(0, 2)
        .map((item) => item.name)
        .join(' ') + (topAuthors[0]?.name ? ` ${topAuthors[0].name}` : ''),
      feedbackAuthors[0]?.name
        ? `${feedbackAuthors[0].name} ${feedbackTags[0]?.name ?? ''}`.trim()
        : '',
      seedPapers[0]?.title ?? '',
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      keywordQueries: keywordQueries.length > 0 ? keywordQueries : ['machine learning'],
      seedPapers,
      tagWeights: topTags,
      authorWeights: topAuthors,
      positiveFeedbackTags: feedbackTags,
      negativeFeedbackTags: feedbackAvoidTags,
      positiveFeedbackAuthors: feedbackAuthors,
    };
  }

  private topSignals(scores: Map<string, number>, limit: number): WeightedSignal[] {
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, score]) => ({ name, score }));
  }

  private async dedupeCandidates(candidates: ExternalRecommendationCandidate[]) {
    const localPapers = await this.papersRepository.listAll();
    const localShortIds = new Set(localPapers.map((paper) => paper.shortId.toLowerCase()));
    const localTitles = new Set(localPapers.map((paper) => normalizeTitle(paper.title)));
    const localUrls = new Set(
      localPapers.map((paper) => paper.sourceUrl?.toLowerCase()).filter(Boolean),
    );

    const seen = new Set<string>();
    const kept: Array<
      ExternalRecommendationCandidate & {
        persistedCandidate: Awaited<ReturnType<RecommendationsRepository['upsertCandidate']>>;
      }
    > = [];

    for (const candidate of candidates) {
      const titleNormalized = normalizeTitle(candidate.title);
      const dedupeKey =
        candidate.doi?.toLowerCase() ||
        candidate.arxivId?.toLowerCase() ||
        `${candidate.source}:${candidate.externalId}` ||
        titleNormalized;
      if (!candidate.title.trim() || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const arxivId = candidate.arxivId?.toLowerCase();
      const sourceUrl = candidate.sourceUrl?.toLowerCase();
      if (
        (arxivId && localShortIds.has(arxivId)) ||
        localTitles.has(titleNormalized) ||
        (sourceUrl && localUrls.has(sourceUrl))
      ) {
        continue;
      }

      const persistedCandidate = await this.recommendationsRepository.upsertCandidate({
        source: candidate.source,
        externalId: candidate.externalId,
        arxivId: candidate.arxivId,
        doi: candidate.doi,
        title: candidate.title,
        titleNormalized,
        authors: candidate.authors,
        abstract: candidate.abstract,
        sourceUrl: candidate.sourceUrl,
        pdfUrl: candidate.pdfUrl,
        publishedAt: candidate.publishedAt,
        venue: candidate.venue,
        citationCount: candidate.citationCount,
        metadata: candidate.metadata,
      });

      kept.push({ ...candidate, persistedCandidate });
    }

    return kept;
  }

  private scoreCandidate(
    candidate: ExternalRecommendationCandidate & { persistedCandidate: { id: string } },
    profile: InterestProfile,
    now: Date,
    semanticContext: SemanticCandidateContext,
  ): ScoredCandidate {
    const haystack = [candidate.title, candidate.abstract ?? '', candidate.venue ?? '']
      .join(' ')
      .toLowerCase();

    let relevanceHits = 0;
    for (const tag of profile.tagWeights) {
      if (haystack.includes(tag.name.toLowerCase())) relevanceHits += tag.score;
    }
    for (const author of profile.authorWeights) {
      if (candidate.authors.some((name) => name.toLowerCase() === author.name.toLowerCase())) {
        relevanceHits += author.score + 2;
      }
    }
    const relevanceScore = Math.min(1, relevanceHits / 12);

    const ageDays = candidate.publishedAt
      ? Math.max(0, (now.getTime() - candidate.publishedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 365;
    const freshnessScore = Math.max(0, Math.min(1, 1 - ageDays / 365));

    const overlapCount = profile.tagWeights
      .slice(0, 3)
      .filter((tag) => haystack.includes(tag.name.toLowerCase())).length;
    const noveltyScore = Math.max(0.1, 1 - overlapCount * 0.22);

    const qualityBase =
      (candidate.citationCount ?? 0) >= 100 ? 1 : (candidate.citationCount ?? 0) / 100;
    const qualityScore = Math.min(
      1,
      qualityBase * 0.7 + (candidate.abstract ? 0.2 : 0) + (candidate.venue ? 0.1 : 0),
    );

    const positiveFeedbackTagMatch = profile.positiveFeedbackTags.find((tag) =>
      haystack.includes(tag.name.toLowerCase()),
    );
    const semanticScore = semanticContext.semanticScore;
    const triggerPaper = semanticContext.triggerPaper ?? this.findTriggerPaper(candidate, profile);
    const negativeFeedbackTagMatch = profile.negativeFeedbackTags.find((tag) =>
      haystack.includes(tag.name.toLowerCase()),
    );
    const positiveFeedbackAuthorMatch = profile.positiveFeedbackAuthors.find((author) =>
      candidate.authors.some((name) => name.toLowerCase() === author.name.toLowerCase()),
    );

    const feedbackBoost = Math.max(
      -0.15,
      Math.min(
        0.15,
        (positiveFeedbackTagMatch ? 0.08 : 0) +
          (positiveFeedbackAuthorMatch ? 0.07 : 0) -
          (negativeFeedbackTagMatch ? 0.12 : 0),
      ),
    );

    const feedbackScore = Math.max(0, Math.min(1, feedbackBoost * 5 + 0.5));
    const score =
      HYBRID_WEIGHTS.relevance * relevanceScore +
      HYBRID_WEIGHTS.semantic * semanticScore +
      HYBRID_WEIGHTS.freshness * freshnessScore +
      HYBRID_WEIGHTS.novelty * noveltyScore +
      HYBRID_WEIGHTS.quality * qualityScore +
      HYBRID_WEIGHTS.feedback * feedbackScore;

    const reason = this.buildReason(candidate, profile, {
      freshnessScore,
      qualityScore,
      semanticScore,
      positiveFeedbackTagMatch,
      positiveFeedbackAuthorMatch,
      negativeFeedbackTagMatch,
    });

    return {
      ...candidate,
      candidateEmbedding: semanticContext.candidateEmbedding,
      score,
      relevanceScore,
      freshnessScore,
      noveltyScore,
      qualityScore,
      semanticScore,
      feedbackBoost,
      reason,
      explorationNote: this.buildExplorationNote({ noveltyScore, semanticScore }),
      triggerPaperTitle: triggerPaper?.title ?? null,
      triggerPaperId: triggerPaper?.id ?? null,
    };
  }

  private async buildSemanticExpansionQueries(profile: InterestProfile): Promise<string[]> {
    if (profile.seedPapers.length === 0 || !localSemanticService.isEnabled()) return [];

    const seedTexts = profile.seedPapers
      .map((paper) => this.buildSeedPaperSemanticText(paper))
      .filter(Boolean)
      .slice(0, 4);
    if (seedTexts.length === 0) return [];

    try {
      const embeddings = await localSemanticService.embedTexts(seedTexts);
      const interestEmbedding = this.averageEmbeddings(embeddings);
      if (!interestEmbedding) return [];

      const rankedSeeds = profile.seedPapers
        .slice(0, seedTexts.length)
        .map((paper, index) => ({
          paper,
          similarity: this.normalizeSemanticScore(
            cosineSimilarity(interestEmbedding, embeddings[index] ?? []),
          ),
        }))
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 2);

      return rankedSeeds
        .map(({ paper }) => this.buildExpansionQueryFromSeed(paper))
        .filter(Boolean)
        .filter((query, index, all) => all.indexOf(query) === index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[recommendations] Semantic expansion unavailable:', message);
      return [];
    }
  }

  private buildExpansionQueryFromSeed(seedPaper: InterestProfile['seedPapers'][number]): string {
    const titleTerms = normalizeTitle(seedPaper.title)
      .split(' ')
      .filter((term) => term.length >= 4 && !QUERY_STOP_WORDS.has(term))
      .slice(0, 2);
    const abstractTerms = normalizeTitle(seedPaper.abstract ?? '')
      .split(' ')
      .filter((term) => term.length >= 4 && !QUERY_STOP_WORDS.has(term))
      .slice(0, 2);
    const tagTerms = seedPaper.tagNames
      .map((tag) => normalizeTitle(tag))
      .flatMap((tag) => tag.split(' '))
      .filter((term) => term.length >= 4 && !QUERY_STOP_WORDS.has(term))
      .slice(0, 2);

    return [...titleTerms, ...abstractTerms, ...tagTerms]
      .filter((term, index, all) => all.indexOf(term) === index)
      .join(' ');
  }

  private async computeSemanticContext(
    candidates: Array<ExternalRecommendationCandidate & { persistedCandidate: { id: string } }>,
    profile: InterestProfile,
  ): Promise<Map<string, SemanticCandidateContext>> {
    const scores = new Map<string, SemanticCandidateContext>();
    if (
      candidates.length === 0 ||
      profile.seedPapers.length === 0 ||
      !localSemanticService.isEnabled()
    ) {
      return scores;
    }

    const semanticSeeds = profile.seedPapers.slice(0, 3);
    const seedTexts = semanticSeeds
      .map((paper) => this.buildSeedPaperSemanticText(paper))
      .filter(Boolean)
      .slice(0, 3);
    const candidateTexts = candidates.map((candidate) =>
      this.buildCandidateSemanticText(candidate),
    );
    if (seedTexts.length === 0 || candidateTexts.length === 0) return scores;

    try {
      const embeddings = await localSemanticService.embedTexts([...seedTexts, ...candidateTexts]);
      const seedEmbeddings = embeddings.slice(0, seedTexts.length);
      const candidateEmbeddings = embeddings.slice(seedTexts.length);
      const interestEmbedding = this.averageEmbeddings(seedEmbeddings);
      if (!interestEmbedding) return scores;

      candidateEmbeddings.forEach((embedding, index) => {
        const similarity = cosineSimilarity(interestEmbedding, embedding);
        let bestSeed: InterestProfile['seedPapers'][number] | null = null;
        let bestSeedSimilarity = -1;

        seedEmbeddings.forEach((seedEmbedding, seedIndex) => {
          const seedSimilarity = cosineSimilarity(seedEmbedding, embedding);
          if (seedSimilarity > bestSeedSimilarity) {
            bestSeedSimilarity = seedSimilarity;
            bestSeed = semanticSeeds[seedIndex] ?? null;
          }
        });

        scores.set(candidates[index].persistedCandidate.id, {
          semanticScore: this.normalizeSemanticScore(similarity),
          triggerPaper: this.normalizeSemanticScore(bestSeedSimilarity) >= 0.35 ? bestSeed : null,
          candidateEmbedding: Array.isArray(embedding) && embedding.length > 0 ? embedding : null,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[recommendations] Semantic rerank unavailable:', message);
    }

    return scores;
  }

  private diversifyScoredCandidates(scored: ScoredCandidate[], limit: number): ScoredCandidate[] {
    if (scored.length <= limit) return scored;

    const groups = new Map<string, ScoredCandidate[]>();
    for (const item of scored) {
      const key = item.triggerPaperId ?? `source:${item.source}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(item);
      groups.set(key, bucket);
    }

    const selected: ScoredCandidate[] = [];
    while (selected.length < limit) {
      const rankedGroups = [...groups.entries()]
        .filter(([, items]) => items.length > 0)
        .map(([key, items]) => ({ key, items }))
        .sort(
          (left, right) =>
            this.adjustedCandidateScore(right.items[0], selected) -
            this.adjustedCandidateScore(left.items[0], selected),
        );
      if (rankedGroups.length === 0) break;

      for (const group of rankedGroups) {
        const bestIndex = this.findBestCandidateIndex(group.items, selected);
        const [next] = group.items.splice(bestIndex, 1);
        if (!next) continue;
        selected.push(next);
        if (selected.length >= limit) break;
      }
    }

    return selected;
  }

  private findBestCandidateIndex(
    candidates: ScoredCandidate[],
    selected: ScoredCandidate[],
  ): number {
    let bestIndex = 0;
    let bestScore = -Infinity;

    candidates.forEach((candidate, index) => {
      const adjusted = this.adjustedCandidateScore(candidate, selected);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  private adjustedCandidateScore(candidate: ScoredCandidate, selected: ScoredCandidate[]): number {
    if (selected.length === 0 || !candidate.candidateEmbedding) return candidate.score;

    const maxSimilarity = selected.reduce((currentMax, item) => {
      if (!item.candidateEmbedding) return currentMax;
      return Math.max(
        currentMax,
        cosineSimilarity(candidate.candidateEmbedding ?? [], item.candidateEmbedding),
      );
    }, -1);

    const exploration = this.getRecommendationExploration();
    const penaltyWeight = BASE_NOVELTY_PENALTY_WEIGHT * (0.5 + exploration);
    const penalty = maxSimilarity >= HIGH_SIMILARITY_THRESHOLD ? maxSimilarity * penaltyWeight : 0;
    return candidate.score - penalty;
  }

  private getRecommendationExploration(): number {
    const value = getSemanticSearchSettings().recommendationExploration;
    if (!Number.isFinite(value)) return 0.35;
    return Math.max(0, Math.min(1, value));
  }

  private buildExplorationNote(metrics: {
    noveltyScore: number;
    semanticScore: number;
  }): string | null {
    const exploration = this.getRecommendationExploration();
    if (exploration >= 0.7 && metrics.noveltyScore >= 0.65) {
      return 'Exploration is turned up, so this more novel paper is being surfaced alongside your strongest matches.';
    }
    if (exploration <= 0.2 && metrics.semanticScore >= 0.75) {
      return 'Exploration is kept focused, so very close semantic matches are preferred.';
    }
    return null;
  }

  private buildSeedPaperSemanticText(seedPaper: InterestProfile['seedPapers'][number]): string {
    return [seedPaper.title, seedPaper.abstract ?? '', seedPaper.tagNames.join(' ')]
      .join(' ')
      .trim();
  }

  private buildCandidateSemanticText(candidate: ExternalRecommendationCandidate): string {
    return [candidate.title, candidate.abstract ?? '', candidate.venue ?? ''].join(' ').trim();
  }

  private averageEmbeddings(embeddings: number[][]): number[] | null {
    if (embeddings.length === 0) return null;
    const valid = embeddings.filter(
      (embedding) => Array.isArray(embedding) && embedding.length > 0,
    );
    if (valid.length === 0) return null;

    const dimension = valid[0].length;
    const compatible = valid.filter((embedding) => embedding.length === dimension);
    if (compatible.length === 0) return null;

    const total = new Array<number>(dimension).fill(0);
    for (const embedding of compatible) {
      for (let index = 0; index < dimension; index += 1) {
        total[index] += embedding[index];
      }
    }

    return total.map((value) => value / compatible.length);
  }

  private normalizeSemanticScore(similarity: number): number {
    if (!Number.isFinite(similarity) || similarity < 0) return 0;
    return Math.max(0, Math.min(1, similarity));
  }

  private findTriggerPaper(
    candidate: ExternalRecommendationCandidate,
    profile: InterestProfile,
  ): { id: string; title: string } | null {
    const candidateText = `${candidate.title} ${candidate.abstract ?? ''}`.toLowerCase();
    const trigger = profile.seedPapers.find((seedPaper) => {
      const seedWords = normalizeTitle(seedPaper.title)
        .split(' ')
        .filter((word) => word.length >= 4);
      return seedWords.some((word) => candidateText.includes(word));
    });
    return trigger ?? profile.seedPapers[0] ?? null;
  }

  private buildReason(
    candidate: ExternalRecommendationCandidate,
    profile: InterestProfile,
    matches: {
      freshnessScore: number;
      qualityScore: number;
      semanticScore: number;
      positiveFeedbackTagMatch?: WeightedSignal;
      positiveFeedbackAuthorMatch?: WeightedSignal;
      negativeFeedbackTagMatch?: WeightedSignal;
    },
  ): string {
    if (matches.positiveFeedbackAuthorMatch) {
      return `You previously opened or saved papers by ${matches.positiveFeedbackAuthorMatch.name}, so this author gets a boost.`;
    }

    if (matches.positiveFeedbackTagMatch) {
      return `You recently engaged with recommendations around ${matches.positiveFeedbackTagMatch.name}, so this topic is ranked higher.`;
    }

    const topMatchingTag = profile.tagWeights.find((tag) =>
      `${candidate.title} ${candidate.abstract ?? ''}`
        .toLowerCase()
        .includes(tag.name.toLowerCase()),
    );
    if (topMatchingTag) {
      return `Because you often read papers tagged ${topMatchingTag.name}.`;
    }

    const matchingAuthor = profile.authorWeights.find((author) =>
      candidate.authors.some((name) => name.toLowerCase() === author.name.toLowerCase()),
    );
    if (matchingAuthor) {
      return `New paper from an author you follow: ${matchingAuthor.name}.`;
    }

    if (matches.negativeFeedbackTagMatch) {
      return `This still overlaps with your interests, but similar papers tagged ${matches.negativeFeedbackTagMatch.name} were deprioritized before.`;
    }

    if (matches.semanticScore >= 0.72) {
      return 'Semantically close to papers you recently read.';
    }

    if (matches.freshnessScore > 0.7) {
      return 'Recent paper in the topic areas you have been reading lately.';
    }

    if (matches.qualityScore > 0.6) {
      return 'Well-cited paper that overlaps with your current research interests.';
    }

    const seedTitle = profile.seedPapers[0]?.title;
    if (seedTitle) {
      return `Related to papers you recently read, such as ${seedTitle}.`;
    }

    return 'Recommended from your library activity and topic signals.';
  }
}
