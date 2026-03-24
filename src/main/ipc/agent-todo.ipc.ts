import { ipcMain } from 'electron';
import { inferAgentToolKind } from '@shared';
import { AgentTodoService } from '../services/agent-todo.service';
import { AcpConnection } from '../agent/acp-connection';
import { resolveAgentCliArgs, resolveAgentHomeFiles } from '../services/agent-config.service';
import {
  scanCcSwitchProviders,
  mapCcSwitchProviderToAddInput,
} from '../services/ccswitch-import.service';
import { createHomeOverrideEnv, resolveHomeWorkingDirectory } from '../utils/home-env';
import type { AgentToolKind } from '@shared';

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

  // CC Switch import
  ipcMain.handle('agent-todo:scan-ccswitch', async () => {
    try {
      const agents = await getService().listAgents();
      const existingNames = new Set(agents.map((a) => `${inferAgentToolKind(a)}:${a.name}`));
      const providers = scanCcSwitchProviders(existingNames);
      return ok(providers);
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:import-ccswitch', async (_, providerIds: string[]) => {
    try {
      let imported = 0;
      const failed: string[] = [];
      for (const id of providerIds) {
        const input = mapCcSwitchProviderToAddInput(id);
        if (!input) {
          failed.push(id);
          continue;
        }
        await getService().addAgent(input);
        imported++;
      }
      return ok({ imported, failed });
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:get-ccswitch-provider', async (_, providerId: string) => {
    try {
      const input = mapCcSwitchProviderToAddInput(providerId);
      if (!input) return err('Provider not found in CC Switch config');
      return ok(input);
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
  ipcMain.handle('agent-todo:delete-run', async (_, runId) => {
    try {
      return ok(await getService().deleteRun(runId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('agent-todo:send-message', async (_, todoId, runId, text) => {
    try {
      return ok(await getService().sendMessage(todoId, runId, text));
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

  ipcMain.handle('agent-todo:get-stats', async () => {
    try {
      return ok(await getService().getAgentRunStats());
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });

  // Get active status (for recovery after navigation)
  ipcMain.handle('agent-todo:get-active-status', async (_, todoId: string) => {
    try {
      return ok(getService().getActiveTodoStatus(todoId));
    } catch (e: unknown) {
      return err((e as Error).message);
    }
  });

  // ACP connectivity test — spawns the real CLI, runs initialize + session/new, then kills it
  ipcMain.handle('agent-todo:test-acp', async (_, agentId: string) => {
    let conn: AcpConnection | null = null;
    let tempHomeDir: string | null = null;
    const stderrLines: string[] = [];
    try {
      const agents = await getService().listAgents();
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return err(`Agent not found: ${agentId}`);

      const cliPath = agent.cliPath ?? agent.backend;
      const acpArgs = [...agent.acpArgs];
      const extraEnv = JSON.parse(
        typeof agent.extraEnv === 'string' ? agent.extraEnv : '{}',
      ) as Record<string, string>;

      const agentTool = inferAgentToolKind(agent) as AgentToolKind;

      // Inject API credentials into env (same as normal run flow)
      if (agentTool === 'codex') {
        if (agent.apiKey) extraEnv['OPENAI_API_KEY'] = agent.apiKey;
        if (agent.baseUrl) extraEnv['OPENAI_BASE_URL'] = agent.baseUrl;
        if (agent.defaultModel) extraEnv['OPENAI_MODEL'] = agent.defaultModel;
      } else if (agentTool === 'claude-code') {
        if (agent.apiKey) extraEnv['ANTHROPIC_API_KEY'] = agent.apiKey;
        if (agent.baseUrl) extraEnv['ANTHROPIC_BASE_URL'] = agent.baseUrl;
        if (agent.defaultModel) extraEnv['ANTHROPIC_MODEL'] = agent.defaultModel;
      }

      // Resolve config file args (e.g. --settings for Claude Code)
      const configInput = {
        agentTool,
        configContent: agent.configContent ?? undefined,
        authContent: agent.authContent ?? undefined,
        apiKey: agent.apiKey ?? undefined,
        baseUrl: agent.baseUrl ?? undefined,
        defaultModel: agent.defaultModel ?? undefined,
      };
      const prependArgs = resolveAgentCliArgs(configInput);
      const homeFiles = resolveAgentHomeFiles(configInput);

      // Write home files to temp location if needed (e.g. Codex config.toml/auth.json)
      if (homeFiles.length > 0) {
        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-agent-test-'));
        for (const hf of homeFiles) {
          const fullPath = path.join(tempHomeDir, hf.relativePath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, hf.content, 'utf-8');
        }
        Object.assign(extraEnv, createHomeOverrideEnv(tempHomeDir));
      }

      const finalArgs = [...prependArgs, ...acpArgs];

      conn = new AcpConnection();
      conn.on('stderr', (text: string) => stderrLines.push(text));

      const cwd = resolveHomeWorkingDirectory(extraEnv);
      await conn.spawn(cliPath, finalArgs, cwd, extraEnv);
      const sessionId = await conn.createSession(cwd);
      await getService().incrementAgentCallCount(agentId);
      return ok({ sessionId });
    } catch (e: unknown) {
      const message = (e as Error).message;
      const stderr = stderrLines.join('\n').trim();
      return err(stderr ? `${message}\n${stderr}` : message);
    } finally {
      conn?.kill();
      if (tempHomeDir) {
        const fs = await import('node:fs');
        try {
          fs.rmSync(tempHomeDir, { recursive: true, force: true });
        } catch {
          // Ignore temp-home cleanup failures on Windows when the shell process
          // has not fully released file handles yet.
        }
      }
    }
  });
}
