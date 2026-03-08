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
}

export interface CreateAgentTodoInput {
  title: string;
  prompt: string;
  cwd: string;
  agentId: string;
  projectId?: string;
  status?: string;
  priority?: number;
  cronExpr?: string;
  cronEnabled?: boolean;
  yoloMode?: boolean;
  model?: string;
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
  status?: string;
  toolCallId?: string;
  toolName?: string;
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
        sessionId?: string;
        lastRunId?: string;
        lastRunAt?: Date;
      }
    >,
  ) {
    return this.prisma.agentTodo.update({ where: { id }, data });
  }

  async deleteTodo(id: string) {
    return this.prisma.agentTodo.delete({ where: { id } });
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
      include: { messages: { orderBy: { createdAt: 'asc' } } },
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
