import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

interface ThoughtBlockProps {
  content: { text: string };
}

export function ThoughtBlock({ content }: ThoughtBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-blue-100 bg-blue-50/50 my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 transition-colors"
      >
        <Brain size={14} className="flex-shrink-0" />
        <span className="font-medium">Thinking...</span>
        {expanded ? (
          <ChevronDown size={14} className="ml-auto" />
        ) : (
          <ChevronRight size={14} className="ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-xs text-blue-700 whitespace-pre-wrap font-mono">
          {content.text}
        </div>
      )}
    </div>
  );
}
