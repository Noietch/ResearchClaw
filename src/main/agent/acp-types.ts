// ACP 协议类型定义

export type AgentBackendType = 'claude-code' | 'codex' | 'gemini' | 'qwen' | 'goose' | 'custom';

export interface AgentCliConfig {
  backend: AgentBackendType;
  cliPath: string;
  acpArgs: string[];
  extraEnv?: Record<string, string>;
}

/**
 * Default configurations for different agent backends
 * Each backend has different ACP activation conventions:
 * - Claude Code: --experimental-acp (supports bypassPermissions YOLO mode)
 * - Codex: uses npx @zed-industries/codex-acp bridge (supports 'full-access' YOLO mode)
 * - Gemini: --experimental-acp (supports 'yolo' mode)
 * - Qwen: --acp (supports 'yolo' mode)
 * - Goose: acp subcommand (GOOSE_MODE=auto for YOLO)
 */
export const DEFAULT_AGENT_CONFIGS: Record<string, Omit<AgentCliConfig, 'cliPath'>> = {
  'claude-code': {
    backend: 'claude-code',
    acpArgs: ['--experimental-acp'],
  },
  codex: {
    backend: 'codex',
    acpArgs: [],
  },
  gemini: {
    backend: 'gemini',
    acpArgs: ['--experimental-acp'],
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
    acpArgs: ['--experimental-acp'],
  },
};

/**
 * YOLO (auto-approve) mode IDs for different backends
 * These are passed to session/set_mode to enable automatic permission approval
 */
export const YOLO_MODE_IDS: Partial<Record<AgentBackendType, string>> = {
  'claude-code': 'bypassPermissions',
  codex: 'full-access',
  gemini: 'yolo',
  qwen: 'yolo',
};

export type AcpSessionUpdateType =
  | 'agent_message_chunk'
  | 'agent_thought_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'plan'
  | 'config_option_update'
  | 'available_commands_update';

export interface AcpSlashCommand {
  name: string;
  description: string;
  input?: { hint?: string } | null;
}

export interface AcpSessionUpdate {
  sessionUpdate: AcpSessionUpdateType;
  content?: { type: 'text' | 'image'; text?: string; data?: string };
  toolCallId?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  title?: string;
  kind?: 'read' | 'edit' | 'execute' | 'mcp';
  rawInput?: Record<string, unknown>;
  locations?: Array<{ path: string }>;
  entries?: Array<{ content: string; status: string; priority?: string }>;
  availableCommands?: AcpSlashCommand[];
}

export interface AcpPermissionRequest {
  options: Array<{
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  }>;
  toolCall: {
    toolCallId: string;
    title: string;
    kind: string;
    rawInput?: Record<string, unknown>;
  };
}
