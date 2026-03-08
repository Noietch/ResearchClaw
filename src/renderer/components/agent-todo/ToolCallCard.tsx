import { Loader2, X } from 'lucide-react';

interface ToolCallContent {
  title?: string;
  kind?: string;
  rawInput?: Record<string, unknown>;
  locations?: Array<{ path: string }>;
  status?: string;
}

interface ToolCallCardProps {
  content: ToolCallContent;
  status?: string;
}

function getKindLabel(kind?: string): string {
  switch (kind) {
    case 'read':
      return 'Read';
    case 'edit':
      return 'Edited';
    case 'execute':
      return 'Ran';
    case 'mcp':
      return 'Called';
    default:
      return 'Used';
  }
}

export function ToolCallCard({ content, status }: ToolCallCardProps) {
  const path = content.locations?.[0]?.path ?? (content.rawInput?.path as string) ?? null;
  const command = (content.rawInput?.command as string) ?? null;

  const effectiveStatus = status ?? content.status;
  const kindLabel = getKindLabel(content.kind);
  const isCompleted = effectiveStatus === 'completed';
  const isFailed = effectiveStatus === 'failed';
  const isExecute = content.kind === 'execute';

  // Display name: prefer path basename, then title, then command snippet
  const displayName = path
    ? (path.split('/').pop() ?? path)
    : (content.title ?? (command ? command.slice(0, 40) : null));

  return (
    <div className="flex items-center gap-2 rounded-md bg-[#f5f5f4] px-3 py-1.5">
      <span className="text-sm font-semibold text-notion-text flex-shrink-0">{kindLabel}</span>
      {displayName && (
        <span className="text-sm text-notion-text-secondary flex-1 truncate font-mono text-xs">
          {displayName}
        </span>
      )}
      {!isCompleted && !isFailed && (
        <Loader2
          size={13}
          className={`animate-spin flex-shrink-0 ${isExecute ? 'text-purple-400' : 'text-notion-text-tertiary'}`}
        />
      )}
      {isFailed && <X size={13} className="text-red-400 flex-shrink-0" />}
    </div>
  );
}
