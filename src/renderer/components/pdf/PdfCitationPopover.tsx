import { useEffect, useState, useCallback, useRef } from 'react';
import { Copy, Check, ExternalLink, Library, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface PdfCitationPopoverProps {
  containerRef: React.RefObject<HTMLDivElement>;
  onSearchPaper: (query: string) => void;
}

interface PopoverState {
  text: string;
  x: number;
  y: number;
}

// More lenient citation patterns - catch more types of references
const CITATION_PATTERNS = {
  // Numeric citations: [1], [2], [1-3], [1,2,3], [1, 2, 3], superscript numbers
  numeric: /\[(?:\d+(?:\s*[-,]\s*\d+)*)+\]|\d{1,3}(?=\s|$|\.)|^\d{1,3}$/,
  // Author-year citations: (Author et al., 2023), (Author, 2023), Author (2023)
  authorYear:
    /\([A-Z][a-zA-Z\s]+(?:\s+et\s+al\.?)?(?:,?\s+\d{4}[a-z]?)\)|[A-Z][a-zA-Z\s]+\s+\(\d{4}[a-z]?\)/,
  // arXiv references
  arxiv: /arXiv[:\s]*\d{4}\.\d{4,5}/i,
  // DOI references
  doi: /DOI[:\s]*10\.\d{4,}/i,
  // Paper titles (heuristic: 5+ words with at least one capital)
  title: /^[A-Z][a-z]+(?:\s+[A-Za-z]+){4,}$/,
};

/**
 * Check if the given text looks like a citation or reference
 */
function looksLikeCitation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 200) return false;

  // Check specific patterns
  for (const pattern of Object.values(CITATION_PATTERNS)) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Heuristic: short text that looks like a reference number
  if (/^\d{1,3}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Get text content at click position
 */
function getTextAtPosition(x: number, y: number): string | null {
  // Get element at click position
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  // Get text from the clicked element
  let text = '';

  // First try the element's own text
  if (element.textContent) {
    text = element.textContent.trim();
  }

  // If element is small (like a superscript number), use it directly
  if (text.length <= 5) {
    return text || null;
  }

  // For longer text, try to find the specific clicked word/phrase
  const textLayer = element.closest('.textLayer');
  if (textLayer) {
    // Try to get the clicked word using selection API
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      const fullText = range.startContainer.textContent || '';
      const offset = range.startOffset;

      // Extract a reasonable context around the click (50 chars each side)
      const start = Math.max(0, offset - 50);
      const end = Math.min(fullText.length, offset + 50);
      text = fullText.slice(start, end).trim();
    }
  }

  return text || null;
}

export function PdfCitationPopover({ containerRef, onSearchPaper }: PdfCitationPopoverProps) {
  const { t } = useTranslation();
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = useCallback(() => {
    setPopover(null);
    setCopied(false);
    setIsSearching(false);
  }, []);

  // Handle right-click (context menu) on any text that looks like a citation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      const containerRect = container.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      // Check if click is within container
      if (
        x < containerRect.left ||
        x > containerRect.right ||
        y < containerRect.top ||
        y > containerRect.bottom
      ) {
        return;
      }

      // Get text at click position
      const text = getTextAtPosition(x, y);
      if (!text) return;

      // Check if it looks like a citation
      const isCitation = looksLikeCitation(text);

      // Always show menu for any text in PDF (not just citations)
      // This makes it more useful
      e.preventDefault();

      // Position popover at click location
      const popoverX = x - containerRect.left;
      const popoverY = y - containerRect.top + 10;

      setPopover({ text, x: popoverX, y: popoverY });
      setCopied(false);
      setIsSearching(false);
    };

    container.addEventListener('contextmenu', handleContextMenu);
    return () => container.removeEventListener('contextmenu', handleContextMenu);
  }, [containerRef]);

  // Handle double-click to directly search
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDoubleClick = (e: MouseEvent) => {
      const containerRect = container.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      // Check if click is within container
      if (
        x < containerRect.left ||
        x > containerRect.right ||
        y < containerRect.top ||
        y > containerRect.bottom
      ) {
        return;
      }

      // Get text at click position
      const text = getTextAtPosition(x, y);
      if (!text) return;

      // Only search if it looks like a citation
      if (!looksLikeCitation(text)) return;

      e.preventDefault();
      e.stopPropagation();

      // Clean up the citation text
      const cleanQuery = text
        .replace(/^\[\d+\]\s*/, '') // Remove [1] prefix
        .replace(/\s+/g, ' ')
        .trim();

      // Trigger search
      onSearchPaper(cleanQuery);
    };

    container.addEventListener('dblclick', handleDoubleClick);
    return () => container.removeEventListener('dblclick', handleDoubleClick);
  }, [containerRef, onSearchPaper]);

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

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!popover) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [popover, dismiss]);

  const handleCopy = useCallback(() => {
    if (!popover) return;
    navigator.clipboard.writeText(popover.text);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [popover]);

  const handleSearchOnline = useCallback(() => {
    if (!popover || isSearching) return;

    // Clean up the citation text
    const cleanQuery = popover.text
      .replace(/^\[\d+\]\s*/, '') // Remove [1] prefix
      .replace(/\s+/g, ' ')
      .trim();

    setIsSearching(true);
    onSearchPaper(cleanQuery);

    // Dismiss after a short delay to show the "Searching..." state
    setTimeout(() => {
      dismiss();
    }, 500);
  }, [popover, isSearching, onSearchPaper, dismiss]);

  const handleSearchLocal = useCallback(() => {
    if (!popover || isSearching) return;
    // For now, use the same search - could be enhanced to filter local library
    const cleanQuery = popover.text
      .replace(/^\[\d+\]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    setIsSearching(true);
    onSearchPaper(cleanQuery);

    setTimeout(() => {
      dismiss();
    }, 500);
  }, [popover, isSearching, onSearchPaper, dismiss]);

  // Truncate text for display
  const displayText =
    popover?.text.length && popover.text.length > 50
      ? popover.text.slice(0, 50) + '...'
      : popover?.text;

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
            left: popover.x,
            top: popover.y,
          }}
        >
          <div className="min-w-[180px] rounded-lg border border-notion-border bg-white p-1 shadow-lg">
            {/* Citation text preview */}
            <div className="border-b border-notion-border px-2.5 py-1.5">
              <p className="text-xs text-notion-text-secondary" title={popover.text}>
                "{displayText}"
              </p>
            </div>

            {/* Menu items */}
            <div className="mt-1">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSearchOnline}
                disabled={isSearching}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-notion-text transition-colors hover:bg-green-50 hover:text-green-600 disabled:opacity-50"
              >
                <ExternalLink size={14} />
                <span>{isSearching ? t('common.loading') : t('pdf.citation.searchOnline')}</span>
              </button>

              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSearchLocal}
                disabled={isSearching}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-notion-text transition-colors hover:bg-notion-accent-light hover:text-notion-accent disabled:opacity-50"
              >
                <Library size={14} />
                <span>{isSearching ? t('common.loading') : t('pdf.citation.searchLocal')}</span>
              </button>

              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                  copied
                    ? 'text-green-600'
                    : 'text-notion-text hover:bg-notion-accent-light hover:text-notion-accent'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? t('common.copied') : t('common.copy')}</span>
              </button>
            </div>

            {/* Hint */}
            <div className="mt-1 border-t border-notion-border px-2.5 py-1">
              <p className="text-[10px] text-notion-text-tertiary">{t('pdf.citation.hint')}</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
