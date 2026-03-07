import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import { ProjectsRepository, PapersRepository } from '@db';
import { getShellPath } from './cli-runner.service';
import { generateWithModelKind } from './ai-provider.service';

export interface CloneResult {
  success: boolean;
  localPath?: string;
  error?: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

function execAsync(
  cmd: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { ...options, env: options.env ?? { ...process.env, PATH: getShellPath() } },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      },
    );
  });
}

export class ProjectsService {
  private repo = new ProjectsRepository();
  private papersRepo = new PapersRepository();

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects() {
    const projects = await this.repo.listProjects();
    const mapped = projects.map((p) => ({
      ...p,
      ideas: p.ideas.map((idea) => ({
        ...idea,
        paperIds: JSON.parse(idea.paperIdsJson) as string[],
      })),
    }));
    // Sort: recently accessed first, then by createdAt
    return mapped.sort((a, b) => {
      const aTime = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  async createProject(input: { name: string; description?: string }) {
    return this.repo.createProject(input);
  }

  async updateProject(id: string, data: { name?: string; description?: string }) {
    return this.repo.updateProject(id, data);
  }

  async deleteProject(id: string) {
    return this.repo.deleteProject(id);
  }

  async touchProject(id: string) {
    return this.repo.touchLastAccessed(id);
  }

  // ── Todos ─────────────────────────────────────────────────────────────────

  async createTodo(input: { projectId: string; text: string }) {
    return this.repo.createTodo(input);
  }

  async updateTodo(id: string, data: { text?: string; done?: boolean }) {
    return this.repo.updateTodo(id, data);
  }

  async deleteTodo(id: string) {
    return this.repo.deleteTodo(id);
  }

  // ── Repos ─────────────────────────────────────────────────────────────────

  async addRepo(input: { projectId: string; repoUrl: string }) {
    return this.repo.createRepo({ projectId: input.projectId, repoUrl: input.repoUrl });
  }

  async cloneRepo(repoId: string, repoUrl: string): Promise<CloneResult> {
    // Clone into ~/vibe-research-repos/<owner>/<repo>
    const urlParts = repoUrl.replace(/\.git$/, '').split('/');
    const repoName = urlParts.slice(-2).join('/');
    const localPath = path.join(os.homedir(), 'vibe-research-repos', repoName);

    try {
      await execAsync(`mkdir -p "${path.dirname(localPath)}"`);
      await execAsync(`git clone --depth=50 "${repoUrl}" "${localPath}"`);
      await this.repo.updateRepo(repoId, { localPath, clonedAt: new Date() });
      return { success: true, localPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getCommits(localPath: string, limit = 30): Promise<CommitInfo[]> {
    try {
      const format = '%H|%h|%s|%an|%ai';
      const output = await execAsync(`git log --pretty=format:"${format}" -n ${limit}`, {
        cwd: localPath,
      });
      if (!output) return [];
      return output.split('\n').map((line) => {
        const [hash, shortHash, message, author, date] = line.split('|');
        return { hash, shortHash, message, author, date };
      });
    } catch {
      return [];
    }
  }

  async deleteRepo(id: string) {
    return this.repo.deleteRepo(id);
  }

  // ── Ideas ─────────────────────────────────────────────────────────────────

  async createIdea(input: {
    projectId: string;
    title: string;
    content: string;
    paperIds?: string[];
  }) {
    return this.repo.createIdea(input);
  }

  async generateIdea(input: {
    projectId: string;
    paperIds: string[];
    repoIds?: string[];
  }): Promise<{ id: string; title: string; content: string }> {
    const project = await this.repo.getProject(input.projectId);
    if (!project) throw new Error('Project not found');

    if (input.paperIds.length === 0 && (!input.repoIds || input.repoIds.length === 0)) {
      throw new Error('Select at least one paper or repository');
    }

    // Fetch paper details
    const papers = await Promise.all(
      input.paperIds.map((id) => this.papersRepo.findById(id).catch(() => null)),
    );
    const validPapers = papers.filter(Boolean) as Awaited<ReturnType<PapersRepository['findById']>>[];

    const paperContext = validPapers
      .map((p) => {
        const parts = [`Title: ${p!.title}`];
        if (p!.abstract) parts.push(`Abstract: ${p!.abstract}`);
        return parts.join('\n');
      })
      .join('\n\n---\n\n');

    // Fetch repo commit summaries
    let repoContext = '';
    if (input.repoIds && input.repoIds.length > 0) {
      const repoSections: string[] = [];
      for (const repoId of input.repoIds) {
        const repo = project.repos.find((r) => r.id === repoId);
        if (!repo) continue;
        const repoName = repo.repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/');
        const parts = [`Repository: ${repoName}`, `URL: ${repo.repoUrl}`];
        if (repo.localPath) {
          const commits = await this.getCommits(repo.localPath, 20);
          if (commits.length > 0) {
            parts.push(
              'Recent commits:\n' +
                commits.map((c) => `  [${c.shortHash}] ${c.message}`).join('\n'),
            );
          }
        }
        repoSections.push(parts.join('\n'));
      }
      repoContext = repoSections.join('\n\n---\n\n');
    }

    const systemPrompt = [
      'You are a research assistant helping to generate research ideas.',
      'Given a project description, academic papers, and optionally a codebase summary,',
      'generate a concrete, actionable research idea that bridges theory and implementation.',
      'The idea should synthesize insights from the provided materials and suggest a novel direction.',
      'Structure your response as JSON with two fields:',
      '"title": a concise idea title (max 15 words)',
      '"content": a detailed description (3-5 paragraphs) covering: motivation, approach, connection to the papers/code, and expected contributions.',
      'Respond in the same language as the project description or paper abstracts.',
    ].join(' ');

    const userPromptParts = [
      `Project: ${project.name}`,
      project.description ? `Description: ${project.description}` : '',
    ].filter(Boolean);

    if (paperContext) {
      userPromptParts.push('', 'Papers to synthesize:', paperContext);
    }
    if (repoContext) {
      userPromptParts.push('', 'Code repositories:', repoContext);
    }
    userPromptParts.push('', 'Generate a research idea as JSON:');

    const response = await generateWithModelKind('chat', systemPrompt, userPromptParts.join('\n'));

    const sourceCount = validPapers.length + (input.repoIds?.length ?? 0);
    let title = `Idea from ${sourceCount} source${sourceCount > 1 ? 's' : ''}`;
    let content = response.trim();

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { title?: string; content?: string };
        if (parsed.title) title = parsed.title;
        if (parsed.content) content = parsed.content;
      }
    } catch {
      // fallback: use raw response as content
    }

    const created = await this.repo.createIdea({
      projectId: input.projectId,
      title,
      content,
      paperIds: input.paperIds,
    });

    return { id: created.id, title: created.title, content: created.content };
  }

  async updateIdea(id: string, data: { title?: string; content?: string }) {
    return this.repo.updateIdea(id, data);
  }

  async deleteIdea(id: string) {
    return this.repo.deleteIdea(id);
  }
}
