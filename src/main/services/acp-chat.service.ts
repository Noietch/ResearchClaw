import { BrowserWindow } from 'electron';
import crypto from 'crypto';
import { ChatRepository, PapersRepository } from '@db';
import {
  generateWithModelKind,
  getLanguageModelFromConfig,
  streamText,
} from './ai-provider.service';
import { getActiveModel, getModelWithKey } from '../store/model-config-store';
import { AcpConnection } from '../agent/acp-connection';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

interface AcpJobState {
  id: string;
  sessionId: string;
  chatSessionId: string;
  status: 'running' | 'completed' | 'failed';
  connection: AcpConnection | null;
  pendingPermission?: {
    requestId: number;
    resolve: (optionId: string) => void;
  };
}

/**
 * Unified chat service that supports both lightweight (direct LLM) and ACP modes.
 *
 * - Lightweight mode (backend=null): Direct streaming via Vercel AI SDK
 * - ACP mode (backend!=null): Full agent capabilities via ACP protocol
 */
export class AcpChatService {
  private repo = new ChatRepository();
  private papersRepo = new PapersRepository();
  private activeJobs = new Map<string, AcpJobState>();

  // ── Sessions ──────────────────────────────────────────────────────────────

  async createSession(input: {
    projectId: string;
    title: string;
    paperIds?: string[];
    repoIds?: string[];
    backend?: string | null;
    cwd?: string | null;
    sessionMode?: string | null;
  }) {
    return this.repo.createSession(input);
  }

  async getSession(id: string) {
    const session = await this.repo.getSession(id);
    if (!session) return null;
    return {
      ...session,
      paperIds: JSON.parse(session.paperIdsJson) as string[],
      repoIds: JSON.parse(session.repoIdsJson) as string[],
    };
  }

  async listSessionsByProject(projectId: string) {
    const sessions = await this.repo.listSessionsByProject(projectId);
    return sessions.map((s) => ({
      ...s,
      paperIds: JSON.parse(s.paperIdsJson) as string[],
      repoIds: JSON.parse(s.repoIdsJson) as string[],
    }));
  }

  async updateSessionTitle(id: string, title: string) {
    return this.repo.updateSessionTitle(id, title);
  }

  async deleteSession(id: string) {
    return this.repo.deleteSession(id);
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async addMessage(input: {
    sessionId: string;
    role: string;
    content: string;
    metadataJson?: string;
  }) {
    return this.repo.addMessage(input);
  }

  async getMessagesBySession(sessionId: string) {
    return this.repo.getMessagesBySession(sessionId);
  }

  // ── Chat (Unified: Lightweight + ACP) ────────────────────────────────────

  async sendMessage(input: {
    chatSessionId: string;
    projectId: string;
    paperIds: string[];
    repoIds?: string[];
    prompt: string;
    backend?: string | null;
    cwd?: string;
  }): Promise<{ jobId: string; started: boolean }> {
    const jobId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const session = await this.repo.getSession(input.chatSessionId);
    if (!session) throw new Error('Chat session not found');

    const job: AcpJobState = {
      id: jobId,
      sessionId: '', // Will be set by ACP if needed
      chatSessionId: input.chatSessionId,
      status: 'running',
      connection: null,
    };
    this.activeJobs.set(jobId, job);

    // Route based on backend
    const backend = input.backend ?? session.backend;
    if (!backend || backend === 'lightweight') {
      // Lightweight mode: Direct LLM streaming (existing logic)
      this.runLightweightChat(job, input).catch((err) => {
        console.error('[AcpChatService] Lightweight chat error:', err);
        job.status = 'failed';
        this.broadcastError(jobId, err.message);
      });
    } else {
      // ACP mode: Spawn agent
      this.runAgentChat(job, input, backend).catch((err) => {
        console.error('[AcpChatService] Agent chat error:', err);
        job.status = 'failed';
        this.broadcastError(jobId, err.message);
      });
    }

    return { jobId, started: true };
  }

  private async runLightweightChat(
    job: AcpJobState,
    input: {
      chatSessionId: string;
      projectId: string;
      paperIds: string[];
      repoIds?: string[];
      prompt: string;
    },
  ) {
    // Fetch existing messages
    const existingMessages = await this.repo.getMessagesBySession(input.chatSessionId);
    const messageHistory = existingMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Fetch paper context
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
      'Draw on the provided papers context to ground your suggestions in concrete evidence.',
      'Ask clarifying questions, suggest connections between ideas, and help the user think through feasibility and novelty.',
      'Be concise but substantive. Respond in the same language as the user.',
    ].join(' ');

    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (paperContext) {
      formattedMessages.push(
        {
          role: 'user',
          content: `${paperContext}\n\nI will discuss research ideas with you. Please be ready.`,
        },
        {
          role: 'assistant',
          content:
            "I understand the project context and the provided materials. I'm ready to help you explore and develop research ideas. What would you like to discuss?",
        },
      );
    }

    formattedMessages.push(...messageHistory);
    formattedMessages.push({ role: 'user', content: input.prompt });

    const { textStream } = streamText({
      model,
      system: systemPrompt,
      messages: formattedMessages,
      maxOutputTokens: 4096,
    });

    const msgId = `msg-${Date.now()}`;
    let fullText = '';

    for await (const chunk of textStream) {
      fullText += chunk;
      this.broadcastStream(job.id, {
        msgId,
        type: 'text',
        role: 'assistant',
        content: { text: chunk },
      });
    }

    // Save assistant message
    await this.repo.addMessage({
      sessionId: input.chatSessionId,
      role: 'assistant',
      content: fullText,
    });

    job.status = 'completed';
    this.broadcastStatus(job.id, 'completed');
  }

  private async runAgentChat(
    job: AcpJobState,
    input: {
      chatSessionId: string;
      projectId: string;
      paperIds: string[];
      repoIds?: string[];
      prompt: string;
      cwd?: string;
    },
    backend: string,
  ) {
    try {
      // Get agent config for the backend
      // TODO: Phase 6 will implement multi-backend support
      // For now, we'll use a simplified approach with default agent config

      const cwd = input.cwd || process.cwd();

      // Create ACP connection
      const connection = new AcpConnection();
      job.connection = connection;

      // Set up event handlers
      connection.on('session:update', (sessionId: string, update: SessionUpdate) => {
        this.handleSessionUpdate(job, sessionId, update);
      });

      connection.on(
        'session:permission',
        (requestId: symbol, sessionId: string, request: any, resolve: (response: any) => void) => {
          this.handlePermissionRequest(job, requestId as unknown as number, request, resolve);
        },
      );

      connection.on('session:finished', (sessionId: string) => {
        console.log('[AcpChatService] Session finished:', sessionId);
        job.status = 'completed';
        this.broadcastStatus(job.id, 'completed');
      });

      connection.on('stderr', (text: string) => {
        console.log('[AcpChatService] Agent stderr:', text);
      });

      connection.on('exit', (code: number | null, signal: string | null) => {
        console.log('[AcpChatService] Agent exited:', code, signal);
        if (job.status === 'running') {
          job.status = 'failed';
          this.broadcastStatus(job.id, 'failed');
        }
      });

      // Get CLI command for the backend
      const cliCommand = this.getCliCommandForBackend(backend);
      await connection.spawn(cliCommand, [], cwd);

      // Create ACP session
      const acpSessionId = await connection.createSession(cwd);
      job.sessionId = acpSessionId;

      // Update database with ACP session ID
      await this.repo.updateSessionAcpFields(input.chatSessionId, {
        acpSessionId,
        backend,
      });

      // Build paper context
      const paperContext = await this.buildPaperContext(input.paperIds);

      // Send prompt with context
      const fullPrompt = paperContext
        ? `${paperContext}\n\n---\n\nUser request: ${input.prompt}`
        : input.prompt;

      await connection.sendPrompt(acpSessionId, fullPrompt);
    } catch (error) {
      console.error('[AcpChatService] Agent chat error:', error);
      job.status = 'failed';
      this.broadcastError(job.id, error instanceof Error ? error.message : String(error));
    }
  }

  private handleSessionUpdate(job: AcpJobState, sessionId: string, update: SessionUpdate) {
    // Convert ACP SessionUpdate to our Message format
    const msgId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    let message: any = {
      id: crypto.randomUUID(),
      msgId,
      type: 'text',
      role: 'assistant',
      content: update,
      createdAt: new Date().toISOString(),
    };

    // Detect message type from update structure
    if ('text' in update) {
      message.type = 'text';
      message.content = { text: update.text };
    } else if ('thought' in update) {
      message.type = 'thought';
      message.content = { text: update.thought };
    } else if ('toolCall' in update) {
      message.type = 'tool_call';
      message.content = update.toolCall;
    }

    this.broadcastStream(job.id, message);

    // Save to database (only for text messages)
    if (message.type === 'text') {
      void this.repo.addMessage({
        sessionId: job.chatSessionId,
        role: 'assistant',
        content: message.content.text,
        metadataJson: JSON.stringify({ type: 'text' }),
      });
    }
  }

  private handlePermissionRequest(
    job: AcpJobState,
    requestId: number,
    request: any,
    resolve: (response: any) => void,
  ) {
    // Store pending permission for user response
    job.pendingPermission = { requestId, resolve };

    // Broadcast permission request to renderer
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('acp-chat:permission', job.id, {
        requestId,
        request,
      });
    });
  }

  async respondToPermission(jobId: string, requestId: number, optionId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job || !job.pendingPermission || job.pendingPermission.requestId !== requestId) {
      throw new Error('Permission request not found or already resolved');
    }

    const { resolve } = job.pendingPermission;
    resolve({ outcome: { outcome: 'selected', optionId } });
    job.pendingPermission = undefined;
  }

  private async buildPaperContext(paperIds: string[]): Promise<string> {
    if (paperIds.length === 0) return '';

    const papers = await Promise.all(
      paperIds.map((id) => this.papersRepo.findById(id).catch(() => null)),
    );
    const validPapers = papers.filter(Boolean) as Awaited<
      ReturnType<PapersRepository['findById']>
    >[];

    if (validPapers.length === 0) return '';

    let context = 'Available research papers:\n\n';
    for (const paper of validPapers) {
      context += `## ${paper!.title}\n`;
      if (paper!.authors) {
        const authors =
          typeof paper!.authors === 'string' ? paper!.authors : JSON.stringify(paper!.authors);
        context += `**Authors:** ${authors}\n`;
      }
      if (paper!.abstract) {
        context += `**Abstract:** ${paper!.abstract}\n`;
      }
      if (paper!.pdfPath) {
        context += `**PDF:** ${paper!.pdfPath}\n`;
      }
      context += '\n';
    }

    return context;
  }

  // ── Job Control ───────────────────────────────────────────────────────────

  killJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (!job) return false;

    if (job.connection) {
      job.connection.kill();
    }
    job.status = 'failed';
    this.activeJobs.delete(jobId);
    return true;
  }

  getActiveJob(jobId: string): AcpJobState | null {
    return this.activeJobs.get(jobId) ?? null;
  }

  // ── Broadcasting ──────────────────────────────────────────────────────────

  private broadcastStream(jobId: string, update: SessionUpdate) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('acp-chat:stream', jobId, update);
    });
  }

  private broadcastStatus(jobId: string, status: string) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('acp-chat:status', jobId, status);
    });
  }

  private broadcastError(jobId: string, error: string) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('acp-chat:error', jobId, error);
    });
  }

  // ── Title Generation ──────────────────────────────────────────────────────

  async generateTitleFromMessage(content: string): Promise<string> {
    const systemPrompt = [
      'You are a helpful assistant that generates short, concise titles for chat conversations.',
      'Given a user message, generate a title of maximum 6 words that summarizes the topic.',
      'Return ONLY the title text, no quotes, no explanation.',
    ].join(' ');

    try {
      const response = await generateWithModelKind(
        'lightweight',
        systemPrompt,
        `Generate a short title for this message: ${content.slice(0, 200)}`,
      );
      return response
        .trim()
        .replace(/^["']|["']$/g, '')
        .slice(0, 50);
    } catch {
      return 'New Chat';
    }
  }

  /**
   * Map backend name to CLI command.
   * Phase 6: Multi-backend support.
   */
  private getCliCommandForBackend(backend: string): string {
    switch (backend) {
      case 'claude-code':
        return 'npx @zed-industries/claude-agent-acp@latest';
      case 'codex':
        return 'npx @zed-industries/codex-acp@latest';
      case 'gemini':
        return 'gemini --experimental-acp';
      case 'opencode':
        return 'opencode acp';
      default:
        // Fallback to claude-code
        return 'npx @zed-industries/claude-agent-acp@latest';
    }
  }
}
