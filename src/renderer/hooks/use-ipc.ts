/**
 * IPC client for the renderer process.
 * Replaces apps/web/src/components/api-client.ts
 */

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      off: (channel: string, listener: (...args: unknown[]) => void) => void;
      once: (channel: string, listener: (...args: unknown[]) => void) => void;
      readLocalFile: (path: string) => Promise<string>;
    };
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.electronAPI) throw new Error('electronAPI not available (not running in Electron)');
  const result = await window.electronAPI.invoke(channel, ...args);
  // Unwrap IpcResult envelope { success, data, error } if present
  if (result !== null && typeof result === 'object' && 'success' in (result as object)) {
    const r = result as { success: boolean; data?: T; error?: string };
    if (!r.success) throw new Error(r.error ?? 'IPC error');
    return r.data as T;
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
  year?: number;
  abstract?: string;
  tagNames?: string[];
  categorizedTags?: Array<{ name: string; category: string }>;
  pdfUrl?: string;
  pdfPath?: string;
  sourceUrl?: string;
  rating?: number | null;
  createdAt?: string;
  lastReadAt?: string | null;
}

export interface TaggingStatus {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  currentPaperId: string | null;
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
  year?: number;
  tagNames?: string[];
  abstract?: string;
  relevanceReason?: string;
}

export interface AgenticSearchResult {
  steps: AgenticSearchStep[];
  papers: AgenticSearchPaper[];
}

export interface ReadingNote {
  id: string;
  title: string;
  contentJson: string;
  content: Record<string, string>;
  chatNoteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTodo {
  id: string;
  projectId: string;
  text: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRepo {
  id: string;
  projectId: string;
  repoUrl: string;
  localPath?: string | null;
  clonedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
  todos: ProjectTodo[];
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

export interface ModelConfig {
  id: string;
  name: string;
  kind: ModelKind;
  backend: ModelBackend;
  provider?: 'anthropic' | 'openai' | 'gemini' | 'custom';
  model?: string;
  baseURL?: string;
  command?: string;
  envVars?: string;
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
  downloadPaper: (input: string, tags?: string[]) =>
    invoke<{
      paper: PaperItem;
      download: { success: boolean; size: number; skipped: boolean };
      existed: boolean;
    }>('papers:download', input, tags),
  getPaper: (id: string) => invoke<PaperItem>('papers:getById', id),
  getPaperByShortId: (shortId: string) => invoke<PaperItem>('papers:getByShortId', shortId),
  downloadPdf: (paperId: string, pdfUrl: string) =>
    invoke<{ pdfPath: string; size: number; skipped: boolean }>(
      'papers:downloadPdf',
      paperId,
      pdfUrl,
    ),
  deletePaper: (id: string) => invoke<PaperItem | null>('papers:delete', id),
  deletePapers: (ids: string[]) => invoke<number>('papers:deleteMany', ids),
  touchPaper: (id: string) => invoke<void>('papers:touch', id),
  fixUrlTitles: () => invoke<{ fixed: number; failed: number }>('papers:fixUrlTitles'),
  stripArxivIdPrefix: () => invoke<{ updated: number }>('papers:stripArxivIdPrefix'),
  updatePaperTags: (id: string, tags: string[]) => invoke<PaperItem>('papers:updateTags', id, tags),
  updatePaperRating: (id: string, rating: number | null) =>
    invoke<PaperItem>('papers:updateRating', id, rating),
  listAllTags: () => invoke<TagInfo[]>('papers:listTags'),
  agenticSearch: (query: string) => invoke<AgenticSearchResult>('papers:agenticSearch', query),
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
  createProject: (input: { name: string; description?: string }) =>
    invoke<ProjectItem>('projects:create', input),
  updateProject: (id: string, data: { name?: string; description?: string }) =>
    invoke<ProjectItem>('projects:update', id, data),
  deleteProject: (id: string) => invoke<ProjectItem>('projects:delete', id),
  touchProject: (id: string) => invoke<void>('projects:touch', id),

  createTodo: (input: { projectId: string; text: string }) =>
    invoke<ProjectTodo>('projects:todo:create', input),
  updateTodo: (id: string, data: { text?: string; done?: boolean }) =>
    invoke<ProjectTodo>('projects:todo:update', id, data),
  deleteTodo: (id: string) => invoke<ProjectTodo>('projects:todo:delete', id),

  addRepo: (input: { projectId: string; repoUrl: string }) =>
    invoke<ProjectRepo>('projects:repo:add', input),
  cloneRepo: (repoId: string, repoUrl: string) =>
    invoke<CloneResult>('projects:repo:clone', repoId, repoUrl),
  getCommits: (localPath: string, limit?: number) =>
    invoke<CommitInfo[]>('projects:repo:commits', localPath, limit),
  deleteRepo: (id: string) => invoke<ProjectRepo>('projects:repo:delete', id),

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
    invoke<{ papersDir: string; editorCommand: string; proxy?: string }>('settings:get'),
  setPapersDir: (dir: string) => invoke<{ success: boolean }>('settings:setPapersDir', dir),
  setEditor: (cmd: string) => invoke<{ success: boolean }>('settings:setEditor', cmd),
  setProxy: (proxy: string | undefined) => invoke<{ success: boolean }>('settings:setProxy', proxy),
  selectFolder: () => invoke<string | null>('settings:selectFolder'),
  getStorageRoot: () => invoke<string>('settings:getStorageRoot'),

  // Shell
  openInEditor: (dirPath: string) =>
    invoke<{ success: boolean; error?: string }>('shell:openInEditor', dirPath),

  // CLI tools
  detectCliTools: () => invoke<CliTool[]>('cli:detect'),
  testCli: (command: string, extraArgs?: string, envVars?: string) =>
    invoke<{ success: boolean; output?: string; error?: string }>(
      'cli:test',
      command,
      extraArgs,
      envVars,
    ),
  runCli: (options: {
    tool: string;
    args: string[];
    sessionId: string;
    cwd?: string;
    envVars?: string;
    useProxy?: boolean;
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
    invoke<{ success: boolean; error?: string }>('models:testSavedConnection', id),
  getModelApiKey: (id: string) => invoke<string | null>('models:getApiKey', id),
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
};

/** Subscribe to IPC events from main process */
export function onIpc(channel: string, listener: (...args: unknown[]) => void): () => void {
  if (!window.electronAPI) return () => {};
  return window.electronAPI.on(channel, listener);
}
