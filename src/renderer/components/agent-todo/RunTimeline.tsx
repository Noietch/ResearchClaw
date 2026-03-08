import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { StatusDot } from './StatusDot';
import type { TokenUsage } from '@shared';

interface RunItem {
  id: string;
  status: string;
  trigger: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  tokenUsage: string | null;
}

interface RunTimelineProps {
  runs: RunItem[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (runId: string) => Promise<void>;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function parseTokenUsage(raw: string | null): TokenUsage | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenUsage;
  } catch {
    return null;
  }
}

export function RunTimeline({ runs, selectedRunId, onSelect, onDelete }: RunTimelineProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, runId: string) {
    e.stopPropagation();
    if (!onDelete || deletingId === runId) return;

    setDeletingId(runId);
    try {
      await onDelete(runId);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="overflow-y-auto">
      <div className="px-3 py-2 border-b border-notion-border">
        <span className="text-xs font-medium text-notion-text-secondary uppercase tracking-wide">
          Run History
        </span>
      </div>
      {runs.length === 0 ? (
        <div className="px-3 py-4 text-xs text-notion-text-secondary text-center">No runs yet</div>
      ) : (
        runs.map((run, i) => (
          <div
            key={run.id}
            onClick={() => onSelect(run.id)}
            className={`group px-3 py-2.5 cursor-pointer border-b border-notion-border transition-colors ${
              selectedRunId === run.id
                ? 'bg-notion-sidebar border-l-2 border-l-notion-text-secondary'
                : 'hover:bg-notion-sidebar'
            }`}
          >
            <div className="flex items-center gap-2">
              <StatusDot status={run.status} size="sm" />
              <span className="text-sm font-medium text-notion-text flex-1">
                Run #{runs.length - i}
              </span>
              {onDelete && (
                <button
                  onClick={(e) => handleDelete(e, run.id)}
                  disabled={deletingId === run.id}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-notion-red/10 rounded transition-opacity disabled:opacity-50"
                  title="Delete run"
                >
                  <Trash2 size={14} className="text-notion-red" />
                </button>
              )}
            </div>
            <div className="text-xs text-notion-text-secondary mt-0.5">
              {formatTime(run.startedAt ?? run.createdAt)}
            </div>
            <div className="text-xs text-notion-text-secondary capitalize">{run.status}</div>
            {run.status === 'failed' && run.errorMessage && (
              <div
                className="text-xs text-notion-red mt-0.5 leading-tight line-clamp-2"
                title={run.errorMessage}
              >
                {run.errorMessage}
              </div>
            )}
            {(() => {
              const usage = parseTokenUsage(run.tokenUsage);
              if (!usage) return null;
              const total =
                usage.inputTokens +
                usage.outputTokens +
                usage.cacheReadTokens +
                usage.cacheCreationTokens;
              return (
                <div
                  className="text-xs text-notion-text-tertiary mt-0.5"
                  title={`In: ${usage.inputTokens.toLocaleString()} · Out: ${usage.outputTokens.toLocaleString()} · Cache read: ${usage.cacheReadTokens.toLocaleString()} · Cache write: ${usage.cacheCreationTokens.toLocaleString()}`}
                >
                  {formatTokens(total)} tokens
                </div>
              );
            })()}
          </div>
        ))
      )}
    </div>
  );
}
