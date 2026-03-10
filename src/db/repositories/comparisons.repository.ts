import { getPrismaClient } from '../client';

export class ComparisonsRepository {
  private prisma = getPrismaClient();

  async create(input: { paperIds: string[]; titles: string[]; contentMd: string }) {
    return this.prisma.comparisonNote.create({
      data: {
        paperIdsJson: JSON.stringify(input.paperIds),
        titlesJson: JSON.stringify(input.titles),
        contentMd: input.contentMd,
      },
    });
  }

  async list() {
    return this.prisma.comparisonNote.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string) {
    return this.prisma.comparisonNote.findUnique({
      where: { id },
    });
  }

  async update(
    id: string,
    data: { contentMd?: string; translatedContentMd?: string | null; chatMessagesJson?: string },
  ) {
    return this.prisma.comparisonNote.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.comparisonNote.delete({
      where: { id },
    });
  }
}
