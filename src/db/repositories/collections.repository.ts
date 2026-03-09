import type { TagCategory, ResearchProfile } from '@shared';
import { getPrismaClient } from '../client';

const DEFAULT_COLLECTIONS = [
  { name: 'My Papers', icon: '📝', color: 'blue', description: 'My papers', sortOrder: 0 },
  {
    name: 'Interesting',
    icon: '✨',
    color: 'yellow',
    description: 'Interesting papers',
    sortOrder: 1,
  },
  { name: 'To Read', icon: '📖', color: 'green', description: 'Reading list', sortOrder: 2 },
];

export class CollectionsRepository {
  private prisma = getPrismaClient();

  async ensureDefaults() {
    for (const def of DEFAULT_COLLECTIONS) {
      const existing = await this.prisma.collection.findUnique({ where: { name: def.name } });
      if (!existing) {
        await this.prisma.collection.create({
          data: { ...def, isDefault: true },
        });
      }
    }
  }

  async create(data: {
    name: string;
    icon?: string;
    color?: string;
    description?: string;
    parentId?: string | null;
  }) {
    const maxOrder = await this.prisma.collection.aggregate({ _max: { sortOrder: true } });
    return this.prisma.collection.create({
      data: {
        name: data.name,
        icon: data.icon,
        color: data.color,
        description: data.description,
        parentId: data.parentId ?? null,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async list() {
    const collections = await this.prisma.collection.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { papers: true } },
      },
    });
    return collections.map((c) => ({
      ...c,
      paperCount: c._count.papers,
    }));
  }

  async findById(id: string) {
    return this.prisma.collection.findUnique({ where: { id } });
  }

  async update(
    id: string,
    data: {
      name?: string;
      icon?: string;
      color?: string;
      description?: string;
      parentId?: string | null;
    },
  ) {
    return this.prisma.collection.update({ where: { id }, data });
  }

  async delete(id: string) {
    const collection = await this.prisma.collection.findUnique({ where: { id } });
    if (!collection) throw new Error('Collection not found');
    if (collection.isDefault) throw new Error('Cannot delete default collection');
    return this.prisma.collection.delete({ where: { id } });
  }

  async move(id: string, parentId: string | null, sortOrder?: number) {
    const collection = await this.prisma.collection.findUnique({ where: { id } });
    if (!collection) throw new Error('Collection not found');
    if (collection.isDefault && parentId !== null) {
      throw new Error('Default collections cannot be moved into sub-folders');
    }

    // Cycle detection: ensure parentId is not a descendant of id
    if (parentId !== null) {
      if (parentId === id) throw new Error('Cannot move collection into itself');
      const descendants = await this.getDescendantIds(id);
      if (descendants.has(parentId)) {
        throw new Error('Cannot move collection into its own descendant');
      }
    }

    const updateData: { parentId: string | null; sortOrder?: number } = { parentId };
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    return this.prisma.collection.update({ where: { id }, data: updateData });
  }

  private async getDescendantIds(id: string): Promise<Set<string>> {
    const result = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = await this.prisma.collection.findMany({
        where: { parentId: current },
        select: { id: true },
      });
      for (const child of children) {
        if (!result.has(child.id)) {
          result.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return result;
  }

  async addPaper(collectionId: string, paperId: string) {
    return this.prisma.paperCollection.upsert({
      where: { paperId_collectionId: { paperId, collectionId } },
      create: { paperId, collectionId },
      update: {},
    });
  }

  async removePaper(collectionId: string, paperId: string) {
    return this.prisma.paperCollection.deleteMany({
      where: { paperId, collectionId },
    });
  }

  async addPapers(collectionId: string, paperIds: string[]) {
    const existing = await this.prisma.paperCollection.findMany({
      where: { collectionId, paperId: { in: paperIds } },
      select: { paperId: true },
    });
    const existingIds = new Set(existing.map((e) => e.paperId));
    const newIds = paperIds.filter((id) => !existingIds.has(id));
    if (newIds.length === 0) return;
    await this.prisma.paperCollection.createMany({
      data: newIds.map((paperId) => ({ paperId, collectionId })),
    });
  }

  async listPapers(collectionId: string) {
    const relations = await this.prisma.paperCollection.findMany({
      where: { collectionId },
      include: {
        paper: {
          include: {
            tags: { include: { tag: true } },
          },
        },
      },
      orderBy: { addedAt: 'desc' },
    });
    return relations.map((r) => ({
      ...r.paper,
      authors: JSON.parse(r.paper.authorsJson) as string[],
      tagNames: r.paper.tags.map((t) => t.tag.name),
      categorizedTags: r.paper.tags.map((t) => ({
        name: t.tag.name,
        category: t.tag.category as TagCategory,
      })),
      addedAt: r.addedAt,
    }));
  }

  async getCollectionsForPaper(paperId: string) {
    const relations = await this.prisma.paperCollection.findMany({
      where: { paperId },
      include: { collection: true },
    });
    return relations.map((r) => r.collection);
  }

  async getResearchProfile(collectionId: string): Promise<ResearchProfile> {
    const papers = await this.prisma.paperCollection.findMany({
      where: { collectionId },
      include: {
        paper: {
          include: {
            tags: { include: { tag: true } },
          },
        },
      },
    });

    // Tag distribution
    const tagCounts = new Map<string, { category: TagCategory; count: number }>();
    // Year distribution
    const yearCounts = new Map<number, number>();
    // Author counts
    const authorCounts = new Map<string, number>();

    for (const rel of papers) {
      const paper = rel.paper;

      // Tags
      for (const pt of paper.tags) {
        const key = pt.tag.name;
        const existing = tagCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          tagCounts.set(key, { category: pt.tag.category as TagCategory, count: 1 });
        }
      }

      // Year (derived from submittedAt)
      if (paper.submittedAt) {
        const year = paper.submittedAt.getFullYear();
        yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      }

      // Authors
      const authors = JSON.parse(paper.authorsJson) as string[];
      for (const author of authors) {
        authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
      }
    }

    const tagDistribution = Array.from(tagCounts.entries())
      .map(([name, { category, count }]) => ({ name, category, count }))
      .sort((a, b) => b.count - a.count);

    const yearDistribution = Array.from(yearCounts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year);

    const topAuthors = Array.from(authorCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      tagDistribution,
      yearDistribution,
      topAuthors,
      totalPapers: papers.length,
    };
  }
}
