import { getPrismaClient } from '../client';

export interface CreateProjectInput {
  name: string;
  description?: string;
  workdir?: string;
}

export interface CreateRepoInput {
  projectId: string;
  repoUrl: string;
  localPath?: string;
  isWorkdirRepo?: boolean;
}

export interface CreateProjectIdeaInput {
  projectId: string;
  title: string;
  content: string;
  paperIds?: string[];
}

export class ProjectsRepository {
  private prisma = getPrismaClient();

  // ── Projects ──────────────────────────────────────────────────────────────

  async createProject(input: CreateProjectInput) {
    return this.prisma.project.create({ data: input });
  }

  async listProjects() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        repos: { orderBy: { createdAt: 'asc' } },
        ideas: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async getProject(id: string) {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        repos: { orderBy: { createdAt: 'asc' } },
        ideas: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async updateProject(id: string, data: Partial<CreateProjectInput>) {
    return this.prisma.project.update({ where: { id }, data });
  }

  async deleteProject(id: string) {
    return this.prisma.project.delete({ where: { id } });
  }

  async touchLastAccessed(id: string) {
    return this.prisma.project.update({
      where: { id },
      data: { lastAccessedAt: new Date() },
    });
  }

  // ── Repos ─────────────────────────────────────────────────────────────────

  async createRepo(input: CreateRepoInput) {
    return this.prisma.projectRepo.create({ data: input });
  }

  async updateRepo(id: string, data: { localPath?: string; clonedAt?: Date; isWorkdirRepo?: boolean }) {
    return this.prisma.projectRepo.update({ where: { id }, data });
  }

  async deleteRepo(id: string) {
    return this.prisma.projectRepo.delete({ where: { id } });
  }

  // ── Ideas ─────────────────────────────────────────────────────────────────

  async createIdea(input: CreateProjectIdeaInput) {
    return this.prisma.projectIdea.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        content: input.content,
        paperIdsJson: JSON.stringify(input.paperIds ?? []),
      },
    });
  }

  async updateIdea(id: string, data: { title?: string; content?: string }) {
    return this.prisma.projectIdea.update({ where: { id }, data });
  }

  async deleteIdea(id: string) {
    return this.prisma.projectIdea.delete({ where: { id } });
  }
}
