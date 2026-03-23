import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { MessageSquare, Copy, Check, Languages, Loader2, X, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { ipc } from '../../hooks/use-ipc';

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
  paperId?: string;
  /** Start TTS reading from the selected position */
  onReadAloud?: (pageNumber: number, selectedText: string, textOffset: number) => void;
}

interface PopoverState {
  text: string;
  centerX: number;
  containerW: number;
  y: number;
  pageNumber: number;
  normalizedRects: Array<{ x: number; y: number; w: number; h: number }>;
  /** Approximate character offset of the selection start within the page's text layer */
  textOffset: number;
}

export function PdfSelectionPopover({
  containerRef,
  onAskAI,
  onHighlight,
  onSearchPaper,
  paperId,
  onReadAloud,
}: PdfSelectionPopoverProps) {
  const { t } = useTranslation();
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [copied, setCopied] = useState(false);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resultCopiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Track AI operation via ref (state updates are async, ref is immediate)
  const aiActiveRef = useRef(false);

  const resetAiState = useCallback(() => {
    setAiAction(null);
    setAiResult(null);
    setAiLoading(false);
    setResultCopied(false);
    aiActiveRef.current = false;
  }, []);

  const dismiss = useCallback(() => {
    setPopover(null);
    setCopied(false);
    resetAiState();
  }, [resetAiState]);

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

        // Compute character offset of selection start within the page's text layer
        let textOffset = 0;
        const textLayerDiv = pageEl?.querySelector('.textLayer');
        if (textLayerDiv && range.startContainer) {
          const spans = textLayerDiv.querySelectorAll('span');
          let charCount = 0;
          let found = false;
          for (const span of spans) {
            if (span.contains(range.startContainer)) {
              // Walk text nodes within this span to find the exact offset
              const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
              let node: Text | null;
              while ((node = walker.nextNode() as Text | null)) {
                if (node === range.startContainer) {
                  charCount += range.startOffset;
                  found = true;
                  break;
                }
                charCount += (node.textContent || '').length;
              }
              if (found) break;
            }
            charCount += (span.textContent || '').length;
          }
          textOffset = charCount;
        }

        setPopover({ text, centerX, containerW, y, pageNumber, normalizedRects, textOffset });
        setCopied(false);
        // Reset AI state when new selection happens
        resetAiState();
      });
    };

    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
  }, [containerRef, resetAiState]);

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

  // Dismiss when selection is cleared (debounced to avoid race with button clicks)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!popover) return;
    const handleSelectionChange = () => {
      // Don't dismiss while AI is active (use ref for immediate check, not state)
      if (aiActiveRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        // Debounce to avoid dismissing when clicking popover buttons
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          // Re-check ref — button click may have set it during the delay
          if (aiActiveRef.current) return;
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed) {
            dismiss();
          }
        }, 200);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [popover, dismiss]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (resultCopiedTimerRef.current) clearTimeout(resultCopiedTimerRef.current);
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

  const handleTranslate = useCallback(async () => {
    if (!popover) return;
    // Clean PDF line breaks: join hyphenated words and collapse newlines
    const textToTranslate = popover.text
      .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2') // "pro-\ngramming" → "programming"
      .replace(/\s*\n\s*/g, ' ') // collapse newlines to spaces
      .replace(/\s{2,}/g, ' ') // collapse multiple spaces
      .trim();
    aiActiveRef.current = true;
    setAiAction('translate');
    setAiResult(null);
    setAiLoading(true);
    setResultCopied(false);
    try {
      const isChinese = /[\u4e00-\u9fff]/.test(textToTranslate);
      const targetLang = isChinese ? 'en' : 'zh-CN';
      const response = await ipc.readerTranslate({
        text: textToTranslate,
        targetLanguage: targetLang,
      });
      // Re-assert state in case something tried to clear it during await
      setAiAction('translate');
      setAiLoading(false);
      setAiResult(response.translatedText);
    } catch (err) {
      setAiAction('translate');
      setAiLoading(false);
      setAiResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [popover]);

  const handleCopyResult = useCallback(() => {
    if (!aiResult) return;
    navigator.clipboard.writeText(aiResult);
    setResultCopied(true);
    if (resultCopiedTimerRef.current) clearTimeout(resultCopiedTimerRef.current);
    resultCopiedTimerRef.current = setTimeout(() => setResultCopied(false), 1500);
  }, [aiResult]);

  // Clamp popover position after every render so it never overflows the container
  const [clampedLeft, setClampedLeft] = useState(0);
  useLayoutEffect(() => {
    if (!popover || !popoverRef.current || !containerRef.current) return;
    const w = popoverRef.current.offsetWidth;
    // Use live container width (accounts for sidebars)
    const containerW = containerRef.current.clientWidth;
    const ideal = popover.centerX - w / 2;
    setClampedLeft(Math.max(8, Math.min(ideal, containerW - w - 8)));
  });

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
            left: clampedLeft,
            top: popover.y,
          }}
        >
          {/* Prevent mousedown inside popover from clearing text selection */}
          <div
            className="rounded-lg border border-notion-border bg-white shadow-lg"
            style={{
              maxWidth: containerRef.current ? containerRef.current.clientWidth - 16 : undefined,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex flex-wrap items-center gap-0.5 p-1.5">
              {/* Ask AI — sends selected text to chat panel */}
              <button
                onClick={handleAskAI}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-notion-text transition-colors hover:bg-blue-50 hover:text-blue-600"
              >
                <MessageSquare size={14} />
                <span>{t('reader.ai.askAi')}</span>
              </button>

              {/* Translate */}
              <button
                onClick={handleTranslate}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  aiAction === 'translate'
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-notion-text hover:bg-blue-50 hover:text-blue-600'
                }`}
              >
                <Languages size={14} />
                <span>{t('reader.ai.translate')}</span>
              </button>

              {/* Read aloud from this page */}
              {onReadAloud && (
                <button
                  onClick={() => {
                    if (!popover) return;
                    onReadAloud(popover.pageNumber, popover.text, popover.textOffset);
                    dismiss();
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-notion-text transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  <Volume2 size={14} />
                  <span>{t('reader.tts.readFromHere')}</span>
                </button>
              )}

              {/* Color dots for instant highlight */}
              {onHighlight && (
                <>
                  <div className="h-4 w-px bg-notion-border" />
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.color}
                      onClick={() => handleHighlight(c.color)}
                      className={`mx-0.5 h-5 w-5 rounded-full ${c.bg} ${c.hover} transition-transform hover:scale-125`}
                      title={c.label}
                    />
                  ))}
                </>
              )}

              <div className="h-4 w-px bg-notion-border" />

              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  copied
                    ? 'text-green-600'
                    : 'text-notion-text hover:bg-blue-50 hover:text-blue-600'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            {/* Translate result area */}
            {/* Translate result — no animation delay, shows loading instantly */}
            {aiAction === 'translate' && (
              <div
                className="mx-1.5 mb-1.5 rounded-lg border border-notion-border bg-notion-sidebar p-3"
                style={{ width: 360 }}
              >
                {aiLoading ? (
                  <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
                    <Loader2 size={14} className="animate-spin text-blue-600" />
                    <span>{t('reader.ai.translating', 'Translating...')}</span>
                  </div>
                ) : aiResult ? (
                  <div>
                    <div className="max-h-[200px] overflow-y-auto text-xs leading-relaxed text-notion-text">
                      {aiResult}
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        onClick={handleCopyResult}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          resultCopied
                            ? 'text-green-600'
                            : 'text-notion-text-secondary hover:bg-white hover:text-notion-text'
                        }`}
                      >
                        {resultCopied ? <Check size={12} /> : <Copy size={12} />}
                        <span>
                          {resultCopied ? t('reader.ai.resultCopied') : t('reader.ai.copyResult')}
                        </span>
                      </button>
                      <button
                        onClick={resetAiState}
                        className="flex items-center justify-center rounded-md p-1 text-notion-text-secondary transition-colors hover:bg-white hover:text-notion-text"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
