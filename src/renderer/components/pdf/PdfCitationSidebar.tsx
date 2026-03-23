import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  extractCitationsFromPdf,
  type CitationMarker,
  type Reference,
} from '../../utils/citation-detector';
import { cleanCitationSearchQuery } from '@shared';
import { ipc } from '../../hooks/use-ipc';

interface CachedReference {
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

interface PdfCitationSidebarProps {
  document: PDFDocumentProxy;
  currentPage: number;
  paperId?: string;
  cachedReferences?: CachedReference[];
  onReferencesExtracted?: (refs: CachedReference[]) => void;
  onSearchPaper: (query: string) => void;
  onGoToPage?: (page: number, saveHistory?: boolean, yFraction?: number) => void;
}

interface CitationData {
  markers: CitationMarker[];
  references: Reference[];
  referenceMap: Map<number, Reference>;
}

// Convert Reference to CachedReference format
function refToCached(ref: Reference): CachedReference {
  return {
    id: `temp-${ref.number}`,
    refNumber: ref.number,
    text: ref.text,
    title: ref.title,
    authors: ref.authors,
    year: ref.year,
    doi: ref.doi,
    arxivId: ref.arxivId,
    url: ref.url,
    venue: ref.venue,
  };
}

// Convert CachedReference to Reference format
function cachedToRef(cached: CachedReference): Reference {
  return {
    number: cached.refNumber,
    text: cached.text,
    title: cached.title,
    authors: cached.authors,
    year: cached.year,
    doi: cached.doi,
    arxivId: cached.arxivId,
    url: cached.url,
    venue: cached.venue ?? null,
  };
}

// Convert CachedReference to IPC save format (without id field)
function cachedToIpcRef(cached: CachedReference) {
  return {
    refNumber: cached.refNumber,
    text: cached.text,
    title: cached.title ?? undefined,
    authors: cached.authors ?? undefined,
    year: cached.year ?? undefined,
    doi: cached.doi ?? undefined,
    arxivId: cached.arxivId ?? undefined,
    url: cached.url ?? undefined,
    venue: cached.venue ?? undefined,
  };
}

export function PdfCitationSidebar({
  document,
  currentPage,
  paperId,
  cachedReferences,
  onReferencesExtracted,
  onSearchPaper,
  onGoToPage,
}: PdfCitationSidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [citationData, setCitationData] = useState<CitationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showAllCitations, setShowAllCitations] = useState(true);
  const [selectedRef, setSelectedRef] = useState<Reference | null>(null);

  // Track document to prevent re-extraction on same PDF
  const extractedDocRef = useRef<PDFDocumentProxy | null>(null);
  const isExtractingRef = useRef(false);

  // Initialize from cached references if available
  useEffect(() => {
    if (cachedReferences && cachedReferences.length > 0) {
      const refs: Reference[] = cachedReferences.map(cachedToRef);
      const referenceMap = new Map<number, Reference>();
      for (const ref of refs) {
        referenceMap.set(ref.number, ref);
      }
      setCitationData({
        markers: [], // Will be filled by background marker extraction below
        references: refs,
        referenceMap,
      });
      extractedDocRef.current = document;

      // Extract citation markers in background (for page jump mapping)
      extractCitationsFromPdf(document)
        .then((data) => {
          setCitationData((prev) => (prev ? { ...prev, markers: data.markers } : prev));
        })
        .catch(() => {});
    }
  }, [cachedReferences, document]);

  // Extract citations and references - only if no cached data
  useEffect(() => {
    // Skip if already have data from cache
    if (cachedReferences && cachedReferences.length > 0) return;
    // Skip if already extracted this document or currently extracting
    if (extractedDocRef.current === document || isExtractingRef.current) return;
    // Skip if already have data for this document
    if (citationData && extractedDocRef.current === document) return;

    const doExtract = async () => {
      isExtractingRef.current = true;
      setLoading(true);
      setProgress(0);
      try {
        const data = await extractCitationsFromPdf(document, setProgress);
        setCitationData(data);
        extractedDocRef.current = document;

        // Save to database if paperId is provided
        if (paperId && data.references.length > 0 && onReferencesExtracted) {
          const cached = data.references.map(refToCached);
          onReferencesExtracted(cached);

          // Also save to database in background
          ipc.saveExtractedRefs(paperId, cached.map(cachedToIpcRef)).catch((err) => {
            console.error('Failed to save extracted refs:', err);
          });
        }
      } catch (err) {
        console.error('Failed to extract citations:', err);
      } finally {
        setLoading(false);
        isExtractingRef.current = false;
      }
    };

    doExtract();
  }, [document, citationData, cachedReferences, paperId, onReferencesExtracted]);

  // Manual refresh - force re-extraction
  const handleRefresh = useCallback(async () => {
    if (isExtractingRef.current) return;

    isExtractingRef.current = true;
    extractedDocRef.current = null;
    setLoading(true);
    setProgress(0);
    setCitationData(null);

    try {
      const data = await extractCitationsFromPdf(document, setProgress);
      setCitationData(data);
      extractedDocRef.current = document;

      // Save to database if paperId is provided
      if (paperId && data.references.length > 0 && onReferencesExtracted) {
        const cached = data.references.map(refToCached);
        onReferencesExtracted(cached);

        ipc.saveExtractedRefs(paperId, cached.map(cachedToIpcRef)).catch((err) => {
          console.error('Failed to save extracted refs:', err);
        });
      }
    } catch (err) {
      console.error('Failed to extract citations:', err);
    } finally {
      setLoading(false);
      isExtractingRef.current = false;
    }
  }, [document, paperId, onReferencesExtracted]);

  // Get unique citation numbers (deduplicated)
  const uniqueCitationNumbers = useMemo(() => {
    if (!citationData) return [];
    const seen = new Set<number>();
    const unique: { num: number; markers: CitationMarker[] }[] = [];

    for (const marker of citationData.markers) {
      for (const num of marker.numbers) {
        if (!seen.has(num)) {
          seen.add(num);
          unique.push({ num, markers: [marker] });
        }
      }
    }

    return unique.sort((a, b) => a.num - b.num);
  }, [citationData]);

  // Map ref number → page where it appears in the reference list (last occurrence = highest page)
  const refPageMap = useMemo(() => {
    if (!citationData) return new Map<number, number>();
    const map = new Map<number, number>();
    for (const marker of citationData.markers) {
      for (const num of marker.numbers) {
        const existing = map.get(num);
        if (!existing || marker.pageNumber > existing) {
          map.set(num, marker.pageNumber);
        }
      }
    }
    return map;
  }, [citationData]);

  // Handle clicking reference text → jump to precise location in PDF
  const handleRefClick = useCallback(
    (ref: Reference) => {
      if (!onGoToPage || !citationData) return;

      // Strategy 1: Find the exact marker for this reference number in the reference section
      // Reference section is typically in the last 40% of the document
      const refSectionStart = Math.floor(document.numPages * 0.6);

      // Find all markers for this reference number in the reference section
      const refMarkers = citationData.markers.filter(
        (m) => m.pageNumber >= refSectionStart && m.numbers.includes(ref.number),
      );

      if (refMarkers.length > 0) {
        // Use the last occurrence (likely the reference list entry, not an in-text citation)
        const targetMarker = refMarkers[refMarkers.length - 1];
        onGoToPage(targetMarker.pageNumber, true, 0);
        return;
      }

      // Strategy 2: If no marker found, fall back to estimation
      const totalRefs = citationData.references.length;
      if (totalRefs === 0) return;

      // Find the page range of the reference section
      const refPages = new Set<number>();
      for (const marker of citationData.markers) {
        if (marker.pageNumber >= refSectionStart) {
          refPages.add(marker.pageNumber);
        }
      }

      if (refPages.size > 0) {
        // Reference section spans these pages
        const sortedPages = [...refPages].sort((a, b) => a - b);
        const firstRefPage = sortedPages[0];
        const lastRefPage = sortedPages[sortedPages.length - 1];
        const totalRefPages = lastRefPage - firstRefPage + 1;

        // Estimate position: ref.number / totalRefs within the ref section pages
        const fraction = (ref.number - 1) / totalRefs;
        const targetPage = firstRefPage + Math.floor(fraction * totalRefPages);
        const yFraction = (fraction * totalRefPages) % 1;

        onGoToPage(targetPage, true, yFraction);
      } else {
        // No markers — estimate based on document length
        // References typically occupy the last 15-20% of pages
        const refStartPage = Math.max(1, Math.floor(document.numPages * 0.82));
        const refPageCount = document.numPages - refStartPage + 1;
        const fraction = (ref.number - 1) / totalRefs;
        const targetPage = refStartPage + Math.floor(fraction * refPageCount);
        const yFraction = (fraction * refPageCount) % 1;

        onGoToPage(targetPage, true, yFraction);
      }
    },
    [onGoToPage, citationData, document.numPages],
  );

  // Handle citation click
  const handleCitationClick = useCallback(
    (refNum: number) => {
      if (!citationData) return;
      const reference = citationData.referenceMap.get(refNum);

      if (reference) {
        setSelectedRef(reference);
      } else {
        // No reference found, search by citation number
        onSearchPaper(`[${refNum}]`);
      }
    },
    [citationData, onSearchPaper],
  );

  // Build search query from reference — prefer arXiv ID, then cleaned title
  const getSearchQuery = useCallback((ref: Reference): string => {
    if (ref.arxivId) return ref.arxivId;
    if (ref.doi) return ref.doi;
    if (ref.title) return cleanCitationSearchQuery(ref.title);
    // Fallback: clean the raw text
    return cleanCitationSearchQuery(ref.text.slice(0, 200));
  }, []);

  // Search with reference info (opens PaperPreviewModal)
  const handleSearch = useCallback(
    (ref: Reference) => {
      onSearchPaper(getSearchQuery(ref));
      setSelectedRef(null);
    },
    [onSearchPaper, getSearchQuery],
  );

  // Auto-check local library match when a reference is selected
  // Map of ref number -> matched paper shortId (null = checked but not found)
  const [localMatches, setLocalMatches] = useState<Map<number, string | null>>(new Map());
  const [checkingRef, setCheckingRef] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedRef) return;
    if (localMatches.has(selectedRef.number)) return;

    setCheckingRef(selectedRef.number);
    ipc
      .matchReference({
        arxivId: selectedRef.arxivId ?? undefined,
        title: selectedRef.title ?? undefined,
      })
      .then((match) => {
        setLocalMatches((prev) => new Map(prev).set(selectedRef.number, match?.shortId ?? null));
      })
      .catch(() => {
        setLocalMatches((prev) => new Map(prev).set(selectedRef.number, null));
      })
      .finally(() => setCheckingRef(null));
  }, [selectedRef, localMatches]);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-notion-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <BookOpen size={14} className="text-blue-600" />
          <span className="text-xs font-medium text-notion-text">{t('pdf.citation.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          {loading && (
            <span className="text-[10px] text-notion-text-tertiary">
              {Math.round(progress * 100)}%
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-notion-sidebar-hover disabled:opacity-50"
            title={t('pdf.citation.scanAll')}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      {/* Stats */}
      {citationData && (
        <div className="border-b border-notion-border px-3 py-1.5 bg-notion-sidebar">
          <p className="text-[10px] text-notion-text-tertiary">
            {citationData.references.length} {t('pdf.citation.referencesFound')} ·{' '}
            {uniqueCitationNumbers.length} {t('pdf.citation.citationsFound')}
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-blue-600" />
          </div>
        ) : citationData ? (
          <>
            {/* All citations list - show all unique citation numbers with their references */}
            <div className="border-b border-notion-border p-2">
              <button
                onClick={() => setShowAllCitations(!showAllCitations)}
                className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-notion-text-tertiary hover:text-notion-text"
              >
                {showAllCitations ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('pdf.citation.allPages')} ({citationData.references.length})
              </button>
            </div>

            {showAllCitations && (
              <div className="p-1">
                {citationData.references.map((ref) => (
                  <div
                    key={ref.number}
                    className="group flex items-start gap-1 rounded-md px-2 py-1.5 hover:bg-blue-50"
                  >
                    {/* Click text area → jump to reference location in PDF */}
                    <button
                      onClick={() => handleRefClick(ref)}
                      className="flex-1 min-w-0 flex items-start gap-2 text-left"
                      title={t('pdf.citation.jumpToRef')}
                    >
                      <span className="flex-shrink-0 text-xs font-bold text-blue-600 w-6">
                        [{ref.number}]
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-notion-text line-clamp-2 group-hover:text-blue-600">
                          {ref.title || ref.text.slice(0, 80) + '...'}
                        </p>
                        {ref.authors && (
                          <p className="text-[10px] text-notion-text-tertiary mt-0.5 truncate">
                            {ref.authors}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {ref.venue && (
                            <span className="inline-block rounded bg-purple-50 px-1 py-0.5 text-[9px] text-purple-600 truncate max-w-[150px]">
                              {ref.venue}
                            </span>
                          )}
                          {ref.year && (
                            <span className="text-[10px] text-notion-text-tertiary">
                              {ref.year}
                            </span>
                          )}
                          {ref.arxivId && (
                            <span className="inline-block rounded bg-blue-50 px-1 py-0.5 text-[9px] text-blue-600">
                              arXiv
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                    {/* Search icon → open detail panel */}
                    <button
                      onClick={() => setSelectedRef(ref)}
                      className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded hover:bg-notion-sidebar-hover opacity-0 group-hover:opacity-100 mt-0.5"
                      title={t('pdf.citation.searchPaper')}
                    >
                      <Search size={12} className="text-notion-text-tertiary" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="p-3">
            <p className="text-xs text-notion-text-tertiary">{t('pdf.citation.noCitations')}</p>
          </div>
        )}
      </div>

      {/* Selected reference detail */}
      <AnimatePresence>
        {selectedRef && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-t border-notion-border bg-notion-sidebar overflow-hidden"
          >
            <div className="p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold text-blue-600">[{selectedRef.number}]</span>
                <button
                  onClick={() => setSelectedRef(null)}
                  className="text-notion-text-tertiary hover:text-notion-text text-sm"
                >
                  ×
                </button>
              </div>
              <p className="text-xs text-notion-text leading-relaxed mb-2">
                {selectedRef.title || selectedRef.text}
              </p>
              {selectedRef.year && (
                <p className="text-[10px] text-notion-text-tertiary mb-1">
                  Year: {selectedRef.year}
                </p>
              )}
              {selectedRef.arxivId && (
                <p className="text-[10px] text-notion-text-tertiary mb-1">
                  arXiv: {selectedRef.arxivId}
                </p>
              )}
              {selectedRef.doi && (
                <p className="text-[10px] text-notion-text-tertiary mb-1 truncate">
                  DOI: {selectedRef.doi}
                </p>
              )}
              {selectedRef.url && (
                <p className="text-[10px] text-notion-text-tertiary mb-2 truncate">
                  URL: {selectedRef.url}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                {(() => {
                  const matchShortId = localMatches.get(selectedRef.number);
                  const isChecking = checkingRef === selectedRef.number;

                  if (isChecking) {
                    return (
                      <div className="flex items-center justify-center py-1">
                        <Loader2 size={14} className="animate-spin text-notion-text-tertiary" />
                      </div>
                    );
                  }

                  if (matchShortId) {
                    // Found in local library → Read
                    return (
                      <button
                        onClick={() => navigate(`/papers/${matchShortId}/reader`)}
                        className="w-full flex items-center justify-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500/90"
                      >
                        <BookOpen size={12} />
                        {t('pdf.citation.read')}
                      </button>
                    );
                  }

                  // No URL — Search paper
                  if (!selectedRef.url) {
                    return (
                      <button
                        onClick={() => handleSearch(selectedRef)}
                        className="w-full flex items-center justify-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500/90"
                      >
                        <Search size={12} />
                        {t('pdf.citation.searchPaper')}
                      </button>
                    );
                  }

                  return null;
                })()}
                {selectedRef.url && (
                  <button
                    onClick={() => window.open(selectedRef.url!, '_blank')}
                    className="w-full flex items-center justify-center gap-1.5 rounded-md border border-notion-border bg-white px-3 py-1.5 text-xs font-medium text-notion-text-secondary hover:bg-notion-sidebar-hover"
                  >
                    <ExternalLink size={12} />
                    {t('pdf.citation.openInBrowser', 'Open in Browser')}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="border-t border-notion-border p-2">
        <p className="text-[10px] text-notion-text-tertiary">{t('pdf.citation.hintSidebar')}</p>
      </div>
    </div>
  );
}
