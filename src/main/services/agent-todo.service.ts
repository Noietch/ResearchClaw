import { AgentTodoRepository } from '@db';
import { detectAgents, DetectedAgent } from '../agent/agent-detector';
import { AgentTaskRunner } from './agent-task-runner';
import { registerRunner, getRunner, stopRunner } from './agent-runner-registry';
import { AgentScheduler } from './agent-scheduler';

export class AgentTodoService {
  private repository: AgentTodoRepository;
  private scheduler: AgentScheduler;

  constructor() {
    this.repository = new AgentTodoRepository();
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
    }));
  }

  async addAgent(input: {
    name: string;
    backend: string;
    cliPath: string;
    acpArgs?: string[];
    extraEnv?: Record<string, string>;
  }) {
    return this.repository.createAgentConfig({
      name: input.name,
      backend: input.backend,
      cliPath: input.cliPath,
      acpArgs: JSON.stringify(input.acpArgs ?? []),
      isCustom: true,
      extraEnv: JSON.stringify(input.extraEnv ?? {}),
    });
  }

  async updateAgent(
    id: string,
    input: Partial<{
      name: string;
      backend: string;
      cliPath: string;
      acpArgs: string[];
      enabled: boolean;
      extraEnv: Record<string, string>;
    }>,
  ) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.backend !== undefined) data.backend = input.backend;
    if (input.cliPath !== undefined) data.cliPath = input.cliPath;
    if (input.acpArgs !== undefined) data.acpArgs = JSON.stringify(input.acpArgs);
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.extraEnv !== undefined) data.extraEnv = JSON.stringify(input.extraEnv);
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
    const extraEnv = JSON.parse(
      typeof agentConfig.extraEnv === 'string' ? agentConfig.extraEnv : '{}',
    ) as Record<string, string>;

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
      cwd: todo.cwd,
      yoloMode: todo.yoloMode,
      extraEnv,
    });

    registerRunner(todoId, runner);

    // Run async
    runner
      .start(todo.prompt)
      .then(async () => {
        const sessionId = runner.getSessionId();
        await this.repository.updateRun(run.id, {
          status: 'completed',
          finishedAt: new Date(),
          ...(sessionId ? { sessionId } : {}),
        });
        await this.repository.updateTodo(todoId, { status: 'completed' });
      })
      .catch(async (error: Error) => {
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
    await this.repository.updateTodo(todoId, { status: 'idle' });
  }

  async confirmPermission(todoId: string, requestId: number, optionId: string) {
    const runner = getRunner(todoId);
    if (!runner) throw new Error('No active runner for todo: ' + todoId);
    runner.confirm(requestId, optionId);
  }

  // ── Run History ─────────────────────────────────────────────────────────────

  async listRuns(todoId: string) {
    return this.repository.findRunsByTodoId(todoId);
  }

  async getRunMessages(runId: string) {
    return this.repository.findMessagesByRunId(runId);
  }

  // ── Cron ────────────────────────────────────────────────────────────────────

  async enableCron(todoId: string, cronExpr: string) {
    await this.repository.updateTodo(todoId, { cronExpr, cronEnabled: true });
    this.scheduler.add(todoId, cronExpr);
  }

  async disableCron(todoId: string) {
    await this.repository.updateTodo(todoId, { cronEnabled: false });
    this.scheduler.remove(todoId);
  }
}
