import { StatusDot } from './StatusDot';

interface RunItem {
  id: string;
  status: string;
  trigger: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface RunTimelineProps {
  runs: RunItem[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
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

export function RunTimeline({ runs, selectedRunId, onSelect }: RunTimelineProps) {
  return (
    <div className="w-52 flex-shrink-0 border-r border-notion-border overflow-y-auto">
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
            className={`px-3 py-2.5 cursor-pointer border-b border-notion-border transition-colors ${
              selectedRunId === run.id
                ? 'bg-notion-accent-light border-l-2 border-l-notion-accent'
                : 'hover:bg-notion-accent-light'
            }`}
          >
            <div className="flex items-center gap-2">
              <StatusDot status={run.status} size="sm" />
              <span className="text-sm font-medium text-notion-text">Run #{runs.length - i}</span>
            </div>
            <div className="text-xs text-notion-text-secondary mt-0.5">
              {formatTime(run.startedAt ?? run.createdAt)}
            </div>
            <div className="text-xs text-notion-text-secondary capitalize">{run.status}</div>
          </div>
        ))
      )}
    </div>
  );
}
