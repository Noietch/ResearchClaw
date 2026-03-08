import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Trash2, Bot } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import { motion, AnimatePresence } from 'framer-motion';

interface AgentConfig {
  id: string;
  name: string;
  backend: string;
  cliPath: string | null;
  acpArgs: string[];
  isDetected: boolean;
  isCustom: boolean;
  enabled: boolean;
}

interface DetectedAgent {
  backend: string;
  name: string;
  cliPath: string;
  acpArgs: string[];
}

export function AgentSettings() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [detected, setDetected] = useState<DetectedAgent[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', backend: '', cliPath: '', acpArgs: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    try {
      const data = await ipc.listAgents();
      setAgents(data as AgentConfig[]);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    try {
      const results = await ipc.detectAgents();
      setDetected(results as DetectedAgent[]);
      // Auto-add newly detected agents
      for (const d of results as DetectedAgent[]) {
        const existing = agents.find((a) => a.backend === d.backend);
        if (!existing) {
          await ipc.addAgent({
            name: d.name,
            backend: d.backend,
            cliPath: d.cliPath,
            acpArgs: d.acpArgs,
          });
        }
      }
      await loadAgents();
    } catch (err) {
      console.error(err);
    } finally {
      setDetecting(false);
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
      });
      setNewAgent({ name: '', backend: '', cliPath: '', acpArgs: '' });
      setShowAddForm(false);
      await loadAgents();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Detected Agents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-notion-text">Detected Agents</h3>
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="flex items-center gap-1.5 rounded-md border border-notion-border px-3 py-1.5 text-xs text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
          >
            <RefreshCw size={12} className={detecting ? 'animate-spin' : ''} />
            {detecting ? 'Detecting...' : 'Re-detect'}
          </button>
        </div>

        <div className="rounded-lg border border-notion-border divide-y divide-notion-border">
          {['claude', 'codex', 'gemini'].map((backend) => {
            const config = agents.find((a) => a.backend === backend && !a.isCustom);
            const det = detected.find((d) => d.backend === backend);
            const isAvailable = !!config || !!det;

            return (
              <div key={backend} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2 w-2 rounded-full flex-shrink-0 ${isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                  />
                  <div>
                    <p className="text-sm font-medium text-notion-text capitalize">
                      {backend === 'claude'
                        ? 'Claude Code'
                        : backend === 'codex'
                          ? 'Codex'
                          : 'Gemini CLI'}
                    </p>
                    <p className="text-xs text-notion-text-secondary">
                      {config?.cliPath ?? (isAvailable ? 'Available' : 'Not installed')}
                    </p>
                  </div>
                </div>
                {config ? (
                  <button
                    onClick={() => handleToggle(config.id, !config.enabled)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      config.enabled
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {config.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                ) : (
                  <span className="text-xs text-notion-text-secondary">Not installed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Agents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-notion-text">Custom Agents</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 rounded-md border border-notion-border px-3 py-1.5 text-xs text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
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
              className="mb-3 rounded-lg border border-notion-border p-4 space-y-3 overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-notion-text">Name</label>
                  <input
                    type="text"
                    value={newAgent.name}
                    onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                    placeholder="My Custom Agent"
                    className="w-full rounded border border-notion-border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-notion-accent"
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
                    className="w-full rounded border border-notion-border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-notion-accent"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">CLI Path</label>
                <input
                  type="text"
                  value={newAgent.cliPath}
                  onChange={(e) => setNewAgent((p) => ({ ...p, cliPath: e.target.value }))}
                  placeholder="/usr/local/bin/my-agent"
                  className="w-full rounded border border-notion-border px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-notion-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-notion-text">
                  ACP Args (space-separated)
                </label>
                <input
                  type="text"
                  value={newAgent.acpArgs}
                  onChange={(e) => setNewAgent((p) => ({ ...p, acpArgs: e.target.value }))}
                  placeholder="--experimental-acp"
                  className="w-full rounded border border-notion-border px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-notion-accent"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded px-3 py-1.5 text-xs text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-notion-accent px-3 py-1.5 text-xs text-white hover:bg-notion-accent/90 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Adding...' : 'Add'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Custom agents list */}
        {agents.filter((a) => a.isCustom).length === 0 ? (
          <div className="rounded-lg border border-notion-border border-dashed px-4 py-6 text-center text-xs text-notion-text-secondary">
            No custom agents. Add one above.
          </div>
        ) : (
          <div className="rounded-lg border border-notion-border divide-y divide-notion-border">
            {agents
              .filter((a) => a.isCustom)
              .map((agent) => (
                <div key={agent.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-notion-text">{agent.name}</p>
                    <p className="text-xs text-notion-text-secondary font-mono">{agent.cliPath}</p>
                    {agent.acpArgs.length > 0 && (
                      <p className="text-xs text-notion-text-secondary">
                        Args: {agent.acpArgs.join(' ')}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    className="rounded p-1 text-notion-text-secondary hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
