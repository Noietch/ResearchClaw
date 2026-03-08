import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ThoughtBlockProps {
  content: { text: string };
}

export function ThoughtBlock({ content }: ThoughtBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-left text-sm text-notion-text-secondary hover:text-notion-text transition-colors"
      >
        <span className="font-semibold text-notion-text-secondary">Thought</span>
        {expanded ? (
          <ChevronDown size={13} className="text-notion-text-tertiary" />
        ) : (
          <ChevronRight size={13} className="text-notion-text-tertiary" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 pl-3 border-l-2 border-notion-border">
              <p className="text-sm italic text-notion-text-tertiary whitespace-pre-wrap leading-relaxed">
                {content.text}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
