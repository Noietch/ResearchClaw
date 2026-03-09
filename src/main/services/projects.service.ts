import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ProjectsRepository, PapersRepository } from '@db';
import { getShellPath } from './cli-runner.service';
import {
  generateWithModelKind,
  getLanguageModelFromConfig,
  streamText,
} from './ai-provider.service';
import { getActiveModel, getModelWithKey } from '../store/model-config-store';

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

export interface WorkdirRepoStatus {
  hasGit: boolean;
  remoteUrl?: string;
  localPath: string;
}

/**
 * Securely execute a command with arguments array (no shell interpolation)
 * Prevents command injection by using spawn with argument array instead of string interpolation
 */
function spawnAsync(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? { ...process.env, PATH: getShellPath() },
      shell: false, // Explicitly disable shell to prevent injection
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => (stdout += data));
    proc.stderr.on('data', (data) => (stderr += data));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Command failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

export class ProjectsService {
  private repo = new ProjectsRepository();
  private papersRepo = new PapersRepository();

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects() {
    const projects = await this.repo.listProjects();
    const mapped = projects.map((p: (typeof projects)[number]) => ({
      ...p,
      ideas: p.ideas.map((idea: (typeof p.ideas)[number]) => ({
        ...idea,
        paperIds: JSON.parse(idea.paperIdsJson) as string[],
      })),
    }));
    // Sort: recently accessed first, then by createdAt
    return mapped.sort((a: (typeof mapped)[number], b: (typeof mapped)[number]) => {
      const aTime = a.lastAccessedAt
        ? new Date(a.lastAccessedAt).getTime()
        : new Date(a.createdAt).getTime();
      const bTime = b.lastAccessedAt
        ? new Date(b.lastAccessedAt).getTime()
        : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  async createProject(input: { name: string; description?: string; workdir?: string }) {
    // Ensure workdir exists if provided
    if (input.workdir) {
      fs.mkdirSync(input.workdir, { recursive: true });
    }
    return this.repo.createProject(input);
  }

  async updateProject(id: string, data: { name?: string; description?: string; workdir?: string }) {
    // Ensure workdir exists if provided
    if (data.workdir) {
      fs.mkdirSync(data.workdir, { recursive: true });
    }
    return this.repo.updateProject(id, data);
  }

  async deleteProject(id: string) {
    return this.repo.deleteProject(id);
  }

  async touchProject(id: string) {
    return this.repo.touchLastAccessed(id);
  }

  // ── Repos ─────────────────────────────────────────────────────────────────

  async addRepo(input: { projectId: string; repoUrl: string }) {
    return this.repo.createRepo({ projectId: input.projectId, repoUrl: input.repoUrl });
  }

  async cloneRepo(repoId: string, repoUrl: string): Promise<CloneResult> {
    // Clone into ~/researchclaw-repos/<owner>/<repo>
    const urlParts = repoUrl.replace(/\.git$/, '').split('/');
    const repoName = urlParts.slice(-2).join('/');
    const localPath = path.join(os.homedir(), 'researchclaw-repos', repoName);

    // Validate inputs to prevent injection
    if (!repoUrl || typeof repoUrl !== 'string') {
      return { success: false, error: 'Invalid repository URL' };
    }
    // Only allow http/https URLs to prevent local file access
    if (!repoUrl.startsWith('http://') && !repoUrl.startsWith('https://')) {
      return { success: false, error: 'Only HTTP/HTTPS URLs are allowed' };
    }

    try {
      // Use spawn with argument array to prevent command injection
      await spawnAsync('mkdir', ['-p', path.dirname(localPath)]);
      await spawnAsync('git', ['clone', '--depth=50', repoUrl, localPath]);
      await this.repo.updateRepo(repoId, { localPath, clonedAt: new Date() });
      return { success: true, localPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getCommits(localPath: string, limit = 30): Promise<CommitInfo[]> {
    // Validate inputs
    if (!localPath || typeof localPath !== 'string') {
      return [];
    }
    // Validate limit is a positive integer
    const validLimit = Math.max(1, Math.min(1000, Math.floor(limit)));

    try {
      const format = '%H|%h|%s|%an|%ai';
      // Use spawn with argument array to prevent command injection
      const output = await spawnAsync(
        'git',
        ['log', `--pretty=format:${format}`, `-n`, String(validLimit)],
        {
          cwd: localPath,
        },
      );
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

  /**
   * Check if the project's workdir contains a .git folder
   * and optionally get the remote URL
   */
  async checkWorkdirGit(projectId: string): Promise<WorkdirRepoStatus | null> {
    const project = await this.repo.getProject(projectId);
    if (!project?.workdir) return null;

    const gitDir = path.join(project.workdir, '.git');
    const hasGit = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();

    if (!hasGit) {
      return { hasGit: false, localPath: project.workdir };
    }

    // Try to get remote URL
    let remoteUrl: string | undefined;
    try {
      remoteUrl = await spawnAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: project.workdir,
      });
    } catch {
      // No remote configured
    }

    return {
      hasGit: true,
      remoteUrl: remoteUrl || undefined,
      localPath: project.workdir,
    };
  }

  /**
   * Run `git init` in the project's workdir
   */
  async initWorkdirGit(projectId: string): Promise<{ success: boolean; error?: string }> {
    const project = await this.repo.getProject(projectId);
    if (!project?.workdir) return { success: false, error: 'No workdir set for this project' };

    try {
      await spawnAsync('git', ['init'], { cwd: project.workdir });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Add the project's workdir as a repo (no cloning needed)
   */
  async addWorkdirRepo(
    projectId: string,
  ): Promise<{ id: string; repoUrl: string; localPath: string } | null> {
    const status = await this.checkWorkdirGit(projectId);
    if (!status?.hasGit) return null;

    // Use remote URL if available, otherwise use local path as identifier
    const repoUrl = status.remoteUrl || `local://${status.localPath}`;

    const repo = await this.repo.createRepo({
      projectId,
      repoUrl,
      localPath: status.localPath,
      isWorkdirRepo: true,
    });

    return {
      id: repo.id,
      repoUrl: repo.repoUrl,
      localPath: status.localPath,
    };
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
    const validPapers = papers.filter(Boolean) as Awaited<
      ReturnType<PapersRepository['findById']>
    >[];

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
        const repo = project.repos.find((r: (typeof project.repos)[number]) => r.id === repoId);
        if (!repo) continue;
        const repoName = repo.repoUrl
          .replace(/\.git$/, '')
          .split('/')
          .slice(-2)
          .join('/');
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

    const response = await generateWithModelKind(
      'lightweight',
      systemPrompt,
      userPromptParts.join('\n'),
    );

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

  private async buildSourceContext(input: {
    projectId: string;
    paperIds: string[];
    repoIds?: string[];
  }): Promise<{
    paperContext: string;
    repoContext: string;
    project: Awaited<ReturnType<ProjectsRepository['getProject']>>;
  }> {
    const project = await this.repo.getProject(input.projectId);
    if (!project) throw new Error('Project not found');

    // Fetch paper details
    const papers = await Promise.all(
      input.paperIds.map((id) => this.papersRepo.findById(id).catch(() => null)),
    );
    const validPapers = papers.filter(Boolean) as Awaited<
      ReturnType<PapersRepository['findById']>
    >[];

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
        const repo = project.repos.find((r: (typeof project.repos)[number]) => r.id === repoId);
        if (!repo) continue;
        const repoName = repo.repoUrl
          .replace(/\.git$/, '')
          .split('/')
          .slice(-2)
          .join('/');
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

    return { paperContext, repoContext, project };
  }

  async ideaChat(
    input: {
      projectId: string;
      paperIds: string[];
      repoIds?: string[];
      messages: { role: 'user' | 'assistant'; content: string }[];
    },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const { paperContext, repoContext, project } = await this.buildSourceContext(input);

    const modelConfig = getActiveModel('lightweight');
    if (!modelConfig) {
      throw new Error('No lightweight model configured. Please set up a model in Settings.');
    }
    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey) throw new Error('Model config not found');
    const model = getLanguageModelFromConfig(configWithKey);

    const systemPrompt = [
      'You are a research ideation assistant helping researchers explore and develop novel research ideas.',
      'You engage in thoughtful, conversational dialogue to help the user brainstorm, refine, and deepen research directions.',
      'Draw on the provided papers and code context to ground your suggestions in concrete evidence.',
      'Ask clarifying questions, suggest connections between ideas, and help the user think through feasibility and novelty.',
      'Be concise but substantive. Respond in the same language as the user.',
    ].join(' ');

    const contextParts: string[] = [
      `Project: ${project.name}`,
      project.description ? `Description: ${project.description}` : '',
    ].filter(Boolean);
    if (paperContext) contextParts.push('Papers:\n' + paperContext);
    if (repoContext) contextParts.push('Repositories:\n' + repoContext);
    const contextStr = contextParts.join('\n\n');

    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: `${contextStr}\n\nI will discuss research ideas with you. Please be ready.`,
      },
      {
        role: 'assistant',
        content:
          "I understand the project context and the provided materials. I'm ready to help you explore and develop research ideas. What would you like to discuss?",
      },
      ...input.messages,
    ];

    const { textStream } = streamText({
      model,
      system: systemPrompt,
      messages: formattedMessages,
      maxOutputTokens: 4096,
      abortSignal: signal,
    });

    let fullText = '';
    for await (const chunk of textStream) {
      fullText += chunk;
      onChunk(chunk);
    }

    return fullText;
  }

  async extractTaskFromChat(input: {
    projectId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ title: string; prompt: string }> {
    const conversationText = input.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const systemPrompt = [
      'You are a task extraction assistant.',
      'Given a research ideation conversation, extract a concrete agent coding task.',
      'Return JSON with exactly two fields:',
      '"title": a concise task title (max 15 words)',
      '"prompt": a detailed task description (2-4 paragraphs) suitable for a coding agent, including background, specific goals, and expected outputs.',
      'Respond ONLY with valid JSON, no markdown, no explanation.',
    ].join(' ');

    const response = await generateWithModelKind('lightweight', systemPrompt, conversationText);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { title?: string; prompt?: string };
        if (parsed.title && parsed.prompt) {
          return { title: parsed.title, prompt: parsed.prompt };
        }
      }
    } catch {
      // fallback
    }

    return { title: 'Research Task', prompt: response.trim() };
  }

  async updateIdea(id: string, data: { title?: string; content?: string }) {
    return this.repo.updateIdea(id, data);
  }

  async deleteIdea(id: string) {
    return this.repo.deleteIdea(id);
  }

  // ── Project Papers ────────────────────────────────────────────────────────

  async addPaperToProject(projectId: string, paperId: string, note?: string) {
    return this.repo.addPaperToProject(projectId, paperId, note);
  }

  async removePaperFromProject(projectId: string, paperId: string) {
    return this.repo.removePaperFromProject(projectId, paperId);
  }

  async listProjectPapers(projectId: string) {
    return this.repo.listProjectPapers(projectId);
  }

  async getProjectsForPaper(paperId: string) {
    return this.repo.getProjectsForPaper(paperId);
  }
}
