import { useEffect, useState, useCallback, useRef } from 'react';
import { MessageSquare, Copy, Check, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const HIGHLIGHT_COLORS = [
  { color: 'yellow', label: 'Important', bg: 'bg-yellow-300', hover: 'hover:bg-yellow-400' },
  { color: 'green', label: 'Method', bg: 'bg-green-300', hover: 'hover:bg-green-400' },
  { color: 'blue', label: 'Data', bg: 'bg-blue-300', hover: 'hover:bg-blue-400' },
  { color: 'pink', label: 'Question', bg: 'bg-pink-300', hover: 'hover:bg-pink-400' },
  { color: 'purple', label: 'Insight', bg: 'bg-purple-300', hover: 'hover:bg-purple-400' },
] as const;

interface PdfSelectionPopoverProps {
  containerRef: React.RefObject<HTMLDivElement>;
  onAskAI: (text: string) => void;
  onHighlight?: (text: string, rectsJson: string, pageNumber: number, color?: string) => void;
  onSearchPaper?: (text: string) => void;
}

interface PopoverState {
  text: string;
  centerX: number;
  containerW: number;
  y: number;
  pageNumber: number;
  normalizedRects: Array<{ x: number; y: number; w: number; h: number }>;
}

export function PdfSelectionPopover({
  containerRef,
  onAskAI,
  onHighlight,
  onSearchPaper,
}: PdfSelectionPopoverProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = useCallback(() => {
    setPopover(null);
    setCopied(false);
  }, []);

  // Listen for text selection on the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (text.length === 0) return;

        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        // Position popover — account for scroll offset (position:absolute in scrollable container)
        const lastRect = rects[rects.length - 1];
        const containerRect = container.getBoundingClientRect();
        const centerX =
          lastRect.left + lastRect.width / 2 - containerRect.left + container.scrollLeft;
        const y = lastRect.bottom - containerRect.top + 6 + container.scrollTop;
        // We'll finalize x in the render using containerWidth
        const containerW = containerRect.width;

        // Pre-capture normalized rects for highlight
        const startNode = range.startContainer.parentElement;
        const pageEl = startNode?.closest('[data-page-number]');
        const pageNumber = pageEl ? Number(pageEl.getAttribute('data-page-number')) : 1;
        const pageRect = pageEl?.getBoundingClientRect();

        let normalizedRects: PopoverState['normalizedRects'] = [];
        if (pageRect && pageRect.width > 0 && pageRect.height > 0) {
          normalizedRects = Array.from(rects)
            .filter((r) => r.width > 1 && r.height > 1)
            .map((r) => ({
              x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
              y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
              w: Math.min(1, r.width / pageRect.width),
              h: Math.min(1, r.height / pageRect.height),
            }))
            .filter((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.01 && r.y + r.h <= 1.01);
        }

        setPopover({ text, centerX, containerW, y, pageNumber, normalizedRects });
        setCopied(false);
      });
    };

    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
  }, [containerRef]);

  // Dismiss when clicking outside the popover
  useEffect(() => {
    if (!popover) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleMouseDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [popover, dismiss]);

  // Dismiss when selection is cleared
  useEffect(() => {
    if (!popover) return;
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        dismiss();
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [popover, dismiss]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!popover) return;
    navigator.clipboard.writeText(popover.text);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [popover]);

  const handleAskAI = useCallback(() => {
    if (!popover) return;
    onAskAI(popover.text);
    dismiss();
  }, [popover, onAskAI, dismiss]);

  const handleHighlight = useCallback(
    (color: string) => {
      if (!popover || !onHighlight) return;
      if (popover.normalizedRects.length === 0) return;
      onHighlight(popover.text, JSON.stringify(popover.normalizedRects), popover.pageNumber, color);
      window.getSelection()?.removeAllRanges();
      dismiss();
    },
    [popover, onHighlight, dismiss],
  );

  return (
    <AnimatePresence>
      {popover && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, scale: 0.95, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 4 }}
          transition={{ duration: 0.15 }}
          className="absolute z-50"
          style={{
            // Clamp left so popover stays within the visible container width
            left: Math.max(
              8,
              Math.min(
                popover.centerX - (popoverRef.current?.offsetWidth ?? 300) / 2,
                popover.containerW - (popoverRef.current?.offsetWidth ?? 300) - 8,
              ),
            ),
            top: popover.y,
          }}
        >
          <div className="flex items-center gap-0.5 whitespace-nowrap rounded-lg border border-notion-border bg-white p-1.5 shadow-lg">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAskAI}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-notion-text transition-colors hover:bg-notion-accent-light hover:text-notion-accent"
            >
              <MessageSquare size={14} />
              <span>Ask AI</span>
            </button>

            {/* Color dots for instant highlight — click to create, add notes in sidebar */}
            {onHighlight && (
              <>
                <div className="h-4 w-px bg-notion-border" />
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.color}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleHighlight(c.color)}
                    className={`mx-0.5 h-5 w-5 rounded-full ${c.bg} ${c.hover} transition-transform hover:scale-125`}
                    title={c.label}
                  />
                ))}
              </>
            )}

            {onSearchPaper && (
              <>
                <div className="h-4 w-px bg-notion-border" />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!popover) return;
                    onSearchPaper(popover.text);
                    dismiss();
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-notion-text transition-colors hover:bg-green-50 hover:text-green-600"
                >
                  <ExternalLink size={14} />
                  <span>Find</span>
                </button>
              </>
            )}

            <div className="h-4 w-px bg-notion-border" />

            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCopy}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                copied
                  ? 'text-green-600'
                  : 'text-notion-text hover:bg-notion-accent-light hover:text-notion-accent'
              }`}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
