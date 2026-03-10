import { useState } from 'react';
import { Loader2, X, ChevronDown, FileText, FolderOpen, Terminal, Search } from 'lucide-react';

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

const KNOWN_KINDS: Record<string, { label: string; icon: React.ReactNode }> = {
  read: { label: 'Read', icon: <FileText size={12} /> },
  edit: { label: 'Edited', icon: <FileText size={12} /> },
  execute: { label: 'Ran', icon: <Terminal size={12} /> },
  mcp: { label: 'Called', icon: <Search size={12} /> },
  glob: { label: 'Glob', icon: <FolderOpen size={12} /> },
  grep: { label: 'Grep', icon: <Search size={12} /> },
};

export function ToolCallCard({ content, status }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const path = content.locations?.[0]?.path ?? (content.rawInput?.path as string) ?? null;
  const command = (content.rawInput?.command as string) ?? null;
  const pattern = (content.rawInput?.pattern as string) ?? null;
  const globPath = (content.rawInput?.glob as string) ?? null;

  const effectiveStatus = status ?? content.status;
  const isCompleted = effectiveStatus === 'completed';
  const isFailed = effectiveStatus === 'failed';
  const isExecute = content.kind === 'execute';

  const kindInfo = content.kind ? KNOWN_KINDS[content.kind] : undefined;
  const label = kindInfo?.label ?? content.title ?? null;
  const icon = kindInfo?.icon ?? <FileText size={12} />;

  // Build detail string based on tool type
  let detail: string | null = null;
  let fullDetail: string | null = null;

  if (isExecute && command) {
    detail = command.length > 80 ? command.slice(0, 80) + '…' : command;
    fullDetail = command;
  } else if (content.kind === 'glob' && (globPath || pattern)) {
    const globStr = globPath ?? pattern ?? '';
    detail = globStr;
    fullDetail = globStr;
  } else if (content.kind === 'grep' && (pattern || path)) {
    detail = pattern ? `pattern: ${pattern}` : path;
    fullDetail = pattern ? `pattern: ${pattern}${path ? ` in ${path}` : ''}` : path;
  } else if (path) {
    // For read/edit: show full path
    detail = path;
    fullDetail = path;
  } else if (command) {
    detail = command.slice(0, 40);
    fullDetail = command;
  }

  // Nothing useful to show — skip rendering entirely
  if (!label && !detail) return null;

  // Execute with a command: expandable card showing full command
  if (isExecute && command) {
    const preview = command.length > 80 ? command.slice(0, 80) + '…' : command;
    return (
      <div className="rounded-md bg-[#f5f5f4] overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#eeeeec] transition-colors"
        >
          <span className="text-notion-text-tertiary flex-shrink-0">{icon}</span>
          <span className="text-sm font-semibold text-notion-text flex-shrink-0">{label}</span>
          <span className="flex-1 truncate font-mono text-xs text-notion-text-secondary">
            {expanded ? command : preview}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!isCompleted && !isFailed && (
              <Loader2 size={13} className="animate-spin text-blue-400" />
            )}
            {isFailed && <X size={13} className="text-red-400" />}
            {command.length > 80 && (
              <ChevronDown
                size={12}
                className={`text-notion-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
              />
            )}
          </div>
        </button>
        {expanded && (
          <div className="px-3 pb-2.5 pt-0">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-notion-text-secondary leading-relaxed">
              {command}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Check if detail is long enough to warrant expandable
  const isLongDetail = fullDetail && fullDetail.length > 60;

  if (isLongDetail && !isExecute) {
    const preview = fullDetail!.length > 60 ? fullDetail!.slice(0, 60) + '…' : fullDetail;
    return (
      <div className="rounded-md bg-[#f5f5f4] overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#eeeeec] transition-colors"
        >
          <span className="text-notion-text-tertiary flex-shrink-0">{icon}</span>
          <span className="text-sm font-semibold text-notion-text flex-shrink-0">{label}</span>
          <span className="flex-1 truncate font-mono text-xs text-notion-text-secondary">
            {expanded ? fullDetail : preview}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!isCompleted && !isFailed && (
              <Loader2 size={13} className="animate-spin text-notion-text-tertiary" />
            )}
            {isFailed && <X size={13} className="text-red-400" />}
            <ChevronDown
              size={12}
              className={`text-notion-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
            />
          </div>
        </button>
        {expanded && (
          <div className="px-3 pb-2.5 pt-0">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-notion-text-secondary leading-relaxed">
              {fullDetail}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Default: single-line card
  return (
    <div className="flex items-center gap-2 rounded-md bg-[#f5f5f4] px-3 py-1.5">
      <span className="text-notion-text-tertiary flex-shrink-0">{icon}</span>
      <span className="text-sm font-semibold text-notion-text flex-shrink-0">{label}</span>
      {detail && (
        <span className="text-sm text-notion-text-secondary flex-1 truncate font-mono text-xs">
          {detail}
        </span>
      )}
      {!isCompleted && !isFailed && (
        <Loader2
          size={13}
          className={`animate-spin flex-shrink-0 ${isExecute ? 'text-blue-400' : 'text-notion-text-tertiary'}`}
        />
      )}
      {isFailed && <X size={13} className="text-red-400 flex-shrink-0" />}
    </div>
  );
}
