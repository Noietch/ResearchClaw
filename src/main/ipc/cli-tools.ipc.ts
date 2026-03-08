import { ipcMain, BrowserWindow } from 'electron';
import type { AgentToolKind } from '@shared';
import {
  detectAllCliTools,
  runCliToWindow,
  classifyCliTestError,
  testCliCommand,
  type CliUsageSummary,
  type CliTestDiagnostics,
} from '../services/cli-runner.service';
import { getCliTools, saveCliTools, type CliConfig } from '../store/cli-tools-store';
import { recordTokenUsage } from '../store/token-usage-store';
import {
  appendLog,
  getLogFilePath,
  makeTimestampedLogName,
  writeDebugFile,
} from '../services/app-log.service';
import { getModelConfig } from '../store/model-config-store';
import {
  attachAgentServiceStream,
  callAgentServiceKill,
  callAgentServiceRun,
  callAgentServiceTest,
} from '../services/agent-local.service';
import {
  getMissingAgentConfigMessage,
  resolveAgentCliArgs,
  resolveAgentHomeFiles,
} from '../services/agent-config.service';

const activeProcesses = new Map<string, { kill: () => void }>();
const sessionUsage = new Map<
  string,
  { provider: string; model: string; usage?: CliUsageSummary }
>();

function persistDiagnosticsFiles(
  diagnostics: {
    command: string;
    stdout?: string;
    stderr?: string;
    structuredOutput?: string;
    stdoutFile?: string;
    stderrFile?: string;
    structuredOutputFile?: string;
  },
  prefix: string,
) {
  const next = { ...diagnostics };
  if (next.stdout && !next.stdoutFile) {
    next.stdoutFile = writeDebugFile(
      makeTimestampedLogName(`${prefix}-stdout`, 'jsonl'),
      next.stdout,
    );
  }
  if (next.stderr && !next.stderrFile) {
    next.stderrFile = writeDebugFile(
      makeTimestampedLogName(`${prefix}-stderr`, 'log'),
      next.stderr,
    );
  }
  if (next.structuredOutput && !next.structuredOutputFile) {
    next.structuredOutputFile = writeDebugFile(
      makeTimestampedLogName(`${prefix}-structured`, 'txt'),
      next.structuredOutput,
    );
  }
  return next;
}

function logCliDiagnostics(event: string, diagnostics: unknown, extra?: Record<string, unknown>) {
  appendLog(
    'agent',
    event,
    {
      ...(extra ?? {}),
      diagnostics,
      logFile: getLogFilePath(AGENT_LOG_FILE),
    },
    AGENT_LOG_FILE,
  );
}

function finalizeSessionUsage(sessionId: string) {
  appendLog('agent', 'session:finalize:start', { sessionId }, AGENT_LOG_FILE);
  const usageState = sessionUsage.get(sessionId);
  if (usageState?.usage) {
    appendLog(
      'agent',
      'session:usage',
      {
        sessionId,
        provider: usageState.provider,
        model: usageState.usage.model ?? usageState.model,
        promptTokens: usageState.usage.promptTokens,
        completionTokens: usageState.usage.completionTokens,
        totalTokens: usageState.usage.totalTokens,
      },
      AGENT_LOG_FILE,
    );
    recordTokenUsage({
      timestamp: new Date().toISOString(),
      provider: usageState.provider,
      model: usageState.usage.model ?? usageState.model,
      promptTokens: usageState.usage.promptTokens,
      completionTokens: usageState.usage.completionTokens,
      totalTokens: usageState.usage.totalTokens,
      kind: 'agent',
    });
  }
  sessionUsage.delete(sessionId);
  activeProcesses.delete(sessionId);
  appendLog('agent', 'session:finalize:done', { sessionId }, AGENT_LOG_FILE);
}

const AGENT_LOG_FILE = 'agent.log';

export function setupCliToolsIpc() {
  ipcMain.handle('cliTools:list', async () => {
    return getCliTools();
  });

  ipcMain.handle('cliTools:save', async (_, tools: CliConfig[]) => {
    saveCliTools(tools);
    return { success: true };
  });

  ipcMain.handle('cli:detect', async () => {
    return detectAllCliTools();
  });

  ipcMain.handle('cli:test', async (_, command: string, extraArgs?: string, envVars?: string) => {
    appendLog(
      'agent',
      'cli:test:start',
      { command, extraArgs, hasEnvVars: !!envVars },
      AGENT_LOG_FILE,
    );

    const result = await testCliCommand({ command, extraArgs, envVars });
    const persistedDiagnostics = result.diagnostics
      ? persistDiagnosticsFiles(result.diagnostics, 'cli-test')
      : undefined;
    const response = result.success
      ? { success: true, output: result.output, diagnostics: persistedDiagnostics }
      : {
          success: false,
          error: classifyCliTestError(
            command.trim().split(/\s+/)[0] || 'cli',
            result.error ?? 'CLI test failed',
          ),
          diagnostics: persistedDiagnostics,
        };

    appendLog(
      'agent',
      response.success ? 'cli:test:success' : 'cli:test:failure',
      { command, result: response },
      AGENT_LOG_FILE,
    );
    if (response.diagnostics) {
      logCliDiagnostics('cli:test:diagnostics', response.diagnostics, { command });
    }
    return { ...response, logFile: getLogFilePath(AGENT_LOG_FILE) };
  });

  ipcMain.handle(
    'cli:testAgent',
    async (
      _,
      options: {
        command: string;
        extraArgs?: string;
        envVars?: string;
        agentTool?: AgentToolKind;
        configContent?: string;
        authContent?: string;
      },
    ) => {
      appendLog(
        'agent',
        'cli:testAgent:start',
        {
          command: options.command,
          agentTool: options.agentTool,
          hasEnvVars: !!options.envVars,
          hasConfigContent: !!options.configContent?.trim(),
          hasAuthContent: !!options.authContent?.trim(),
        },
        AGENT_LOG_FILE,
      );

      const missingConfigMessage = getMissingAgentConfigMessage(options);
      if (missingConfigMessage) {
        const response = {
          success: false,
          error: missingConfigMessage,
          logFile: getLogFilePath(AGENT_LOG_FILE),
        };
        appendLog(
          'agent',
          'cli:testAgent:missingConfig',
          {
            command: options.command,
            agentTool: options.agentTool,
            error: missingConfigMessage,
            logFile: getLogFilePath(AGENT_LOG_FILE),
          },
          AGENT_LOG_FILE,
        );
        return response;
      }

      const serviceResult = await callAgentServiceTest({
        command: options.command,
        extraArgs: options.extraArgs,
        envVars: options.envVars,
        agentTool: options.agentTool,
        configContent: options.configContent,
        authContent: options.authContent,
      });

      const persistedDiagnostics =
        serviceResult.diagnostics && typeof serviceResult.diagnostics === 'object'
          ? persistDiagnosticsFiles(
              serviceResult.diagnostics as CliTestDiagnostics,
              options.agentTool === 'claude-code'
                ? 'claude-test'
                : options.agentTool === 'codex'
                  ? 'codex-test'
                  : 'agent-test',
            )
          : undefined;
      const response = serviceResult.success
        ? { success: true, output: serviceResult.output, diagnostics: persistedDiagnostics }
        : {
            success: false,
            error: serviceResult.error ?? 'CLI test failed',
            diagnostics: persistedDiagnostics,
          };

      appendLog(
        'agent',
        response.success ? 'cli:testAgent:success' : 'cli:testAgent:failure',
        { command: options.command, agentTool: options.agentTool, result: response },
        AGENT_LOG_FILE,
      );
      if (response.diagnostics) {
        logCliDiagnostics('cli:testAgent:diagnostics', response.diagnostics, {
          command: options.command,
          agentTool: options.agentTool,
        });
      }
      return { ...response, logFile: getLogFilePath(AGENT_LOG_FILE) };
    },
  );

  ipcMain.handle(
    'cli:run',
    async (
      event,
      options: {
        tool: string;
        args: string[];
        sessionId: string;
        cwd?: string;
        envVars?: string;
        useProxy?: boolean;
        displayLabel?: string;
        homeFiles?: Array<{ relativePath: string; content: string }>;
        modelId?: string;
      },
    ) => {
      appendLog(
        'agent',
        'cli:run:start',
        {
          tool: options.tool,
          sessionId: options.sessionId,
          cwd: options.cwd,
          hasEnvVars: !!options.envVars,
          hasHomeFiles: !!options.homeFiles?.length,
          modelId: options.modelId,
        },
        AGENT_LOG_FILE,
      );
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { error: 'No window found' };

      const existing = activeProcesses.get(options.sessionId);
      if (existing) existing.kill();

      let resolvedHomeFiles = options.homeFiles;
      let prependArgs: string[] = [];
      if ((!resolvedHomeFiles || resolvedHomeFiles.length === 0) && options.modelId) {
        const model = getModelConfig(options.modelId);
        if (model) {
          const missingConfigMessage = getMissingAgentConfigMessage(model);
          if (missingConfigMessage) {
            appendLog(
              'agent',
              'cli:run:missingConfig',
              {
                sessionId: options.sessionId,
                modelId: options.modelId,
                error: missingConfigMessage,
              },
              AGENT_LOG_FILE,
            );
            throw new Error(missingConfigMessage);
          }
          resolvedHomeFiles = resolveAgentHomeFiles(model);
          prependArgs = options.tool.includes('--settings') ? [] : resolveAgentCliArgs(model);
        }
      }

      const cmdParts = options.tool.trim().split(/\s+/);
      const command = cmdParts[0];
      sessionUsage.set(options.sessionId, {
        provider: command,
        model: options.displayLabel || options.tool,
      });

      const stream = await attachAgentServiceStream(options.sessionId, {
        onOutput: (data) =>
          win.webContents.send('cli:output', { sessionId: options.sessionId, data }),
        onError: (data) =>
          win.webContents.send('cli:error', { sessionId: options.sessionId, data }),
        onUsage: (usage) => {
          const existingUsage = sessionUsage.get(options.sessionId);
          if (!existingUsage) return;
          appendLog(
            'agent',
            'cli:run:usage:update',
            { sessionId: options.sessionId, usage },
            AGENT_LOG_FILE,
          );
          sessionUsage.set(options.sessionId, {
            ...existingUsage,
            usage,
            model: usage.model ?? existingUsage.model,
          });
          win.webContents.send('cli:usage', { sessionId: options.sessionId, usage });
        },
        onDone: (code) => {
          appendLog('agent', 'cli:run:done', { sessionId: options.sessionId }, AGENT_LOG_FILE);
          win.webContents.send('cli:done', { sessionId: options.sessionId, code });
          finalizeSessionUsage(options.sessionId);
        },
      });

      await callAgentServiceRun({
        tool: options.tool,
        args: options.args,
        sessionId: options.sessionId,
        cwd: options.cwd,
        envVars: options.envVars,
        useProxy: options.useProxy,
        homeFiles: resolvedHomeFiles,
        prependArgs,
      });

      activeProcesses.set(options.sessionId, {
        kill: () => {
          appendLog('agent', 'cli:run:kill', { sessionId: options.sessionId }, AGENT_LOG_FILE);
          stream.close();
          void callAgentServiceKill(options.sessionId);
          finalizeSessionUsage(options.sessionId);
        },
      });
      return { sessionId: options.sessionId, started: true };
    },
  );

  ipcMain.handle('cli:kill', async (_, sessionId: string) => {
    const proc = activeProcesses.get(sessionId);
    if (proc) {
      appendLog('agent', 'cli:kill:requested', { sessionId }, AGENT_LOG_FILE);
      proc.kill();
      return { killed: true };
    }
    return callAgentServiceKill(sessionId);
  });
}
