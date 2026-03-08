// ---- Agent 配置 ----
export interface AgentConfigItem {
  id: string;
  name: string;
  backend: string;
  cliPath: string | null;
  acpArgs: string[];
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
  extraEnv?: Record<string, string>;
  enabled?: boolean;
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
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
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
}

export interface AgentTodoQuery {
  status?: string;
  projectId?: string;
}

// ---- 执行记录 ----
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
