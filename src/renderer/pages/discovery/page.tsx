import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc, onIpc, type DiscoveredPaper } from '../../hooks/use-ipc';
import { useTabs } from '../../hooks/use-tabs';
import {
  Sparkles,
  RefreshCw,
  Download,
  ExternalLink,
  Loader2,
  Filter,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Star,
  Target,
  FileSearch,
  Clock,
  XCircle,
  RotateCcw,
  CalendarDays,
  Eye,
  ThumbsUp,
} from 'lucide-react';
import clsx from 'clsx';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
};

const COMMON_CATEGORIES = [
  'cs.AI',
  'cs.LG',
  'cs.CL',
  'cs.CV',
  'cs.NE',
  'cs.RO',
  'cs.SE',
  'cs.IR',
  'stat.ML',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyError(error: unknown, t: any): string {
  const msg = String(error).toLowerCase();
  if (
    msg.includes('fetch') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('dns') ||
    msg.includes('socket')
  ) {
    return t(
      'discovery.errorNetwork',
      'Cannot reach arXiv. Check your internet connection or proxy settings.',
    );
  }
  if (
    msg.includes('timeout') ||
    msg.includes('timedout') ||
    msg.includes('timed out') ||
    msg.includes('econnaborted')
  ) {
    return t('discovery.errorTimeout', 'Request timed out. Try again with fewer papers.');
  }
  if (
    msg.includes('api') ||
    msg.includes('model') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('insufficient')
  ) {
    return t(
      'discovery.errorAI',
      'AI evaluation failed. Check your model configuration in Settings.',
    );
  }
  // Return original error for anything else
  const raw = String(error);
  // Strip "Error: " prefix if present
  return raw.startsWith('Error: ') ? raw.slice(7) : raw;
}

function getScoreColor(score: number): string {
  if (score >= 8) return 'text-green-600 bg-green-50';
  if (score >= 6) return 'text-blue-600 bg-blue-50';
  if (score >= 4) return 'text-yellow-600 bg-yellow-50';
  return 'text-red-600 bg-red-50';
}

function getRecommendationStyle(rec: string): { bg: string; text: string } {
  switch (rec) {
    case 'must-read':
      return { bg: 'bg-green-100', text: 'text-green-700' };
    case 'worth-reading':
      return { bg: 'bg-blue-100', text: 'text-blue-700' };
    case 'skimmable':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'skip':
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
  }
}

export function DiscoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openTab } = useTabs();

  const [papers, setPapers] = useState<DiscoveredPaper[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'arxiv' | 'alphaxiv-trending'>('all');
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [calculateRelevance, setCalculateRelevance] = useState(false);
  const [relevanceProgress, setRelevanceProgress] = useState<{
    scored: number;
    total: number;
  } | null>(null);
  const [evaluateProgress, setEvaluateProgress] = useState<{
    evaluated: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedOp, setLastFailedOp] = useState<'fetch' | 'evaluate' | 'relevance' | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('researchclaw-discovery-categories');
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    return ['cs.AI', 'cs.LG'];
  });
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [daysBack, setDaysBack] = useState(() => {
    const stored = localStorage.getItem('researchclaw-discovery-days-back');
    const num = stored ? Number(stored) : NaN;
    return [1, 3, 7, 14].includes(num) ? num : 14;
  });
  const [sortMode, setSortMode] = useState<'default' | 'relevance' | 'quality' | 'views' | 'votes'>(
    'default',
  );
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isFromToday, setIsFromToday] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<
    { date: string; fetchedAt: string; paperCount: number; categories: string[] }[]
  >([]);
  const [viewingHistoryDate, setViewingHistoryDate] = useState<string | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  // Persist filter preferences
  useEffect(() => {
    localStorage.setItem('researchclaw-discovery-categories', JSON.stringify(selectedCategories));
  }, [selectedCategories]);

  useEffect(() => {
    localStorage.setItem('researchclaw-discovery-days-back', String(daysBack));
  }, [daysBack]);

  // Close history dropdown on outside click
  useEffect(() => {
    if (!showHistoryDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
        setShowHistoryDropdown(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHistoryDropdown(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showHistoryDropdown]);

  // Load cached results on mount, auto-refresh if stale (>6 hours)
  useEffect(() => {
    const loadCached = async () => {
      try {
        const cached = await ipc.getLastDiscoveryResult();
        if (cached && cached.papers.length > 0) {
          setPapers(cached.papers);
          setFetchedAt(cached.fetchedAt);
          setIsFromToday(cached.isFromToday);
          // Check if any paper has relevance score
          if (
            cached.papers.some((p) => p.relevanceScore !== null && p.relevanceScore !== undefined)
          ) {
            setSortMode('relevance');
          }
          // Check which papers are already in library
          const importedSet = new Set<string>();
          for (const paper of cached.papers) {
            const existing = await ipc.getPaperByShortId(paper.arxivId);
            if (existing && !existing.isTemporary) {
              importedSet.add(paper.arxivId);
            }
          }
          setImportedIds(importedSet);

          // Auto-refresh only if cached data is NOT from today
          if (!cached.isFromToday) {
            handleFetch();
          }
        }
      } catch (e) {
        console.error('Failed to load cached discovery results:', e);
      }
    };
    loadCached();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetch = useCallback(
    async (force = false) => {
      if (selectedCategories.length === 0) return;

      // Skip if we already have today's data (unless forced)
      if (!force && isFromToday && papers.length > 0) return;

      setLoading(true);
      setError(null);
      setLastFailedOp(null);

      try {
        // Fetch arXiv (main process does incremental merge, returns full set)
        const arxivResult = await ipc.fetchDiscoveryPapers({
          categories: selectedCategories,
          maxResults: 50,
          daysBack,
        });

        // Also fetch AlphaXiv trending (merges into main process state)
        await ipc.fetchTrendingPapers().catch(() => null);

        // Reload the full merged result from main process
        const merged = await ipc.getLastDiscoveryResult();

        if (merged && merged.papers.length > 0) {
          setPapers(merged.papers);
          setFetchedAt(merged.fetchedAt);
          setIsFromToday(true);
          setViewingHistoryDate(null);
        } else if (!arxivResult.success) {
          setError(classifyError(arxivResult.error || 'Failed to fetch papers', t));
          setLastFailedOp('fetch');
        }
      } catch (e) {
        setError(classifyError(e, t));
        setLastFailedOp('fetch');
      } finally {
        setLoading(false);
      }
    },
    [selectedCategories, daysBack, isFromToday, papers.length, t],
  );

  // Merge updated papers (from evaluate/relevance) into existing state,
  // preserving source and alphaxivMetrics that the main process doesn't track.
  const mergePapers = useCallback((updated: DiscoveredPaper[]) => {
    const updatedMap = new Map(updated.map((p) => [p.arxivId, p]));
    setPapers((prev) =>
      prev.map((p) => {
        const u = updatedMap.get(p.arxivId);
        if (!u) return p;
        return { ...u, source: p.source, alphaxivMetrics: p.alphaxivMetrics };
      }),
    );
  }, []);

  const handleEvaluate = useCallback(async () => {
    if (papers.length === 0) return;

    setEvaluating(true);
    setError(null);
    setLastFailedOp(null);
    setEvaluateProgress({ evaluated: 0, total: papers.length });

    try {
      const result = await ipc.evaluateDiscoveryPapers();
      if (result.success && result.papers) {
        mergePapers(result.papers);
      } else if (!result.success && result.error) {
        setError(classifyError(result.error, t));
        setLastFailedOp('evaluate');
      }
    } catch (e) {
      console.error('Evaluation failed:', e);
      setError(classifyError(e, t));
      setLastFailedOp('evaluate');
    } finally {
      setEvaluating(false);
      setEvaluateProgress(null);
    }
  }, [papers.length, mergePapers, t]);

  const handleCancelEvaluation = useCallback(async () => {
    try {
      await ipc.cancelEvaluation();
    } catch (e) {
      console.error('Failed to cancel evaluation:', e);
    }
  }, []);

  // Subscribe to evaluation progress
  useEffect(() => {
    const unsub = onIpc('discovery:evaluateProgress', (_event, progress) => {
      setEvaluateProgress(progress as { evaluated: number; total: number });
    });
    return unsub;
  }, []);

  // Subscribe to relevance progress — update paper scores as they arrive
  useEffect(() => {
    const unsub = onIpc('discovery:relevanceProgress', (_event: unknown, rawData: unknown) => {
      const data = rawData as { scored: number; total: number; batchPapers: DiscoveredPaper[] };
      setRelevanceProgress({ scored: data.scored, total: data.total });
      // Merge batch scores into UI state immediately
      const batchMap = new Map(data.batchPapers.map((p) => [p.arxivId, p]));
      setPapers((prev) =>
        prev.map((p) => {
          const scored = batchMap.get(p.arxivId);
          if (!scored) return p;
          return { ...p, relevanceScore: scored.relevanceScore };
        }),
      );
    });
    return unsub;
  }, []);

  const handleImport = useCallback(async (paper: DiscoveredPaper) => {
    setImportingIds((prev) => new Set(prev).add(paper.arxivId));
    try {
      // Import permanently (not temporary)
      const result = await ipc.downloadPaper(paper.arxivId, [], false);
      if (result) {
        // Mark as imported
        setImportedIds((prev) => new Set(prev).add(paper.arxivId));
      }
      return result;
    } catch (e) {
      console.error('Import failed:', e);
      return null;
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(paper.arxivId);
        return next;
      });
    }
  }, []);

  // Read PDF - imports as temporary (24h), then opens in app reader
  const handleReadPdf = useCallback(
    async (paper: DiscoveredPaper) => {
      // First check if paper already exists
      const existing = await ipc.getPaperByShortId(paper.arxivId);
      if (existing) {
        openTab(`/papers/${existing.shortId}/reader`, { from: '/discovery' });
        return;
      }

      setDownloadingIds((prev) => new Set(prev).add(paper.arxivId));
      try {
        // Import as temporary (will be cleaned up after 24h unless made permanent)
        const result = await ipc.downloadPaper(paper.arxivId, [], true);
        if (result && result.paper) {
          // Navigate to in-app reader
          openTab(`/papers/${result.paper.shortId}/reader`, { from: '/discovery' });
        }
      } catch (e) {
        console.error('Failed to read PDF:', e);
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(paper.arxivId);
          return next;
        });
      }
    },
    [openTab],
  );

  // View detail - opens preview page (no download needed)
  const handleViewDetail = useCallback(
    (paper: DiscoveredPaper) => {
      navigate('/discovery/preview', { state: { paper } });
    },
    [navigate],
  );

  // Calculate relevance scores based on user's library
  const handleCalculateRelevance = useCallback(async () => {
    if (papers.length === 0) return;

    setCalculateRelevance(true);
    setRelevanceProgress(null);
    setError(null);
    setLastFailedOp(null);
    try {
      const result = await ipc.calculateRelevance();
      if (result.success && result.papers) {
        mergePapers(result.papers);
        setSortMode('relevance');
      } else if (!result.success && result.error) {
        setError(classifyError(result.error, t));
        setLastFailedOp('relevance');
      }
    } catch (e) {
      console.error('Relevance calculation failed:', e);
      setError(classifyError(e, t));
      setLastFailedOp('relevance');
    } finally {
      setCalculateRelevance(false);
      setRelevanceProgress(null);
    }
  }, [papers.length, mergePapers, t]);

  const handleCancelRelevance = useCallback(async () => {
    try {
      await ipc.cancelRelevance();
    } catch (e) {
      console.error('Failed to cancel relevance calculation:', e);
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (!lastFailedOp) return;
    if (lastFailedOp === 'fetch') handleFetch();
    else if (lastFailedOp === 'evaluate') handleEvaluate();
    else if (lastFailedOp === 'relevance') handleCalculateRelevance();
  }, [lastFailedOp, handleFetch, handleEvaluate, handleCalculateRelevance]);

  // Load history entries
  const loadHistory = useCallback(async () => {
    try {
      const entries = await ipc.getDiscoveryHistory();
      setHistoryEntries(entries);
    } catch (e) {
      console.error('Failed to load discovery history:', e);
    }
  }, []);

  // Load a specific history entry
  const handleLoadHistoryEntry = useCallback(async (date: string) => {
    try {
      const result = await ipc.loadDiscoveryHistoryEntry(date);
      if (result && result.papers.length > 0) {
        setPapers(result.papers);
        setFetchedAt(result.fetchedAt);
        setIsFromToday(result.isFromToday);
        setViewingHistoryDate(result.isFromToday ? null : date);
        if (
          result.papers.some((p) => p.relevanceScore !== null && p.relevanceScore !== undefined)
        ) {
          setSortMode('relevance');
        } else {
          setSortMode('default');
        }
        setCurrentPage(1);
      }
    } catch (e) {
      console.error('Failed to load history entry:', e);
    }
    setShowHistoryDropdown(false);
  }, []);

  // Go back to today's results
  const handleBackToToday = useCallback(async () => {
    setViewingHistoryDate(null);
    try {
      const cached = await ipc.getLastDiscoveryResult();
      if (cached && cached.papers.length > 0) {
        // Reload from the most recent entry (today if available)
        const entries = await ipc.getDiscoveryHistory();
        if (entries.length > 0) {
          const todayKey = new Date().toISOString().slice(0, 10);
          const todayEntry = entries.find((e) => e.date === todayKey);
          if (todayEntry) {
            await handleLoadHistoryEntry(todayKey);
            setViewingHistoryDate(null);
            return;
          }
        }
        // Fallback: just load last result
        setPapers(cached.papers);
        setFetchedAt(cached.fetchedAt);
        setIsFromToday(cached.isFromToday);
      }
    } catch (e) {
      console.error('Failed to go back to today:', e);
    }
  }, [handleLoadHistoryEntry]);

  // Format a date key for display
  const formatHistoryDate = useCallback(
    (dateStr: string) => {
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      if (dateStr === todayKey) return t('discovery.today', 'Today');
      if (dateStr === yesterdayKey) return t('discovery.yesterday', 'Yesterday');

      // Format as "Mar 19" style
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },
    [t],
  );

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  // Filter by source, then sort
  const filteredPapers =
    sourceFilter === 'all'
      ? papers
      : papers.filter((p) =>
          sourceFilter === 'alphaxiv-trending'
            ? p.source === 'alphaxiv-trending'
            : p.source !== 'alphaxiv-trending',
        );

  const sortedPapers = [...filteredPapers].sort((a, b) => {
    switch (sortMode) {
      case 'relevance':
        return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
      case 'quality':
        return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      case 'views':
        return (b.alphaxivMetrics?.visits ?? 0) - (a.alphaxivMetrics?.visits ?? 0);
      case 'votes':
        return (b.alphaxivMetrics?.votes ?? 0) - (a.alphaxivMetrics?.votes ?? 0);
      default:
        // Default: quality if available, else preserve original order
        if (a.qualityScore || b.qualityScore) {
          return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
        }
        return 0;
    }
  });

  // Pagination
  const totalPages = Math.ceil(sortedPapers.length / pageSize);
  const paginatedPapers = sortedPapers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Check if any papers have relevance scores (for display)
  const hasRelevanceScores = filteredPapers.some(
    (p) => p.relevanceScore !== null && p.relevanceScore !== undefined,
  );

  // Count papers by source for tab badges
  const arxivCount = papers.filter((p) => p.source !== 'alphaxiv-trending').length;
  const trendingCount = papers.filter((p) => p.source === 'alphaxiv-trending').length;

  // Reset to page 1 when sort mode changes
  useEffect(() => {
    setCurrentPage(1);
  }, [sortMode]);

  // Format fetch time
  const formatFetchTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) {
      return t('discovery.fetchedJustNow', 'Fetched just now');
    } else if (diffHours < 24) {
      return t('discovery.fetchedHoursAgo', {
        count: diffHours,
        defaultValue: `Fetched ${diffHours}h ago`,
      });
    } else {
      return t('discovery.fetchedDaysAgo', {
        count: diffDays,
        defaultValue: `Fetched ${diffDays}d ago`,
      });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-notion-sidebar">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-notion-border bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
              <Sparkles size={18} className="text-purple-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-notion-text">
                {t('discovery.title', 'Discover Papers')}
              </h1>
              <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
                <span>{t('discovery.subtitle', 'Find and evaluate new papers from arXiv')}</span>
                {fetchedAt && (
                  <>
                    <span className="text-notion-border">·</span>
                    <span
                      className={clsx(
                        'flex items-center gap-1',
                        isFromToday ? 'text-green-600' : 'text-orange-500',
                      )}
                    >
                      <Clock size={10} />
                      {formatFetchTime(fetchedAt)}
                    </span>
                  </>
                )}
                {/* History button */}
                <div className="relative" ref={historyDropdownRef}>
                  <button
                    onClick={() => {
                      if (!showHistoryDropdown) loadHistory();
                      setShowHistoryDropdown(!showHistoryDropdown);
                    }}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-notion-text-tertiary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text-secondary"
                  >
                    <CalendarDays size={10} />
                    {t('discovery.history', 'History')}
                  </button>
                  <AnimatePresence>
                    {showHistoryDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-notion-border bg-white p-1.5 shadow-lg"
                      >
                        {historyEntries.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-notion-text-tertiary">
                            {t('discovery.noHistory', 'No history available')}
                          </div>
                        ) : (
                          historyEntries.map((entry) => (
                            <button
                              key={entry.date}
                              onClick={() => handleLoadHistoryEntry(entry.date)}
                              className={clsx(
                                'flex w-full items-center justify-between rounded px-3 py-1.5 text-xs transition-colors',
                                viewingHistoryDate === entry.date
                                  ? 'bg-notion-accent-light text-notion-accent'
                                  : 'text-notion-text-secondary hover:bg-notion-sidebar',
                              )}
                            >
                              <span className="font-medium">{formatHistoryDate(entry.date)}</span>
                              <span className="text-notion-text-tertiary">
                                {entry.paperCount} papers
                              </span>
                            </button>
                          ))
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Category Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                className="flex items-center gap-2 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
              >
                <Filter size={14} />
                {selectedCategories.length} {t('discovery.categories', 'categories')}
                <ChevronDown size={14} />
              </button>

              <AnimatePresence>
                {showCategoryDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-notion-border bg-white p-2 shadow-lg"
                  >
                    {COMMON_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                          selectedCategories.includes(cat)
                            ? 'bg-notion-accent-light text-notion-accent'
                            : 'text-notion-text-secondary hover:bg-notion-sidebar',
                        )}
                      >
                        <div
                          className={clsx(
                            'flex h-4 w-4 items-center justify-center rounded border',
                            selectedCategories.includes(cat)
                              ? 'border-notion-accent bg-notion-accent'
                              : 'border-notion-border',
                          )}
                        >
                          {selectedCategories.includes(cat) && (
                            <CheckCircle2 size={12} className="text-white" />
                          )}
                        </div>
                        {cat}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Days Filter */}
            <select
              value={daysBack}
              onChange={(e) => setDaysBack(Number(e.target.value))}
              className="rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm text-notion-text-secondary"
            >
              <option value={1}>{t('discovery.last1Day', 'Last 1 day')}</option>
              <option value={3}>{t('discovery.last3Days', 'Last 3 days')}</option>
              <option value={7}>{t('discovery.last7Days', 'Last 7 days')}</option>
              <option value={14}>{t('discovery.last14Days', 'Last 14 days')}</option>
            </select>

            {/* Fetch Button */}
            <button
              onClick={() => handleFetch(true)}
              disabled={loading || selectedCategories.length === 0}
              className="flex items-center gap-2 rounded-lg bg-notion-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-notion-accent/90 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t('discovery.fetch', 'Fetch Papers')}
            </button>
          </div>
        </div>
      </div>

      {/* Source filter tabs — only show when we have papers from both sources */}
      {papers.length > 0 && trendingCount > 0 && arxivCount > 0 && (
        <div className="flex-shrink-0 border-b border-notion-border bg-white px-6">
          <div className="flex gap-1">
            {(
              [
                { key: 'all', label: t('discovery.allSources', 'All'), count: papers.length },
                { key: 'arxiv', label: 'arXiv', count: arxivCount },
                {
                  key: 'alphaxiv-trending',
                  label: t('discovery.alphaxivHot', 'AlphaXiv Hot'),
                  count: trendingCount,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setSourceFilter(tab.key);
                  setCurrentPage(1);
                  // Reset sort if switching to a tab that doesn't support current sort
                  if (tab.key === 'arxiv' && (sortMode === 'views' || sortMode === 'votes')) {
                    setSortMode('default');
                  }
                }}
                className={clsx(
                  'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
                  sourceFilter === tab.key
                    ? 'text-notion-accent'
                    : 'text-notion-text-tertiary hover:text-notion-text-secondary',
                )}
              >
                {tab.label}
                <span
                  className={clsx(
                    'rounded-full px-1.5 py-0.5 text-xs',
                    sourceFilter === tab.key
                      ? 'bg-notion-accent/10 text-notion-accent'
                      : 'bg-notion-sidebar text-notion-text-tertiary',
                  )}
                >
                  {tab.count}
                </span>
                {sourceFilter === tab.key && (
                  <motion.div
                    layoutId="sourceFilterIndicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-notion-accent"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
            <div className="ml-2 flex flex-shrink-0 items-center gap-1">
              {lastFailedOp && (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                >
                  <RotateCcw size={12} />
                  {t('common.retry')}
                </button>
              )}
              <button
                onClick={() => {
                  setError(null);
                  setLastFailedOp(null);
                }}
                className="rounded p-1 transition-colors hover:bg-red-100"
              >
                <XCircle size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Viewing history banner */}
        {viewingHistoryDate && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-notion-accent/20 bg-notion-accent-light px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2 text-notion-accent">
              <CalendarDays size={14} />
              {t('discovery.viewingHistory', {
                date: formatHistoryDate(viewingHistoryDate),
                defaultValue: `Viewing results from ${formatHistoryDate(viewingHistoryDate)}`,
              })}
            </div>
            <button
              onClick={handleBackToToday}
              className="text-xs font-medium text-notion-accent underline decoration-notion-accent/30 transition-colors hover:decoration-notion-accent"
            >
              {t('discovery.backToToday', 'Back to today')}
            </button>
          </div>
        )}

        {papers.length > 0 && !evaluating && (
          <div className="mb-4 flex flex-wrap gap-2">
            {/* Evaluate with AI - only show if some papers don't have quality scores */}
            {papers.some((p) => !p.qualityScore) && (
              <button
                onClick={handleEvaluate}
                className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-100"
              >
                <Sparkles size={16} />
                {t('discovery.evaluateWithAI', 'Evaluate with AI')}
              </button>
            )}

            {/* Smart Filter - show if any papers still need relevance scoring */}
            {papers.some((p) => p.relevanceScore === null || p.relevanceScore === undefined) && (
              <button
                onClick={handleCalculateRelevance}
                disabled={calculateRelevance}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  sortMode === 'relevance'
                    ? 'border-green-300 bg-green-50 text-green-600'
                    : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100',
                )}
              >
                {calculateRelevance ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Target size={16} />
                )}
                {t('discovery.smartFilter', 'Smart Filter')}
              </button>
            )}

            {/* Sort options */}
            {(() => {
              const sortOptions: { key: typeof sortMode; label: string; show: boolean }[] = [
                { key: 'default', label: t('discovery.sortDefault', 'Default'), show: true },
                {
                  key: 'quality',
                  label: t('discovery.sortByQuality', 'Sort by Quality'),
                  show: papers.some((p) => p.qualityScore),
                },
                {
                  key: 'relevance',
                  label: t('discovery.sortByRelevance', 'Sort by Relevance'),
                  show: papers.some(
                    (p) => p.relevanceScore !== null && p.relevanceScore !== undefined,
                  ),
                },
                {
                  key: 'views',
                  label: t('discovery.sortByViews', 'Sort by Views'),
                  show: sourceFilter !== 'arxiv' && filteredPapers.some((p) => p.alphaxivMetrics),
                },
                {
                  key: 'votes',
                  label: t('discovery.sortByVotes', 'Sort by Votes'),
                  show: sourceFilter !== 'arxiv' && filteredPapers.some((p) => p.alphaxivMetrics),
                },
              ];
              const visible = sortOptions.filter((o) => o.show);
              // Only show sort controls when there are multiple options
              if (visible.length <= 1) return null;
              return (
                <div className="flex items-center gap-1 rounded-lg border border-notion-border bg-notion-sidebar p-0.5">
                  {visible.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setSortMode(opt.key)}
                      className={clsx(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                        sortMode === opt.key
                          ? 'bg-white text-notion-text shadow-sm'
                          : 'text-notion-text-tertiary hover:text-notion-text-secondary',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Relevance calculation indicator with progress */}
        {calculateRelevance && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-green-600" />
                <span className="text-sm text-green-700">
                  {t('discovery.calculatingRelevance', 'Calculating relevance to your library...')}
                  {relevanceProgress && ` ${relevanceProgress.scored}/${relevanceProgress.total}`}
                </span>
              </div>
              <button
                onClick={handleCancelRelevance}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100"
              >
                <XCircle size={14} />
                {t('common.cancel', 'Cancel')}
              </button>
            </div>
            {relevanceProgress && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-green-100">
                <motion.div
                  className="h-full bg-green-500"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${(relevanceProgress.scored / relevanceProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {evaluating && evaluateProgress && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-blue-600" />
                <span className="text-sm text-blue-700">
                  {t('discovery.evaluating', 'Evaluating papers...')} {evaluateProgress.evaluated}/
                  {evaluateProgress.total}
                </span>
              </div>
              <button
                onClick={handleCancelEvaluation}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
              >
                <XCircle size={14} />
                {t('common.cancel', 'Cancel')}
              </button>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
              <motion.div
                className="h-full bg-blue-500"
                initial={{ width: 0 }}
                animate={{
                  width: `${(evaluateProgress.evaluated / evaluateProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <Loader2 size={32} className="animate-spin text-notion-accent" />
              <p className="mt-3 text-sm text-notion-text-secondary">
                {t('discovery.fetching', 'Fetching papers from arXiv...')}
              </p>
            </motion.div>
          ) : papers.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-notion-sidebar">
                <TrendingUp size={28} className="text-notion-text-tertiary" />
              </div>
              <p className="mt-4 text-base text-notion-text-secondary">
                {t('discovery.empty', 'No papers discovered yet')}
              </p>
              <p className="mt-1 text-sm text-notion-text-tertiary">
                {t('discovery.emptyHint', 'Select categories and click "Fetch Papers" to start')}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="papers"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4"
            >
              {paginatedPapers.map((paper) => (
                <PaperCard
                  key={paper.arxivId}
                  paper={paper}
                  showRelevance={hasRelevanceScores}
                  isDownloading={downloadingIds.has(paper.arxivId)}
                  isImporting={importingIds.has(paper.arxivId)}
                  isImported={importedIds.has(paper.arxivId)}
                  onImport={handleImport}
                  onReadPdf={handleReadPdf}
                  onViewDetail={handleViewDetail}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-notion-border bg-white text-notion-text-secondary transition-colors hover:bg-notion-sidebar disabled:opacity-40 disabled:hover:bg-white"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors',
                    page === currentPage
                      ? 'bg-notion-accent text-white'
                      : 'border border-notion-border bg-white text-notion-text-secondary hover:bg-notion-sidebar',
                  )}
                >
                  {page}
                </button>
              ))}
            </div>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-notion-border bg-white text-notion-text-secondary transition-colors hover:bg-notion-sidebar disabled:opacity-40 disabled:hover:bg-white"
            >
              <ChevronRight size={16} />
            </button>

            <span className="ml-2 text-xs text-notion-text-tertiary">
              {t('discovery.pageInfo', '{{current}} / {{total}} pages', {
                current: currentPage,
                total: totalPages,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PaperCard({
  paper,
  showRelevance,
  isDownloading,
  isImporting,
  isImported,
  onImport,
  onReadPdf,
  onViewDetail,
}: {
  paper: DiscoveredPaper;
  showRelevance: boolean;
  isDownloading: boolean;
  isImporting: boolean;
  isImported: boolean;
  onImport: (paper: DiscoveredPaper) => void;
  onReadPdf: (paper: DiscoveredPaper) => void;
  onViewDetail: (paper: DiscoveredPaper) => void;
}) {
  const { t } = useTranslation();

  return (
    <motion.div
      variants={cardVariants}
      onClick={() => onViewDetail(paper)}
      className="group cursor-pointer rounded-xl border border-notion-border bg-white p-4 transition-all hover:border-notion-accent/30 hover:shadow-md"
    >
      <div className="flex gap-4">
        {/* Score Badge */}
        <div className="flex flex-col items-center gap-1">
          {/* Quality Score */}
          {paper.qualityScore && (
            <div
              className={clsx(
                'flex h-12 w-12 flex-col items-center justify-center rounded-lg',
                getScoreColor(paper.qualityScore),
              )}
            >
              <span className="text-lg font-bold">{paper.qualityScore}</span>
            </div>
          )}
          {/* Relevance Score */}
          {showRelevance && paper.relevanceScore !== null && paper.relevanceScore !== undefined && (
            <div
              className={clsx(
                'flex h-8 w-12 flex-col items-center justify-center rounded-lg',
                paper.relevanceScore >= 70
                  ? 'bg-green-100 text-green-700'
                  : paper.relevanceScore >= 40
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600',
              )}
              title={t('discovery.relevanceScore', 'Relevance to your library')}
            >
              <span className="text-xs font-bold">{paper.relevanceScore}%</span>
            </div>
          )}
          {paper.qualityRecommendation && (
            <span
              className={clsx(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                ...Object.values(getRecommendationStyle(paper.qualityRecommendation)),
              )}
            >
              {t(`discovery.${paper.qualityRecommendation}`, paper.qualityRecommendation)}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-medium leading-snug text-notion-text">
              {paper.title}
            </h3>
            <a
              href={paper.absUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-notion-text-tertiary hover:text-notion-accent"
            >
              <ExternalLink size={14} />
            </a>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-notion-text-tertiary">
            <span className="truncate">{paper.authors.slice(0, 3).join(', ')}</span>
            {paper.authors.length > 3 && <span>+{paper.authors.length - 3}</span>}
            <span className="text-notion-border">·</span>
            <span>{new Date(paper.publishedAt).toLocaleDateString()}</span>
            <span className="text-notion-border">·</span>
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5">{paper.categories[0]}</span>
            {/* AlphaXiv trending metrics */}
            {paper.alphaxivMetrics && (
              <>
                <span className="text-notion-border">·</span>
                <span className="flex items-center gap-0.5" title={t('discovery.views', 'Views')}>
                  <Eye size={10} />
                  {paper.alphaxivMetrics.visits.toLocaleString()}
                </span>
                <span className="flex items-center gap-0.5" title={t('discovery.votes', 'Votes')}>
                  <ThumbsUp size={10} />
                  {paper.alphaxivMetrics.votes.toLocaleString()}
                </span>
                {paper.alphaxivMetrics.githubStars != null &&
                  paper.alphaxivMetrics.githubStars > 0 && (
                    <span
                      className="flex items-center gap-0.5"
                      title={t('discovery.githubStars', 'GitHub Stars')}
                    >
                      <Star size={10} />
                      {paper.alphaxivMetrics.githubStars.toLocaleString()}
                    </span>
                  )}
              </>
            )}
          </div>

          {/* AI Reason */}
          {paper.qualityReason && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-notion-text-secondary">
              {paper.qualityReason}
            </p>
          )}

          {/* Quality Dimensions */}
          {paper.qualityDimensions && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(paper.qualityDimensions).map(([key, value]) => (
                <span
                  key={key}
                  className="flex items-center gap-1 rounded bg-notion-sidebar px-1.5 py-0.5 text-xs"
                >
                  <span className="text-notion-text-tertiary">{t(`discovery.${key}`, key)}:</span>
                  <span className="font-medium text-notion-text">{value}</span>
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onReadPdf(paper)}
              disabled={isDownloading}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                isDownloading
                  ? 'cursor-wait border-notion-accent/50 bg-notion-accent-light text-notion-accent'
                  : 'border-notion-border bg-white text-notion-text-secondary hover:bg-notion-sidebar',
              )}
            >
              {isDownloading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FileSearch size={12} />
              )}
              {isDownloading
                ? t('discovery.downloading', 'Downloading...')
                : t('discovery.readPdf', 'Read PDF')}
            </button>
            {isImported ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                <CheckCircle2 size={12} />
                {t('discovery.imported', 'Imported')}
              </span>
            ) : (
              <button
                onClick={() => onImport(paper)}
                disabled={isImporting}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-colors',
                  isImporting
                    ? 'cursor-wait bg-notion-accent/70 text-white'
                    : 'bg-notion-accent text-white hover:bg-notion-accent/90',
                )}
              >
                {isImporting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
                {isImporting
                  ? t('discovery.importing', 'Importing...')
                  : t('discovery.import', 'Import')}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
