import { getPrismaClient } from '../client';

export class SourceEventsRepository {
  private prisma = getPrismaClient();

  async create(params: {
    paperId: string;
    source: 'chrome' | 'manual' | 'arxiv';
    rawTitle?: string;
    rawUrl?: string;
  }) {
    return this.prisma.sourceEvent.create({
      data: params,
    });
  }

  async findByPaperId(paperId: string) {
    return this.prisma.sourceEvent.findMany({
      where: { paperId },
      orderBy: { importedAt: 'desc' },
    });
  }
}
