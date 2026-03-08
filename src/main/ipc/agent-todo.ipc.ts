import { ipcMain } from 'electron';
import { AgentTodoService } from '../services/agent-todo.service';

let service: AgentTodoService | null = null;
function getService() {
  if (!service) service = new AgentTodoService();
  return service;
}

export function getAgentTodoService(): AgentTodoService {
  return getService();
}

function ok<T>(data: T) {
  return { success: true, data };
}
function err(message: string) {
  return { success: false, error: message };
}

export function setupAgentTodoIpc() {
  // Agent 配置
  ipcMain.handle('agent-todo:detect-agents', async () => {
    try {
      return ok(await getService().detectAgents());
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:list-agents', async () => {
    try {
      return ok(await getService().listAgents());
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:add-agent', async (_, input) => {
    try {
      return ok(await getService().addAgent(input));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:update-agent', async (_, id, input) => {
    try {
      return ok(await getService().updateAgent(id, input));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:remove-agent', async (_, id) => {
    try {
      return ok(await getService().removeAgent(id));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });

  // TODO CRUD
  ipcMain.handle('agent-todo:list', async (_, query?) => {
    try {
      return ok(await getService().listTodos(query));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:get', async (_, id) => {
    try {
      return ok(await getService().getTodo(id));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:create', async (_, input) => {
    try {
      return ok(await getService().createTodo(input));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:update', async (_, id, input) => {
    try {
      return ok(await getService().updateTodo(id, input));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:delete', async (_, id) => {
    try {
      return ok(await getService().deleteTodo(id));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });

  // 执行控制
  ipcMain.handle('agent-todo:run', async (_, todoId) => {
    try {
      return ok(await getService().runTodo(todoId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:stop', async (_, todoId) => {
    try {
      return ok(await getService().stopTodo(todoId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:confirm', async (_, todoId, requestId, optionId) => {
    try {
      return ok(await getService().confirmPermission(todoId, requestId, optionId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:list-runs', async (_, todoId) => {
    try {
      return ok(await getService().listRuns(todoId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:get-run-messages', async (_, runId) => {
    try {
      return ok(await getService().getRunMessages(runId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });

  // 定时任务
  ipcMain.handle('agent-todo:enable-cron', async (_, todoId, cronExpr) => {
    try {
      return ok(await getService().enableCron(todoId, cronExpr));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:disable-cron', async (_, todoId) => {
    try {
      return ok(await getService().disableCron(todoId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
}
