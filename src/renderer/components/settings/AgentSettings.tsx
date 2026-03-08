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
} from 'lucide-react';
import { ipc, type TokenUsageRecord, type CliTestDiagnostics } from '../../hooks/use-ipc';
import type { AgentConfigItem, AgentToolKind } from '@shared';
import { AGENT_TOOL_META, getAgentToolMeta } from '@shared';

// Claude Logo Component
function ClaudeLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Claude</title>
      <path
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
        fill="#D97757"
        fillRule="nonzero"
      />
    </svg>
  );
}

// Code X Logo Component
function CodeXLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Code X</title>
      <circle cx="80" cy="79" r="65" fill="white" />
      <path
        d="M135 80C135 49.6243 110.376 25 80 25C49.6243 25 25 49.6243 25 80C25 110.376 49.6243 135 80 135V149C41.8924 149 11 118.108 11 80C11 41.8924 41.8924 11 80 11C118.108 11 149 41.8924 149 80C149 118.108 118.108 149 80 149V135C110.376 135 135 110.376 135 80Z"
        fill="black"
      />
      <path
        d="M50.9235 54.3903C54.0216 52.577 58.0026 53.6185 59.8161 56.7165L70.9294 75.7009C72.6642 78.6649 72.6642 82.3345 70.9294 85.2985L59.8161 104.283C58.0026 107.381 54.0216 108.422 50.9235 106.609C47.8255 104.796 46.784 100.815 48.5973 97.7165L58.6745 80.4997L48.5973 63.2829C46.784 60.1848 47.8255 56.2038 50.9235 54.3903Z"
        fill="black"
      />
      <path
        d="M112 89.5C115.59 89.5 118.5 92.4101 118.5 96C118.5 99.5899 115.59 102.5 112 102.5H85C81.4101 102.5 78.5 99.5899 78.5 96C78.5 92.4101 81.4101 89.5 85 89.5H112Z"
        fill="black"
      />
    </svg>
  );
}

// Get logo component by agent type
function getAgentLogo(tool: AgentToolKind, size?: number) {
  switch (tool) {
    case 'claude-code':
      return <ClaudeLogo size={size} />;
    case 'codex':
      return <CodeXLogo size={size} />;
    default:
      return <Bot size={size} />;
  }
}

const AGENT_NAME_SUGGESTIONS = ['Aria', 'Max', 'Nova', 'Echo', 'Sage', 'Orion', 'Luna', 'Finn'];

export function AgentSettings() {
  const [agents, setAgents] = useState<AgentConfigItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [newAgent, setNewAgent] = useState({
    name: '',
    backend: '',
    cliPath: '',
    agentTool: 'claude-code' as AgentToolKind,
    configContent: '',
    authContent: '',
    extraEnvText: '',
    defaultModel: '',
    apiKey: '',
    baseUrl: '',
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

  async function handleAddAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!newAgent.name || !newAgent.cliPath) return;
    setSaving(true);
    try {
      const extraEnv = parseEnvText(newAgent.extraEnvText);
      const meta = getAgentToolMeta(newAgent.agentTool);
      await ipc.addAgent({
        name: newAgent.name,
        backend: newAgent.backend,
        cliPath: newAgent.cliPath,
        acpArgs: meta.defaultAcpArgs,
        agentTool: newAgent.agentTool,
        configContent: newAgent.configContent || undefined,
        authContent: newAgent.authContent || undefined,
        extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
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
        extraEnvText: '',
        defaultModel: '',
        apiKey: '',
        baseUrl: '',
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
        extraEnv: editingAgent.extraEnv,
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
      const result = await ipc.testAgentAcp(agent.id);
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
                  <div className="grid grid-cols-2 gap-3">
                    {AGENT_TOOL_META.map((meta) => (
                      <button
                        key={meta.value}
                        type="button"
                        onClick={() => handleAgentToolChange(meta.value)}
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                          newAgent.agentTool === meta.value
                            ? 'border-notion-accent bg-notion-accent-light'
                            : 'border-notion-border hover:border-notion-accent/50 hover:bg-notion-sidebar/50'
                        }`}
                      >
                        {getAgentLogo(meta.value, 24)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-notion-text">
                              {meta.label}
                            </span>
                            {meta.supportsYolo && <Zap size={10} className="text-purple-500" />}
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
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {AGENT_NAME_SUGGESTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setNewAgent((p) => ({ ...p, name: n }))}
                        className="px-2 py-0.5 rounded-full text-xs border border-notion-border hover:bg-notion-accent-light hover:border-notion-accent/30 text-notion-text-secondary transition-colors"
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
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                      className="mt-2 w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                          className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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

                {/* Environment Variables */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">
                    Environment Variables
                  </label>
                  <textarea
                    value={newAgent.extraEnvText}
                    onChange={(e) => setNewAgent((p) => ({ ...p, extraEnvText: e.target.value }))}
                    placeholder={'ANTHROPIC_AUTH_TOKEN=your-token\nANTHROPIC_BASE_URL=https://...'}
                    rows={3}
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent resize-none"
                  />
                  <p className="mt-1 text-xs text-notion-text-tertiary">
                    One KEY=VALUE per line. Injected into the agent process environment.
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
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent resize-none"
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
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent resize-none"
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
                    className={`rounded-lg border overflow-hidden transition-colors ${
                      agent.enabled
                        ? 'bg-green-50 border-green-200'
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
                        <div
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${agent.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-notion-text">
                              {agent.name}
                              <span className="ml-1 text-xs font-normal text-notion-text-tertiary">
                                ({meta.label})
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {usage.calls > 0 && (
                          <div className="text-right">
                            <div className="text-xs font-semibold tabular-nums text-notion-accent">
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
                        <button
                          onClick={() => handleToggle(agent.id, !agent.enabled)}
                          className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                            agent.enabled
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {agent.enabled ? 'Activated' : 'Deactivated'}
                        </button>
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
                          <pre className="text-red-600 whitespace-pre-wrap">{testResult.error}</pre>
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
                <div className="text-sm font-semibold tabular-nums text-notion-accent">
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
                    <span className="text-sm font-semibold tabular-nums text-notion-accent">
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
  const [extraEnvText, setExtraEnvText] = useState(() => envToText(agent?.extraEnv));

  useEffect(() => {
    setExtraEnvText(envToText(agent?.extraEnv));
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
                          ? 'border-notion-accent bg-notion-accent-light'
                          : 'border-notion-border hover:border-notion-accent/50 hover:bg-notion-sidebar/50'
                      }`}
                    >
                      {getAgentLogo(m.value, 24)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-notion-text">{m.label}</span>
                          {m.supportsYolo && <Zap size={10} className="text-purple-500" />}
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
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {AGENT_NAME_SUGGESTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onUpdate({ name: n })}
                      className="px-2 py-0.5 rounded-full text-xs border border-notion-border hover:bg-notion-accent-light hover:border-notion-accent/30 text-notion-text-secondary transition-colors"
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
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                    className="mt-2 w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent"
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

              {/* Environment Variables */}
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">
                  Environment Variables
                </label>
                <textarea
                  value={extraEnvText}
                  onChange={(e) => {
                    setExtraEnvText(e.target.value);
                    onUpdate({ extraEnv: parseEnvText(e.target.value) });
                  }}
                  placeholder={'ANTHROPIC_AUTH_TOKEN=your-token\nANTHROPIC_BASE_URL=https://...'}
                  rows={3}
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent resize-none"
                />
                <p className="mt-1 text-xs text-notion-text-tertiary">
                  One KEY=VALUE per line. Injected into the agent process environment.
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
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent resize-none"
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
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent resize-none"
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

function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Remove trailing comma (JSON-style)
    if (value.endsWith(',')) value = value.slice(0, -1).trim();
    // Remove surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

function envToText(env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return '';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
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
