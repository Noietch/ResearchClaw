import { useState, useEffect } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import type { AgentConfigItem } from '@shared';

interface AgentSelectorProps {
  value: string;
  onChange: (id: string) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const [agents, setAgents] = useState<AgentConfigItem[]>([]);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    ipc.listAgents().then(setAgents).catch(console.error);
  }, []);

  async function handleDetect() {
    setDetecting(true);
    try {
      const detected = await ipc.detectAgents();
      for (const d of detected) {
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
      const updated = await ipc.listAgents();
      setAgents(updated);
    } catch (e) {
      console.error(e);
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="flex gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-md border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-notion-accent"
      >
        <option value="">Select an agent...</option>
        {agents
          .filter((a) => a.enabled)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <button
        type="button"
        onClick={handleDetect}
        disabled={detecting}
        className="flex items-center gap-1 rounded-md border border-notion-border px-3 py-2 text-sm text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
        title="Detect installed agents"
      >
        {detecting ? <RefreshCw size={14} className="animate-spin" /> : <Bot size={14} />}
        Detect
      </button>
    </div>
  );
}
