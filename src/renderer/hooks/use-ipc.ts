/**
 * IPC client for the renderer process.
 * Replaces apps/web/src/components/api-client.ts
 */

import type {
  AgentConfigItem,
  DetectedAgentItem,
  AddAgentInput,
  AgentTodoItem,
  AgentTodoDetail,
  CreateAgentTodoInput,
  AgentTodoQuery,
  AgentTodoRunItem,
  AgentTodoMessageItem,
  AgentToolKind,
} from '@shared';

declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      off: (channel: string, listener: (...args: unknown[]) => void) => void;
      once: (channel: string, listener: (...args: unknown[]) => void) => void;
      readLocalFile: (path: string) => Promise<string>;
      // Window controls
      windowClose: () => Promise<void>;
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
    };
  }
}

function getElectronAPI() {
  return typeof window === 'undefined' ? undefined : window.electronAPI;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const electronAPI = getElectronAPI();
  if (!electronAPI) {
    return Promise.reject(
      new Error(`IPC unavailable for channel "${channel}": Electron preload API not found.`),
    );
  }

  const result = await electronAPI.invoke(channel, ...args);
  // Check if result is an IpcResult wrapper (has 'success' AND either 'data' or 'error' as top-level keys)
  // This distinguishes IpcResult { success, data?, error? } from direct result objects like { success, output, ... }
  if (
    result !== null &&
    typeof result === 'object' &&
    'success' in (result as object) &&
    ('data' in (result as object) || 'error' in (result as object))
  ) {
    const ipcResult = result as { success: boolean; data?: T; error?: string };
    if (!ipcResult.success) throw new Error(ipcResult.error ?? 'IPC error');
    return ipcResult.data as T;
  }

  return result as T;
}

export type ImportPhase =
  | 'idle'
  | 'scanning'
  | 'parsing_history'
  | 'upserting_papers'
  | 'downloading_pdfs'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ImportStatus {
  active: boolean;
  total: number;
  completed: number;
  success: number;
  failed: number;
  skipped: number;
  phase: ImportPhase;
  message: string;
  lastImportAt: string | null;
  lastImportCount: number;
}

export interface ScanResult {
  papers: Array<{ arxivId: string; title: string; url: string }>;
  newCount: number;
  existingCount: number;
}

export interface PaperItem {
  id: string;
  shortId: string;
  title: string;
  authors?: string[];
  submittedAt?: string;
  abstract?: string;
  tagNames?: string[];
  categorizedTags?: Array<{ name: string; category: string }>;
  pdfUrl?: string;
  pdfPath?: string;
  sourceUrl?: string;
  processingStatus?: string;
  processingError?: string | null;
  processedAt?: string | null;
  indexedAt?: string | null;
  metadataSource?: string | null;
  rating?: number | null;
  createdAt?: string;
  lastReadAt?: string | null;
}

export interface PaperProcessingInfo {
  paperId: string;
  processingStatus: string;
  processingError?: string | null;
  processedAt?: string | null;
  indexedAt?: string | null;
  metadataSource?: string | null;
}

export interface TaggingStatus {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  currentPaperId: string | null;
  currentPaperTitle?: string | null;
  stage?:
    | 'idle'
    | 'building_prompt'
    | 'requesting_model'
    | 'streaming'
    | 'parsing'
    | 'saving'
    | 'done'
    | 'error';
  partialText?: string;
  message: string;
}

export interface TagInfo {
  name: string;
  category: string;
  count: number;
}

export interface ConsolidationSuggestion {
  merges: Array<{ keep: string; remove: string[]; reason: string }>;
  recategorize: Array<{ tag: string; from: string; to: string; reason: string }>;
}

export interface AgenticSearchStep {
  type: 'thinking' | 'searching' | 'found' | 'reasoning' | 'done';
  message: string;
  keywords?: string[];
  foundCount?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface SourceEvent {
  id: string;
  paperId: string;
  source: 'chrome' | 'manual' | 'arxiv';
  rawTitle?: string | null;
  rawUrl?: string | null;
  importedAt: string;
}

export interface AgenticSearchPaper {
  id: string;
  shortId: string;
  title: string;
  authors?: string[];
  submittedAt?: string;
  tagNames?: string[];
  abstract?: string;
  relevanceReason?: string;
  processingStatus?: string;
}

export interface AgenticSearchResult {
  steps: AgenticSearchStep[];
  papers: AgenticSearchPaper[];
}

export interface SemanticSearchPaper {
  id: string;
  shortId: string;
  title: string;
  authors?: string[];
  submittedAt?: string | null;
  tagNames?: string[];
  abstract?: string | null;
  relevanceReason?: string;
  similarityScore: number;
  matchedChunks: string[];
  processingStatus?: string;
}

export interface SemanticSearchResult {
  mode: 'semantic' | 'fallback';
  papers: SemanticSearchPaper[];
  fallbackReason?: string;
}

export interface ReadingNote {
  id: string;
  title: string;
  contentJson: string;
  content: Record<string, unknown>;
  chatNoteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperAnalysis {
  summary: string;
  problem: string;
  method: string;
  contributions: string[];
  evidence: string;
  limitations: string[];
  applications: string[];
  questions: string[];
  tags: string[];
}

export interface ProjectRepo {
  id: string;
  projectId: string;
  repoUrl: string;
  localPath?: string | null;
  clonedAt?: string | null;
  isWorkdirRepo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkdirRepoStatus {
  hasGit: boolean;
  remoteUrl?: string;
  localPath: string;
}

export interface ProjectIdea {
  id: string;
  projectId: string;
  title: string;
  content: string;
  paperIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
  workdir?: string | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
  repos: ProjectRepo[];
  ideas: ProjectIdea[];
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface CloneResult {
  success: boolean;
  localPath?: string;
  error?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  model: string;
  baseURL?: string;
  enabled: boolean;
  hasApiKey?: boolean;
}

export interface CliTool {
  name: string;
  displayName: string;
  command: string;
  isInstalled: boolean;
  version?: string;
}

export type ProviderKind = 'anthropic' | 'openai' | 'gemini' | 'custom';

export type ModelKind = 'agent' | 'lightweight' | 'chat';
export type ModelBackend = 'api' | 'cli';
export type { AgentToolKind };

export interface ProxyScope {
  pdfDownload: boolean;
  aiApi: boolean;
  cliTools: boolean;
}

export interface SemanticSearchSettings {
  enabled: boolean;
  autoProcess: boolean;
  autoStartOllama: boolean;
  baseUrl: string;
  metadataModel: string;
  embeddingModel: string;
}

export interface ProxyTestResult {
  url: string;
  name: string;
  success: boolean;
  latency?: number;
  error?: string;
}

export interface TokenUsageRecord {
  timestamp: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  kind: 'agent' | 'lightweight' | 'chat' | 'other';
}

export interface TokenUsageSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCalls: number;
  byProvider: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  byModel: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  byKind: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  lastUpdated: string | null;
}

export interface AgentConfigFileStatus {
  label: string;
  path: string;
  exists: boolean;
}

export interface AgentConfigStatus {
  tool: AgentToolKind;
  files: AgentConfigFileStatus[];
  missingRequired: boolean;
}

export interface AgentConfigContents {
  tool: AgentToolKind;
  configContent?: string;
  authContent?: string;
}

export interface CliTestDiagnostics {
  command: string;
  args: string[];
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  structuredOutput?: string;
  stdoutFile?: string;
  stderrFile?: string;
  structuredOutputFile?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  backend: ModelBackend;
  provider?: 'anthropic' | 'openai' | 'gemini' | 'custom';
  model?: string;
  baseURL?: string;
  command?: string;
  envVars?: string;
  agentTool?: AgentToolKind;
  configContent?: string;
  authContent?: string;
  hasApiKey?: boolean;
}

export interface CliConfig {
  id: string;
  name: string;
  command: string;
  envVars: string;
  provider: ProviderKind;
  active: boolean;
  useProxy?: boolean;
}

export const ipc = {
  // Papers
  listPapers: (query?: {
    q?: string;
    year?: number;
    tag?: string;
    importedWithin?: 'today' | 'week' | 'month' | 'all';
  }) => invoke<PaperItem[]>('papers:list', query ?? {}),
  listTodayPapers: () => invoke<PaperItem[]>('papers:listToday'),
  createPaper: (input: Record<string, unknown>) => invoke<PaperItem>('papers:create', input),
  importLocalPdf: (filePath: string) => invoke<PaperItem>('papers:importLocalPdf', filePath),
  downloadPaper: (input: string, tags?: string[]) =>
    invoke<{
      paper: PaperItem;
      download: { success: boolean; size: number; skipped: boolean };
      existed: boolean;
    }>('papers:download', input, tags),
  getPaper: (id: string) => invoke<PaperItem>('papers:getById', id),
  getPaperByShortId: (shortId: string) => invoke<PaperItem>('papers:getByShortId', shortId),
  getPaperProcessingStatus: (paperId: string) =>
    invoke<PaperProcessingInfo | null>('papers:getProcessingStatus', paperId),
  retryPaperProcessing: (paperId: string) =>
    invoke<{ queued: boolean }>('papers:retryProcessing', paperId),
  downloadPdf: (paperId: string, pdfUrl: string) =>
    invoke<{ pdfPath: string; size: number; skipped: boolean }>(
      'papers:downloadPdf',
      paperId,
      pdfUrl,
    ),
  deletePaper: (id: string) => invoke<PaperItem | null>('papers:delete', id),
  deletePapers: (ids: string[]) => invoke<number>('papers:deleteMany', ids),
  touchPaper: (id: string) => invoke<void>('papers:touch', id),
  updatePaperTags: (id: string, tags: string[]) => invoke<PaperItem>('papers:updateTags', id, tags),
  updatePaperRating: (id: string, rating: number | null) =>
    invoke<PaperItem>('papers:updateRating', id, rating),
  listAllTags: () => invoke<TagInfo[]>('papers:listTags'),
  agenticSearch: (query: string) => invoke<AgenticSearchResult>('papers:agenticSearch', query),
  semanticSearch: (query: string, limit?: number) =>
    invoke<SemanticSearchResult>('papers:semanticSearch', query, limit),
  getSourceEvents: (paperId: string) => invoke<SourceEvent[]>('papers:getSourceEvents', paperId),

  // Tagging
  tagPaper: (paperId: string) =>
    invoke<Array<{ name: string; category: string }>>('tagging:tagPaper', paperId),
  organizePaperTags: (paperId: string) =>
    invoke<Array<{ name: string; category: string }>>('tagging:organizePaper', paperId),
  tagUntagged: () => invoke<{ started: boolean }>('tagging:tagUntagged'),
  cancelTagging: () => invoke<{ cancelled: boolean }>('tagging:cancel'),
  getTaggingStatus: () => invoke<TaggingStatus>('tagging:status'),
  suggestConsolidation: () => invoke<ConsolidationSuggestion>('tagging:suggestConsolidation'),
  mergeTag: (keep: string, remove: string[]) =>
    invoke<{ success: boolean }>('tagging:merge', keep, remove),
  recategorizeTag: (name: string, newCategory: string) =>
    invoke<{ success: boolean }>('tagging:recategorize', name, newCategory),
  renameTag: (oldName: string, newName: string) =>
    invoke<{ success: boolean }>('tagging:rename', oldName, newName),
  deleteTag: (name: string) => invoke<{ success: boolean }>('tagging:deleteTag', name),

  // Reading
  listReading: (paperId: string) => invoke<ReadingNote[]>('reading:listByPaper', paperId),
  createReading: (input: Record<string, unknown>) => invoke<ReadingNote>('reading:create', input),
  updateReading: (id: string, content: Record<string, unknown>) =>
    invoke<ReadingNote>('reading:update', id, content),
  getReading: (id: string) => invoke<ReadingNote>('reading:getById', id),
  deleteReading: (id: string) => invoke<ReadingNote>('reading:delete', id),
  saveChat: (input: { paperId: string; noteId: string | null; messages: unknown[] }) =>
    invoke<{ id: string }>('reading:saveChat', input),
  analyzePaper: (input: { sessionId: string; paperId: string; pdfUrl?: string }) =>
    invoke<{ sessionId: string; started: boolean }>('reading:analyze', input),
  killAnalysis: (sessionId: string) =>
    invoke<{ killed: boolean }>('reading:analyzeKill', sessionId),
  chat: (input: { sessionId: string; paperId: string; messages: unknown[]; pdfUrl?: string }) =>
    invoke<{ sessionId: string; started: boolean }>('reading:chat', input),
  killChat: (sessionId: string) => invoke<{ killed: boolean }>('reading:chatKill', sessionId),
  aiEditNotes: (input: {
    paperId: string;
    instruction: string;
    currentNotes: Record<string, string>;
    pdfUrl?: string;
  }) => invoke<Record<string, string>>('reading:aiEdit', input),
  extractPdfUrl: (paperId: string) => invoke<string | null>('reading:extractPdfUrl', paperId),
  generateNotes: (chatNoteId: string) =>
    invoke<{ id: string; title: string; contentJson: string }>('reading:generateNotes', chatNoteId),

  // Projects
  listProjects: () => invoke<ProjectItem[]>('projects:list'),
  createProject: (input: { name: string; description?: string; workdir?: string }) =>
    invoke<ProjectItem>('projects:create', input),
  updateProject: (id: string, data: { name?: string; description?: string; workdir?: string }) =>
    invoke<ProjectItem>('projects:update', id, data),
  deleteProject: (id: string) => invoke<ProjectItem>('projects:delete', id),
  touchProject: (id: string) => invoke<void>('projects:touch', id),

  addRepo: (input: { projectId: string; repoUrl: string }) =>
    invoke<ProjectRepo>('projects:repo:add', input),
  cloneRepo: (repoId: string, repoUrl: string) =>
    invoke<CloneResult>('projects:repo:clone', repoId, repoUrl),
  getCommits: (localPath: string, limit?: number) =>
    invoke<CommitInfo[]>('projects:repo:commits', localPath, limit),
  deleteRepo: (id: string) => invoke<ProjectRepo>('projects:repo:delete', id),

  // Workdir repo (no clone needed)
  checkWorkdirGit: (projectId: string) =>
    invoke<WorkdirRepoStatus | null>('projects:workdir:check', projectId),
  addWorkdirRepo: (projectId: string) =>
    invoke<{ id: string; repoUrl: string; localPath: string } | null>(
      'projects:workdir:addRepo',
      projectId,
    ),

  createProjectIdea: (input: {
    projectId: string;
    title: string;
    content: string;
    paperIds?: string[];
  }) => invoke<ProjectIdea>('projects:idea:create', input),
  generateProjectIdea: (input: { projectId: string; paperIds: string[]; repoIds?: string[] }) =>
    invoke<{ id: string; title: string; content: string }>('projects:idea:generate', input),
  updateProjectIdea: (id: string, data: { title?: string; content?: string }) =>
    invoke<ProjectIdea>('projects:idea:update', id, data),
  deleteProjectIdea: (id: string) => invoke<ProjectIdea>('projects:idea:delete', id),

  startIdeaChat: (input: {
    sessionId: string;
    projectId: string;
    paperIds: string[];
    repoIds?: string[];
    messages: { role: 'user' | 'assistant'; content: string }[];
  }) => invoke<{ sessionId: string; started: boolean }>('projects:idea:chat', input),
  killIdeaChat: (sessionId: string) =>
    invoke<{ killed: boolean }>('projects:idea:chatKill', sessionId),
  extractTaskFromChat: (input: {
    projectId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }) => invoke<{ title: string; prompt: string }>('projects:idea:extract-task', input),

  // Ingest
  importChromeHistoryFromFile: (filePath: string) =>
    invoke<{ imported: number; previewTitles: string[] }>('ingest:chromeHistoryFromFile', filePath),
  importChromeHistoryAuto: (days: number | null = 1) =>
    invoke<{ imported: number; previewTitles: string[] }>('ingest:chromeHistoryAuto', days),
  scanLocalPapersDir: (dir: string) => invoke<{ started: boolean }>('ingest:scanLocalDir', dir),
  getImportStatus: () => invoke<ImportStatus>('ingest:status'),
  // New scan/import flow
  scanChromeHistory: (days: number | null = 1) => invoke<ScanResult>('ingest:scan', days),
  importScannedPapers: (papers: ScanResult['papers']) =>
    invoke<{ started: boolean }>('ingest:importScanned', papers),
  cancelImport: () => invoke<{ cancelled: boolean }>('ingest:cancel'),

  // Providers
  listProviders: () => invoke<ProviderConfig[]>('providers:list'),
  saveProvider: (config: Record<string, unknown>) =>
    invoke<{ success: boolean }>('providers:save', config),
  getActiveProvider: () => invoke<string>('providers:getActive'),
  setActiveProvider: (id: string) => invoke<{ success: boolean }>('providers:setActive', id),

  // App settings
  getSettings: () =>
    invoke<{ papersDir: string; editorCommand: string; proxy?: string; proxyScope?: ProxyScope }>(
      'settings:get',
    ),
  setPapersDir: (dir: string) => invoke<{ success: boolean }>('settings:setPapersDir', dir),
  setEditor: (cmd: string) => invoke<{ success: boolean }>('settings:setEditor', cmd),
  setProxy: (proxy: string | undefined) => invoke<{ success: boolean }>('settings:setProxy', proxy),
  setProxyScope: (scope: ProxyScope) =>
    invoke<{ success: boolean }>('settings:setProxyScope', scope),
  testProxy: (proxyUrl?: string) =>
    invoke<{ hasProxy: boolean; results: ProxyTestResult[] }>('settings:testProxy', proxyUrl),
  selectFolder: () => invoke<string | null>('settings:selectFolder'),
  selectPdfFile: () => invoke<string | null>('settings:selectPdfFile'),
  getStorageRoot: () => invoke<string>('settings:getStorageRoot'),
  getSemanticSearchSettings: () => invoke<SemanticSearchSettings>('settings:getSemanticSearch'),
  setSemanticSearchSettings: (settings: Partial<SemanticSearchSettings>) =>
    invoke<{ success: boolean }>('settings:setSemanticSearch', settings),

  // Shell
  openInEditor: (dirPath: string) =>
    invoke<{ success: boolean; error?: string }>('shell:openInEditor', dirPath),

  // CLI tools
  detectCliTools: () => invoke<CliTool[]>('cli:detect'),
  testCli: (command: string, extraArgs?: string, envVars?: string) =>
    invoke<{
      success: boolean;
      output?: string;
      error?: string;
      diagnostics?: CliTestDiagnostics;
      logFile?: string;
    }>('cli:test', command, extraArgs, envVars),
  testAgentCli: (options: {
    command: string;
    extraArgs?: string;
    envVars?: string;
    agentTool?: AgentToolKind;
    configContent?: string;
    authContent?: string;
  }) =>
    invoke<{
      success: boolean;
      output?: string;
      error?: string;
      diagnostics?: CliTestDiagnostics;
      logFile?: string;
    }>('cli:testAgent', options),
  runCli: (options: {
    tool: string;
    args: string[];
    sessionId: string;
    cwd?: string;
    envVars?: string;
    useProxy?: boolean;
    displayLabel?: string;
    homeFiles?: Array<{ relativePath: string; content: string }>;
    modelId?: string;
  }) => invoke<{ sessionId: string; started: boolean }>('cli:run', options),
  killCli: (sessionId: string) => invoke<{ killed: boolean }>('cli:kill', sessionId),

  // CLI tools config (persisted in ~/.vibe-research/)
  listCliConfigs: () => invoke<CliConfig[]>('cliTools:list'),
  saveCliConfigs: (tools: CliConfig[]) => invoke<{ success: boolean }>('cliTools:save', tools),

  // Models (new unified config)
  listModels: () => invoke<ModelConfig[]>('models:list'),
  getActiveModelIds: () => invoke<Record<ModelKind, string | null>>('models:getActiveIds'),
  getActiveModel: (kind: ModelKind) => invoke<ModelConfig | null>('models:getActive', kind),
  saveModel: (config: Omit<ModelConfig, 'hasApiKey'> & { apiKey?: string }) =>
    invoke<{ success: boolean }>('models:save', config),
  deleteModel: (id: string) => invoke<{ success: boolean }>('models:delete', id),
  setActiveModel: (kind: ModelKind, id: string) =>
    invoke<{ success: boolean }>('models:setActive', kind, id),
  testSavedModelConnection: (id: string) =>
    invoke<{
      success: boolean;
      error?: string;
      output?: string;
      diagnostics?: CliTestDiagnostics;
      logFile?: string;
    }>('models:testSavedConnection', id),
  getModelApiKey: (id: string) => invoke<string | null>('models:getApiKey', id),
  getAgentConfigStatus: (tool: AgentToolKind) =>
    invoke<AgentConfigStatus>('models:getAgentConfigStatus', tool),
  getAgentConfigContents: (tool: AgentToolKind) =>
    invoke<AgentConfigContents>('models:getAgentConfigContents', tool),
  testModelConnection: (params: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'custom';
    model: string;
    apiKey?: string;
    baseURL?: string;
  }) => invoke<{ success: boolean; error?: string }>('models:testConnection', params),

  // Token Usage
  getTokenUsageSummary: () =>
    invoke<{
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalTokens: number;
      totalCalls: number;
      byProvider: Record<
        string,
        { prompt: number; completion: number; total: number; calls: number }
      >;
      byModel: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
      byKind: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
      lastUpdated: string | null;
    }>('tokenUsage:getSummary'),
  getTokenUsageRecords: () =>
    invoke<
      Array<{
        timestamp: string;
        provider: string;
        model: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        kind: 'agent' | 'lightweight' | 'chat' | 'other';
      }>
    >('tokenUsage:getRecords'),
  clearTokenUsage: () => invoke<{ success: boolean }>('tokenUsage:clear'),

  // Agent Tasks
  detectAgents: () => invoke<DetectedAgentItem[]>('agent-todo:detect-agents'),
  listAgents: () => invoke<AgentConfigItem[]>('agent-todo:list-agents'),
  addAgent: (input: AddAgentInput) => invoke<AgentConfigItem>('agent-todo:add-agent', input),
  updateAgent: (id: string, input: Partial<AddAgentInput>) =>
    invoke<AgentConfigItem>('agent-todo:update-agent', id, input),
  removeAgent: (id: string) => invoke<void>('agent-todo:remove-agent', id),
  listAgentTodos: (query?: AgentTodoQuery) => invoke<AgentTodoItem[]>('agent-todo:list', query),
  getAgentTodo: (id: string) => invoke<AgentTodoDetail>('agent-todo:get', id),
  createAgentTodo: (input: CreateAgentTodoInput) =>
    invoke<AgentTodoItem>('agent-todo:create', input),
  updateAgentTodo: (id: string, input: Partial<CreateAgentTodoInput>) =>
    invoke<AgentTodoItem>('agent-todo:update', id, input),
  deleteAgentTodo: (id: string) => invoke<void>('agent-todo:delete', id),
  runAgentTodo: (todoId: string) => invoke<AgentTodoRunItem>('agent-todo:run', todoId),
  stopAgentTodo: (todoId: string) => invoke<void>('agent-todo:stop', todoId),
  confirmAgentPermission: (todoId: string, requestId: number, optionId: string) =>
    invoke<void>('agent-todo:confirm', todoId, requestId, optionId),
  listAgentTodoRuns: (todoId: string) => invoke<AgentTodoRunItem[]>('agent-todo:list-runs', todoId),
  getAgentTodoRunMessages: (runId: string) =>
    invoke<AgentTodoMessageItem[]>('agent-todo:get-run-messages', runId),
  deleteAgentTodoRun: (runId: string) => invoke<void>('agent-todo:delete-run', runId),
  enableAgentTodoCron: (todoId: string, cronExpr: string) =>
    invoke<void>('agent-todo:enable-cron', todoId, cronExpr),
  disableAgentTodoCron: (todoId: string) => invoke<void>('agent-todo:disable-cron', todoId),

  // Window controls (for Windows title bar)
  windowClose: () => {
    const api = getElectronAPI();
    return api?.windowClose?.() ?? Promise.resolve();
  },
  windowMinimize: () => {
    const api = getElectronAPI();
    return api?.windowMinimize?.() ?? Promise.resolve();
  },
  windowMaximize: () => {
    const api = getElectronAPI();
    return api?.windowMaximize?.() ?? Promise.resolve();
  },
  windowIsMaximized: () => {
    const api = getElectronAPI();
    return api?.windowIsMaximized?.() ?? Promise.resolve(false);
  },
};

/** Subscribe to IPC events from main process */
export function onIpc(channel: string, listener: (...args: unknown[]) => void): () => void {
  const electronAPI = getElectronAPI();
  if (!electronAPI) {
    return () => undefined;
  }

  return electronAPI.on(channel, listener);
}
