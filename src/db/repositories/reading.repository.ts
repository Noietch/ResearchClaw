import type { ReadingNoteInput } from '@shared';
import { getPrismaClient } from '../client';

export class ReadingRepository {
  private prisma = getPrismaClient();

  async create(input: ReadingNoteInput) {
    return this.prisma.readingNote.create({
      data: {
        paperId: input.paperId,
        type: input.type,
        title: input.title,
        contentJson: JSON.stringify(input.content),
        version: input.version,
        repoUrl: input.repoUrl,
        commitHash: input.commitHash,
        chatNoteId: input.chatNoteId,
      },
    });
  }

  async update(id: string, content: Record<string, unknown>) {
    return this.prisma.readingNote.update({
      where: { id },
      data: {
        contentJson: JSON.stringify(content),
        updatedAt: new Date(),
      },
    });
  }

  async updateRaw(id: string, contentJson: string) {
    return this.prisma.readingNote.update({
      where: { id },
      data: { contentJson, updatedAt: new Date() },
    });
  }

  async getById(id: string) {
    const item = await this.prisma.readingNote.findUnique({
      where: { id },
    });
    if (!item) return null;
    return {
      ...item,
      content: JSON.parse(item.contentJson) as Record<string, unknown>,
    };
  }

  async listByPaper(paperId: string) {
    const items = await this.prisma.readingNote.findMany({
      where: { paperId },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => ({
      ...item,
      content: JSON.parse(item.contentJson) as Record<string, unknown>,
    }));
  }

  async getGeneratedNote(chatNoteId: string) {
    const item = await this.prisma.readingNote.findUnique({
      where: { chatNoteId },
    });
    if (!item) return null;
    return {
      ...item,
      content: JSON.parse(item.contentJson) as Record<string, unknown>,
    };
  }

  async delete(id: string) {
    return this.prisma.readingNote.delete({
      where: { id },
    });
  }
}
