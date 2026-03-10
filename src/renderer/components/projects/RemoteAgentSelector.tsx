import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Server, Check, Loader2, X } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import type { AgentConfigItem } from '@shared';

interface RemoteAgentSelectorProps {
  value?: string; // agent ID, empty means "local"
  onChange: (id: string | undefined) => void;
  className?: string;
}

export function RemoteAgentSelector({ value, onChange, className }: RemoteAgentSelectorProps) {
  const [agents, setAgents] = useState<AgentConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const list = await ipc.listAgents();
      setAgents(list.filter((a) => (a as any).isRemote));
    } catch (e) {
      console.error('Failed to load agents:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-remote-agent-selector]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedAgent = value ? agents.find((a) => a.id === value) : null;

  return (
    <div className={`relative ${className ?? ''}`} data-remote-agent-selector>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text transition-colors hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <Server
            size={14}
            className={selectedAgent ? 'text-purple-500' : 'text-notion-text-tertiary'}
          />
          {loading ? (
            'Loading…'
          ) : selectedAgent ? (
            <span className="truncate">
              {selectedAgent.name}{' '}
              <span className="text-notion-text-tertiary">
                ({(selectedAgent as any).sshUsername}@{(selectedAgent as any).sshHost})
              </span>
            </span>
          ) : (
            <span className="text-notion-text-secondary">None (local execution)</span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-notion-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-notion-border bg-white shadow-lg">
          {/* None option */}
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${
              !value ? 'bg-blue-50 text-blue-700' : 'text-notion-text'
            }`}
          >
            <span className="flex items-center gap-2">
              <X size={14} className="text-notion-text-tertiary" />
              None (local execution)
            </span>
            {!value && <Check size={13} className="text-blue-600" />}
          </button>

          {agents.length > 0 && (
            <div className="border-t border-notion-border">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    onChange(agent.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${
                    value === agent.id ? 'bg-blue-50 text-blue-700' : 'text-notion-text'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Server size={14} className="text-purple-500" />
                    <span className="truncate">
                      {agent.name}{' '}
                      <span className="text-notion-text-tertiary">
                        ({(agent as any).sshUsername}@{(agent as any).sshHost}:
                        {(agent as any).sshPort ?? 22})
                      </span>
                    </span>
                  </span>
                  {value === agent.id && <Check size={13} className="text-blue-600" />}
                </button>
              ))}
            </div>
          )}

          {agents.length === 0 && !loading && (
            <div className="border-t border-notion-border px-3 py-2.5 text-xs text-notion-text-tertiary">
              No remote agents configured. Add one in Settings → Agents.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
