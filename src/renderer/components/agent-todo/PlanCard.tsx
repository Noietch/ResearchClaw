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
    return <Check size={14} className="text-green-500 flex-shrink-0 mt-0.5" />;
  if (status === 'in_progress' || status === 'active')
    return <Loader2 size={14} className="animate-spin text-blue-600 flex-shrink-0 mt-0.5" />;
  return <Circle size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />;
}

export function PlanCard({ content }: PlanCardProps) {
  if (!content.entries?.length) return null;

  const entries = content.entries;

  return (
    <div className="border border-notion-border rounded-lg overflow-hidden my-2">
      <div className="px-3 py-2 bg-notion-sidebar border-b border-notion-border">
        <span className="font-medium text-sm text-notion-text">Plan</span>
      </div>
      <ul className="divide-y divide-notion-border">
        {entries.map((entry, i) => {
          const isActive = entry.status === 'in_progress' || entry.status === 'active';
          const isDone = entry.status === 'completed' || entry.status === 'done';
          return (
            <li
              key={i}
              className={[
                'flex items-start gap-2 px-3 py-2 bg-white',
                isActive ? 'border-l-2 border-blue-400 bg-blue-50/40' : '',
              ].join(' ')}
            >
              <EntryIcon status={entry.status} />
              <span
                className={`text-sm leading-snug ${
                  isDone ? 'line-through text-notion-text-tertiary' : 'text-notion-text'
                }`}
              >
                {entry.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
