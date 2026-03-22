import { getPrismaClient } from '../client';

// ── Input types ────────────────────────────────────────────────────────────────

export interface CreateAgentConfigInput {
  name: string;
  backend: string;
  cliPath?: string;
  acpArgs?: string;
  agentTool?: string;
  configContent?: string;
  authContent?: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  isDetected?: boolean;
  isCustom?: boolean;
  enabled?: boolean;
  extraEnv?: string;
  defaultModel?: string | null;
  isRemote?: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUsername?: string | null;
  sshAuthMethod?: string | null;
  sshPrivateKeyPath?: string | null;
  sshPassphraseEncrypted?: string | null;
  remoteCliPath?: string | null;
  remoteExtraEnv?: string;
}

export interface CreateAgentTodoInput {
  title: string;
  prompt: string;
  cwd: string;
  agentId: string;
  projectId?: string;
  paperId?: string;
  status?: string;
  priority?: number;
  cronExpr?: string;
  cronEnabled?: boolean;
  yoloMode?: boolean;
  model?: string | null;
}

export interface CreateAgentTodoRunInput {
  todoId: string;
  status?: string;
  trigger?: string;
  sessionId?: string;
}

export interface CreateAgentTodoMessageInput {
  runId: string;
  msgId: string;
  type: string;
  role?: string;
  content: string;
  status?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
}

// ── Repository ─────────────────────────────────────────────────────────────────

export class AgentTodoRepository {
  private prisma = getPrismaClient();

  // ── AgentConfig ────────────────────────────────────────────────────────────

  async findAllAgentConfigs() {
    return this.prisma.agentConfig.findMany({
      orderBy: { createdAt: 'asc' },
      include: { todos: false },
    });
  }

  async createAgentConfig(data: CreateAgentConfigInput) {
    return this.prisma.agentConfig.create({ data });
  }

  async updateAgentConfig(id: string, data: Partial<CreateAgentConfigInput>) {
    return this.prisma.agentConfig.update({ where: { id }, data });
  }

  async deleteAgentConfig(id: string) {
    return this.prisma.agentConfig.delete({ where: { id } });
  }

  async incrementAgentCallCount(id: string) {
    return this.prisma.agentConfig.update({
      where: { id },
      data: { callCount: { increment: 1 } },
    });
  }

  // ── AgentTodo ──────────────────────────────────────────────────────────────

  async findAllTodos(query?: { status?: string; projectId?: string }) {
    return this.prisma.agentTodo.findMany({
      where: {
        ...(query?.status !== undefined ? { status: query.status } : {}),
        ...(query?.projectId !== undefined ? { projectId: query.projectId } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        agent: true,
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { results: true } },
      },
    });
  }

  async findTodoById(id: string) {
    return this.prisma.agentTodo.findUnique({
      where: { id },
      include: {
        agent: true,
        runs: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async createTodo(data: CreateAgentTodoInput) {
    return this.prisma.agentTodo.create({ data });
  }

  async updateTodo(
    id: string,
    data: Partial<
      CreateAgentTodoInput & {
        sessionId?: string | null;
        lastRunId?: string | null;
        lastRunAt?: Date | null;
      }
    >,
  ) {
    return this.prisma.agentTodo.update({ where: { id }, data });
  }

  async deleteTodo(id: string) {
    return this.prisma.agentTodo.delete({ where: { id } });
  }

  async findTodosByPaperId(paperId: string) {
    return this.prisma.agentTodo.findMany({
      where: { paperId },
      orderBy: { createdAt: 'desc' },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async findCronEnabled() {
    return this.prisma.agentTodo.findMany({
      where: { cronEnabled: true },
      include: { agent: true },
    });
  }

  // ── AgentTodoRun ───────────────────────────────────────────────────────────

  async createRun(data: CreateAgentTodoRunInput) {
    return this.prisma.agentTodoRun.create({ data });
  }

  async updateRun(
    id: string,
    data: Partial<{
      status: string;
      sessionId: string;
      startedAt: Date;
      finishedAt: Date;
      exitCode: number;
      errorMessage: string;
      summary: string;
      tokenUsage: string;
    }>,
  ) {
    return this.prisma.agentTodoRun.update({ where: { id }, data });
  }

  async findRunsByTodoId(todoId: string) {
    return this.prisma.agentTodoRun.findMany({
      where: { todoId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteRun(runId: string) {
    return this.prisma.agentTodoRun.delete({ where: { id: runId } });
  }

  async findRunById(runId: string) {
    return this.prisma.agentTodoRun.findUnique({ where: { id: runId } });
  }

  // ── AgentTodoMessage ───────────────────────────────────────────────────────

  async createMessage(data: CreateAgentTodoMessageInput) {
    return this.prisma.agentTodoMessage.create({ data });
  }

  // Per-msgId write queue to prevent concurrent upsert race conditions.
  // Without this, rapid streaming chunks can cause: read A → read B → write A → write B
  // where B overwrites A's append, resulting in lost/garbled text.
  private upsertQueues = new Map<string, Promise<unknown>>();

  private enqueueUpsert(key: string, fn: () => Promise<unknown>): Promise<unknown> {
    const prev = this.upsertQueues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn); // Run fn after previous completes, even if it failed
    this.upsertQueues.set(key, next);
    // Clean up the map entry when done to prevent memory leaks
    next.then(() => {
      if (this.upsertQueues.get(key) === next) {
        this.upsertQueues.delete(key);
      }
    });
    return next;
  }

  /**
   * Upsert a message by runId + msgId.
   * For text messages with the same msgId, this appends new content to existing content.
   * For other message types, this updates the existing message.
   *
   * Uses a per-msgId queue to serialize writes and prevent race conditions
   * where concurrent chunks overwrite each other's text.
   */
  async upsertMessage(data: CreateAgentTodoMessageInput) {
    const key = `${data.runId}:${data.msgId}`;
    return this.enqueueUpsert(key, async () => {
      const existing = await this.prisma.agentTodoMessage.findFirst({
        where: { runId: data.runId, msgId: data.msgId },
      });

      if (!existing) {
        return this.prisma.agentTodoMessage.create({ data });
      }

      // For text/thought messages, append new content to existing content
      if (data.type === 'text' || data.type === 'thought') {
        // Re-read to get latest content (another queued write may have updated it)
        const latest = await this.prisma.agentTodoMessage.findUnique({
          where: { id: existing.id },
        });
        const existingContent = JSON.parse(latest?.content ?? existing.content) as {
          text: string;
        };
        const newContent = JSON.parse(data.content) as { text: string };
        const mergedContent = {
          text: (existingContent.text ?? '') + (newContent.text ?? ''),
        };
        return this.prisma.agentTodoMessage.update({
          where: { id: existing.id },
          data: { content: JSON.stringify(mergedContent) },
        });
      }

      return this._upsertNonText(existing, data);
    });
  }

  private async _upsertNonText(
    existing: {
      id: string;
      content: string;
      status: string | null;
      toolCallId: string | null;
      toolName: string | null;
    },
    data: CreateAgentTodoMessageInput,
  ) {
    // For tool_call messages, deep-merge content
    if (data.type === 'tool_call') {
      const existingContent = JSON.parse(existing.content) as Record<string, unknown>;
      const newContent = JSON.parse(data.content) as Record<string, unknown>;
      const mergedContent: Record<string, unknown> = { ...existingContent };
      for (const [k, v] of Object.entries(newContent)) {
        if (v !== undefined && v !== null && v !== '') {
          mergedContent[k] = v;
        }
      }
      return this.prisma.agentTodoMessage.update({
        where: { id: existing.id },
        data: {
          content: JSON.stringify(mergedContent),
          status: data.status ?? existing.status,
          toolCallId: data.toolCallId ?? existing.toolCallId,
          toolName: data.toolName ?? existing.toolName,
        },
      });
    }

    // For other message types, replace the existing message
    return this.prisma.agentTodoMessage.update({
      where: { id: existing.id },
      data: {
        content: data.content,
        status: data.status ?? existing.status,
        toolCallId: data.toolCallId ?? existing.toolCallId,
        toolName: data.toolName ?? existing.toolName,
      },
    });
  }

  async updateMessage(
    id: string,
    data: Partial<{
      content: string;
      status: string;
      toolCallId: string;
      toolName: string;
    }>,
  ) {
    return this.prisma.agentTodoMessage.update({ where: { id }, data });
  }

  async findMessagesByRunId(runId: string) {
    return this.prisma.agentTodoMessage.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAgentRunStats() {
    const configs = await this.prisma.agentConfig.findMany({
      select: { id: true, name: true, callCount: true },
      orderBy: { callCount: 'desc' },
    });
    return configs;
  }
}
