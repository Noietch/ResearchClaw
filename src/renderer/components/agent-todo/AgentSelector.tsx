import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import type { AgentConfigItem } from '@shared';
import { AgentLogo } from './AgentLogo';

interface AgentSelectorProps {
  value: string;
  onChange: (id: string) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const [agents, setAgents] = useState<AgentConfigItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipc.listAgents().then(setAgents).catch(console.error);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const enabled = agents.filter((a) => a.enabled);
  const selected = enabled.find((a) => a.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-notion-border bg-white px-3 py-2 text-sm text-notion-text hover:border-notion-accent/40 focus:outline-none focus:ring-1 focus:ring-notion-accent transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0">
            <AgentLogo tool={selected?.agentTool} size={14} />
          </span>
          <span
            className={`truncate ${selected ? 'text-notion-text' : 'text-notion-text-tertiary'}`}
          >
            {selected ? selected.name : 'Select an agent…'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-notion-text-tertiary transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-notion-border bg-white shadow-lg py-1">
          {enabled.length === 0 ? (
            <div className="px-3 py-2 text-sm text-notion-text-tertiary">
              No agents configured — add one in Settings → Agents
            </div>
          ) : (
            enabled.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  a.id === value
                    ? 'bg-notion-accent-light text-notion-accent'
                    : 'text-notion-text hover:bg-notion-sidebar'
                }`}
              >
                <span className="flex-shrink-0">
                  <AgentLogo tool={a.agentTool} size={13} />
                </span>
                {a.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
