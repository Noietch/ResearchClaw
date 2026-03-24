import { randomUUID } from 'node:crypto';
import {
  matchesNormalSearchQuery,
  type SourceType,
  type TagCategory,
  type CategorizedTag,
} from '@shared';
import { getPrismaClient } from '../client';

export interface CreatePaperParams {
  shortId: string;
  title: string;
  authors: string[];
  source: SourceType;
  sourceUrl?: string;
  submittedAt?: Date | null;
  abstract?: string;
  venue?: string;
  pdfUrl?: string;
  pdfPath?: string;
  doi?: string;
  tags: string[];
  categorizedTags?: CategorizedTag[];
  isTemporary?: boolean;
}

export interface SemanticIndexDebugSummary {
  totalPapers: number;
  indexedPapers: number;
  pendingPapers: number;
  failedPapers: number;
  totalChunks: number;
  recentFailures: Array<{
    id: string;
    shortId: string;
    title: string;
    processingStatus: string;
    processingError: string | null;
    updatedAt: Date;
  }>;
}

function mapPaper<
  T extends { authorsJson: string; tags: Array<{ tag: { name: string; category: string } }> },
>(paper: T) {
  return {
    ...paper,
    authors: JSON.parse(paper.authorsJson) as string[],
    tagNames: paper.tags.map((item) => item.tag.name),
    categorizedTags: paper.tags.map((item) => ({
      name: item.tag.name,
      category: item.tag.category as TagCategory,
    })),
  };
}

export class PapersRepository {
  private prisma = getPrismaClient();

  async create(params: CreatePaperParams) {
    // If categorizedTags provided, use them; otherwise map string[] to {name, category:'topic'}
    const tagInputs: CategorizedTag[] =
      params.categorizedTags && params.categorizedTags.length > 0
        ? params.categorizedTags
        : params.tags.map((name) => ({ name, category: 'topic' as TagCategory }));

    const tags = await Promise.all(
      tagInputs.map((t) =>
        this.prisma.tag.upsert({
          where: { name: t.name },
          create: { name: t.name, category: t.category },
          update: { category: t.category }, // update category if tag exists
        }),
      ),
    );

    const created = await this.prisma.paper.create({
      data: {
        shortId: params.shortId,
        title: params.title,
        authorsJson: JSON.stringify(params.authors),
        source: params.source,
        sourceUrl: params.sourceUrl,
        submittedAt: params.submittedAt,
        abstract: params.abstract,
        venue: params.venue,
        pdfUrl: params.pdfUrl,
        pdfPath: params.pdfPath,
        doi: params.doi,
        isTemporary: params.isTemporary ?? false,
        temporaryImportedAt: params.isTemporary ? new Date() : null,
        tags: {
          create: tags.map((tag) => ({
            tagId: tag.id,
          })),
        },
      },
      include: {
        tags: { include: { tag: true } },
      },
    });

    return mapPaper(created);
  }

  async list(query?: {
    q?: string;
    year?: number;
    tag?: string;
    importedWithin?: 'today' | 'week' | 'month' | 'all';
    temporary?: boolean;
  }) {
    const conditions: Record<string, unknown>[] = [];

    // Filter by temporary status
    if (query?.temporary === true) {
      conditions.push({ isTemporary: true });
      // Reading List only shows papers with downloaded PDFs
      conditions.push({ pdfPath: { not: null } });
    } else {
      conditions.push({ isTemporary: false });
    }

    if (query?.year) {
      conditions.push({
        submittedAt: {
          gte: new Date(`${query.year}-01-01T00:00:00Z`),
          lt: new Date(`${query.year + 1}-01-01T00:00:00Z`),
        },
      });
    }

    if (query?.tag) {
      conditions.push({ tags: { some: { tag: { name: query.tag } } } });
    }

    // Import time filter
    if (query?.importedWithin && query.importedWithin !== 'all') {
      const now = new Date();
      let startDate: Date;
      switch (query.importedWithin) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          break;
        default:
          startDate = new Date(0);
      }
      conditions.push({ createdAt: { gte: startDate } });
    }

    const papers = await this.prisma.paper.findMany({
      where: conditions.length > 0 ? { AND: conditions } : {},
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
      orderBy: [{ lastReadAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });

    const mapped = papers.map((paper) => mapPaper(paper));

    // Post-query filtering: match q against title, authors, tags, venue, and abstract
    if (query?.q) {
      return mapped.filter((paper) => matchesNormalSearchQuery(paper, query.q!));
    }

    return mapped;
  }

  async listPaginated(query?: {
    q?: string;
    year?: number;
    tag?: string;
    importedWithin?: 'today' | 'week' | 'month' | 'all';
    temporary?: boolean;
    page?: number;
    pageSize?: number;
    sortBy?: 'lastRead' | 'importDate' | 'title';
    readingStatus?: 'all' | 'unread' | 'reading' | 'finished';
  }) {
    const page = query?.page ?? 0;
    const pageSize = query?.pageSize ?? 50;
    const conditions: Record<string, unknown>[] = [];

    // Filter by temporary status
    if (query?.temporary === true) {
      conditions.push({ isTemporary: true });
      conditions.push({ pdfPath: { not: null } });
    } else {
      conditions.push({ isTemporary: false });
    }

    if (query?.year) {
      conditions.push({
        submittedAt: {
          gte: new Date(`${query.year}-01-01T00:00:00Z`),
          lt: new Date(`${query.year + 1}-01-01T00:00:00Z`),
        },
      });
    }

    if (query?.tag === '__untagged__') {
      conditions.push({ tags: { none: {} } });
    } else if (query?.tag) {
      conditions.push({ tags: { some: { tag: { name: query.tag } } } });
    }

    // Import time filter
    if (query?.importedWithin && query.importedWithin !== 'all') {
      const now = new Date();
      let startDate: Date;
      switch (query.importedWithin) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          break;
        default:
          startDate = new Date(0);
      }
      conditions.push({ createdAt: { gte: startDate } });
    }

    // Text search filter — match title, authors, venue, or abstract at DB level
    if (query?.q) {
      const q = query.q.trim();
      if (q) {
        conditions.push({
          OR: [
            { title: { contains: q } },
            { authorsJson: { contains: q } },
            { venue: { contains: q } },
            { abstract: { contains: q } },
          ],
        });
      }
    }

    // Reading status filter
    if (query?.readingStatus && query.readingStatus !== 'all') {
      if (query.readingStatus === 'unread') {
        conditions.push({ OR: [{ lastReadPage: null }, { lastReadAt: null }] });
      } else {
        // 'reading' and 'finished' need field-to-field comparison — use raw SQL for IDs
        const op = query.readingStatus === 'reading' ? '<' : '>=';
        const ids = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM Paper WHERE lastReadPage IS NOT NULL AND totalPages IS NOT NULL AND lastReadPage ${op} totalPages`,
        );
        conditions.push({ id: { in: ids.map((r) => r.id) } });
      }
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    // Determine sort order
    let orderBy: Record<string, unknown>[];
    switch (query?.sortBy) {
      case 'importDate':
        orderBy = [{ createdAt: 'desc' }];
        break;
      case 'title':
        orderBy = [{ title: 'asc' }];
        break;
      case 'lastRead':
      default:
        orderBy = [{ lastReadAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
        break;
    }

    const [papers, total] = await Promise.all([
      this.prisma.paper.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          links: true,
          readingNotes: true,
        },
        orderBy,
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.paper.count({ where }),
    ]);

    return {
      papers: papers.map((paper) => mapPaper(paper)),
      total,
      page,
      pageSize,
    };
  }

  async getCounts() {
    const ACTIVE_PROCESSING_STATUSES = [
      'queued',
      'embedding',
      'extracting_text',
      'extracting_metadata',
      'chunking',
    ];

    const [total, untagged, unindexed, missingAbstract, withPdf, years, processing] =
      await Promise.all([
        this.prisma.paper.count({ where: { isTemporary: false } }),
        this.prisma.paper.count({
          where: { isTemporary: false, tags: { none: {} } },
        }),
        this.prisma.paper.count({
          where: {
            isTemporary: false,
            indexedAt: null,
            abstract: { not: '' },
            processingStatus: { notIn: ACTIVE_PROCESSING_STATUSES },
          },
        }),
        this.prisma.paper.count({
          where: {
            isTemporary: false,
            OR: [{ abstract: null }, { abstract: '' }],
            NOT: [{ pdfPath: null, pdfUrl: null }],
          },
        }),
        this.prisma.paper.count({
          where: {
            isTemporary: false,
            NOT: [{ pdfPath: null, pdfUrl: null }],
          },
        }),
        this.prisma.paper.findMany({
          where: { isTemporary: false, submittedAt: { not: null } },
          select: { submittedAt: true },
          distinct: ['submittedAt'],
        }),
        this.prisma.paper.count({
          where: {
            isTemporary: false,
            processingStatus: { in: ACTIVE_PROCESSING_STATUSES },
          },
        }),
      ]);

    // Extract unique years from submittedAt dates
    const yearSet = new Set<number>();
    for (const p of years) {
      if (p.submittedAt) yearSet.add(new Date(p.submittedAt).getUTCFullYear());
    }

    return {
      total,
      untagged,
      unindexed,
      missingAbstract,
      withPdf,
      availableYears: Array.from(yearSet).sort((a, b) => b - a),
      processing,
    };
  }

  async findById(id: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
    });

    if (!paper) {
      return null;
    }

    return mapPaper(paper);
  }

  async findByIds(ids: string[]) {
    const papers = await this.prisma.paper.findMany({
      where: { id: { in: ids } },
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
    });

    return papers.map(mapPaper);
  }

  async count(): Promise<number> {
    return this.prisma.paper.count();
  }

  async findByShortId(shortId: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { shortId },
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
    });

    if (!paper) {
      return null;
    }

    return mapPaper(paper);
  }

  async findByNormalizedTitle(title: string) {
    // Normalize: lowercase, strip extra whitespace and common punctuation
    const normalized = title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized.length < 10) return null;

    // Search for papers with similar titles
    const papers = await this.prisma.paper.findMany({
      where: {
        title: { contains: normalized.substring(0, 80) },
      },
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
      take: 5,
    });

    // Check for high-confidence match (normalized titles match closely)
    for (const paper of papers) {
      const existingNormalized = paper.title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (
        existingNormalized === normalized ||
        existingNormalized.includes(normalized) ||
        normalized.includes(existingNormalized)
      ) {
        return mapPaper(paper);
      }
    }

    return null;
  }

  async findByDoi(doi: string) {
    const paper = await this.prisma.paper.findFirst({
      where: { doi },
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
    });

    if (!paper) return null;
    return mapPaper(paper);
  }

  async updatePdfPath(id: string, pdfPath: string | null) {
    return this.prisma.paper.update({
      where: { id },
      data: { pdfPath },
    });
  }

  async clearPdfPathByFilePath(filePath: string) {
    await this.prisma.paper.updateMany({
      where: { pdfPath: filePath },
      data: { pdfPath: null },
    });
  }

  async updateTags(id: string, tagNames: string[]) {
    // First, get or create all tags
    const tags = await Promise.all(
      tagNames.map((name) =>
        this.prisma.tag.upsert({
          where: { name },
          create: { name },
          update: {},
        }),
      ),
    );

    // Delete existing paper-tag relations
    await this.prisma.paperTag.deleteMany({
      where: { paperId: id },
    });

    // Create new paper-tag relations
    if (tags.length > 0) {
      await this.prisma.paperTag.createMany({
        data: tags.map((tag) => ({
          paperId: id,
          tagId: tag.id,
        })),
      });
    }

    // Return updated paper with tags
    return this.findById(id);
  }

  async listAllTags(): Promise<string[]> {
    const tags = await this.prisma.tag.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return tags.map((t) => t.name);
  }

  async touchLastRead(id: string) {
    return this.prisma.paper.update({
      where: { id },
      data: { lastReadAt: new Date() },
    });
  }

  async updateReadingProgress(id: string, lastReadPage: number, totalPages: number) {
    return this.prisma.paper.update({
      where: { id },
      data: { lastReadPage, totalPages, lastReadAt: new Date() },
    });
  }

  async updateTemporaryStatus(id: string, isTemporary: boolean, temporaryImportedAt?: Date | null) {
    return this.prisma.paper.update({
      where: { id },
      data: {
        isTemporary,
        temporaryImportedAt:
          temporaryImportedAt !== undefined ? temporaryImportedAt : isTemporary ? new Date() : null,
      },
    });
  }

  async updateTitle(id: string, title: string) {
    return this.prisma.paper.update({
      where: { id },
      data: { title },
    });
  }

  async updateRating(id: string, rating: number | null) {
    const updated = await this.prisma.paper.update({
      where: { id },
      data: { rating },
      include: {
        tags: { include: { tag: true } },
      },
    });
    return mapPaper(updated);
  }

  async updateAbstract(id: string, abstract: string) {
    const updated = await this.prisma.paper.update({
      where: { id },
      data: { abstract },
      include: {
        tags: { include: { tag: true } },
      },
    });
    return mapPaper(updated);
  }

  async updateMetadata(
    id: string,
    data: {
      title?: string;
      authors?: string[];
      abstract?: string;
      venue?: string | null;
      submittedAt?: Date | null;
      metadataSource?: string | null;
    },
  ) {
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) {
      updateData.title = data.title;
    }
    if (data.authors !== undefined) {
      updateData.authorsJson = JSON.stringify(data.authors);
    }
    if (data.abstract !== undefined) {
      updateData.abstract = data.abstract;
    }
    if (data.venue !== undefined) {
      updateData.venue = data.venue;
    }
    if (data.submittedAt !== undefined) {
      updateData.submittedAt = data.submittedAt;
    }
    if (data.metadataSource !== undefined) {
      updateData.metadataSource = data.metadataSource;
    }

    const updated = await this.prisma.paper.update({
      where: { id },
      data: updateData,
      include: {
        tags: { include: { tag: true } },
      },
    });
    return mapPaper(updated);
  }

  async listAll() {
    const papers = await this.prisma.paper.findMany({
      select: { id: true, shortId: true, title: true, sourceUrl: true },
    });
    return papers;
  }

  async listAllShortIds(): Promise<Set<string>> {
    const papers = await this.prisma.paper.findMany({
      select: { shortId: true },
    });
    return new Set(papers.map((p) => p.shortId));
  }

  async delete(id: string) {
    return this.prisma.paper.delete({
      where: { id },
    });
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;

    // Use transaction for atomic delete
    // Prisma's deleteMany doesn't cascade, so we need to delete related records first
    const result = await this.prisma.$transaction(async (tx) => {
      // Delete related records in order
      await tx.readingNote.deleteMany({
        where: { paperId: { in: ids } },
      });
      await tx.paperTag.deleteMany({
        where: { paperId: { in: ids } },
      });
      await tx.sourceEvent.deleteMany({
        where: { paperId: { in: ids } },
      });
      await tx.paperCodeLink.deleteMany({
        where: { paperId: { in: ids } },
      });

      return tx.paper.deleteMany({
        where: { id: { in: ids } },
      });
    });

    return result.count;
  }

  async countByShortIdPrefix(prefix: string): Promise<number> {
    const count = await this.prisma.paper.count({
      where: {
        shortId: { startsWith: prefix },
      },
    });
    return count;
  }

  async updateTextPath(id: string, textPath: string) {
    return this.prisma.paper.update({
      where: { id },
      data: { textPath },
    });
  }

  async updateProcessingState(
    id: string,
    data: {
      processingStatus?: string;
      processingError?: string | null;
      processedAt?: Date | null;
      indexedAt?: Date | null;
      metadataSource?: string | null;
    },
  ) {
    return this.prisma.paper.update({
      where: { id },
      data,
    });
  }

  async listIndexedPaperIds(): Promise<string[]> {
    const rows = await this.prisma.paper.findMany({
      where: { indexedAt: { not: null } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listPendingSemanticPaperIds(): Promise<string[]> {
    const rows = await this.prisma.paper.findMany({
      where: {
        indexedAt: null,
        OR: [{ pdfPath: { not: null } }, { pdfUrl: { not: null } }, { source: 'arxiv' }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  async clearAllIndexedAt(): Promise<number> {
    const result = await this.prisma.paper.updateMany({
      where: { indexedAt: { not: null } },
      data: { indexedAt: null, processingStatus: 'idle' },
    });
    return result.count;
  }

  async getSemanticIndexDebugSummary(): Promise<SemanticIndexDebugSummary> {
    const [totalPapers, indexedPapers, pendingPapers, failedPapers, recentFailures] =
      await Promise.all([
        this.prisma.paper.count(),
        this.prisma.paper.count({ where: { indexedAt: { not: null } } }),
        this.prisma.paper.count({
          where: {
            indexedAt: null,
            OR: [{ pdfPath: { not: null } }, { pdfUrl: { not: null } }, { source: 'arxiv' }],
          },
        }),
        this.prisma.paper.count({ where: { processingStatus: 'failed' } }),
        this.prisma.paper.findMany({
          where: { processingStatus: 'failed' },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            shortId: true,
            title: true,
            processingStatus: true,
            processingError: true,
            updatedAt: true,
          },
        }),
      ]);

    return {
      totalPapers,
      indexedPapers,
      pendingPapers,
      failedPapers,
      totalChunks: 0, // paperChunk model was removed, return 0
      recentFailures,
    };
  }

  async listIndexedPapersForSemanticSearch() {
    return this.prisma.paper.findMany({
      where: { indexedAt: { not: null } },
      include: {
        tags: { include: { tag: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async listToday() {
    // Get start of today in local timezone
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTimestamp = startOfToday.getTime();

    // Use raw query since SQLite stores timestamps as integers
    // Exclude temporary papers from Discovery
    const papers = await this.prisma.$queryRaw<
      Array<{
        id: string;
        shortId: string;
        title: string;
        authorsJson: string;
        source: 'chrome' | 'manual' | 'arxiv';
        sourceUrl: string | null;
        submittedAt: string | null;
        abstract: string | null;
        pdfUrl: string | null;
        pdfPath: string | null;
        createdAt: Date;
        updatedAt: Date;
        lastReadAt: Date | null;
      }>
    >`
      SELECT * FROM Paper WHERE createdAt >= ${startTimestamp} AND isTemporary = 0 ORDER BY createdAt DESC
    `;

    // Fetch tags for each paper
    const paperIds = papers.map((p) => p.id);
    const paperTags = await this.prisma.paperTag.findMany({
      where: { paperId: { in: paperIds } },
      include: { tag: true },
    });

    const tagMap = new Map<string, string[]>();
    const categorizedTagMap = new Map<string, CategorizedTag[]>();
    for (const pt of paperTags) {
      // Flat tag names
      const existing = tagMap.get(pt.paperId) || [];
      existing.push(pt.tag.name);
      tagMap.set(pt.paperId, existing);
      // Categorized tags
      const categorized = categorizedTagMap.get(pt.paperId) || [];
      categorized.push({ name: pt.tag.name, category: pt.tag.category as TagCategory });
      categorizedTagMap.set(pt.paperId, categorized);
    }

    return papers.map((paper) => ({
      ...paper,
      authors: JSON.parse(paper.authorsJson) as string[],
      tagNames: tagMap.get(paper.id) || [],
      categorizedTags: categorizedTagMap.get(paper.id) || [],
    }));
  }

  // ── Tag management methods ─────────────────────────────────────────────

  async updateTagsWithCategories(id: string, tags: CategorizedTag[]) {
    const uniqueTags = Array.from(
      new Map(
        tags
          .map((tag) => ({ ...tag, name: tag.name.trim() }))
          .filter((tag) => tag.name)
          .map((tag) => [`${tag.category}:${tag.name.toLowerCase()}`, tag]),
      ).values(),
    );

    const tagRecords = await Promise.all(
      uniqueTags.map((t) =>
        this.prisma.tag.upsert({
          where: { name: t.name },
          create: { name: t.name, category: t.category },
          update: { category: t.category },
        }),
      ),
    );

    await this.prisma.paperTag.deleteMany({ where: { paperId: id } });

    if (tagRecords.length > 0) {
      await this.prisma.paperTag.createMany({
        data: tagRecords.map((tag) => ({ paperId: id, tagId: tag.id })),
      });
    }

    return this.findById(id);
  }

  async listAllTagsWithCategory(): Promise<
    Array<{ name: string; category: string; count: number }>
  > {
    const tags = await this.prisma.tag.findMany({
      select: {
        name: true,
        category: true,
        _count: { select: { papers: true } },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return tags.map((t) => ({
      name: t.name,
      category: t.category,
      count: t._count.papers,
    }));
  }

  async listTagVocabulary(): Promise<{ domain: string[]; method: string[]; topic: string[] }> {
    const tags = await this.prisma.tag.findMany({
      where: {
        papers: { some: {} }, // only tags that are actually used
      },
      select: { name: true, category: true },
      orderBy: { name: 'asc' },
    });
    const vocab: { domain: string[]; method: string[]; topic: string[] } = {
      domain: [],
      method: [],
      topic: [],
    };
    for (const t of tags) {
      const cat = t.category as keyof typeof vocab;
      if (vocab[cat]) vocab[cat].push(t.name);
    }
    return vocab;
  }

  async listUntaggedPaperIds(): Promise<string[]> {
    const papers = await this.prisma.paper.findMany({
      where: { tags: { none: {} } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return papers.map((p) => p.id);
  }

  async listPapersMissingAbstract(): Promise<
    Array<{
      id: string;
      shortId: string;
      title: string;
      pdfPath: string | null;
      pdfUrl: string | null;
    }>
  > {
    const papers = await this.prisma.paper.findMany({
      where: {
        OR: [{ abstract: null }, { abstract: '' }],
        NOT: [{ pdfPath: null, pdfUrl: null }],
      },
      select: {
        id: true,
        shortId: true,
        title: true,
        pdfPath: true,
        pdfUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return papers;
  }

  async listPapersWithPdf(): Promise<
    Array<{
      id: string;
      shortId: string;
      title: string;
      pdfPath: string | null;
      pdfUrl: string | null;
    }>
  > {
    const papers = await this.prisma.paper.findMany({
      where: {
        NOT: [{ pdfPath: null, pdfUrl: null }],
      },
      select: {
        id: true,
        shortId: true,
        title: true,
        pdfPath: true,
        pdfUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return papers;
  }

  async mergeTag(keepName: string, removeNames: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Ensure the keep tag exists
      const keepTag = await tx.tag.findUnique({ where: { name: keepName } });
      if (!keepTag) throw new Error(`Tag "${keepName}" not found`);

      // Find tags to remove
      const removeTags = await tx.tag.findMany({
        where: { name: { in: removeNames } },
      });

      for (const removeTag of removeTags) {
        // Get all papers linked to the tag being removed
        const paperTags = await tx.paperTag.findMany({
          where: { tagId: removeTag.id },
        });

        for (const pt of paperTags) {
          // Check if this paper is already linked to the keep tag
          const existing = await tx.paperTag.findUnique({
            where: { paperId_tagId: { paperId: pt.paperId, tagId: keepTag.id } },
          });
          if (!existing) {
            await tx.paperTag.create({
              data: { paperId: pt.paperId, tagId: keepTag.id },
            });
          }
        }

        // Delete all associations for removed tag, then delete the tag itself
        await tx.paperTag.deleteMany({ where: { tagId: removeTag.id } });
        await tx.tag.delete({ where: { id: removeTag.id } });
      }
    });
  }

  async recategorizeTag(name: string, newCategory: string): Promise<void> {
    await this.prisma.tag.update({
      where: { name },
      data: { category: newCategory },
    });
  }

  async renameTag(oldName: string, newName: string): Promise<void> {
    // Check for conflict
    const existing = await this.prisma.tag.findUnique({ where: { name: newName } });
    if (existing) {
      // Merge into existing tag
      await this.mergeTag(newName, [oldName]);
    } else {
      await this.prisma.tag.update({
        where: { name: oldName },
        data: { name: newName },
      });
    }
  }

  async deleteTag(name: string): Promise<void> {
    const tag = await this.prisma.tag.findUnique({ where: { name } });
    if (!tag) return;
    await this.prisma.paperTag.deleteMany({ where: { tagId: tag.id } });
    await this.prisma.tag.delete({ where: { id: tag.id } });
  }

  // ── Citation extraction tracking ──────────────────────────────────────

  async listPendingCitationPaperIds(): Promise<string[]> {
    const rows = await this.prisma.paper.findMany({
      where: { citationsExtractedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async markCitationsExtracted(paperId: string): Promise<void> {
    await this.prisma.paper.update({
      where: { id: paperId },
      data: { citationsExtractedAt: new Date() },
    });
  }

  /**
   * Find papers that don't have embeddings yet
   */
  async findPapersWithoutEmbeddings(limit?: number) {
    const papers = await this.prisma.paper.findMany({
      where: {
        embedding: null,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    return papers.map(mapPaper);
  }

  /**
   * Get paper with its embedding
   */
  async getPaperWithEmbedding(paperId: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        embedding: true,
      },
    });

    if (!paper) return null;

    return {
      ...mapPaper(paper),
      embedding: paper.embedding,
    };
  }

  // ── Temporary papers management ──────────────────────────────────────

  /**
   * List expired temporary papers (for cleanup)
   */
  async listExpiredTemporaryPapers(cutoffDate: Date) {
    const papers = await this.prisma.paper.findMany({
      where: {
        isTemporary: true,
        temporaryImportedAt: { lt: cutoffDate },
      },
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
    });
    return papers.map((paper) => mapPaper(paper));
  }

  /**
   * General update method
   */
  async update(
    id: string,
    data: {
      title?: string;
      isTemporary?: boolean;
      temporaryImportedAt?: Date | null;
    },
  ) {
    return this.prisma.paper.update({
      where: { id },
      data,
    });
  }
}
