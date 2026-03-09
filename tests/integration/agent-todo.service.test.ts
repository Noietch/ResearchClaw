import { beforeEach, describe, expect, it, vi } from 'vitest';

function createRepositoryMock() {
  return {
    findCronEnabled: vi.fn().mockResolvedValue([]),
    findAllAgentConfigs: vi.fn(),
    createAgentConfig: vi.fn(),
    updateAgentConfig: vi.fn(),
    deleteAgentConfig: vi.fn(),
    findAllTodos: vi.fn(),
    findTodoById: vi.fn(),
    createTodo: vi.fn(),
    updateTodo: vi.fn(),
    deleteTodo: vi.fn(),
    incrementAgentCallCount: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    createMessage: vi.fn(),
    findRunsByTodoId: vi.fn(),
    findMessagesByRunId: vi.fn(),
    findRunById: vi.fn(),
    deleteRun: vi.fn(),
    getAgentRunStats: vi.fn(),
  };
}

describe('AgentTodoService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('parses serialized agent args when listing agents and todos', async () => {
    const repository = createRepositoryMock();
    repository.findAllAgentConfigs.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Codex',
        acpArgs: '["serve","--stdio"]',
        backend: 'codex',
      },
    ]);
    repository.findAllTodos.mockResolvedValue([
      {
        id: 'todo-1',
        title: 'Draft summary',
        agent: {
          id: 'agent-1',
          name: 'Codex',
          acpArgs: '["serve","--stdio"]',
        },
      },
    ]);

    vi.doMock('@db', () => ({
      AgentTodoRepository: class {
        constructor() {
          return repository;
        }
      },
      ProjectsRepository: class {
        getProject = vi.fn().mockResolvedValue(null);
      },
    }));
    vi.doMock('../..//src/main/agent/agent-detector', () => ({
      detectAgents: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-task-runner', () => ({
      AgentTaskRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-runner-registry', () => ({
      registerRunner: vi.fn(),
      getRunner: vi.fn(),
      stopRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-scheduler', () => ({
      AgentScheduler: class {
        constructor() {
          return { loadFromDb: vi.fn(), add: vi.fn(), remove: vi.fn() };
        }
      },
    }));
    vi.doMock('../../src/main/agent/session-stats-reader', () => ({
      readSessionStats: vi.fn(),
    }));

    const { AgentTodoService } = await import('../../src/main/services/agent-todo.service');
    const service = new AgentTodoService();

    await expect(service.listAgents()).resolves.toEqual([
      expect.objectContaining({ acpArgs: ['serve', '--stdio'] }),
    ]);
    await expect(service.listTodos()).resolves.toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ acpArgs: ['serve', '--stdio'] }),
      }),
    ]);
  });

  it('serializes array and object fields when adding and updating agents', async () => {
    const repository = createRepositoryMock();
    repository.createAgentConfig.mockImplementation(async (input) => input);
    repository.updateAgentConfig.mockImplementation(async (_id, input) => input);

    vi.doMock('@db', () => ({
      AgentTodoRepository: class {
        constructor() {
          return repository;
        }
      },
      ProjectsRepository: class {
        getProject = vi.fn().mockResolvedValue(null);
      },
    }));
    vi.doMock('../../src/main/agent/agent-detector', () => ({
      detectAgents: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-task-runner', () => ({
      AgentTaskRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-runner-registry', () => ({
      registerRunner: vi.fn(),
      getRunner: vi.fn(),
      stopRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-scheduler', () => ({
      AgentScheduler: class {
        constructor() {
          return { loadFromDb: vi.fn(), add: vi.fn(), remove: vi.fn() };
        }
      },
    }));
    vi.doMock('../../src/main/agent/session-stats-reader', () => ({
      readSessionStats: vi.fn(),
    }));

    const { AgentTodoService } = await import('../../src/main/services/agent-todo.service');
    const service = new AgentTodoService();

    const created = await service.addAgent({
      name: 'Codex',
      backend: 'codex',
      cliPath: '/usr/bin/codex',
      acpArgs: ['serve', '--stdio'],
      extraEnv: { OPENAI_API_KEY: 'key' },
      defaultModel: 'gpt-5',
    });
    expect(created).toEqual(
      expect.objectContaining({
        acpArgs: '["serve","--stdio"]',
        extraEnv: '{"OPENAI_API_KEY":"key"}',
        isCustom: true,
      }),
    );

    const updated = await service.updateAgent('agent-1', {
      acpArgs: ['exec'],
      extraEnv: { OPENAI_BASE_URL: 'https://example.com' },
      defaultModel: undefined,
      apiKey: undefined,
      baseUrl: undefined,
    });
    expect(updated).toEqual(
      expect.objectContaining({
        acpArgs: '["exec"]',
        extraEnv: '{"OPENAI_BASE_URL":"https://example.com"}',
        defaultModel: null,
        apiKey: null,
        baseUrl: null,
      }),
    );
  });

  it('clears last run references before deleting a run', async () => {
    const repository = createRepositoryMock();
    repository.findRunById.mockResolvedValue({ id: 'run-1', todoId: 'todo-1' });
    repository.findAllTodos.mockResolvedValue([
      { id: 'todo-1', lastRunId: 'run-1', lastRunAt: new Date('2026-03-09T00:00:00Z') },
    ]);
    repository.deleteRun.mockResolvedValue({ deleted: true });

    vi.doMock('@db', () => ({
      AgentTodoRepository: class {
        constructor() {
          return repository;
        }
      },
      ProjectsRepository: class {
        getProject = vi.fn().mockResolvedValue(null);
      },
    }));
    vi.doMock('../../src/main/agent/agent-detector', () => ({
      detectAgents: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-task-runner', () => ({
      AgentTaskRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-runner-registry', () => ({
      registerRunner: vi.fn(),
      getRunner: vi.fn(),
      stopRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-scheduler', () => ({
      AgentScheduler: class {
        constructor() {
          return { loadFromDb: vi.fn(), add: vi.fn(), remove: vi.fn() };
        }
      },
    }));
    vi.doMock('../../src/main/agent/session-stats-reader', () => ({
      readSessionStats: vi.fn(),
    }));

    const { AgentTodoService } = await import('../../src/main/services/agent-todo.service');
    const service = new AgentTodoService();

    await expect(service.deleteRun('run-1')).resolves.toEqual({ deleted: true });
    expect(repository.updateTodo).toHaveBeenCalledWith('todo-1', {
      lastRunId: null,
      lastRunAt: null,
    });
    expect(repository.deleteRun).toHaveBeenCalledWith('run-1');
  });

  it('updates persistence and scheduler when toggling cron', async () => {
    const repository = createRepositoryMock();
    const scheduler = {
      loadFromDb: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
    };

    vi.doMock('@db', () => ({
      AgentTodoRepository: class {
        constructor() {
          return repository;
        }
      },
      ProjectsRepository: class {
        getProject = vi.fn().mockResolvedValue(null);
      },
    }));
    vi.doMock('../../src/main/agent/agent-detector', () => ({
      detectAgents: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-task-runner', () => ({
      AgentTaskRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-runner-registry', () => ({
      registerRunner: vi.fn(),
      getRunner: vi.fn(),
      stopRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-scheduler', () => ({
      AgentScheduler: class {
        constructor() {
          return scheduler;
        }
      },
    }));
    vi.doMock('../../src/main/agent/session-stats-reader', () => ({
      readSessionStats: vi.fn(),
    }));

    const { AgentTodoService } = await import('../../src/main/services/agent-todo.service');
    const service = new AgentTodoService();

    await service.enableCron('todo-1', '0 * * * *');
    expect(repository.updateTodo).toHaveBeenCalledWith('todo-1', {
      cronExpr: '0 * * * *',
      cronEnabled: true,
    });
    expect(scheduler.add).toHaveBeenCalledWith('todo-1', '0 * * * *');

    await service.disableCron('todo-1');
    expect(repository.updateTodo).toHaveBeenCalledWith('todo-1', {
      cronEnabled: false,
    });
    expect(scheduler.remove).toHaveBeenCalledWith('todo-1');
  });

  it('persists user messages before forwarding them to an active runner', async () => {
    const repository = createRepositoryMock();
    const runner = {
      isAlive: vi.fn(() => true),
      pushUserMessage: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('@db', () => ({
      AgentTodoRepository: class {
        constructor() {
          return repository;
        }
      },
      ProjectsRepository: class {
        getProject = vi.fn().mockResolvedValue(null);
      },
    }));
    vi.doMock('../../src/main/agent/agent-detector', () => ({
      detectAgents: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-task-runner', () => ({
      AgentTaskRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-runner-registry', () => ({
      registerRunner: vi.fn(),
      getRunner: vi.fn(() => runner),
      stopRunner: vi.fn(),
    }));
    vi.doMock('../../src/main/services/agent-scheduler', () => ({
      AgentScheduler: class {
        constructor() {
          return { loadFromDb: vi.fn(), add: vi.fn(), remove: vi.fn() };
        }
      },
    }));
    vi.doMock('../../src/main/agent/session-stats-reader', () => ({
      readSessionStats: vi.fn(),
    }));

    const { AgentTodoService } = await import('../../src/main/services/agent-todo.service');
    const service = new AgentTodoService();

    await service.sendMessage('todo-1', 'run-1', 'hello agent');

    expect(repository.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        type: 'text',
        role: 'user',
        content: JSON.stringify({ text: 'hello agent' }),
      }),
    );
    expect(runner.pushUserMessage).toHaveBeenCalledWith(
      'run-1',
      expect.stringMatching(/^user-/),
      'hello agent',
    );
    expect(runner.sendMessage).toHaveBeenCalledWith('hello agent');
  });
});
