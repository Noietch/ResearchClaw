import {
  getModelConfigs,
  getActiveModelIds,
  getActiveModel,
  setActiveModel,
  saveModelConfig,
  deleteModelConfig,
  getDecryptedApiKey,
  type ModelConfig,
  type ModelKind,
} from '../store/model-config-store';
import type { AgentToolKind } from '@shared';
import { testApiConnection } from './ai-provider.service';
import { callAgentServiceTest } from './agent-local.service';
import {
  getSystemAgentConfigStatus,
  getSystemAgentConfigContents,
  getMissingAgentConfigMessage,
  resolveAgentCliArgs,
  resolveAgentHomeFiles,
  type AgentConfigStatus,
  type AgentConfigContents,
} from './agent-config.service';
import {
  classifyCliTestError,
  testCliCommand,
  type CliTestDiagnostics,
} from './cli-runner.service';
import {
  appendLog,
  getLogFilePath,
  makeTimestampedLogName,
  writeDebugFile,
} from './app-log.service';

function persistDiagnosticsFiles(
  diagnostics: CliTestDiagnostics,
  prefix: string,
): CliTestDiagnostics {
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

export class ModelsService {
  listModels(): (ModelConfig & { hasApiKey: boolean })[] {
    const models = getModelConfigs();
    return models.map((m) => ({
      ...m,
      apiKeyEncrypted: undefined,
      hasApiKey: !!m.apiKeyEncrypted,
    }));
  }

  getActiveIds(): Record<ModelKind, string | null> {
    return getActiveModelIds();
  }

  getActive(kind: ModelKind): (ModelConfig & { hasApiKey: boolean }) | null {
    const model = getActiveModel(kind);
    if (!model) return null;
    return {
      ...model,
      apiKeyEncrypted: undefined,
      hasApiKey: !!model.apiKeyEncrypted,
    };
  }

  save(config: Omit<ModelConfig, 'apiKeyEncrypted'> & { apiKey?: string }): { success: boolean } {
    saveModelConfig(config);
    return { success: true };
  }

  delete(id: string): { success: boolean } {
    deleteModelConfig(id);
    return { success: true };
  }

  setActive(kind: ModelKind, id: string): { success: boolean } {
    setActiveModel(kind, id);
    return { success: true };
  }

  getApiKey(id: string): string | null {
    const key = getDecryptedApiKey(id) ?? null;
    return key;
  }

  async testConnection(params: {
    provider:
      | 'anthropic'
      | 'openai'
      | 'gemini'
      | 'openrouter'
      | 'deepseek'
      | 'zhipu'
      | 'minimax'
      | 'moonshot'
      | 'custom';
    model: string;
    apiKey?: string;
    baseURL?: string;
  }): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
    return testApiConnection(params);
  }

  getAgentConfigStatus(tool: AgentToolKind): AgentConfigStatus {
    return getSystemAgentConfigStatus(tool);
  }

  getAgentConfigContents(tool: AgentToolKind): AgentConfigContents {
    return getSystemAgentConfigContents(tool);
  }

  async testSavedConnection(id: string): Promise<{
    success: boolean;
    error?: string;
    output?: string;
    latencyMs?: number;
    diagnostics?: import('./cli-runner.service').CliTestDiagnostics;
    logFile?: string;
  }> {
    appendLog(
      'agent',
      'models:testSavedConnection:start',
      { id, logFile: getLogFilePath('agent.log') },
      'agent.log',
    );
    const models = getModelConfigs();
    const model = models.find((m) => m.id === id);
    if (!model) {
      return { success: false, error: 'Model not found.', logFile: getLogFilePath('agent.log') };
    }

    if (model.backend === 'api') {
      const apiKey = getDecryptedApiKey(id);
      return testApiConnection({
        provider: model.provider ?? 'openai',
        model: model.model ?? '',
        apiKey,
        baseURL: model.baseURL,
      });
    }

    const missingConfigMessage = getMissingAgentConfigMessage(model);
    if (missingConfigMessage) {
      appendLog(
        'agent',
        'models:testSavedConnection:missingConfig',
        { id, error: missingConfigMessage, logFile: getLogFilePath('agent.log') },
        'agent.log',
      );
      return { success: false, error: missingConfigMessage, logFile: getLogFilePath('agent.log') };
    }

    const serviceResult = await callAgentServiceTest({
      command: model.command ?? '',
      envVars: model.envVars,
      agentTool: model.agentTool,
      configContent: model.configContent,
      authContent: model.authContent,
      debugFilePrefix: `saved-model-${id}`,
    });

    const persistedDiagnostics =
      serviceResult.diagnostics && typeof serviceResult.diagnostics === 'object'
        ? persistDiagnosticsFiles(
            serviceResult.diagnostics as CliTestDiagnostics,
            `saved-model-${id}`,
          )
        : undefined;

    if (serviceResult.success) {
      const response = {
        success: true,
        output: serviceResult.output,
        diagnostics: persistedDiagnostics,
        logFile: serviceResult.logFile ?? getLogFilePath('agent.log'),
      };
      appendLog('agent', 'models:testSavedConnection:result', { id, response }, 'agent.log');
      if (persistedDiagnostics) {
        appendLog(
          'agent',
          'models:testSavedConnection:diagnostics',
          { id, diagnostics: persistedDiagnostics, logFile: getLogFilePath('agent.log') },
          'agent.log',
        );
      }
      return response;
    }

    if (persistedDiagnostics) {
      appendLog(
        'agent',
        'models:testSavedConnection:diagnostics',
        {
          id,
          diagnostics: persistedDiagnostics,
          logFile: serviceResult.logFile ?? getLogFilePath('agent.log'),
        },
        'agent.log',
      );
    }
    const response = {
      success: false,
      error: serviceResult.error ?? 'CLI test failed',
      diagnostics: persistedDiagnostics,
      logFile: serviceResult.logFile ?? getLogFilePath('agent.log'),
    };
    appendLog('agent', 'models:testSavedConnection:result', { id, response }, 'agent.log');
    return response;
  }
}

export const modelsService = new ModelsService();
