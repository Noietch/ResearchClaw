import { getPrismaClient } from '../client';

export interface UpsertRecommendationCandidateInput {
  source: string;
  externalId: string;
  arxivId?: string | null;
  doi?: string | null;
  title: string;
  titleNormalized: string;
  authors: string[];
  abstract?: string | null;
  sourceUrl?: string | null;
  pdfUrl?: string | null;
  publishedAt?: Date | null;
  venue?: string | null;
  citationCount?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertRecommendationResultInput {
  candidateId: string;
  score: number;
  relevanceScore: number;
  freshnessScore: number;
  noveltyScore: number;
  qualityScore: number;
  semanticScore?: number | null;
  explorationNote?: string | null;
  reason: string;
  triggerPaperTitle?: string | null;
  triggerPaperId?: string | null;
  status?: string;
  generatedAt: Date;
}

function mapCandidate(candidate: { authorsJson: string; metadataJson: string }) {
  return {
    ...candidate,
    authors: JSON.parse(candidate.authorsJson) as string[],
    metadata: JSON.parse(candidate.metadataJson) as Record<string, unknown>,
  };
}

export class RecommendationsRepository {
  private prisma = getPrismaClient();

  async upsertCandidate(input: UpsertRecommendationCandidateInput) {
    const candidate = await this.prisma.recommendationCandidate.upsert({
      where: {
        source_externalId: {
          source: input.source,
          externalId: input.externalId,
        },
      },
      create: {
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
      },
      update: {
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
      },
    });

    return mapCandidate(candidate);
  }

  async upsertResult(input: UpsertRecommendationResultInput) {
    return this.prisma.recommendationResult.upsert({
      where: { candidateId: input.candidateId },
      create: {
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
      },
      update: {
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
        status: input.status,
        generatedAt: input.generatedAt,
      },
    });
  }

  async listResults(filter?: { status?: string }) {
    return this.prisma.recommendationResult.findMany({
      where: filter?.status ? { status: filter.status } : {},
      include: { candidate: true },
      orderBy: [{ generatedAt: 'desc' }, { score: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async findCandidateById(candidateId: string) {
    const candidate = await this.prisma.recommendationCandidate.findUnique({
      where: { id: candidateId },
    });
    return candidate ? mapCandidate(candidate) : null;
  }

  async markStatus(candidateId: string, status: string) {
    return this.prisma.recommendationResult.update({
      where: { candidateId },
      data: { status },
    });
  }

  async createFeedback(candidateId: string, action: string) {
    return this.prisma.recommendationFeedback.create({
      data: { candidateId, action },
    });
  }

  async getStatusMap(candidateIds: string[]) {
    if (candidateIds.length === 0) return new Map<string, string>();
    const rows = await this.prisma.recommendationResult.findMany({
      where: { candidateId: { in: candidateIds } },
      select: { candidateId: true, status: true },
    });
    return new Map(rows.map((row) => [row.candidateId, row.status]));
  }

  async listRecentFeedback(limit = 120) {
    return this.prisma.recommendationFeedback.findMany({
      include: { candidate: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
