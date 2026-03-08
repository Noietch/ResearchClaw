import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Edit,
  Terminal,
  Plug,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  X,
} from 'lucide-react';

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

function ToolIcon({ kind }: { kind?: string }) {
  switch (kind) {
    case 'read':
      return <FileText size={14} />;
    case 'edit':
      return <Edit size={14} />;
    case 'execute':
      return <Terminal size={14} />;
    case 'mcp':
      return <Plug size={14} />;
    default:
      return <Terminal size={14} />;
  }
}

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === 'pending')
    return <Loader2 size={12} className="animate-spin text-blue-500" />;
  if (status === 'in_progress') return <Loader2 size={12} className="animate-spin text-blue-500" />;
  if (status === 'completed') return <Check size={12} className="text-green-500" />;
  if (status === 'failed') return <X size={12} className="text-red-500" />;
  return null;
}

export function ToolCallCard({ content, status }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const path = content.locations?.[0]?.path ?? (content.rawInput?.path as string) ?? null;
  const command = (content.rawInput?.command as string) ?? null;
  const hasOutput = path || command;

  return (
    <motion.div layout className="border border-notion-border rounded-lg overflow-hidden my-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-notion-bg-secondary">
        <ToolIcon kind={content.kind} />
        <span className="font-medium text-sm text-notion-text flex-1 truncate">
          {content.title ?? content.kind ?? 'Tool Call'}
        </span>
        <StatusBadge status={status ?? content.status} />
        {hasOutput && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-notion-text-secondary hover:text-notion-text"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>

      {(path || command) && (
        <div className="px-3 py-1 text-xs font-mono text-notion-text-secondary bg-white border-t border-notion-border">
          {path ?? command}
        </div>
      )}

      {expanded && content.rawInput && (
        <div className="border-t border-notion-border">
          <pre className="px-3 py-2 text-xs font-mono bg-gray-50 max-h-48 overflow-y-auto text-notion-text">
            {JSON.stringify(content.rawInput, null, 2)}
          </pre>
        </div>
      )}
    </motion.div>
  );
}
