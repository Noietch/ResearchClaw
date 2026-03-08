import { AgentTaskRunner, TaskStatus } from './agent-task-runner';

const activeRunners = new Map<string, AgentTaskRunner>();

export function registerRunner(todoId: string, runner: AgentTaskRunner): void {
  const existing = activeRunners.get(todoId);
  if (existing) {
    existing.stop();
  }
  activeRunners.set(todoId, runner);

  runner.on('status-change', (status: TaskStatus) => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      activeRunners.delete(todoId);
    }
  });
}

export function getRunner(todoId: string): AgentTaskRunner | undefined {
  return activeRunners.get(todoId);
}

export function stopRunner(todoId: string): void {
  const runner = activeRunners.get(todoId);
  if (runner) {
    runner.stop();
    activeRunners.delete(todoId);
  }
}

export function stopAllRunners(): void {
  for (const runner of activeRunners.values()) {
    runner.stop();
  }
  activeRunners.clear();
}
