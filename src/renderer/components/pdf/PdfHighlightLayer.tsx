import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { HighlightItem } from '../../hooks/use-ipc';

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: 'rgba(223, 171, 1, 0.3)',
  green: 'rgba(15, 123, 15, 0.3)',
  blue: 'rgba(46, 170, 220, 0.3)',
  pink: 'rgba(226, 85, 161, 0.3)',
  purple: 'rgba(144, 101, 176, 0.3)',
};

const COLOR_OPTIONS = [
  { name: 'yellow', bg: '#dfab01' },
  { name: 'green', bg: '#0f7b0f' },
  { name: 'blue', bg: '#2eaadc' },
  { name: 'pink', bg: '#e255a1' },
  { name: 'purple', bg: '#9065b0' },
];

interface PdfHighlightLayerProps {
  highlights: HighlightItem[];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  onDeleteHighlight?: (id: string) => void;
  onUpdateHighlight?: (id: string, params: { color?: string }) => void;
}

/**
 * Renders highlight rectangles on a PDF page.
 * Highlights are pointer-events: none (visual only).
 * Use PdfHighlightManager at the document level to handle click interactions.
 */
export const PdfHighlightLayer = memo(function PdfHighlightLayer({
  highlights,
  pageNumber,
  pageWidth,
  pageHeight,
}: PdfHighlightLayerProps) {
  const pageHighlights = highlights.filter((h) => h.pageNumber === pageNumber);
  if (pageHighlights.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
      {pageHighlights.map((highlight) => {
        const rects: Array<{ x: number; y: number; w: number; h: number }> = JSON.parse(
          highlight.rectsJson,
        );
        const color = HIGHLIGHT_COLORS[highlight.color] || HIGHLIGHT_COLORS.yellow;

        return rects.map((rect, i) => (
          <div
            key={`${highlight.id}-${i}`}
            className="absolute rounded-sm"
            style={{
              left: rect.x * pageWidth,
              top: rect.y * pageHeight,
              width: rect.w * pageWidth,
              height: rect.h * pageHeight,
              backgroundColor: color,
              mixBlendMode: 'multiply',
            }}
          />
        ));
      })}
    </div>
  );
});

/**
 * Floating popover for highlight actions (change color, delete).
 * Rendered at the document scroll container level, triggered by double-click detection.
 */
export function HighlightActionPopover({
  highlights,
  scrollContainerRef,
  onDeleteHighlight,
  onUpdateHighlight,
}: {
  highlights: HighlightItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onDeleteHighlight?: (id: string) => void;
  onUpdateHighlight?: (id: string, params: { color?: string }) => void;
}) {
  const [active, setActive] = useState<{ id: string; x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!active) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActive(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [active]);

  // Listen for double-click on the scroll container to detect highlight clicks
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleDblClick = (e: MouseEvent) => {
      // Find which page was clicked
      const pageEl = (e.target as HTMLElement).closest('[data-page-number]');
      if (!pageEl) return;
      const pageNum = Number(pageEl.getAttribute('data-page-number'));
      const pageRect = pageEl.getBoundingClientRect();
      const clickX = (e.clientX - pageRect.left) / pageRect.width;
      const clickY = (e.clientY - pageRect.top) / pageRect.height;

      // Check if click falls within any highlight rect on this page
      for (const h of highlights) {
        if (h.pageNumber !== pageNum) continue;
        const rects: Array<{ x: number; y: number; w: number; h: number }> = JSON.parse(
          h.rectsJson,
        );
        for (const r of rects) {
          if (clickX >= r.x && clickX <= r.x + r.w && clickY >= r.y && clickY <= r.y + r.h) {
            // Hit! Clear text selection and stop propagation to prevent selection popover
            e.stopPropagation();
            e.preventDefault();
            window.getSelection()?.removeAllRanges();
            const containerRect = container.getBoundingClientRect();
            setActive({
              id: h.id,
              x: e.clientX - containerRect.left + container.scrollLeft,
              y: e.clientY - containerRect.top + container.scrollTop + 8,
            });
            return;
          }
        }
      }
    };

    container.addEventListener('dblclick', handleDblClick);
    return () => container.removeEventListener('dblclick', handleDblClick);
  }, [scrollContainerRef, highlights]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          className="absolute z-50"
          style={{ left: active.x, top: active.y, transform: 'translateX(-50%)' }}
        >
          <div className="flex items-center gap-1 rounded-lg border border-notion-border bg-white p-1.5 shadow-lg">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  onUpdateHighlight?.(active.id, { color: c.name });
                  setActive(null);
                }}
                className="h-5 w-5 rounded-full border border-white/50 transition-transform hover:scale-125"
                style={{ backgroundColor: c.bg }}
                title={c.name}
              />
            ))}
            <div className="mx-0.5 h-4 w-px bg-notion-border" />
            <button
              onClick={() => {
                onDeleteHighlight?.(active.id);
                setActive(null);
              }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-red-50 hover:text-red-500 text-notion-text-tertiary"
              title="Delete highlight"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
