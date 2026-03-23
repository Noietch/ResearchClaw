import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Bot,
  Cpu,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  Key,
  Play,
  AlertCircle,
  Zap,
  Settings2,
  Pencil,
  X,
  Link,
  Eye,
  EyeOff,
  Server,
  FolderOpen,
} from 'lucide-react';
import { ipc, type TokenUsageRecord, type CliTestDiagnostics } from '../../hooks/use-ipc';
import type { AgentConfigItem, AgentToolKind, DetectedAgentItem } from '@shared';
import { AGENT_TOOL_META, getAgentToolMeta } from '@shared';
import { AgentLogo } from '../agent-todo/AgentLogo';
import { useToast } from '../toast';

const AGENT_NAME_SUGGESTIONS = ['Aria', 'Max', 'Nova', 'Echo', 'Sage', 'Orion', 'Luna', 'Finn'];

function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message ?? `Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

const AGENT_TEST_TIMEOUT_MS = 20_000;

export function AgentSettings() {
  const { error: showError, success: showSuccess } = useToast();
  const [agents, setAgents] = useState<AgentConfigItem[]>([]);
  const [activeTab, setActiveTab] = useState<'local' | 'remote'>('local');
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [newAgent, setNewAgent] = useState({
    name: '',
    backend: '',
    cliPath: '',
    agentTool: 'claude-code' as AgentToolKind,
    configContent: '',
    authContent: '',
    defaultModel: '',
    apiKey: '',
    baseUrl: '',
  });
  const [newRemoteAgent, setNewRemoteAgent] = useState({
    name: '',
    agentTool: 'claude-code' as AgentToolKind,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshAuthMethod: 'privateKey' as 'password' | 'privateKey',
    sshPrivateKeyPath: '~/.ssh/id_ed25519',
    sshPassphrase: '',
    remoteCliPath: '',
    apiKey: '',
    baseUrl: '',
    defaultModel: '',
  });
  const [showRemotePassphrase, setShowRemotePassphrase] = useState(false);
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgentItem[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfigItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [agentStats, setAgentStats] = useState<
    Array<{ id: string; name: string; callCount: number }>
  >([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    agentId: string;
    success: boolean;
    output?: string;
    error?: string;
    diagnostics?: CliTestDiagnostics;
  } | null>(null);

  useEffect(() => {
    loadAgents();
    loadUsage();
  }, []);

  async function loadAgents() {
    try {
      const data = await ipc.listAgents();
      setAgents(data as AgentConfigItem[]);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadUsage() {
    try {
      const [usageRecords, stats] = await Promise.all([
        ipc.getTokenUsageRecords(),
        ipc.getAgentRunStats(),
      ]);
      setRecords(usageRecords as TokenUsageRecord[]);
      setAgentStats(stats);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDetectAgents() {
    setDetecting(true);
    setHasScanned(false);
    try {
      const detected = await ipc.detectAgents();
      setDetectedAgents(detected as DetectedAgentItem[]);
    } catch (err) {
      console.error(err);
      showError(`Failed to detect agents: ${(err as Error).message}`);
    } finally {
      setDetecting(false);
      setHasScanned(true);
    }
  }

  function backendToAgentTool(backend: string): AgentToolKind {
    if (backend === 'claude-code') return 'claude-code';
    if (backend === 'codex') return 'codex';
    if (backend === 'gemini') return 'gemini';
    if (backend === 'openclaw') return 'openclaw';
    if (backend === 'opencode') return 'opencode';
    if (backend === 'qwen') return 'qwen';
    if (backend === 'goose') return 'goose';
    return 'custom';
  }

  function isAgentAlreadyAdded(detected: DetectedAgentItem): boolean {
    return agents.some((a) => a.cliPath === detected.cliPath);
  }

  async function handleQuickAddAgent(detected: DetectedAgentItem) {
    setSaving(true);
    try {
      await ipc.addAgent({
        name: detected.name,
        backend: detected.backend,
        cliPath: detected.cliPath,
        acpArgs: detected.acpArgs,
        agentTool: backendToAgentTool(detected.backend),
        configContent: detected.configContent || undefined,
        authContent: detected.authContent || undefined,
        apiKey: detected.apiKey || undefined,
        baseUrl: detected.baseUrl || undefined,
        defaultModel: detected.defaultModel || undefined,
        isCustom: false,
      });
      await loadAgents();
      showSuccess(`Agent "${detected.name}" added successfully`);
    } catch (err) {
      console.error(err);
      showError(`Failed to add agent: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await ipc.updateAgent(id, { enabled });
      await loadAgents();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await ipc.removeAgent(id);
      await loadAgents();
    } catch (err) {
      console.error(err);
    }
  }

  const handleAgentToolChange = useCallback((tool: AgentToolKind, isEdit = false) => {
    const meta = getAgentToolMeta(tool);
    // Get all default CLI commands to check if current path is a default
    const defaultCommands = AGENT_TOOL_META.map((m) => m.cliCommand).filter(Boolean);

    if (isEdit) {
      setEditingAgent((prev) => {
        if (!prev) return null;
        // Only update cliPath if it's empty or matches a default command
        const shouldUpdateCliPath = !prev.cliPath || defaultCommands.includes(prev.cliPath);
        return {
          ...prev,
          agentTool: tool,
          backend: tool.replace(/-/g, ''),
          cliPath: shouldUpdateCliPath ? meta.cliCommand || prev.cliPath : prev.cliPath,
        };
      });
    } else {
      setNewAgent((prev) => {
        // Only update cliPath if it's empty or matches a default command
        const shouldUpdateCliPath = !prev.cliPath || defaultCommands.includes(prev.cliPath);
        return {
          ...prev,
          agentTool: tool,
          backend: tool.replace(/-/g, ''),
          cliPath: shouldUpdateCliPath ? meta.cliCommand || prev.cliPath : prev.cliPath,
        };
      });
    }
  }, []);

  async function handleAddRemoteAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!newRemoteAgent.name || !newRemoteAgent.sshHost || !newRemoteAgent.sshUsername) return;
    setSaving(true);
    try {
      const meta = getAgentToolMeta(newRemoteAgent.agentTool);
      await ipc.addAgent({
        name: newRemoteAgent.name,
        backend: newRemoteAgent.agentTool.replace(/-/g, ''),
        cliPath: newRemoteAgent.remoteCliPath || meta.cliCommand,
        acpArgs: meta.defaultAcpArgs,
        agentTool: newRemoteAgent.agentTool,
        apiKey: newRemoteAgent.apiKey || undefined,
        baseUrl: newRemoteAgent.baseUrl || undefined,
        defaultModel: newRemoteAgent.defaultModel || undefined,
        isCustom: true,
        isRemote: true,
        sshHost: newRemoteAgent.sshHost,
        sshPort: newRemoteAgent.sshPort,
        sshUsername: newRemoteAgent.sshUsername,
        sshAuthMethod: newRemoteAgent.sshAuthMethod,
        sshPrivateKeyPath: newRemoteAgent.sshPrivateKeyPath || undefined,
        sshPassphrase: newRemoteAgent.sshPassphrase || undefined,
        remoteCliPath: newRemoteAgent.remoteCliPath || undefined,
      });
      setNewRemoteAgent({
        name: '',
        agentTool: 'claude-code',
        sshHost: '',
        sshPort: 22,
        sshUsername: '',
        sshAuthMethod: 'privateKey',
        sshPrivateKeyPath: '~/.ssh/id_ed25519',
        sshPassphrase: '',
        remoteCliPath: '',
        apiKey: '',
        baseUrl: '',
        defaultModel: '',
      });
      setShowAddForm(false);
      await loadAgents();
      showSuccess(`Remote agent "${newRemoteAgent.name}" added successfully`);
    } catch (err) {
      console.error(err);
      showError(`Failed to add remote agent: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgent.name || !newAgent.cliPath) return;
    setSaving(true);
    try {
      const meta = getAgentToolMeta(newAgent.agentTool);
      await ipc.addAgent({
        name: newAgent.name,
        backend: newAgent.backend,
        cliPath: newAgent.cliPath,
        acpArgs: meta.defaultAcpArgs,
        agentTool: newAgent.agentTool,
        configContent: newAgent.configContent || undefined,
        authContent: newAgent.authContent || undefined,
        defaultModel: newAgent.defaultModel || undefined,
        apiKey: newAgent.apiKey || undefined,
        baseUrl: newAgent.baseUrl || undefined,
        isCustom: true,
      });
      setNewAgent({
        name: '',
        backend: '',
        cliPath: '',
        agentTool: 'claude-code',
        configContent: '',
        authContent: '',
        defaultModel: '',
        apiKey: '',
        baseUrl: '',
      });
      setShowAddForm(false);
      await loadAgents();
      showSuccess(`Agent "${newAgent.name}" added successfully`);
    } catch (err) {
      console.error(err);
      showError(`Failed to add agent: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAgent) return;
    setSaving(true);
    try {
      await ipc.updateAgent(editingAgent.id, {
        name: editingAgent.name,
        backend: editingAgent.backend,
        cliPath: editingAgent.cliPath ?? undefined,
        acpArgs: editingAgent.acpArgs,
        agentTool: editingAgent.agentTool,
        configContent: editingAgent.configContent || undefined,
        authContent: editingAgent.authContent || undefined,
        defaultModel: editingAgent.defaultModel || undefined,
        apiKey: editingAgent.apiKey || undefined,
        baseUrl: editingAgent.baseUrl || undefined,
      });
      setEditingAgent(null);
      await loadAgents();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection(agent: AgentConfigItem) {
    setTesting(agent.id);
    setTestResult(null);
    try {
      const result = await withTimeout(
        ipc.testAgentAcp(agent.id),
        AGENT_TEST_TIMEOUT_MS,
        'Agent test timed out after 20 seconds',
      );
      if (result && 'sessionId' in result) {
        setTestResult({
          agentId: agent.id,
          success: true,
          output: `ACP session created: ${result.sessionId}`,
        });
      } else {
        setTestResult({ agentId: agent.id, success: false, error: 'No session ID returned' });
      }
    } catch (err) {
      setTestResult({ agentId: agent.id, success: false, error: String(err) });
    } finally {
      setTesting(null);
    }
  }

  async function handleLoadConfigContents(
    tool: AgentToolKind,
    target: 'config' | 'auth',
    isEdit = false,
  ) {
    try {
      const contents = await ipc.getAgentConfigContents(tool);
      if (isEdit) {
        setEditingAgent((prev) => {
          if (!prev) return null;
          if (target === 'config' && contents.configContent) {
            return { ...prev, configContent: contents.configContent || '' };
          } else if (target === 'auth' && contents.authContent) {
            return { ...prev, authContent: contents.authContent || '' };
          }
          return prev;
        });
      } else {
        if (target === 'config' && contents.configContent) {
          setNewAgent((p) => ({ ...p, configContent: contents.configContent || '' }));
        } else if (target === 'auth' && contents.authContent) {
          setNewAgent((p) => ({ ...p, authContent: contents.authContent || '' }));
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAutoDetectConfig(tool: AgentToolKind, isEdit = false) {
    try {
      const contents = await ipc.getSystemAgentConfig(tool);
      if (isEdit) {
        setEditingAgent((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            configContent: contents.configContent || prev.configContent,
            authContent: contents.authContent || prev.authContent,
          };
        });
      } else {
        setNewAgent((p) => ({
          ...p,
          configContent: contents.configContent || p.configContent,
          authContent: contents.authContent || p.authContent,
        }));
      }
    } catch (err) {
      console.error('Auto-detect failed:', err);
    }
  }

  const updateEditingAgent = useCallback((updates: Partial<AgentConfigItem>) => {
    setEditingAgent((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  // Agent usage statistics
  const agentByProvider = useMemo(() => {
    const map = new Map<string, { calls: number; tokens: number }>();
    for (const r of records) {
      if (r.kind !== 'agent') continue;
      const key = formatUsageLabel(r.provider, r.model);
      const existing = map.get(key) ?? { calls: 0, tokens: 0 };
      map.set(key, {
        calls: existing.calls + 1,
        tokens: existing.tokens + r.totalTokens,
      });
    }
    return Array.from(map.entries())
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.calls - a.calls);
  }, [records]);

  const totalAgentRuns = useMemo(
    () => agentByProvider.reduce((sum, item) => sum + item.calls, 0),
    [agentByProvider],
  );

  const totalAgentTokens = useMemo(
    () => agentByProvider.reduce((sum, item) => sum + item.tokens, 0),
    [agentByProvider],
  );

  // Get usage count for a specific agent
  const getAgentUsage = (agentName: string) => {
    const item = agentByProvider.find((a) => a.key === agentName);
    return item ?? { calls: 0, tokens: 0 };
  };

  return (
    <div className="space-y-6">
      {/* Agents Section */}
      <div className="rounded-xl border border-notion-border bg-white">
        <div className="border-b border-notion-border px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-notion-sidebar">
                <Bot size={16} className="text-notion-text-secondary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-notion-text">Agents</h3>
                <p className="text-xs text-notion-text-tertiary">
                  Manage CLI agents for automated tasks
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'local' && (
                <button
                  onClick={handleDetectAgents}
                  disabled={detecting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                >
                  {detecting ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
                  Scan Local
                </button>
              )}
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
              >
                <Plus size={12} />
                Add Agent
              </button>
            </div>
          </div>
          {/* Local / Remote tabs */}
          <div className="mt-3 flex gap-1">
            {(['local', 'remote'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setShowAddForm(false);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-500 text-white'
                    : 'text-notion-text-secondary hover:bg-notion-sidebar'
                }`}
              >
                {tab === 'local' ? <Cpu size={12} /> : <Server size={12} />}
                {tab === 'local' ? 'Local' : 'Remote'}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    activeTab === tab ? 'bg-white/20' : 'bg-notion-sidebar'
                  }`}
                >
                  {tab === 'local'
                    ? agents.filter((a) => !(a as any).isRemote).length
                    : agents.filter((a) => (a as any).isRemote).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Detected Agents */}
        <AnimatePresence>
          {(detectedAgents.length > 0 || (hasScanned && detectedAgents.length === 0)) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden border-b border-notion-border"
            >
              <div className="px-5 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-notion-text-secondary">Detected Agents</p>
                  <button
                    onClick={() => {
                      setDetectedAgents([]);
                      setHasScanned(false);
                    }}
                    className="rounded-lg p-1 text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                  >
                    <X size={12} />
                  </button>
                </div>
                {detectedAgents.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-notion-border px-3 py-3 text-xs text-notion-text-tertiary">
                    <AlertCircle size={14} />
                    No CLI agents detected on this machine. You can add agents manually.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {detectedAgents.map((detected) => {
                      const alreadyAdded = isAgentAlreadyAdded(detected);
                      return (
                        <div
                          key={detected.cliPath}
                          className="flex items-center justify-between rounded-lg border border-notion-border px-3 py-2 transition-colors hover:bg-blue-50 hover:border-blue-200"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-6 w-6 items-center justify-center">
                              <AgentLogo tool={backendToAgentTool(detected.backend)} size={16} />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-notion-text">
                                {detected.name}
                              </p>
                              <p className="text-xs text-notion-text-tertiary">
                                {detected.nativeCliPath}
                              </p>
                              {(detected.configContent ||
                                detected.authContent ||
                                detected.apiKey ||
                                detected.defaultModel) && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  {detected.configContent && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
                                      <Check size={10} />
                                      config
                                    </span>
                                  )}
                                  {detected.authContent && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
                                      <Check size={10} />
                                      auth
                                    </span>
                                  )}
                                  {detected.apiKey && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
                                      <Key size={10} />
                                      API key
                                    </span>
                                  )}
                                  {detected.defaultModel && (
                                    <span className="text-[10px] text-notion-text-tertiary">
                                      model: {detected.defaultModel}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {alreadyAdded ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600">
                              <Check size={12} />
                              Already added
                            </span>
                          ) : (
                            <button
                              onClick={() => handleQuickAddAgent(detected)}
                              disabled={saving}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500/90 disabled:opacity-50"
                            >
                              <Plus size={12} />
                              Add
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add Form — Remote */}
        <AnimatePresence>
          {showAddForm && activeTab === 'remote' && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              onSubmit={handleAddRemoteAgent}
              className="overflow-hidden border-b border-notion-border"
            >
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  <Server size={13} />
                  Remote agents run on a server via SSH. Configure the connection and CLI path
                  below.
                </div>
                {/* Agent Type */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-notion-text">
                    Agent Type
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_TOOL_META.filter((m) => m.value !== 'custom').map((meta) => (
                      <button
                        key={meta.value}
                        type="button"
                        onClick={() => setNewRemoteAgent((p) => ({ ...p, agentTool: meta.value }))}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          newRemoteAgent.agentTool === meta.value
                            ? 'border-blue-400 bg-blue-50 text-blue-600'
                            : 'border-notion-border text-notion-text-secondary hover:bg-notion-sidebar'
                        }`}
                      >
                        {<AgentLogo tool={meta.value} size={14} />}
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">Name</label>
                  <input
                    type="text"
                    value={newRemoteAgent.name}
                    onChange={(e) => setNewRemoteAgent((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Remote Claude (codelab)"
                    className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {/* SSH Connection */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">
                    SSH Connection
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newRemoteAgent.sshHost}
                      onChange={(e) =>
                        setNewRemoteAgent((p) => ({ ...p, sshHost: e.target.value }))
                      }
                      placeholder="hostname or IP"
                      className="flex-1 rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <input
                      type="number"
                      value={newRemoteAgent.sshPort}
                      onChange={(e) =>
                        setNewRemoteAgent((p) => ({
                          ...p,
                          sshPort: parseInt(e.target.value) || 22,
                        }))
                      }
                      className="w-20 rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>
                {/* Username */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">
                    Username
                  </label>
                  <input
                    type="text"
                    value={newRemoteAgent.sshUsername}
                    onChange={(e) =>
                      setNewRemoteAgent((p) => ({ ...p, sshUsername: e.target.value }))
                    }
                    placeholder="ssh username"
                    className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {/* Auth Method */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">
                    Auth Method
                  </label>
                  <div className="flex gap-2">
                    {(['privateKey', 'password'] as const).map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setNewRemoteAgent((p) => ({ ...p, sshAuthMethod: method }))}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          newRemoteAgent.sshAuthMethod === method
                            ? 'border-blue-400 bg-blue-50 text-blue-600'
                            : 'border-notion-border text-notion-text-secondary hover:bg-notion-sidebar'
                        }`}
                      >
                        <Key size={12} />
                        {method === 'privateKey' ? 'Private Key' : 'Password'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Private Key Path */}
                {newRemoteAgent.sshAuthMethod === 'privateKey' && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-notion-text">
                      Private Key Path
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newRemoteAgent.sshPrivateKeyPath}
                        onChange={(e) =>
                          setNewRemoteAgent((p) => ({ ...p, sshPrivateKeyPath: e.target.value }))
                        }
                        placeholder="~/.ssh/id_ed25519"
                        className="flex-1 rounded-lg border border-notion-border px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await ipc.selectSshKeyFile();
                          if (!r.canceled && r.path)
                            setNewRemoteAgent((p) => ({ ...p, sshPrivateKeyPath: r.path! }));
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-notion-border px-3 text-xs text-notion-text-secondary hover:bg-notion-sidebar"
                      >
                        <FolderOpen size={12} />
                        Browse
                      </button>
                    </div>
                    <div className="mt-1.5">
                      <label className="mb-1 block text-xs text-notion-text-tertiary">
                        Passphrase (optional)
                      </label>
                      <div className="relative">
                        <input
                          type={showRemotePassphrase ? 'text' : 'password'}
                          value={newRemoteAgent.sshPassphrase}
                          onChange={(e) =>
                            setNewRemoteAgent((p) => ({ ...p, sshPassphrase: e.target.value }))
                          }
                          placeholder="Leave empty if key has no passphrase"
                          className="w-full rounded-lg border border-notion-border px-3 py-2 pr-9 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRemotePassphrase((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-notion-text-tertiary hover:text-notion-text"
                        >
                          {showRemotePassphrase ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {/* Remote CLI Path */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">
                    Remote CLI Path
                    <span className="ml-1 text-notion-text-tertiary font-normal">
                      — full path on the remote server
                    </span>
                  </label>
                  <input
                    type="text"
                    value={newRemoteAgent.remoteCliPath}
                    onChange={(e) =>
                      setNewRemoteAgent((p) => ({ ...p, remoteCliPath: e.target.value }))
                    }
                    placeholder="/home/user/.local/bin/claude"
                    className="w-full rounded-lg border border-notion-border px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {/* API Key */}
                {getAgentToolMeta(newRemoteAgent.agentTool).requiresApiKey && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-notion-text">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={newRemoteAgent.apiKey}
                      onChange={(e) => setNewRemoteAgent((p) => ({ ...p, apiKey: e.target.value }))}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      saving ||
                      !newRemoteAgent.name ||
                      !newRemoteAgent.sshHost ||
                      !newRemoteAgent.sshUsername
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {saving ? 'Adding…' : 'Add Remote Agent'}
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Add Form — Local */}
        <AnimatePresence>
          {showAddForm && activeTab === 'local' && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              onSubmit={handleAddAgent}
              className="overflow-hidden border-b border-notion-border"
            >
              <div className="p-5 space-y-4">
                {/* Agent Type Selection */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-notion-text">
                    Agent Type
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {AGENT_TOOL_META.map((meta) => (
                      <button
                        key={meta.value}
                        type="button"
                        onClick={() => handleAgentToolChange(meta.value)}
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                          newAgent.agentTool === meta.value
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-notion-border hover:border-blue-400 hover:bg-notion-sidebar/50'
                        }`}
                      >
                        {<AgentLogo tool={meta.value} size={24} />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-notion-text">
                              {meta.label}
                            </span>
                            {meta.supportsYolo && <Zap size={10} className="text-blue-500" />}
                          </div>
                          <span className="text-xs text-notion-text-tertiary line-clamp-1">
                            {meta.description}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Basic Info */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">Name</label>
                  <input
                    type="text"
                    value={newAgent.name}
                    onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Aria"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {AGENT_NAME_SUGGESTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setNewAgent((p) => ({ ...p, name: n }))}
                        className="px-2 py-0.5 rounded-full text-xs border border-notion-border hover:bg-blue-50 hover:border-blue-200 text-notion-text-secondary transition-colors"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* CLI Path */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">
                    CLI Path
                  </label>
                  <input
                    type="text"
                    value={newAgent.cliPath}
                    onChange={(e) => setNewAgent((p) => ({ ...p, cliPath: e.target.value }))}
                    placeholder="/usr/local/bin/claude"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  />
                </div>

                {/* Default Model */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">
                    Default Model
                  </label>
                  <select
                    value={newAgent.defaultModel}
                    onChange={(e) => setNewAgent((p) => ({ ...p, defaultModel: e.target.value }))}
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  >
                    <option value="">Use agent default</option>
                    {getAgentToolMeta(newAgent.agentTool).models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                        {m.description ? ` — ${m.description}` : ''}
                      </option>
                    ))}
                    <option value="__custom__">Custom model...</option>
                  </select>
                  {newAgent.defaultModel === '__custom__' && (
                    <input
                      type="text"
                      autoFocus
                      placeholder="Enter custom model name"
                      onChange={(e) => setNewAgent((p) => ({ ...p, defaultModel: e.target.value }))}
                      className="mt-2 w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                    />
                  )}
                  <p className="mt-1 text-xs text-notion-text-tertiary">
                    {newAgent.agentTool === 'codex'
                      ? 'Sets OPENAI_MODEL when running tasks.'
                      : 'Sets ANTHROPIC_MODEL when running tasks.'}
                  </p>
                </div>

                {/* API Configuration - Show for agents that require API key */}
                {getAgentToolMeta(newAgent.agentTool).requiresApiKey && (
                  <div className="space-y-3 p-3 rounded-lg bg-notion-sidebar/50 border border-notion-border">
                    <div className="flex items-center gap-2 text-xs font-medium text-notion-text">
                      <Key size={12} />
                      API Configuration
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-notion-text">
                        API Key <span className="text-notion-red">*</span>
                      </label>
                      <input
                        type="password"
                        value={newAgent.apiKey}
                        onChange={(e) => setNewAgent((p) => ({ ...p, apiKey: e.target.value }))}
                        placeholder={newAgent.agentTool === 'codex' ? 'sk-...' : 'sk-ant-...'}
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                      />
                      <p className="mt-1 text-xs text-notion-text-tertiary">
                        {newAgent.agentTool === 'codex'
                          ? 'Your OpenAI API key for Code X authentication.'
                          : 'Your Anthropic API key for Claude authentication.'}
                      </p>
                    </div>
                    {getAgentToolMeta(newAgent.agentTool).supportsBaseUrl && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-notion-text flex items-center gap-1">
                          <Link size={10} />
                          Base URL <span className="text-notion-text-tertiary">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={newAgent.baseUrl}
                          onChange={(e) => setNewAgent((p) => ({ ...p, baseUrl: e.target.value }))}
                          placeholder={
                            newAgent.agentTool === 'codex'
                              ? 'https://api.openai.com/v1'
                              : 'https://api.anthropic.com'
                          }
                          className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                        />
                        <p className="mt-1 text-xs text-notion-text-tertiary">
                          {newAgent.agentTool === 'codex'
                            ? 'Custom API endpoint. Leave empty for default OpenAI endpoint.'
                            : 'Custom API endpoint. Leave empty for default Anthropic endpoint.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Config & Auth (collapsible) */}
                <details className="group">
                  <summary className="flex items-center gap-2 cursor-pointer text-xs font-medium text-notion-text-secondary hover:text-notion-text">
                    <Settings2 size={12} />
                    Advanced: Config & Auth Files
                    <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-notion-text flex items-center gap-1.5">
                          <FileText size={12} />
                          {getAgentToolMeta(newAgent.agentTool).configLabel}
                        </label>
                        <button
                          type="button"
                          onClick={() => handleLoadConfigContents(newAgent.agentTool, 'config')}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Load from file
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAutoDetectConfig(newAgent.agentTool)}
                          className="text-xs text-green-600 hover:underline"
                        >
                          Auto-detect
                        </button>
                      </div>
                      <textarea
                        value={newAgent.configContent}
                        onChange={(e) =>
                          setNewAgent((p) => ({ ...p, configContent: e.target.value }))
                        }
                        placeholder="Config file content (JSON/TOML/YAML)"
                        rows={3}
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-notion-text flex items-center gap-1.5">
                          <Key size={12} />
                          {getAgentToolMeta(newAgent.agentTool).authLabel}
                        </label>
                        <button
                          type="button"
                          onClick={() => handleLoadConfigContents(newAgent.agentTool, 'auth')}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Load from file
                        </button>
                      </div>
                      <textarea
                        value={newAgent.authContent}
                        onChange={(e) =>
                          setNewAgent((p) => ({ ...p, authContent: e.target.value }))
                        }
                        placeholder="Auth file content"
                        rows={2}
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none"
                      />
                    </div>
                  </div>
                </details>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-notion-text-secondary hover:bg-notion-sidebar transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    {saving ? 'Adding...' : 'Add Agent'}
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Agents list */}
        <div className="p-4">
          {agents.filter((a) =>
            activeTab === 'local' ? !(a as any).isRemote : (a as any).isRemote,
          ).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              {activeTab === 'remote' ? (
                <Server size={24} className="mb-2 text-notion-text-tertiary opacity-40" />
              ) : (
                <Bot size={24} className="mb-2 text-notion-text-tertiary opacity-40" />
              )}
              <p className="text-sm text-notion-text-secondary">
                {activeTab === 'remote'
                  ? 'No remote agents configured'
                  : 'No local agents configured'}
              </p>
              <p className="text-xs text-notion-text-tertiary">
                {activeTab === 'remote'
                  ? 'Add a remote agent to run tasks on a server via SSH'
                  : 'Click "Add Agent" to configure your first CLI agent'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {agents
                .filter((a) => (activeTab === 'local' ? !(a as any).isRemote : (a as any).isRemote))
                .map((agent) => {
                  const usage = getAgentUsage(agent.name);
                  const isExpanded = expandedAgent === agent.id;
                  const meta = getAgentToolMeta(agent.agentTool || 'claude-code');
                  return (
                    <div
                      key={agent.id}
                      className={`rounded-lg border overflow-hidden transition-colors ${
                        agent.enabled
                          ? 'border-blue-200 bg-blue-50/40'
                          : 'bg-white border-notion-border'
                      }`}
                    >
                      {/* Header row */}
                      <div
                        className={`flex items-center justify-between px-4 py-3 transition-colors ${agent.configContent || agent.authContent ? 'hover:bg-notion-sidebar/50 cursor-pointer' : ''}`}
                        onClick={() =>
                          (agent.configContent || agent.authContent) &&
                          setExpandedAgent(isExpanded ? null : agent.id)
                        }
                      >
                        <div className="flex items-center gap-3">
                          {agent.configContent || agent.authContent ? (
                            isExpanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )
                          ) : (
                            <span className="w-[14px]" />
                          )}
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-notion-sidebar border border-notion-border">
                            <AgentLogo tool={agent.agentTool} size={16} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-notion-text">
                                {agent.name}
                                <span className="ml-1 text-xs font-normal text-notion-text-tertiary">
                                  ({meta.label})
                                </span>
                              </p>
                              {agent.enabled && (
                                <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-2xs font-medium text-blue-700">
                                  Active
                                </span>
                              )}
                              {(agent as any).isRemote && (agent as any).sshHost && (
                                <span className="shrink-0 flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-2xs font-medium text-purple-700">
                                  <Server size={10} />
                                  {(agent as any).sshUsername}@{(agent as any).sshHost}:
                                  {(agent as any).sshPort ?? 22}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {usage.calls > 0 && (
                            <div className="text-right">
                              <div className="text-xs font-semibold tabular-nums text-blue-600">
                                {usage.calls} runs
                              </div>
                              <div className="text-xs text-notion-text-tertiary tabular-nums">
                                {formatTokens(usage.tokens)} tokens
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => handleTestConnection(agent)}
                            disabled={testing === agent.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-notion-border px-2 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                            title="Test agent connection"
                          >
                            {testing === agent.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Play size={12} />
                            )}
                            Test Connection
                          </button>
                          <button
                            onClick={() => setEditingAgent(agent)}
                            className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                            title="Edit agent"
                          >
                            <Pencil size={14} />
                          </button>
                          {!agent.enabled && (
                            <button
                              onClick={() => handleToggle(agent.id, true)}
                              className="rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                            >
                              Activate
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(agent.id)}
                            className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-500"
                            title="Remove agent"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {/* Test result */}
                      {testResult?.agentId === agent.id && (
                        <div
                          className={`mx-4 mb-3 rounded-lg p-3 text-xs ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}
                        >
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {testResult.success ? (
                              <>
                                <Check size={12} className="text-green-600" /> Connection successful
                              </>
                            ) : (
                              <>
                                <AlertCircle size={12} className="text-red-600" /> Connection failed
                              </>
                            )}
                          </div>
                          {testResult.output && (
                            <pre className="text-notion-text-secondary whitespace-pre-wrap">
                              {testResult.output}
                            </pre>
                          )}
                          {testResult.error && (
                            <pre className="text-red-600 whitespace-pre-wrap">
                              {testResult.error}
                            </pre>
                          )}
                          {testResult.diagnostics && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-notion-text-tertiary hover:text-notion-text">
                                Diagnostics
                              </summary>
                              <pre className="mt-1 bg-white rounded p-2 font-mono overflow-auto max-h-32">
                                {JSON.stringify(testResult.diagnostics, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                      {/* Expanded details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.15 }}
                            className="border-t border-notion-border bg-notion-sidebar/30"
                          >
                            <div className="p-4 space-y-3">
                              {/* Config & Auth content */}
                              {(agent.configContent || agent.authContent) && (
                                <div className="space-y-2">
                                  {agent.configContent && (
                                    <div>
                                      <p className="text-xs font-medium text-notion-text mb-1 flex items-center gap-1">
                                        <FileText size={10} /> Config
                                      </p>
                                      <pre className="bg-notion-bg rounded p-2 text-xs font-mono text-notion-text-secondary overflow-auto max-h-24">
                                        {agent.configContent}
                                      </pre>
                                    </div>
                                  )}
                                  {agent.authContent && (
                                    <div>
                                      <p className="text-xs font-medium text-notion-text mb-1 flex items-center gap-1">
                                        <Key size={10} /> Auth
                                      </p>
                                      <pre className="bg-notion-bg rounded p-2 text-xs font-mono text-notion-text-secondary overflow-auto max-h-24">
                                        {agent.authContent}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Agent Usage Statistics */}
      <div className="rounded-xl border border-notion-border bg-white">
        <div className="flex items-center justify-between border-b border-notion-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-notion-sidebar">
              <Cpu size={16} className="text-notion-text-secondary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-notion-text">Usage Statistics</h3>
              <p className="text-xs text-notion-text-tertiary">
                Agent run frequency across all tasks
              </p>
            </div>
          </div>
          {totalAgentRuns > 0 && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-blue-600">
                  {totalAgentRuns} runs
                </div>
                <div className="text-xs text-notion-text-tertiary tabular-nums">
                  {formatTokens(totalAgentTokens)} tokens
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4">
          {agentByProvider.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Bot size={24} className="mb-2 text-notion-text-tertiary opacity-40" />
              <p className="text-sm text-notion-text-secondary">No agent runs yet</p>
              <p className="text-xs text-notion-text-tertiary">
                Statistics will appear after running agent tasks
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {agentByProvider.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-notion-sidebar/50 transition-colors"
                >
                  <span className="font-mono text-sm text-notion-text">{item.key}</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold tabular-nums text-blue-600">
                      {item.calls} runs
                    </span>
                    <span className="ml-2 text-xs text-notion-text-tertiary tabular-nums">
                      {formatTokens(item.tokens)} tokens
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent Calls */}
      {agentStats.length > 0 && (
        <div className="rounded-xl border border-notion-border bg-white">
          <div className="border-b border-notion-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-notion-text-tertiary">
            Agent Calls
          </div>
          {agentStats.map((a, i) => {
            const maxCalls = Math.max(...agentStats.map((x) => x.callCount), 1);
            const pct = (a.callCount / maxCalls) * 100;
            return (
              <div
                key={a.id}
                className={`px-4 py-3 ${i < agentStats.length - 1 ? 'border-b border-notion-border' : ''}`}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-notion-text">{a.name}</span>
                    <span className="ml-2 text-xs text-notion-text-tertiary">
                      task runs + connection tests
                    </span>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-notion-text">
                    {a.callCount}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-notion-sidebar">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Agent Modal */}
      <EditAgentModal
        agent={editingAgent}
        onUpdate={updateEditingAgent}
        onClose={() => setEditingAgent(null)}
        onSave={handleEditAgent}
        saving={saving}
        onAgentToolChange={(tool) => handleAgentToolChange(tool, true)}
        onLoadConfigContents={(tool, target) => handleLoadConfigContents(tool, target, true)}
        onAutoDetectConfig={(tool) => handleAutoDetectConfig(tool, true)}
      />
    </div>
  );
}

// Edit Agent Modal Component
function EditAgentModal({
  agent,
  onUpdate,
  onClose,
  onSave,
  saving,
  onAgentToolChange,
  onLoadConfigContents,
  onAutoDetectConfig,
}: {
  agent: AgentConfigItem | null;
  onUpdate: (updates: Partial<AgentConfigItem>) => void;
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
  saving: boolean;
  onAgentToolChange: (tool: AgentToolKind) => void;
  onLoadConfigContents: (tool: AgentToolKind, target: 'config' | 'auth') => void;
  onAutoDetectConfig: (tool: AgentToolKind) => void;
}) {
  if (!agent) return null;

  const meta = getAgentToolMeta(agent.agentTool || 'claude-code');

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-lg rounded-xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={onSave}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-notion-border px-5 py-4">
              <h3 className="text-sm font-semibold text-notion-text">Edit Agent</h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Agent Type Selection */}
              <div>
                <label className="mb-2 block text-xs font-medium text-notion-text">
                  Agent Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {AGENT_TOOL_META.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => onAgentToolChange(m.value)}
                      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                        agent.agentTool === m.value
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-notion-border hover:border-blue-400 hover:bg-notion-sidebar/50'
                      }`}
                    >
                      {<AgentLogo tool={m.value} size={24} />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-notion-text">{m.label}</span>
                          {m.supportsYolo && <Zap size={10} className="text-blue-500" />}
                        </div>
                        <span className="text-xs text-notion-text-tertiary line-clamp-1">
                          {m.description}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Basic Info */}
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">Name</label>
                <input
                  type="text"
                  value={agent.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  placeholder="e.g. Aria"
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {AGENT_NAME_SUGGESTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onUpdate({ name: n })}
                      className="px-2 py-0.5 rounded-full text-xs border border-notion-border hover:bg-blue-50 hover:border-blue-200 text-notion-text-secondary transition-colors"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* CLI Path */}
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">CLI Path</label>
                <input
                  type="text"
                  value={agent.cliPath || ''}
                  onChange={(e) => onUpdate({ cliPath: e.target.value })}
                  placeholder="/usr/local/bin/claude"
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                />
              </div>

              {/* Default Model */}
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">
                  Default Model
                </label>
                <select
                  value={agent.defaultModel || ''}
                  onChange={(e) => onUpdate({ defaultModel: e.target.value || undefined })}
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                >
                  <option value="">Use agent default</option>
                  {getAgentToolMeta(agent.agentTool || 'claude-code').models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                      {m.description ? ` — ${m.description}` : ''}
                    </option>
                  ))}
                  <option value="__custom__">Custom model...</option>
                </select>
                {agent.defaultModel === '__custom__' && (
                  <input
                    type="text"
                    autoFocus
                    placeholder="Enter custom model name"
                    onChange={(e) => onUpdate({ defaultModel: e.target.value || undefined })}
                    className="mt-2 w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  />
                )}
                <p className="mt-1 text-xs text-notion-text-tertiary">
                  {agent.agentTool === 'codex'
                    ? 'Sets OPENAI_MODEL when running tasks.'
                    : 'Sets ANTHROPIC_MODEL when running tasks.'}
                </p>
              </div>

              {/* API Configuration - Show for agents that require API key */}
              {getAgentToolMeta(agent.agentTool || 'claude-code').requiresApiKey && (
                <div className="space-y-3 p-3 rounded-lg bg-notion-sidebar/50 border border-notion-border">
                  <div className="flex items-center gap-2 text-xs font-medium text-notion-text">
                    <Key size={12} />
                    API Configuration
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-notion-text">
                      API Key <span className="text-notion-red">*</span>
                    </label>
                    <input
                      type="password"
                      value={agent.apiKey || ''}
                      onChange={(e) => onUpdate({ apiKey: e.target.value })}
                      placeholder={agent.agentTool === 'codex' ? 'sk-...' : 'sk-ant-...'}
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                    />
                    <p className="mt-1 text-xs text-notion-text-tertiary">
                      {agent.agentTool === 'codex'
                        ? 'Your OpenAI API key for Code X authentication.'
                        : 'Your Anthropic API key for Claude authentication.'}
                    </p>
                  </div>
                  {getAgentToolMeta(agent.agentTool || 'claude-code').supportsBaseUrl && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-notion-text flex items-center gap-1">
                        <Link size={10} />
                        Base URL <span className="text-notion-text-tertiary">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={agent.baseUrl || ''}
                        onChange={(e) => onUpdate({ baseUrl: e.target.value })}
                        placeholder={
                          agent.agentTool === 'codex'
                            ? 'https://api.openai.com/v1'
                            : 'https://api.anthropic.com'
                        }
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                      />
                      <p className="mt-1 text-xs text-notion-text-tertiary">
                        {agent.agentTool === 'codex'
                          ? 'Custom API endpoint. Leave empty for default OpenAI endpoint.'
                          : 'Custom API endpoint. Leave empty for default Anthropic endpoint.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Config & Auth */}
              <details className="group" open={!!agent.configContent || !!agent.authContent}>
                <summary className="flex items-center gap-2 cursor-pointer text-xs font-medium text-notion-text-secondary hover:text-notion-text">
                  <Settings2 size={12} />
                  Advanced: Config & Auth Files
                  <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-notion-text flex items-center gap-1.5">
                        <FileText size={12} />
                        {meta.configLabel}
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          onLoadConfigContents(agent.agentTool || 'claude-code', 'config')
                        }
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Load from file
                      </button>
                      <button
                        type="button"
                        onClick={() => onAutoDetectConfig(agent.agentTool || 'claude-code')}
                        className="text-xs text-green-600 hover:underline"
                      >
                        Auto-detect
                      </button>
                    </div>
                    <textarea
                      value={agent.configContent || ''}
                      onChange={(e) => onUpdate({ configContent: e.target.value })}
                      placeholder="Config file content (JSON/TOML/YAML)"
                      rows={3}
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-notion-text flex items-center gap-1.5">
                        <Key size={12} />
                        {meta.authLabel}
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          onLoadConfigContents(agent.agentTool || 'claude-code', 'auth')
                        }
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Load from file
                      </button>
                    </div>
                    <textarea
                      value={agent.authContent || ''}
                      onChange={(e) => onUpdate({ authContent: e.target.value })}
                      placeholder="Auth file content"
                      rows={2}
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none"
                    />
                  </div>
                </div>
              </details>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-notion-border px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm text-notion-text-secondary hover:bg-notion-sidebar transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function formatUsageLabel(provider: string, model: string) {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider === 'codex') {
    return model && model !== 'codex' ? `Codex · ${model}` : 'Codex';
  }
  if (normalizedProvider === 'claude') {
    return model && model !== 'claude' ? `Claude Code · ${model}` : 'Claude Code';
  }
  return `${provider}/${model}`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
