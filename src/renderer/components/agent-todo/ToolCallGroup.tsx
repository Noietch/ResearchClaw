import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';

interface Message {
  id: string;
  msgId: string;
  content: unknown;
  status?: string | null;
}

interface ToolCallGroupProps {
  tools: Message[];
}

function buildSummary(tools: Message[], t: (key: string, options?: any) => string): string {
  const counts: Record<string, number> = {};
  for (const tool of tools) {
    const kind = (tool.content as any)?.kind ?? 'other';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  const parts: string[] = [];
  if (counts['read']) parts.push(t('toolCall.readFiles', { count: counts['read'] }));
  if (counts['edit']) parts.push(t('toolCall.editFiles', { count: counts['edit'] }));
  if (counts['execute']) parts.push(t('toolCall.executeCommands', { count: counts['execute'] }));
  const searchN = (counts['glob'] ?? 0) + (counts['grep'] ?? 0);
  if (searchN) parts.push(t('toolCall.search', { count: searchN }));
  if (counts['mcp']) parts.push(t('toolCall.callTools', { count: counts['mcp'] }));
  return parts.join(' · ') || t('toolCall.operations', { count: tools.length });
}

export function ToolCallGroup({ tools }: ToolCallGroupProps) {
  const { t } = useTranslation();
  const hasPending = tools.some(
    (tool) => !tool.status || tool.status === 'pending' || tool.status === 'running',
  );
  const [expanded, setExpanded] = useState(hasPending);

  const summary = buildSummary(tools, t as (key: string, options?: any) => string);

  if (!expanded) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-1 my-0.5 rounded-md cursor-pointer
          text-xs text-notion-text-secondary bg-notion-sidebar
          hover:bg-blue-50 hover:text-blue-600 transition-colors"
        onClick={() => setExpanded(true)}
      >
        <ChevronRight size={11} className="flex-shrink-0" />
        <span>{summary}</span>
        <span className="text-notion-text-tertiary ml-1">({tools.length})</span>
      </div>
    );
  }

  return (
    <div className="border border-notion-border rounded-lg overflow-hidden my-1">
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer text-xs
          text-notion-text-secondary bg-notion-sidebar
          hover:bg-blue-50 hover:text-blue-600 transition-colors"
        onClick={() => setExpanded(false)}
      >
        <ChevronDown size={11} className="flex-shrink-0" />
        <span>{summary}</span>
        <span className="ml-auto text-notion-text-tertiary">
          {t('toolCall.steps', { count: tools.length })}
        </span>
      </div>
      <div className="divide-y divide-notion-border bg-white">
        {tools.map((tool) => (
          <div key={tool.id} className="px-2 py-1">
            <ToolCallCard content={tool.content as any} status={tool.status ?? undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
