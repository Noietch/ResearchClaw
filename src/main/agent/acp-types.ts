// ACP 协议类型定义

export interface AgentCliConfig {
  backend: 'claude' | 'codex' | 'gemini';
  cliPath: string;
  acpArgs: string[];
  extraEnv?: Record<string, string>;
}

export const DEFAULT_AGENT_CONFIGS: Record<string, Omit<AgentCliConfig, 'cliPath'>> = {
  claude: {
    backend: 'claude',
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
};

export type AcpSessionUpdateType =
  | 'agent_message_chunk'
  | 'agent_thought_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'plan'
  | 'config_option_update';

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
