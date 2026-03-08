// ---- Agent 配置 ----
export type AgentToolKind = 'claude-code' | 'codex';

/**
 * Model option for agent configuration
 */
export interface ModelOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Agent metadata for different CLI tools
 */
export interface AgentToolMeta {
  value: AgentToolKind;
  label: string;
  description: string;
  cliCommand: string;
  defaultAcpArgs: string[];
  configLabel: string;
  configPath?: string;
  authLabel: string;
  authPath?: string;
  supportsYolo: boolean;
  yoloModeId?: string;
  /** Whether this agent type requires API key configuration */
  requiresApiKey: boolean;
  /** Whether this agent type supports custom base URL */
  supportsBaseUrl: boolean;
  /** Available models for this agent type */
  models: ModelOption[];
}

export const AGENT_TOOL_META: AgentToolMeta[] = [
  {
    value: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic\'s official CLI for Claude',
    cliCommand: 'claude',
    defaultAcpArgs: ['--experimental-acp'],
    configLabel: 'Claude Settings',
    configPath: '~/.claude/settings.json',
    authLabel: 'Auth credentials',
    authPath: '~/.claude/credentials.json',
    supportsYolo: true,
    yoloModeId: 'bypassPermissions',
    requiresApiKey: true,
    supportsBaseUrl: true,
    models: [
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most capable' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Balanced' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fast' },
    ],
  },
  {
    value: 'codex',
    label: 'Code X',
    description: 'OpenAI Codex via codex-acp bridge',
    cliCommand: 'codex',
    defaultAcpArgs: [],
    configLabel: 'Code X Config',
    configPath: '~/.codex/config.toml',
    authLabel: 'API Configuration',
    authPath: '~/.codex/auth.json',
    supportsYolo: false,
    requiresApiKey: true,
    supportsBaseUrl: true,
    models: [
      { value: 'gpt-5.4', label: 'GPT 5.4', description: 'Latest' },
      { value: 'gpt-5.3', label: 'GPT 5.3' },
      { value: 'gpt-5.2', label: 'GPT 5.2' },
      { value: 'gpt-5.1', label: 'GPT 5.1' },
      { value: 'o3-high', label: 'O3 High', description: 'High reasoning' },
      { value: 'o3-medium', label: 'O3 Medium', description: 'Medium reasoning' },
      { value: 'o3-low', label: 'O3 Low', description: 'Low reasoning' },
    ],
  },
];

export function getAgentToolMeta(tool: AgentToolKind): AgentToolMeta {
  return AGENT_TOOL_META.find(m => m.value === tool) || AGENT_TOOL_META[AGENT_TOOL_META.length - 1];
}

export interface AgentConfigItem {
  id: string;
  name: string;
  backend: string;
  cliPath: string | null;
  acpArgs: string[];
  agentTool?: AgentToolKind;
  configContent?: string;
  authContent?: string;
  extraEnv?: Record<string, string>;
  defaultModel?: string | null;
  /** API key for Code X agent */
  apiKey?: string;
  /** Base URL for Code X agent */
  baseUrl?: string;
  isDetected: boolean;
  isCustom: boolean;
  enabled: boolean;
}

export interface DetectedAgentItem {
  backend: string;
  name: string;
  cliPath: string;
  acpArgs: string[];
}

export interface AddAgentInput {
  name: string;
  backend: string;
  cliPath: string;
  acpArgs?: string[];
  agentTool?: AgentToolKind;
  configContent?: string;
  authContent?: string;
  extraEnv?: Record<string, string>;
  defaultModel?: string;
  /** API key for Code X agent */
  apiKey?: string;
  /** Base URL for Code X agent */
  baseUrl?: string;
  enabled?: boolean;
  isCustom?: boolean;
}

// ---- TODO ----
export interface AgentTodoItem {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  agentId: string;
  agent: AgentConfigItem;
  status: string;
  priority: number;
  cronExpr: string | null;
  cronEnabled: boolean;
  yoloMode: boolean;
  model: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectId?: string | null;
}

export interface AgentTodoDetail extends AgentTodoItem {
  runs: AgentTodoRunItem[];
}

export interface CreateAgentTodoInput {
  title: string;
  prompt: string;
  cwd: string;
  agentId: string;
  projectId?: string;
  priority?: number;
  cronExpr?: string;
  yoloMode?: boolean;
  model?: string | null;
}

export interface AgentTodoQuery {
  status?: string;
  projectId?: string;
}

// ---- 执行记录 ----
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface AgentTodoRunItem {
  id: string;
  todoId: string;
  status: string;
  trigger: string;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorMessage: string | null;
  summary: string | null;
  tokenUsage: string | null;
  createdAt: string;
}

// ---- 消息 ----
export interface AgentTodoMessageItem {
  id: string;
  runId: string;
  msgId: string;
  type: 'text' | 'tool_call' | 'thought' | 'plan' | 'permission' | 'system' | 'error';
  role: 'user' | 'assistant' | 'system';
  content: unknown;
  status: string | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: string;
}

// ---- 事件 ----
export interface StreamEventData {
  todoId: string;
  runId: string;
  message: AgentTodoMessageItem;
}

export interface StatusEventData {
  todoId: string;
  status: string;
  message?: string;
}

export interface PermissionRequestData {
  todoId: string;
  runId: string;
  requestId: number;
  request: {
    options: Array<{
      optionId: string;
      name: string;
      kind: string;
    }>;
    toolCall: {
      toolCallId: string;
      title: string;
      kind: string;
      rawInput?: Record<string, unknown>;
    };
  };
}
