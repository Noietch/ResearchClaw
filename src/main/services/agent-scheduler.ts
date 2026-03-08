import { Cron } from 'croner';

interface ScheduledJob {
  todoId: string;
  cronExpr: string;
  job: Cron;
}

export class AgentScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private onTrigger: (todoId: string) => Promise<void>;

  constructor(onTrigger: (todoId: string) => Promise<void>) {
    this.onTrigger = onTrigger;
  }

  async loadFromDb(todos: Array<{ id: string; cronExpr: string }>): Promise<void> {
    for (const todo of todos) {
      this.add(todo.id, todo.cronExpr);
    }
  }

  add(todoId: string, cronExpr: string): void {
    this.remove(todoId);
    const job = new Cron(
      cronExpr,
      {
        name: `agent-todo-${todoId}`,
        catch: (error: unknown) => {
          console.error(`Cron job failed for todo ${todoId}:`, error);
        },
      },
      async () => {
        try {
          await this.onTrigger(todoId);
        } catch (error) {
          console.error(`Cron trigger failed for todo ${todoId}:`, error);
        }
      },
    );
    this.jobs.set(todoId, { todoId, cronExpr, job });
  }

  remove(todoId: string): void {
    const existing = this.jobs.get(todoId);
    if (existing) {
      existing.job.stop();
      this.jobs.delete(todoId);
    }
  }

  getNextRun(todoId: string): Date | null {
    const existing = this.jobs.get(todoId);
    if (!existing) return null;
    return existing.job.nextRun() || null;
  }

  listActive(): Array<{ todoId: string; cronExpr: string; nextRun: Date | null }> {
    return Array.from(this.jobs.values()).map((j) => ({
      todoId: j.todoId,
      cronExpr: j.cronExpr,
      nextRun: j.job.nextRun() || null,
    }));
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.job.stop();
    }
    this.jobs.clear();
  }
}
