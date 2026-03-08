// ACP 协议类型定义
// 使用 @agentclientprotocol/sdk 的官方类型，替换原来的手写类型

export type {
  SessionNotification,
  SessionUpdate,
  RequestPermissionRequest,
  RequestPermissionResponse,
  RequestPermissionOutcome,
  SelectedPermissionOutcome,
  NewSessionResponse,
  InitializeResponse,
  PromptResponse,
} from '@agentclientprotocol/sdk';

export type AgentBackendType = 'claude-code' | 'codex' | 'gemini' | 'qwen' | 'goose' | 'custom';

export interface AgentCliConfig {
  backend: AgentBackendType;
  cliPath: string;
  acpArgs: string[];
  extraEnv?: Record<string, string>;
}

/**
 * Default configurations for different agent backends.
 *
 * All backends expose the ACP protocol via stdin/stdout JSON-RPC.
 *
 * - claude-code: spawned via `claude-agent-acp` bridge (uses @anthropic-ai/claude-agent-sdk)
 * - codex:       npx @zed-industries/codex-acp bridge
 * - gemini:      gemini --experimental-acp
 * - qwen:        qwen --acp
 * - goose:       goose acp
 */
export const DEFAULT_AGENT_CONFIGS: Record<string, Omit<AgentCliConfig, 'cliPath'>> = {
  'claude-code': {
    backend: 'claude-code',
    acpArgs: [],
  },
  codex: {
    backend: 'codex',
    acpArgs: [],
  },
  gemini: {
    backend: 'gemini',
    acpArgs: ['--acp'],
  },
  qwen: {
    backend: 'qwen',
    acpArgs: ['--acp'],
  },
  goose: {
    backend: 'goose',
    acpArgs: ['acp'],
  },
  custom: {
    backend: 'custom',
    acpArgs: [],
  },
};

/**
 * YOLO (auto-approve) mode IDs for different backends.
 * Passed to session/setMode to enable automatic permission approval.
 */
export const YOLO_MODE_IDS: Partial<Record<AgentBackendType, string>> = {
  'claude-code': 'bypassPermissions',
  codex: 'full-access',
  gemini: 'yolo',
  qwen: 'yolo',
};
