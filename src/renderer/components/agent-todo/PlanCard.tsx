import { Check, Loader2, Circle } from 'lucide-react';

interface PlanEntry {
  content: string;
  status: string;
  priority?: string;
}

interface PlanCardProps {
  content: { entries?: PlanEntry[] };
}

function EntryIcon({ status }: { status: string }) {
  if (status === 'completed' || status === 'done')
    return <Check size={14} className="text-green-500 flex-shrink-0" />;
  if (status === 'in_progress' || status === 'active')
    return <Loader2 size={14} className="animate-spin text-notion-text-secondary flex-shrink-0" />;
  return <Circle size={14} className="text-gray-400 flex-shrink-0" />;
}

export function PlanCard({ content }: PlanCardProps) {
  if (!content.entries?.length) return null;

  return (
    <div className="border border-notion-border rounded-lg overflow-hidden my-2">
      <div className="px-3 py-2 bg-notion-bg-secondary border-b border-notion-border">
        <span className="font-medium text-sm text-notion-text">Plan</span>
      </div>
      <ul className="divide-y divide-notion-border">
        {content.entries.map((entry, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2 bg-white">
            <EntryIcon status={entry.status} />
            <span className="text-sm text-notion-text">{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
