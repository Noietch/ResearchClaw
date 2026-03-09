import { PapersRepository, RecommendationsRepository } from '@db';
import { PapersService } from './papers.service';
import { DownloadService } from './download.service';
import type { RecommendationItem } from '@shared';
import { SemanticScholarRecommendationSource } from './recommendation-sources/semantic-scholar-source';
import { ArxivRecommendationSource } from './recommendation-sources/arxiv-source';
import {
  normalizeTitle,
  type ExternalRecommendationCandidate,
} from './recommendation-sources/shared';

interface WeightedSignal {
  name: string;
  score: number;
}

interface InterestProfile {
  keywordQueries: string[];
  seedTitles: string[];
  tagWeights: WeightedSignal[];
  authorWeights: WeightedSignal[];
  positiveFeedbackTags: WeightedSignal[];
  negativeFeedbackTags: WeightedSignal[];
  positiveFeedbackAuthors: WeightedSignal[];
}

interface ScoredCandidate {
  persistedCandidate: { id: string };
  score: number;
  relevanceScore: number;
  freshnessScore: number;
  noveltyScore: number;
  qualityScore: number;
  feedbackBoost: number;
  reason: string;
  triggerPaperTitle: string | null;
}

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

    const [semanticKeywordCandidates, semanticSeedCandidates, arxivCandidates] = await Promise.all([
      this.semanticScholar.searchByKeywords(profile.keywordQueries, 8),
      this.semanticScholar.searchBySeedTitles(profile.seedTitles, 4),
      this.arxiv.searchByKeywords(profile.keywordQueries, 6),
    ]);

    const deduped = await this.dedupeCandidates([
      ...semanticKeywordCandidates,
      ...semanticSeedCandidates,
      ...arxivCandidates,
    ]);

    const scored = deduped
      .map((candidate) => this.scoreCandidate(candidate, profile, generatedAt))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

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
        reason: item.reason,
        triggerPaperTitle: item.triggerPaperTitle,
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
      reason: row.reason,
      triggerPaperTitle: row.triggerPaperTitle,
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
      const baseWeight = row.action === 'saved' ? 3 : row.action === 'opened' ? 1 : -3;

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
    const seedTitles = sortedBySignal
      .slice(0, 5)
      .map((paper) => paper.title)
      .filter(Boolean);

    const keywordQueries = [
      [...topTags.slice(0, 2), ...feedbackTags.slice(0, 1)].map((item) => item.name).join(' '),
      topTags
        .slice(0, 2)
        .map((item) => item.name)
        .join(' ') + (topAuthors[0]?.name ? ` ${topAuthors[0].name}` : ''),
      feedbackAuthors[0]?.name
        ? `${feedbackAuthors[0].name} ${feedbackTags[0]?.name ?? ''}`.trim()
        : '',
      seedTitles[0] ?? '',
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      keywordQueries: keywordQueries.length > 0 ? keywordQueries : ['machine learning'],
      seedTitles,
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
    const triggerPaperTitle = this.findTriggerPaperTitle(candidate, profile);
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

    const score =
      0.4 * relevanceScore +
      0.2 * freshnessScore +
      0.18 * noveltyScore +
      0.14 * qualityScore +
      0.08 * Math.max(0, feedbackBoost * 5 + 0.5);

    const reason = this.buildReason(candidate, profile, {
      freshnessScore,
      qualityScore,
      positiveFeedbackTagMatch,
      positiveFeedbackAuthorMatch,
      negativeFeedbackTagMatch,
    });

    return {
      ...candidate,
      score: score + feedbackBoost,
      relevanceScore,
      freshnessScore,
      noveltyScore,
      qualityScore,
      feedbackBoost,
      reason,
      triggerPaperTitle,
    };
  }

  private findTriggerPaperTitle(
    candidate: ExternalRecommendationCandidate,
    profile: InterestProfile,
  ): string | null {
    const candidateText = `${candidate.title} ${candidate.abstract ?? ''}`.toLowerCase();
    const trigger = profile.seedTitles.find((seedTitle) => {
      const seedWords = normalizeTitle(seedTitle)
        .split(' ')
        .filter((word) => word.length >= 4);
      return seedWords.some((word) => candidateText.includes(word));
    });
    return trigger ?? profile.seedTitles[0] ?? null;
  }

  private buildReason(
    candidate: ExternalRecommendationCandidate,
    profile: InterestProfile,
    matches: {
      freshnessScore: number;
      qualityScore: number;
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

    if (matches.freshnessScore > 0.7) {
      return 'Recent paper in the topic areas you have been reading lately.';
    }

    if (matches.qualityScore > 0.6) {
      return 'Well-cited paper that overlaps with your current research interests.';
    }

    const seedTitle = profile.seedTitles[0];
    if (seedTitle) {
      return `Related to papers you recently read, such as ${seedTitle}.`;
    }

    return 'Recommended from your library activity and topic signals.';
  }
}
