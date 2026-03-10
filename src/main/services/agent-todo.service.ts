import os from 'os';
import { AgentTodoRepository, ProjectsRepository } from '@db';
import { detectAgents, DetectedAgent } from '../agent/agent-detector';
import { AgentTaskRunner } from './agent-task-runner';
import { registerRunner, getRunner, stopRunner } from './agent-runner-registry';
import { AgentScheduler } from './agent-scheduler';
import { readSessionStats } from '../agent/session-stats-reader';
import { getSshConnectConfig } from '../store/ssh-server-store';
import { decryptString } from '../utils/encryption';
import type { SshConnectConfig } from '@shared';

/**
 * Safely parse extraEnv from DB.
 * Handles cases where the value was accidentally double/triple-serialized
 * (e.g. stored as `"\"{\\\"KEY\\\":\\\"VALUE\\\"}\""`).
 * Keeps unwrapping until we get a plain object or give up.
 */
export function parseExtraEnv(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  let val: unknown = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof val === 'object' && val !== null) return val as Record<string, string>;
    if (typeof val !== 'string') break;
    try {
      val = JSON.parse(val);
    } catch {
      break;
    }
  }
  return {};
}

export class AgentTodoService {
  private repository: AgentTodoRepository;
  private projectsRepository: ProjectsRepository;
  private scheduler: AgentScheduler;

  constructor() {
    this.repository = new AgentTodoRepository();
    this.projectsRepository = new ProjectsRepository();
    this.scheduler = new AgentScheduler((todoId) =>
      this.runTodo(todoId, 'cron').then(() => undefined),
    );
  }

  async initialize(): Promise<void> {
    const cronTodos = await this.repository.findCronEnabled();
    await this.scheduler.loadFromDb(
      cronTodos.filter((t) => t.cronExpr).map((t) => ({ id: t.id, cronExpr: t.cronExpr! })),
    );
  }

  getScheduler(): AgentScheduler {
    return this.scheduler;
  }

  // ── Agent Config ────────────────────────────────────────────────────────────

  async detectAgents(): Promise<DetectedAgent[]> {
    return detectAgents();
  }

  async listAgents() {
    const configs = await this.repository.findAllAgentConfigs();
    return configs.map((c) => ({
      ...c,
      acpArgs: JSON.parse(c.acpArgs) as string[],
      remoteExtraEnv: parseExtraEnv((c as any).remoteExtraEnv),
      // Never expose the encrypted passphrase to renderer
      sshPassphraseEncrypted: undefined,
    }));
  }

  async addAgent(input: {
    name: string;
    backend: string;
    cliPath: string;
    acpArgs?: string[];
    agentTool?: string;
    configContent?: string;
    authContent?: string;
    extraEnv?: Record<string, string>;
    defaultModel?: string;
    apiKey?: string;
    baseUrl?: string;
    isRemote?: boolean;
    sshHost?: string;
    sshPort?: number;
    sshUsername?: string;
    sshAuthMethod?: string;
    sshPrivateKeyPath?: string;
    sshPassphrase?: string;
    remoteCliPath?: string;
    remoteExtraEnv?: Record<string, string>;
  }) {
    const { encryptString, isEncryptionAvailable } = await import('../utils/encryption');
    let sshPassphraseEncrypted: string | undefined;
    if (input.sshPassphrase && isEncryptionAvailable()) {
      sshPassphraseEncrypted = encryptString(input.sshPassphrase);
    }
    return this.repository.createAgentConfig({
      name: input.name,
      backend: input.backend,
      cliPath: input.cliPath,
      acpArgs: JSON.stringify(input.acpArgs ?? []),
      agentTool: input.agentTool,
      configContent: input.configContent,
      authContent: input.authContent,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      isCustom: true,
      extraEnv: JSON.stringify(input.extraEnv ?? {}),
      defaultModel: input.defaultModel,
      isRemote: input.isRemote ?? false,
      sshHost: input.sshHost,
      sshPort: input.sshPort,
      sshUsername: input.sshUsername,
      sshAuthMethod: input.sshAuthMethod,
      sshPrivateKeyPath: input.sshPrivateKeyPath,
      sshPassphraseEncrypted,
      remoteCliPath: input.remoteCliPath,
      remoteExtraEnv: JSON.stringify(input.remoteExtraEnv ?? {}),
    });
  }

  async updateAgent(
    id: string,
    input: Partial<{
      name: string;
      backend: string;
      cliPath: string;
      acpArgs: string[];
      agentTool: string;
      configContent: string;
      authContent: string;
      enabled: boolean;
      extraEnv: Record<string, string>;
      defaultModel: string;
      apiKey: string;
      baseUrl: string;
      isRemote: boolean;
      sshHost: string;
      sshPort: number;
      sshUsername: string;
      sshAuthMethod: string;
      sshPrivateKeyPath: string;
      sshPassphrase: string;
      remoteCliPath: string;
      remoteExtraEnv: Record<string, string>;
    }>,
  ) {
    const { encryptString, isEncryptionAvailable } = await import('../utils/encryption');
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.backend !== undefined) data.backend = input.backend;
    if (input.cliPath !== undefined) data.cliPath = input.cliPath;
    if (input.acpArgs !== undefined) data.acpArgs = JSON.stringify(input.acpArgs);
    if (input.agentTool !== undefined) data.agentTool = input.agentTool;
    if (input.configContent !== undefined) data.configContent = input.configContent;
    if (input.authContent !== undefined) data.authContent = input.authContent;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.extraEnv !== undefined) data.extraEnv = JSON.stringify(input.extraEnv);
    if ('defaultModel' in input) data.defaultModel = input.defaultModel ?? null;
    if ('apiKey' in input) data.apiKey = input.apiKey ?? null;
    if ('baseUrl' in input) data.baseUrl = input.baseUrl ?? null;
    if (input.isRemote !== undefined) data.isRemote = input.isRemote;
    if ('sshHost' in input) data.sshHost = input.sshHost ?? null;
    if ('sshPort' in input) data.sshPort = input.sshPort ?? null;
    if ('sshUsername' in input) data.sshUsername = input.sshUsername ?? null;
    if ('sshAuthMethod' in input) data.sshAuthMethod = input.sshAuthMethod ?? null;
    if ('sshPrivateKeyPath' in input) data.sshPrivateKeyPath = input.sshPrivateKeyPath ?? null;
    if ('sshPassphrase' in input && input.sshPassphrase && isEncryptionAvailable()) {
      data.sshPassphraseEncrypted = encryptString(input.sshPassphrase);
    }
    if ('remoteCliPath' in input) data.remoteCliPath = input.remoteCliPath ?? null;
    if (input.remoteExtraEnv !== undefined)
      data.remoteExtraEnv = JSON.stringify(input.remoteExtraEnv);
    return this.repository.updateAgentConfig(
      id,
      data as Parameters<typeof this.repository.updateAgentConfig>[1],
    );
  }

  async removeAgent(id: string) {
    return this.repository.deleteAgentConfig(id);
  }

  // ── TODO CRUD ───────────────────────────────────────────────────────────────

  async listTodos(query?: { status?: string; projectId?: string }) {
    const todos = await this.repository.findAllTodos(query);
    return todos.map((t) => ({
      ...t,
      agent: { ...t.agent, acpArgs: JSON.parse(t.agent.acpArgs) as string[] },
      resultsCount: t._count?.results ?? 0,
    }));
  }

  async getTodo(id: string) {
    const todo = await this.repository.findTodoById(id);
    if (!todo) throw new Error(`AgentTodo not found: ${id}`);
    return {
      ...todo,
      agent: { ...todo.agent, acpArgs: JSON.parse(todo.agent.acpArgs) as string[] },
    };
  }

  async createTodo(input: {
    title: string;
    prompt: string;
    cwd: string;
    agentId: string;
    projectId?: string;
    priority?: number;
    cronExpr?: string;
    yoloMode?: boolean;
    model?: string;
  }) {
    return this.repository.createTodo(input);
  }

  async updateTodo(
    id: string,
    input: Partial<{
      title: string;
      prompt: string;
      cwd: string;
      agentId: string;
      status: string;
      priority: number;
      cronExpr: string;
      cronEnabled: boolean;
      yoloMode: boolean;
      model: string | null;
    }>,
  ) {
    return this.repository.updateTodo(id, input);
  }

  async deleteTodo(id: string) {
    return this.repository.deleteTodo(id);
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  async runTodo(todoId: string, trigger: 'manual' | 'cron' = 'manual') {
    const todo = await this.getTodo(todoId);

    // Skip if already running
    const existingRunner = getRunner(todoId);
    if (
      existingRunner &&
      (existingRunner.getStatus() === 'running' || existingRunner.getStatus() === 'initializing')
    ) {
      throw new Error('Todo is already running');
    }

    const agentConfig = todo.agent;
    const cliPath = agentConfig.cliPath ?? agentConfig.backend;
    const acpArgs = agentConfig.acpArgs;
    const extraEnv = parseExtraEnv(agentConfig.extraEnv);

    // Inject model override: todo.model takes precedence over agent defaultModel
    const model = (todo as any).model ?? agentConfig.defaultModel;
    if (model) {
      // Use appropriate env var based on agent type
      if (agentConfig.agentTool === 'codex') {
        extraEnv['OPENAI_MODEL'] = model;
      } else {
        extraEnv['ANTHROPIC_MODEL'] = model;
      }
    }

    // Inject API configuration based on agent type
    if (agentConfig.agentTool === 'codex') {
      if (agentConfig.apiKey) extraEnv['OPENAI_API_KEY'] = agentConfig.apiKey;
      if (agentConfig.baseUrl) extraEnv['OPENAI_BASE_URL'] = agentConfig.baseUrl;
    } else if (agentConfig.agentTool === 'claude-code') {
      if (agentConfig.apiKey) extraEnv['ANTHROPIC_API_KEY'] = agentConfig.apiKey;
      if (agentConfig.baseUrl) extraEnv['ANTHROPIC_BASE_URL'] = agentConfig.baseUrl;
    }

    // Resolve SSH config — agent-level takes priority, fall back to project-level (legacy)
    let sshConfig: SshConnectConfig | undefined;
    let cwd = todo.cwd;

    if ((agentConfig as any).isRemote && (agentConfig as any).sshHost) {
      // New-style: SSH config embedded in the agent itself
      const agent = agentConfig as any;
      const expandedKeyPath = agent.sshPrivateKeyPath?.replace(/^~/, os.homedir());
      sshConfig = {
        host: agent.sshHost,
        port: agent.sshPort ?? 22,
        username: agent.sshUsername ?? '',
        privateKeyPath: expandedKeyPath,
        passphrase: agent.sshPassphraseEncrypted
          ? decryptString(agent.sshPassphraseEncrypted)
          : undefined,
      };
      // Use remoteCliPath if set
      if (agent.remoteCliPath) {
        (agentConfig as any).cliPath = agent.remoteCliPath;
      }
      // Merge remoteExtraEnv on top of extraEnv
      const remoteEnv = parseExtraEnv((agentConfig as any).remoteExtraEnv);
      Object.assign(extraEnv, remoteEnv);
    } else if ((todo as any).projectId) {
      // Legacy: SSH config from project.sshServerId
      const project = await this.projectsRepository.getProject((todo as any).projectId);
      if (project?.sshServerId) {
        try {
          sshConfig = getSshConnectConfig(project.sshServerId);
          if (project.remoteWorkdir) {
            cwd = project.remoteWorkdir;
          }
        } catch (error) {
          console.error('Failed to resolve SSH config from project:', error);
        }
      }
    }

    // Increment call counter for this agent
    await this.repository.incrementAgentCallCount(agentConfig.id);

    // Create run record
    const run = await this.repository.createRun({
      todoId,
      trigger,
      status: 'running',
    });
    await this.repository.updateRun(run.id, { startedAt: new Date() });
    await this.repository.updateTodo(todoId, {
      status: 'running',
      lastRunId: run.id,
      lastRunAt: new Date(),
    });

    const runner = new AgentTaskRunner({
      todoId,
      runId: run.id,
      backend: agentConfig.backend,
      cliPath,
      acpArgs,
      cwd,
      yoloMode: todo.yoloMode,
      extraEnv,
      sshConfig,
    });

    registerRunner(todoId, runner);

    // Persist stream messages to DB as they arrive
    runner.on(
      'stream',
      (data: {
        runId: string;
        message: {
          msgId: string;
          type: string;
          role: string;
          content: unknown;
          status?: string | null;
          toolCallId?: string | null;
          toolName?: string | null;
        };
      }) => {
        const m = data.message;
        this.repository
          .createMessage({
            runId: data.runId,
            msgId: m.msgId,
            type: m.type as
              | 'text'
              | 'tool_call'
              | 'thought'
              | 'plan'
              | 'permission'
              | 'system'
              | 'error',
            role: m.role as 'user' | 'assistant' | 'system',
            content: JSON.stringify(m.content),
            status: m.status ?? null,
            toolCallId: m.toolCallId ?? null,
            toolName: m.toolName ?? null,
          })
          .catch(() => {
            /* ignore duplicate msgId errors */
          });
      },
    );

    // Run async
    runner
      .start(todo.prompt)
      .then(async () => {
        console.log('[AgentTodoService] runner.start completed, todoId=', todoId);
        const sessionId = runner.getSessionId();
        console.log('[AgentTodoService] sessionId=', sessionId);

        // Try to read token usage from the Claude session JSONL file
        // Skip for remote runs - the stats file is on the remote server
        let tokenUsage: string | undefined;
        if (sessionId && !(agentConfig as any).isRemote) {
          console.log('[AgentTodoService] reading session stats...');
          try {
            const stats = await readSessionStats(sessionId, cwd);
            console.log('[AgentTodoService] session stats=', stats);
            if (stats) {
              tokenUsage = JSON.stringify(stats);
            }
          } catch (statsErr) {
            console.error('[AgentTodoService] readSessionStats error:', statsErr);
          }
        }

        console.log('[AgentTodoService] updating run to completed...');
        await this.repository.updateRun(run.id, {
          status: 'completed',
          finishedAt: new Date(),
          ...(sessionId ? { sessionId } : {}),
          ...(tokenUsage ? { tokenUsage } : {}),
        });
        console.log('[AgentTodoService] updating todo to completed...');
        await this.repository.updateTodo(todoId, { status: 'completed' });
        console.log('[AgentTodoService] run finished OK');
      })
      .catch(async (error: Error) => {
        console.error('[AgentTodoService] runner error:', error);
        // If already cancelled, don't overwrite with failed
        if (runner.getStatus() === 'cancelled') return;
        await this.repository.updateRun(run.id, {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: error.message,
        });
        await this.repository.updateTodo(todoId, { status: 'failed' });
      });

    return run;
  }

  async stopTodo(todoId: string) {
    stopRunner(todoId);
    const todo = await this.repository.findTodoById(todoId);
    if (todo?.lastRunId) {
      await this.repository.updateRun(todo.lastRunId, {
        status: 'cancelled',
        finishedAt: new Date(),
      });
    }
    await this.repository.updateTodo(todoId, { status: 'cancelled' });
  }

  async confirmPermission(todoId: string, requestId: string, optionId: string) {
    const runner = getRunner(todoId);
    if (!runner) throw new Error('No active runner for todo: ' + todoId);
    runner.confirm(requestId, optionId);
  }

  async sendMessage(todoId: string, runId: string, text: string): Promise<void> {
    console.log('[AgentTodoService] sendMessage todoId=', todoId, 'runId=', runId);
    const runner = getRunner(todoId);
    if (!runner || !runner.isAlive()) {
      throw new Error('No active session for todo: ' + todoId);
    }

    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log('[AgentTodoService] creating user message msgId=', msgId);
    await this.repository.createMessage({
      runId,
      msgId,
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text }),
      status: null,
      toolCallId: null,
      toolName: null,
    });

    console.log('[AgentTodoService] pushing user message to runner...');
    runner.pushUserMessage(runId, msgId, text);
    console.log('[AgentTodoService] calling runner.sendMessage...');
    await runner.sendMessage(text);
    console.log('[AgentTodoService] sendMessage done');
  }

  // ── Run History ─────────────────────────────────────────────────────────────

  async listRuns(todoId: string) {
    return this.repository.findRunsByTodoId(todoId);
  }

  async getRunMessages(runId: string) {
    return this.repository.findMessagesByRunId(runId);
  }

  async deleteRun(runId: string) {
    const run = await this.repository.findRunById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    // If this run is the lastRun of the todo, clear the reference
    const todos = await this.repository.findAllTodos();
    const todoWithLastRun = todos.find((t) => t.lastRunId === runId);
    if (todoWithLastRun) {
      await this.repository.updateTodo(todoWithLastRun.id, {
        lastRunId: null,
        lastRunAt: null,
      });
    }

    return this.repository.deleteRun(runId);
  }

  // ── Cron ────────────────────────────────────────────────────────────────────

  async enableCron(todoId: string, cronExpr: string) {
    await this.repository.updateTodo(todoId, { cronExpr, cronEnabled: true });
    this.scheduler.add(todoId, cronExpr);
  }

  async incrementAgentCallCount(agentId: string) {
    return this.repository.incrementAgentCallCount(agentId);
  }

  async getAgentRunStats() {
    return this.repository.getAgentRunStats();
  }

  async disableCron(todoId: string) {
    await this.repository.updateTodo(todoId, { cronEnabled: false });
    this.scheduler.remove(todoId);
  }

  // ── Active Status (for recovery after page navigation) ─────────────────────

  /**
   * Get the current status and messages of an active (running) todo.
   * This is used to recover state when the user navigates away and back.
   * Returns null if no active runner exists for this todoId.
   */
  getActiveTodoStatus(
    todoId: string,
  ): { status: string; messages: TodoMessage[]; runId: string | null } | null {
    const runner = getRunner(todoId);
    if (!runner) return null;

    return {
      status: runner.getStatus(),
      messages: runner.getMergedMessages(), // Use merged messages for proper text accumulation
      runId: runner.getRunId(),
    };
  }
}

import type { TodoMessage } from '../agent/acp-adapter';
