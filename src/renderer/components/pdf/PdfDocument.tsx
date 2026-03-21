import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipc } from '../../hooks/use-ipc';
import i18n from 'i18next';
import { usePdfDocument } from './use-pdf-document';
import { usePdfViewport } from './use-pdf-viewport';
import { PdfPage } from './PdfPage';
import { PdfToolbar } from './PdfToolbar';
import { PdfOutlineSidebar } from './PdfOutlineSidebar';
import { PdfSearchBar } from './PdfSearchBar';
import { PdfSelectionPopover } from './PdfSelectionPopover';
import { PdfCitationSidebar } from './PdfCitationSidebar';
import { PdfAIOutlineSidebar } from './PdfAIOutlineSidebar';
import { PdfHighlightLayer, HighlightActionPopover } from './PdfHighlightLayer';
import type { HighlightItem } from '../../hooks/use-ipc';

export type ReadingMode = 'light' | 'sepia' | 'dark';

export interface CachedReference {
  id: string;
  refNumber: number;
  text: string;
  title: string | null;
  authors: string | null;
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  url: string | null;
  venue: string | null;
}

interface PdfDocumentProps {
  path: string;
  paperId?: string;
  cachedReferences?: CachedReference[];
  onReferencesExtracted?: (refs: CachedReference[]) => void;
  onFileNotFound?: () => void;
  initialPage?: number;
  onPageChange?: (page: number, total: number) => void;
  onAskAI?: (text: string) => void;
  highlights?: HighlightItem[];
  onCreateHighlight?: (params: {
    pageNumber: number;
    rectsJson: string;
    text: string;
    color: string;
    note?: string;
  }) => void;
  onDeleteHighlight?: (id: string) => void;
  onUpdateHighlight?: (id: string, params: { color?: string }) => void;
  onOpenUrl?: (url: string) => void;
  onSearchPaper?: (query: string) => void;
  showCitationSidebar?: boolean;
  onToggleCitationSidebar?: () => void;
  showAIOutlineSidebar?: boolean;
  onToggleAIOutlineSidebar?: () => void;
  shortId?: string;
  goToPageRef?: React.MutableRefObject<((page: number) => void) | null>;
}

const PAGE_GAP = 8;
const BUFFER_PAGES = 2;

const READING_MODE_FILTERS: Record<ReadingMode, string> = {
  light: 'none',
  sepia: 'sepia(20%) brightness(0.95)',
  dark: 'invert(0.85) hue-rotate(180deg)',
};

export function PdfDocument({
  path,
  paperId,
  cachedReferences,
  onReferencesExtracted,
  onFileNotFound,
  initialPage,
  onPageChange,
  onAskAI,
  highlights = [],
  onCreateHighlight,
  onDeleteHighlight,
  onUpdateHighlight,
  onOpenUrl,
  onSearchPaper,
  showCitationSidebar: externalShowCitationSidebar,
  onToggleCitationSidebar,
  showAIOutlineSidebar,
  onToggleAIOutlineSidebar,
  shortId,
  goToPageRef,
}: PdfDocumentProps) {
  // Session key for persisting scroll position and scale per PDF
  const sessionKey = `pdf-state:${path}`;

  // Track previous path to detect paper changes
  const prevPathRef = useRef(path);
  const pathChanged = prevPathRef.current !== path;

  // Restore saved state from session (for tab switching) - re-read when path changes
  const [restoredState, setRestoredState] = useState<{
    page?: number;
    scrollTop?: number;
    customScale?: number;
    fitMode?: string;
  } | null>(() => {
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (saved)
        return JSON.parse(saved) as {
          page?: number;
          scrollTop?: number;
          customScale?: number;
          fitMode?: string;
        };
    } catch {}
    return null;
  });

  const { t } = useTranslation();

  // Per-page AI summary state
  const [pageSummaries, setPageSummaries] = useState<Map<number, string>>(new Map());
  const [summarizingPage, setSummarizingPage] = useState<number | null>(null);

  const handleSummarizePage = useCallback(
    async (pageNum: number) => {
      if (!paperId || summarizingPage !== null) return;
      // If already cached, toggle off
      if (pageSummaries.has(pageNum)) {
        setPageSummaries((prev) => {
          const next = new Map(prev);
          next.delete(pageNum);
          return next;
        });
        return;
      }
      setSummarizingPage(pageNum);
      try {
        const result = await ipc.readerInlineAI({
          paperId,
          action: 'summarizeParagraph',
          selectedText: `[Full content of page ${pageNum}]`,
          pageNumber: pageNum,
          language: i18n.language,
        });
        setPageSummaries((prev) => new Map(prev).set(pageNum, result.result));
      } catch {
        // silent
      } finally {
        setSummarizingPage(null);
      }
    },
    [paperId, summarizingPage, pageSummaries],
  );

  const { document, numPages, loading, error } = usePdfDocument({ path, onFileNotFound });
  const viewport = usePdfViewport(
    restoredState?.fitMode === 'custom' && restoredState.customScale
      ? { initialFitMode: 'custom', initialCustomScale: restoredState.customScale }
      : undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = sessionStorage.getItem(sessionKey);
    if (saved) {
      try {
        return JSON.parse(saved).page ?? initialPage ?? 1;
      } catch {}
    }
    return initialPage ?? 1;
  });
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [pageHeights, setPageHeights] = useState<number[]>([]);
  const [firstPageWidth, setFirstPageWidth] = useState(0);
  const [showOutline, setShowOutline] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(260);
  const leftResizing = useRef(false);
  // Scroll position history stack (exact scrollTop values for precise back navigation)
  const [scrollHistory, setScrollHistory] = useState<number[]>([]);
  const [readingMode, setReadingMode] = useState<ReadingMode>(() => {
    return (localStorage.getItem('pdf-reading-mode') as ReadingMode) || 'light';
  });
  const onPageChangeRef = useRef(onPageChange);
  const initialPageScrolled = useRef(false); // prevents restore from running twice
  const savesEnabled = useRef(false); // prevents saves from overwriting restore target
  const pageChangeDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  // Reset state when path changes (switching to a different paper)
  useEffect(() => {
    if (!pathChanged) return;

    prevPathRef.current = path;

    // Reset refs that control scroll restoration
    initialPageScrolled.current = false;
    savesEnabled.current = false;

    // Clear page history for new document
    setScrollHistory([]);

    // Read fresh state from sessionStorage for the new path
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          page?: number;
          scrollTop?: number;
          customScale?: number;
          fitMode?: string;
        };
        setRestoredState(parsed);
        setCurrentPage(parsed.page ?? initialPage ?? 1);
      } else {
        setRestoredState(null);
        setCurrentPage(initialPage ?? 1);
      }
    } catch {
      setRestoredState(null);
      setCurrentPage(initialPage ?? 1);
    }
  }, [path, pathChanged, sessionKey, initialPage]);

  // Save reading mode preference
  useEffect(() => {
    localStorage.setItem('pdf-reading-mode', readingMode);
  }, [readingMode]);

  // Observe container size for fit modes
  // Depend on `document` so it re-runs after loading completes and container mounts
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [document]);

  // Load page dimensions
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    document.getPage(1).then((page) => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: 1.0 });
      setFirstPageWidth(vp.width);
      const heights = Array(document.numPages).fill(vp.height);
      setPageHeights(heights);
    });
    return () => {
      cancelled = true;
    };
  }, [document]);

  const scaleReady = firstPageWidth > 0 && containerSize.width > 0;

  // Compute actual scale based on fit mode
  const prevScaleRef = useRef<number>(1.0);
  const actualScale = useMemo(() => {
    if (!scaleReady) return 1.0;
    // Account for left sidebar width when any sidebar is open
    const hasLeftSidebar = showOutline || externalShowCitationSidebar || showAIOutlineSidebar;
    const availableWidth = containerSize.width - (hasLeftSidebar ? leftSidebarWidth : 0);
    if (viewport.fitMode === 'fit-width') {
      return (availableWidth - 32) / firstPageWidth;
    }
    if (viewport.fitMode === 'fit-page') {
      const firstPageHeight = pageHeights[0] || 800;
      const scaleW = (availableWidth - 32) / firstPageWidth;
      const scaleH = (containerSize.height - 16) / firstPageHeight;
      return Math.min(scaleW, scaleH);
    }
    return viewport.customScale;
  }, [
    viewport.fitMode,
    viewport.customScale,
    firstPageWidth,
    pageHeights,
    containerSize,
    showOutline,
    externalShowCitationSidebar,
    showAIOutlineSidebar,
    leftSidebarWidth,
  ]);

  // Preserve scroll position when scale changes due to container resize
  useEffect(() => {
    const prevScale = prevScaleRef.current;
    if (prevScale !== actualScale && prevScale > 0 && savesEnabled.current) {
      const scrollEl = scrollRef.current;
      if (scrollEl && scrollEl.scrollTop > 0) {
        const ratio = actualScale / prevScale;
        scrollEl.scrollTop = scrollEl.scrollTop * ratio;
      }
    }
    prevScaleRef.current = actualScale;
  }, [actualScale]);

  // Track visible pages via IntersectionObserver
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !document) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNum = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (!pageNum) continue;
            if (entry.isIntersecting) {
              for (
                let i = Math.max(1, pageNum - BUFFER_PAGES);
                i <= Math.min(numPages, pageNum + BUFFER_PAGES);
                i++
              ) {
                next.add(i);
              }
            }
          }
          const visibleNums = entries
            .filter((e) => e.isIntersecting)
            .map((e) => Number((e.target as HTMLElement).dataset.pageNumber))
            .filter(Boolean);

          if (visibleNums.length > 0) {
            const minVisible = Math.min(...visibleNums);
            const maxVisible = Math.max(...visibleNums);
            for (const p of next) {
              if (p < minVisible - BUFFER_PAGES || p > maxVisible + BUFFER_PAGES) {
                next.delete(p);
              }
            }
          }
          return next;
        });

        const visibleEntries = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.pageNumber))
          .filter(Boolean)
          .sort((a, b) => a - b);

        if (visibleEntries.length > 0) {
          const topPage = visibleEntries[0];
          setCurrentPage(topPage);
          // Don't save state until initial scroll restore is done
          if (!savesEnabled.current) return;
          if (pageChangeDebounceRef.current) clearTimeout(pageChangeDebounceRef.current);
          pageChangeDebounceRef.current = setTimeout(() => {
            onPageChangeRef.current?.(topPage, numPages);
          }, 500);
        }
      },
      { root: scrollContainer, threshold: 0.1 },
    );

    const pageElements = scrollContainer.querySelectorAll('[data-page-number]');
    pageElements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [document, numPages, pageHeights, actualScale]);

  // Restore scroll position — use saved scrollTop (pixel-precise) or initialPage
  useEffect(() => {
    if (!document || !scrollRef.current || initialPageScrolled.current) return;
    if (pageHeights.length === 0 || firstPageWidth === 0) return;

    requestAnimationFrame(() => {
      if (!scrollRef.current || initialPageScrolled.current) return;
      initialPageScrolled.current = true;

      // Prefer pixel-precise scrollTop, fallback to page-based calculation
      if (restoredState?.scrollTop && restoredState.scrollTop > 0) {
        scrollRef.current.scrollTop = restoredState.scrollTop;
      } else {
        const targetPage = restoredState?.page ?? initialPage ?? 1;
        if (targetPage > 1) {
          const scrollTo = (targetPage - 1) * (pageHeights[0] * actualScale + PAGE_GAP);
          scrollRef.current.scrollTop = scrollTo;
        }
      }
      // Enable saves after scroll settles (prevents race with IntersectionObserver)
      setTimeout(() => {
        savesEnabled.current = true;
      }, 500);
    });
  }, [document, pageHeights, actualScale, firstPageWidth, restoredState]);

  const goToPage = useCallback(
    (page: number, saveHistory = true, yFraction = 0) => {
      if (!scrollRef.current || pageHeights.length === 0) return;
      if (saveHistory) {
        // Save exact scroll position before jumping
        setScrollHistory((prev) => [...prev, scrollRef.current!.scrollTop]);
      }
      const clamped = Math.max(1, Math.min(numPages, page));
      const pageSize = (pageHeights[0] || 800) * actualScale + PAGE_GAP;
      const scrollTo = (clamped - 1) * pageSize + yFraction * (pageHeights[0] || 800) * actualScale;
      scrollRef.current.scrollTo({ top: scrollTo, behavior: 'smooth' });
    },
    [numPages, pageHeights, actualScale],
  );

  // Expose goToPage to parent via ref
  useEffect(() => {
    if (goToPageRef) goToPageRef.current = goToPage;
    return () => {
      if (goToPageRef) goToPageRef.current = null;
    };
  }, [goToPage, goToPageRef]);

  const goBack = useCallback(() => {
    if (scrollHistory.length === 0 || !scrollRef.current) return;
    const prevScrollTop = scrollHistory[scrollHistory.length - 1];
    setScrollHistory((h) => h.slice(0, -1));
    scrollRef.current.scrollTo({ top: prevScrollTop, behavior: 'smooth' });
  }, [scrollHistory]);

  // Keep actualScale in a ref for keyboard handlers
  const actualScaleRef = useRef(actualScale);
  actualScaleRef.current = actualScale;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      } else if (mod && e.key === '=') {
        e.preventDefault();
        viewport.zoomIn(actualScaleRef.current);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        viewport.zoomOut(actualScaleRef.current);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        viewport.resetZoom();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewport]);

  // Persist state to session storage — save on every scroll + scale change + unmount
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const saveSessionState = useCallback(() => {
    // Don't save until initial restore is done, to avoid overwriting saved position with page 1
    if (!savesEnabled.current) return;
    try {
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          page: currentPageRef.current,
          scrollTop: scrollRef.current?.scrollTop ?? 0,
          customScale: viewport.customScale,
          fitMode: viewport.fitMode,
        }),
      );
    } catch {}
  }, [sessionKey, viewport.customScale, viewport.fitMode]);

  // Save on scale/fitMode changes
  useEffect(() => {
    saveSessionState();
  }, [saveSessionState]);

  // Save scroll position on scroll (debounced)
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(saveSessionState, 300);
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [document, saveSessionState]);

  // Save on unmount (tab switch)
  const saveRef = useRef(saveSessionState);
  saveRef.current = saveSessionState;
  useEffect(() => {
    return () => saveRef.current();
  }, []);

  // Pinch-to-zoom via trackpad (ctrl+wheel)
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.01;
      const newScale = Math.min(5, Math.max(0.25, actualScaleRef.current + delta));
      viewport.setCustomScale(newScale);
    };
    scrollContainer.addEventListener('wheel', handleWheel, { passive: false });
    return () => scrollContainer.removeEventListener('wheel', handleWheel);
  }, [viewport]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#525659]">
        <Loader2 size={20} className="animate-spin text-white/60" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#525659] p-4">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!document) return null;

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col">
      <PdfToolbar
        currentPage={currentPage}
        numPages={numPages}
        scale={actualScale}
        fitMode={viewport.fitMode}
        onZoomIn={() => {
          if (scaleReady) viewport.zoomIn(actualScale);
        }}
        onZoomOut={() => {
          if (scaleReady) viewport.zoomOut(actualScale);
        }}
        onSetFitMode={viewport.setFitMode}
        onGoToPage={goToPage}
        showOutline={showOutline}
        onToggleOutline={() => {
          setShowOutline((v) => {
            if (!v) {
              // Closing other sidebars when opening outline
              onToggleCitationSidebar && externalShowCitationSidebar && onToggleCitationSidebar();
              onToggleAIOutlineSidebar && showAIOutlineSidebar && onToggleAIOutlineSidebar();
            }
            return !v;
          });
        }}
        showCitationSidebar={externalShowCitationSidebar}
        onToggleCitationSidebar={() => {
          if (!externalShowCitationSidebar) setShowOutline(false);
          onToggleCitationSidebar?.();
        }}
        showAIOutline={showAIOutlineSidebar}
        onToggleAIOutline={() => {
          if (!showAIOutlineSidebar) setShowOutline(false);
          onToggleAIOutlineSidebar?.();
        }}
        showSearch={showSearch}
        onToggleSearch={() => setShowSearch((v) => !v)}
        readingMode={readingMode}
        onSetReadingMode={setReadingMode}
        canGoBack={scrollHistory.length > 0}
        onGoBack={goBack}
      />

      {showSearch && (
        <PdfSearchBar
          document={document}
          onGoToPage={goToPage}
          onClose={() => setShowSearch(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar (outline / citation / AI outline — mutually exclusive) */}
        {(showOutline ||
          (externalShowCitationSidebar && onSearchPaper) ||
          (showAIOutlineSidebar && paperId && shortId)) && (
          <>
            <div
              className="flex h-full flex-shrink-0 flex-col overflow-hidden"
              style={{ width: leftSidebarWidth }}
            >
              {showOutline && (
                <PdfOutlineSidebar
                  document={document}
                  onGoToPage={goToPage}
                  currentPage={currentPage}
                />
              )}
              {externalShowCitationSidebar && onSearchPaper && (
                <PdfCitationSidebar
                  document={document}
                  currentPage={currentPage}
                  paperId={paperId}
                  cachedReferences={cachedReferences}
                  onReferencesExtracted={onReferencesExtracted}
                  onSearchPaper={onSearchPaper}
                  onGoToPage={goToPage}
                />
              )}
              {showAIOutlineSidebar && paperId && shortId && (
                <PdfAIOutlineSidebar paperId={paperId} shortId={shortId} />
              )}
            </div>
            {/* Resize handle */}
            <div
              className="group flex w-1 cursor-col-resize items-center justify-center hover:bg-blue-400/50 active:bg-blue-400 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                leftResizing.current = true;
                const startX = e.clientX;
                const startW = leftSidebarWidth;
                const onMove = (ev: MouseEvent) => {
                  if (!leftResizing.current) return;
                  const newW = Math.max(180, Math.min(500, startW + ev.clientX - startX));
                  setLeftSidebarWidth(newW);
                };
                const onUp = () => {
                  leftResizing.current = false;
                  window.document.removeEventListener('mousemove', onMove);
                  window.document.removeEventListener('mouseup', onUp);
                };
                window.document.addEventListener('mousemove', onMove);
                window.document.addEventListener('mouseup', onUp);
              }}
            />
          </>
        )}

        {/* PDF pages */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-auto bg-[#e8e8e5]"
          style={{
            scrollBehavior: 'auto',
            filter: READING_MODE_FILTERS[readingMode],
          }}
        >
          <div className="flex flex-col items-center py-2" style={{ gap: PAGE_GAP }}>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
              const isVisible = visiblePages.has(pageNum);
              const pageWidth = firstPageWidth * actualScale;
              const pageHeight = (pageHeights[0] || 800) * actualScale;
              return (
                <div
                  key={pageNum}
                  className="relative mx-auto overflow-hidden bg-white shadow-md"
                  data-page-number={pageNum}
                  style={{ width: Math.floor(pageWidth), height: Math.floor(pageHeight) }}
                >
                  <PdfPage
                    document={document}
                    pageNumber={pageNum}
                    scale={actualScale}
                    isVisible={isVisible}
                    onGoToPage={goToPage}
                    onOpenUrl={onOpenUrl}
                  />
                  {isVisible && (
                    <PdfHighlightLayer
                      highlights={highlights}
                      pageNumber={pageNum}
                      pageWidth={pageWidth}
                      pageHeight={pageHeight}
                    />
                  )}
                  {/* Per-page AI summary button */}
                  {isVisible && paperId && (
                    <div className="absolute right-2 top-2 z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSummarizePage(pageNum);
                        }}
                        disabled={summarizingPage !== null && summarizingPage !== pageNum}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg shadow-sm transition-all ${
                          pageSummaries.has(pageNum)
                            ? 'bg-purple-100 text-purple-600 opacity-100'
                            : 'bg-white/80 text-notion-text-tertiary opacity-0 hover:opacity-100 hover:bg-purple-50 hover:text-purple-500'
                        } border border-notion-border/50`}
                        title={t('reader.ai.summarizePage', 'Summarize page')}
                      >
                        {summarizingPage === pageNum ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Sparkles size={13} />
                        )}
                      </button>
                      {/* Page summary card */}
                      {pageSummaries.has(pageNum) && (
                        <div className="absolute right-0 top-9 w-72 rounded-lg border border-notion-border bg-white p-3 shadow-lg">
                          <p className="text-xs leading-relaxed text-notion-text whitespace-pre-wrap">
                            {pageSummaries.get(pageNum)}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPageSummaries((prev) => {
                                const next = new Map(prev);
                                next.delete(pageNum);
                                return next;
                              });
                            }}
                            className="mt-2 text-[10px] text-notion-text-tertiary hover:text-notion-text"
                          >
                            {t('common.close')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selection popover for Ask AI */}
          {onAskAI && (
            <PdfSelectionPopover
              containerRef={scrollRef as React.RefObject<HTMLDivElement>}
              onAskAI={onAskAI}
              onHighlight={
                onCreateHighlight
                  ? (text, rectsJson, pageNumber, color) => {
                      onCreateHighlight({
                        pageNumber,
                        rectsJson,
                        text,
                        color: color ?? 'yellow',
                      });
                    }
                  : undefined
              }
              onSearchPaper={onSearchPaper}
              paperId={paperId}
            />
          )}

          {/* Highlight action popover (double-click to edit/delete) */}
          <HighlightActionPopover
            highlights={highlights}
            scrollContainerRef={scrollRef}
            onDeleteHighlight={onDeleteHighlight}
            onUpdateHighlight={onUpdateHighlight}
          />
        </div>
      </div>
    </div>
  );
}
