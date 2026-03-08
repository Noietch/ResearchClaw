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
} from 'lucide-react';
import { ipc, type TokenUsageRecord, type CliTestDiagnostics } from '../../hooks/use-ipc';
import type { AgentConfigItem, AgentToolKind } from '@shared';
import { AGENT_TOOL_META, getAgentToolMeta } from '@shared';

export function AgentSettings() {
  const [agents, setAgents] = useState<AgentConfigItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [newAgent, setNewAgent] = useState({
    name: '',
    backend: '',
    cliPath: '',
    acpArgs: '',
    agentTool: 'claude-code' as AgentToolKind,
    configContent: '',
    authContent: '',
  });
  const [editingAgent, setEditingAgent] = useState<AgentConfigItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
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
      const usageRecords = await ipc.getTokenUsageRecords();
      setRecords(usageRecords as TokenUsageRecord[]);
    } catch (err) {
      console.error(err);
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
    if (!confirm('Remove this agent?')) return;
    try {
      await ipc.removeAgent(id);
      await loadAgents();
    } catch (err) {
      console.error(err);
    }
  }

  const handleAgentToolChange = useCallback((tool: AgentToolKind, isEdit = false) => {
    const meta = getAgentToolMeta(tool);
    if (isEdit) {
      setEditingAgent((prev) =>
        prev
          ? {
              ...prev,
              agentTool: tool,
              backend: tool === 'custom' ? prev.backend : tool.replace(/-/g, ''),
              cliPath: meta.cliCommand || prev.cliPath,
              acpArgs: meta.defaultAcpArgs,
            }
          : null,
      );
    } else {
      setNewAgent((prev) => ({
        ...prev,
        agentTool: tool,
        backend: tool === 'custom' ? prev.backend : tool.replace(/-/g, ''),
        cliPath: meta.cliCommand || prev.cliPath,
        acpArgs: meta.defaultAcpArgs.join(' '),
      }));
    }
  }, []);

  async function handleAddAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgent.name || !newAgent.backend || !newAgent.cliPath) return;
    setSaving(true);
    try {
      const acpArgs = newAgent.acpArgs.trim() ? newAgent.acpArgs.split(' ').filter(Boolean) : [];
      await ipc.addAgent({
        name: newAgent.name,
        backend: newAgent.backend,
        cliPath: newAgent.cliPath,
        acpArgs,
        agentTool: newAgent.agentTool,
        configContent: newAgent.configContent || undefined,
        authContent: newAgent.authContent || undefined,
        isCustom: true,
      });
      setNewAgent({
        name: '',
        backend: '',
        cliPath: '',
        acpArgs: '',
        agentTool: 'claude-code',
        configContent: '',
        authContent: '',
      });
      setShowAddForm(false);
      await loadAgents();
    } catch (err) {
      console.error(err);
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
      const result = await ipc.testAgentCli({
        command: agent.cliPath || '',
        extraArgs: agent.acpArgs.join(' '),
        agentTool: agent.agentTool,
        configContent: agent.configContent,
        authContent: agent.authContent,
      });
      setTestResult({ agentId: agent.id, ...result });
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
        <div className="flex items-center justify-between border-b border-notion-border px-5 py-4">
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
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
          >
            <Plus size={12} />
            Add Agent
          </button>
        </div>

        {/* Add Form */}
        <AnimatePresence>
          {showAddForm && (
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
                  <div className="grid grid-cols-3 gap-2">
                    {AGENT_TOOL_META.map((meta) => (
                      <button
                        key={meta.value}
                        type="button"
                        onClick={() => handleAgentToolChange(meta.value)}
                        className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-all ${
                          newAgent.agentTool === meta.value
                            ? 'border-notion-accent bg-notion-accent-light'
                            : 'border-notion-border hover:border-notion-accent/50 hover:bg-notion-sidebar/50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 w-full">
                          <span className="text-sm font-medium text-notion-text">{meta.label}</span>
                          {meta.supportsYolo && <Zap size={10} className="text-purple-500" />}
                        </div>
                        <span className="text-xs text-notion-text-tertiary line-clamp-1">
                          {meta.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-notion-text">Name</label>
                    <input
                      type="text"
                      value={newAgent.name}
                      onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                      placeholder="My Agent"
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-notion-text">
                      Backend ID
                    </label>
                    <input
                      type="text"
                      value={newAgent.backend}
                      onChange={(e) => setNewAgent((p) => ({ ...p, backend: e.target.value }))}
                      placeholder="custom"
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                    />
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

                {/* ACP Args */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">
                    ACP Args
                  </label>
                  <input
                    type="text"
                    value={newAgent.acpArgs}
                    onChange={(e) => setNewAgent((p) => ({ ...p, acpArgs: e.target.value }))}
                    placeholder="--experimental-acp"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  />
                  <p className="mt-1 text-xs text-notion-text-tertiary">
                    Arguments to enable ACP protocol mode. Different CLIs use different conventions.
                  </p>
                </div>

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
                          className="text-xs text-notion-accent hover:underline"
                        >
                          Load from file
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
                          className="text-xs text-notion-accent hover:underline"
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
                    className="rounded-lg bg-notion-accent px-3 py-1.5 text-sm text-white hover:bg-notion-accent/90 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Adding...' : 'Add Agent'}
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Agents list */}
        <div className="p-4">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Bot size={24} className="mb-2 text-notion-text-tertiary opacity-40" />
              <p className="text-sm text-notion-text-secondary">No agents configured</p>
              <p className="text-xs text-notion-text-tertiary">
                Click "Add Agent" to configure your first CLI agent
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => {
                const usage = getAgentUsage(agent.name);
                const isExpanded = expandedAgent === agent.id;
                const meta = getAgentToolMeta(agent.agentTool || 'claude-code');
                return (
                  <div
                    key={agent.id}
                    className="rounded-lg border border-notion-border overflow-hidden"
                  >
                    {/* Header row */}
                    <div
                      className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-notion-sidebar/50 cursor-pointer"
                      onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <div
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${agent.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-notion-text">{agent.name}</p>
                            {meta.supportsYolo && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 text-xs">
                                <Zap size={8} />
                                YOLO
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-notion-text-tertiary">
                            {meta.label} · {agent.cliPath}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
                        </button>
                        <button
                          onClick={() => setEditingAgent(agent)}
                          className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                          title="Edit agent"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleToggle(agent.id, !agent.enabled)}
                          className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                            agent.enabled
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {agent.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <button
                          onClick={() => handleDelete(agent.id)}
                          className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
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
                            {/* Backend & Args */}
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <span className="text-notion-text-tertiary">Backend: </span>
                                <span className="font-mono text-notion-text">{agent.backend}</span>
                              </div>
                              <div>
                                <span className="text-notion-text-tertiary">ACP Args: </span>
                                <span className="font-mono text-notion-text">
                                  {agent.acpArgs.join(' ') || '-'}
                                </span>
                              </div>
                            </div>
                            {/* YOLO Mode info */}
                            {meta.supportsYolo && (
                              <div className="flex items-center gap-2 text-xs">
                                <Zap size={12} className="text-purple-500" />
                                <span className="text-notion-text-secondary">
                                  Supports auto-approve mode via{' '}
                                  <code className="px-1 py-0.5 bg-purple-50 rounded text-purple-600">
                                    {meta.yoloModeId}
                                  </code>
                                </span>
                              </div>
                            )}
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
                            {/* Test connection */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleTestConnection(agent)}
                                disabled={testing === agent.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                              >
                                {testing === agent.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Play size={12} />
                                )}
                                Test Connection
                              </button>
                            </div>
                            {/* Test result */}
                            {testResult?.agentId === agent.id && (
                              <div
                                className={`rounded-lg p-3 text-xs ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}
                              >
                                <div className="flex items-center gap-1.5 font-medium mb-1">
                                  {testResult.success ? (
                                    <>
                                      <Check size={12} className="text-green-600" /> Connection
                                      successful
                                    </>
                                  ) : (
                                    <>
                                      <AlertCircle size={12} className="text-red-600" /> Connection
                                      failed
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

      {/* Edit Agent Modal */}
      <EditAgentModal
        agent={editingAgent}
        onUpdate={updateEditingAgent}
        onClose={() => setEditingAgent(null)}
        onSave={handleEditAgent}
        saving={saving}
        onAgentToolChange={(tool) => handleAgentToolChange(tool, true)}
        onLoadConfigContents={(tool, target) => handleLoadConfigContents(tool, target, true)}
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
}: {
  agent: AgentConfigItem | null;
  onUpdate: (updates: Partial<AgentConfigItem>) => void;
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
  saving: boolean;
  onAgentToolChange: (tool: AgentToolKind) => void;
  onLoadConfigContents: (tool: AgentToolKind, target: 'config' | 'auth') => void;
}) {
  const [acpArgsText, setAcpArgsText] = useState(() => agent?.acpArgs.join(' ') ?? '');

  useEffect(() => {
    setAcpArgsText(agent?.acpArgs.join(' ') ?? '');
  }, [agent?.id]);

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
        onClick={(e) => e.target === e.currentTarget && onClose()}
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
                <div className="grid grid-cols-3 gap-2">
                  {AGENT_TOOL_META.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => onAgentToolChange(m.value)}
                      className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-all ${
                        agent.agentTool === m.value
                          ? 'border-notion-accent bg-notion-accent-light'
                          : 'border-notion-border hover:border-notion-accent/50 hover:bg-notion-sidebar/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-sm font-medium text-notion-text">{m.label}</span>
                        {m.supportsYolo && <Zap size={10} className="text-purple-500" />}
                      </div>
                      <span className="text-xs text-notion-text-tertiary line-clamp-1">
                        {m.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">Name</label>
                  <input
                    type="text"
                    value={agent.name}
                    onChange={(e) => onUpdate({ name: e.target.value })}
                    placeholder="My Agent"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">
                    Backend ID
                  </label>
                  <input
                    type="text"
                    value={agent.backend}
                    placeholder="custom"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                    readOnly
                  />
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

              {/* ACP Args */}
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">ACP Args</label>
                <input
                  type="text"
                  value={acpArgsText}
                  onChange={(e) => {
                    setAcpArgsText(e.target.value);
                    onUpdate({ acpArgs: e.target.value.split(' ').filter(Boolean) });
                  }}
                  placeholder="--experimental-acp"
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                />
                <p className="mt-1 text-xs text-notion-text-tertiary">
                  Arguments to enable ACP protocol mode.
                </p>
              </div>

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
                        className="text-xs text-notion-accent hover:underline"
                      >
                        Load from file
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
                        className="text-xs text-notion-accent hover:underline"
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
                className="rounded-lg bg-notion-accent px-3 py-1.5 text-sm text-white hover:bg-notion-accent/90 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
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
