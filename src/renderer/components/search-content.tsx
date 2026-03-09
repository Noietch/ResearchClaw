import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse, { type IFuseOptions } from 'fuse.js';
import {
  ipc,
  onIpc,
  type PaperItem,
  type AgenticSearchStep,
  type AgenticSearchPaper,
  type SemanticSearchPaper,
} from '../hooks/use-ipc';
import { FileText, Search, Loader2, Trash2, X, Sparkles, RotateCcw } from 'lucide-react';
import {
  cleanArxivTitle,
  filterNormalSearchResults,
  getTagStyle,
  tokenizeSearchQuery,
} from '@shared';

const EXCLUDED_TAGS = [
  'arxiv',
  'chrome',
  'manual',
  'pdf',
  'research-paper',
  'research paper',
  'paper',
];

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 24,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.15 },
  },
};

const titleVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
  hidden: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.3 },
  },
};

const searchBoxVariants = {
  center: {
    y: 0,
    transition: { type: 'spring' as const, stiffness: 200, damping: 25 },
  },
  top: {
    y: 0,
    transition: { type: 'spring' as const, stiffness: 200, damping: 25 },
  },
};

type SearchMode = 'search' | 'agentic';

// Fuse.js fallback config for title/tag typo tolerance when exact token matching finds nothing
const FUSE_OPTIONS: IFuseOptions<PaperItem> = {
  keys: [
    { name: 'title', weight: 0.75 },
    { name: 'tagNames', weight: 0.25 },
  ],
  threshold: 0.22,
  minMatchCharLength: 3,
  includeScore: true,
  ignoreLocation: true,
};

/**
 * Multi-token fuzzy search: split query by spaces, search each token independently,
 * then rank by combined score = avgScore / hitCount².
 * Papers matching more tokens rank higher — e.g. "auto regression video gen" will
 * rank a paper matching all 4 tokens above one matching only 1.
 */
function fuseTokenSearch(fuse: Fuse<PaperItem>, query: string): PaperItem[] {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  if (tokens.length === 1) return fuse.search(tokens[0]).map((r) => r.item);

  const hitCount = new Map<string, number>();
  const scoreSum = new Map<string, number>();
  const itemMap = new Map<string, PaperItem>();

  for (const token of tokens) {
    for (const r of fuse.search(token)) {
      const id = r.item.id;
      hitCount.set(id, (hitCount.get(id) ?? 0) + 1);
      scoreSum.set(id, (scoreSum.get(id) ?? 0) + (r.score ?? 1));
      itemMap.set(id, r.item);
    }
  }

  return Array.from(hitCount.entries())
    .map(([id, count]) => {
      const avgScore = (scoreSum.get(id) ?? 1) / count;
      return { id, combined: avgScore / (count * count) };
    })
    .sort((a, b) => a.combined - b.combined)
    .map(({ id }) => itemMap.get(id)!);
}

function getNormalSearchResults(
  items: PaperItem[],
  query: string,
  fuse: Fuse<PaperItem> | null = null,
): PaperItem[] {
  if (!query.trim()) return [];

  const exactMatches = filterNormalSearchResults(items, query);
  if (exactMatches.length > 0 || !fuse) {
    return exactMatches;
  }

  const tokens = tokenizeSearchQuery(query);
  if (tokens.some((token) => token.length < 3)) {
    return [];
  }

  return fuseTokenSearch(fuse, query);
}

function mergePaperSnapshot(paper: PaperItem, latest?: PaperItem): PaperItem {
  return latest ? { ...paper, ...latest } : paper;
}

function mergeAgenticPaper(paper: AgenticSearchPaper, latest?: PaperItem): AgenticSearchPaper {
  return latest
    ? {
        ...paper,
        title: latest.title,
        authors: latest.authors,
        submittedAt: latest.submittedAt,
        tagNames: latest.tagNames,
        abstract: latest.abstract,
        processingStatus: latest.processingStatus,
      }
    : paper;
}

function mergeSemanticPaper(paper: SemanticSearchPaper, latest?: PaperItem): SemanticSearchPaper {
  return latest
    ? {
        ...paper,
        title: latest.title,
        authors: latest.authors,
        submittedAt: latest.submittedAt ?? paper.submittedAt ?? null,
        tagNames: latest.tagNames,
        abstract: latest.abstract ?? paper.abstract ?? null,
        processingStatus: latest.processingStatus,
      }
    : paper;
}

function markPaperQueuedStatus<T extends { id: string; processingStatus?: string }>(
  items: T[],
  paperId: string,
): T[] {
  return items.map((paper) =>
    paper.id === paperId ? { ...paper, processingStatus: 'queued' } : paper,
  );
}

export function SearchContent() {
  const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [agenticPapers, setAgenticPapers] = useState<AgenticSearchPaper[]>([]);
  const [semanticPapers, setSemanticPapers] = useState<SemanticSearchPaper[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [retryingPaperId, setRetryingPaperId] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('search');
  const [agenticSteps, setAgenticSteps] = useState<AgenticSearchStep[]>([]);
  const [agenticError, setAgenticError] = useState<string | null>(null);
  const [semanticFallbackReason, setSemanticFallbackReason] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fuseRef = useRef<Fuse<PaperItem> | null>(null);
  const navigate = useNavigate();

  const reloadPapers = useCallback(async () => {
    const data = await ipc.listPapers().catch(() => [] as PaperItem[]);
    setAllPapers(data);
    fuseRef.current = new Fuse(data, FUSE_OPTIONS);
    return data;
  }, []);

  // Load all papers once on mount for fuzzy search
  useEffect(() => {
    void reloadPapers();
  }, [reloadPapers]);

  useEffect(() => {
    return onIpc('papers:processingStatus', () => {
      void reloadPapers().then((latestPapers) => {
        const latestById = new Map(latestPapers.map((paper) => [paper.id, paper]));

        setAgenticPapers((prev) =>
          prev.map((paper) => mergeAgenticPaper(paper, latestById.get(paper.id))),
        );
        setSemanticPapers((prev) =>
          prev.map((paper) => mergeSemanticPaper(paper, latestById.get(paper.id))),
        );

        if (query.trim() && searchMode === 'search' && !!semanticFallbackReason) {
          setPapers(
            getNormalSearchResults(latestPapers, query, new Fuse(latestPapers, FUSE_OPTIONS)),
          );
          return;
        }

        setPapers((prev) =>
          prev.map((paper) => mergePaperSnapshot(paper, latestById.get(paper.id))),
        );
      });
    });
  }, [query, reloadPapers, searchMode, semanticFallbackReason]);

  const doNormalSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setHasSearched(false);
        setPapers([]);
        return;
      }
      setHasSearched(true);
      setPapers(getNormalSearchResults(allPapers, q, fuseRef.current));
    },
    [allPapers],
  );

  const doAgenticSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setHasSearched(false);
      setAgenticPapers([]);
      setAgenticSteps([]);
      setAgenticError(null);
      return;
    }
    setLoading(true);
    setHasSearched(true);
    setAgenticSteps([]);
    setAgenticPapers([]);
    setAgenticError(null);

    // Listen for streaming step events from main process
    const unsubscribe = onIpc('papers:agenticSearch:step', (...args: unknown[]) => {
      const step = args[1] as AgenticSearchStep; // args[0] is IpcRendererEvent
      setAgenticSteps((prev) => [...prev, step]);
      if (step.type === 'done') {
        setLoading(false);
      }
    });

    try {
      const result = await ipc.agenticSearch(q.trim());
      setAgenticPapers(result.papers);
      // Ensure steps are set from final result (in case events were missed)
      if (result.steps.length > 0) {
        setAgenticSteps(result.steps);
      }
    } catch (error) {
      console.error('Agentic search failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setAgenticError(errorMsg);
    } finally {
      unsubscribe();
      setLoading(false);
    }
  }, []);

  const doSemanticSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setHasSearched(false);
        setSemanticPapers([]);
        setSemanticFallbackReason(null);
        setPapers([]);
        return;
      }

      setLoading(true);
      setHasSearched(true);
      setSemanticPapers([]);
      setSemanticFallbackReason(null);

      try {
        const result = await ipc.semanticSearch(q.trim(), 18);
        if (result.mode === 'fallback') {
          setSemanticFallbackReason(
            result.fallbackReason ??
              'Semantic search is unavailable. Showing normal results instead.',
          );
          doNormalSearch(q);
          return;
        }
        setSemanticPapers(result.papers);
      } catch (error) {
        console.error('Semantic search failed:', error);
        setSemanticFallbackReason(
          error instanceof Error
            ? error.message
            : 'Semantic search failed. Showing normal results instead.',
        );
        doNormalSearch(q);
      } finally {
        setLoading(false);
      }
    },
    [doNormalSearch],
  );

  const doSearch = useCallback(
    (q: string) => {
      if (searchMode === 'agentic') {
        void doAgenticSearch(q);
      } else {
        void doSemanticSearch(q);
      }
    },
    [searchMode, doAgenticSearch, doSemanticSearch],
  );

  const handleRetryProcessing = useCallback(
    async (paperId: string) => {
      setRetryingPaperId(paperId);
      try {
        await ipc.retryPaperProcessing(paperId);
        setAllPapers((prev) => markPaperQueuedStatus(prev, paperId));
        setPapers((prev) => markPaperQueuedStatus(prev, paperId));
        setAgenticPapers((prev) => markPaperQueuedStatus(prev, paperId));
        setSemanticPapers((prev) => markPaperQueuedStatus(prev, paperId));
        void reloadPapers();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Failed to retry paper processing');
      } finally {
        setRetryingPaperId(null);
      }
    },
    [reloadPapers],
  );

  const handleDelete = useCallback(async (paperId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This action cannot be undone.`)) return;
    setDeleting(paperId);
    try {
      await ipc.deletePaper(paperId);
      setAllPapers((prev) => {
        const next = prev.filter((p) => p.id !== paperId);
        fuseRef.current = new Fuse(next, FUSE_OPTIONS);
        return next;
      });
      setPapers((prev) => prev.filter((p) => p.id !== paperId));
      setAgenticPapers((prev) => prev.filter((p) => p.id !== paperId));
      setSemanticPapers((prev) => prev.filter((p) => p.id !== paperId));
    } catch {
      alert('Failed to delete paper');
    } finally {
      setDeleting(null);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      doSearch(query);
    }
  };

  const handleSearch = () => {
    doSearch(query);
  };

  const handleClear = () => {
    setQuery('');
    setHasSearched(false);
    setPapers([]);
    setAgenticPapers([]);
    setAgenticSteps([]);
    setAgenticError(null);
    setSemanticPapers([]);
    setSemanticFallbackReason(null);
    inputRef.current?.focus();
  };

  const handleSearchModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setHasSearched(false);
    setPapers([]);
    setAgenticPapers([]);
    setAgenticSteps([]);
    setAgenticError(null);
    setSemanticPapers([]);
    setSemanticFallbackReason(null);
    inputRef.current?.focus();
  };

  const semanticUsingFallback = searchMode === 'search' && !!semanticFallbackReason;
  const displayPapers =
    searchMode === 'agentic' ? agenticPapers : !semanticUsingFallback ? semanticPapers : papers;

  return (
    <div className="flex h-full flex-col">
      <motion.div
        className={`flex flex-col items-center ${
          hasSearched ? 'pt-8 pb-4' : 'flex-1 justify-center'
        }`}
        variants={searchBoxVariants}
        animate={hasSearched ? 'top' : 'center'}
      >
        <div className="w-full max-w-2xl px-6">
          <AnimatePresence mode="wait">
            {!hasSearched && (
              <motion.p
                key={searchMode}
                variants={titleVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className={`mb-6 text-center text-2xl font-semibold transition-colors duration-200 ${
                  searchMode === 'agentic' ? 'text-blue-600' : 'text-notion-text'
                }`}
              >
                {searchMode === 'agentic'
                  ? 'What are you curious about?'
                  : 'What are you reading today?'}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Search box */}
          <motion.div
            className={`rounded-2xl border bg-white shadow-notion-hover transition-all duration-200 focus-within:shadow-lg ${
              searchMode === 'agentic' ? 'border-blue-200' : 'border-notion-border'
            }`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 24 }}
          >
            <div className="flex items-center gap-3 px-5 py-4">
              <AnimatePresence mode="wait">
                {searchMode === 'agentic' ? (
                  <motion.div
                    key="sparkles"
                    initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Sparkles size={18} className="flex-shrink-0 text-blue-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="search"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Search size={18} className="flex-shrink-0 text-notion-text-tertiary" />
                  </motion.div>
                )}
              </AnimatePresence>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  searchMode === 'agentic'
                    ? 'Describe what you are looking for...'
                    : 'Search by title, tag, abstract, or meaning…'
                }
                className="flex-1 border-none bg-transparent text-base text-notion-text placeholder-notion-text-tertiary outline-none"
              />
              {query && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={handleClear}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text"
                >
                  <X size={14} />
                </motion.button>
              )}
              {loading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Loader2
                    size={16}
                    className={`animate-spin flex-shrink-0 ${
                      searchMode === 'agentic' ? 'text-blue-500' : 'text-notion-text-tertiary'
                    }`}
                  />
                </motion.div>
              )}
              <motion.button
                onClick={handleSearch}
                disabled={!query.trim() || loading}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-all duration-200 hover:opacity-80 disabled:opacity-40 ${
                  searchMode === 'agentic' ? 'bg-blue-600' : 'bg-notion-text'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {searchMode === 'agentic' ? 'Ask AI' : 'Search'}
              </motion.button>
            </div>
          </motion.div>

          {/* Search mode selector - toggle buttons below search box */}
          <div className="mt-3 flex justify-start">
            <div className="relative flex rounded-full bg-notion-sidebar p-1">
              <motion.div
                className="absolute top-1 bottom-1 rounded-full bg-white shadow-sm"
                animate={{
                  left: searchMode === 'search' ? '4px' : 'calc(50% + 1px)',
                  width: 'calc(50% - 4px)',
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
              <button
                onClick={() => handleSearchModeChange('search')}
                className={`relative z-10 w-24 rounded-full py-1 text-sm font-medium transition-colors duration-150 ${
                  searchMode === 'search'
                    ? 'text-notion-text'
                    : 'text-notion-text-tertiary hover:text-notion-text-secondary'
                }`}
              >
                Search
              </button>
              <button
                onClick={() => handleSearchModeChange('agentic')}
                className={`relative z-10 flex w-24 items-center justify-center gap-1 rounded-full py-1 text-sm font-medium transition-colors duration-150 ${
                  searchMode === 'agentic'
                    ? 'text-blue-600'
                    : 'text-notion-text-tertiary hover:text-notion-text-secondary'
                }`}
              >
                <Sparkles size={12} />
                Agentic
                <span className="text-xs opacity-70">(Beta)</span>
              </button>
            </div>
          </div>

          {/* Agentic search error */}
          <AnimatePresence>
            {searchMode === 'agentic' && agenticError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 rounded-xl bg-red-50 p-4"
              >
                <div className="flex items-start gap-2">
                  <span className="text-red-500">⚠️</span>
                  <div>
                    <p className="text-sm font-medium text-red-700">AI Search Failed</p>
                    <p className="mt-1 text-xs text-red-600">{agenticError}</p>
                    <Link
                      to="/settings"
                      className="mt-2 inline-block text-xs font-medium text-red-700 underline hover:text-red-800"
                    >
                      Configure AI Provider →
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {searchMode === 'search' && semanticFallbackReason && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-4"
              >
                <div className="flex items-start gap-2">
                  <span className="text-amber-500">⚠️</span>
                  <div>
                    <p className="text-sm font-medium text-amber-700">
                      Semantic search unavailable
                    </p>
                    <p className="mt-1 text-xs text-amber-700/80">{semanticFallbackReason}</p>
                    <p className="mt-2 text-xs text-amber-700/80">
                      Showing keyword search results instead.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Agentic search steps - real-time AI thinking process */}
          <AnimatePresence>
            {searchMode === 'agentic' && (agenticSteps.length > 0 || loading) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3"
              >
                <div className="space-y-1.5">
                  {agenticSteps.map((step, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`flex items-start gap-2 text-sm ${
                        index === agenticSteps.length - 1 && step.type !== 'done'
                          ? 'text-notion-text'
                          : 'text-notion-text-secondary'
                      }`}
                    >
                      <span className="mt-0.5 flex-shrink-0 text-base leading-none">
                        {step.type === 'thinking' && '💭'}
                        {step.type === 'searching' && '🔍'}
                        {step.type === 'found' && '✅'}
                        {step.type === 'reasoning' && '🧠'}
                        {step.type === 'done' && '🎯'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span>{step.message}</span>
                        {step.keywords && step.keywords.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {step.keywords.map((kw) => (
                              <span
                                key={kw}
                                className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-blue-600"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  {/* Pulsing indicator when waiting for next step */}
                  {loading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2 text-sm text-blue-500"
                    >
                      <Loader2 size={13} className="animate-spin flex-shrink-0" />
                      <span className="text-xs">AI is thinking...</span>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Results - fades in when searching */}
      <AnimatePresence mode="wait">
        {hasSearched && (
          <motion.div
            key="results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto px-6 pb-8"
          >
            <div className="mx-auto max-w-5xl">
              {displayPapers.length > 0 ? (
                <>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 text-sm text-notion-text-tertiary"
                  >
                    Found {displayPapers.length} paper{displayPapers.length !== 1 ? 's' : ''}
                    {searchMode === 'agentic' && ' (AI-curated)'}
                  </motion.p>
                  <motion.div
                    className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <AnimatePresence mode="popLayout">
                      {searchMode === 'agentic'
                        ? agenticPapers.map((paper) => (
                            <AgenticPaperCard
                              key={paper.id}
                              paper={paper}
                              deleting={deleting}
                              retryingPaperId={retryingPaperId}
                              onDelete={handleDelete}
                              onRetry={handleRetryProcessing}
                            />
                          ))
                        : !semanticUsingFallback
                          ? semanticPapers.map((paper) => (
                              <SemanticPaperCard
                                key={paper.id}
                                paper={paper}
                                deleting={deleting}
                                retryingPaperId={retryingPaperId}
                                onDelete={handleDelete}
                                onRetry={handleRetryProcessing}
                              />
                            ))
                          : papers.map((paper) => (
                              <PaperCard
                                key={paper.id}
                                paper={paper}
                                deleting={deleting}
                                retryingPaperId={retryingPaperId}
                                onDelete={handleDelete}
                                onRetry={handleRetryProcessing}
                              />
                            ))}
                    </AnimatePresence>
                  </motion.div>
                </>
              ) : (
                !loading && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center py-16 text-center"
                  >
                    <p className="text-base text-notion-text-secondary">No matching papers found</p>
                    <p className="mt-1 text-sm text-notion-text-tertiary">
                      {searchMode === 'agentic'
                        ? 'Try a different description'
                        : 'Try different keywords or wait for indexing to finish'}
                    </p>
                  </motion.div>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PaperCard({
  paper,
  deleting,
  retryingPaperId,
  onDelete,
  onRetry,
}: {
  paper: PaperItem;
  deleting: string | null;
  retryingPaperId: string | null;
  onDelete: (id: string, title: string) => void;
  onRetry: (id: string) => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/papers/${paper.shortId}`, { state: { from: '/search' } });
  };

  return (
    <motion.div
      variants={cardVariants}
      layout
      className="group relative flex flex-col rounded-xl border border-notion-border bg-white p-4"
      whileHover={{
        scale: 1.02,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
      }}
    >
      {paper.processingStatus === 'failed' && (
        <motion.button
          onClick={(e) => {
            e.stopPropagation();
            onRetry(paper.id);
          }}
          disabled={retryingPaperId === paper.id}
          className="absolute right-10 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-amber-100 hover:text-amber-700 group-hover:opacity-100 disabled:opacity-100"
          title="Retry processing"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {retryingPaperId === paper.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
        </motion.button>
      )}
      <motion.button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(paper.id, paper.title);
        }}
        disabled={deleting === paper.id}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
        title="Delete paper"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        {deleting === paper.id ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </motion.button>

      <button onClick={handleClick} className="flex flex-col items-start gap-2 text-left">
        <motion.div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50"
          whileHover={{ rotate: 5 }}
        >
          <FileText size={18} className="text-blue-500" />
        </motion.div>

        <h3 className="line-clamp-2 text-sm font-medium text-notion-text">
          {cleanArxivTitle(paper.title)}
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {paper.submittedAt && (
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs text-notion-text-secondary">
              {new Date(paper.submittedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </span>
          )}
          <ProcessingBadge status={paper.processingStatus} />
        </div>

        {paper.processingStatus === 'failed' && paper.processingError && (
          <p className="line-clamp-3 break-all text-xs text-red-700/90">{paper.processingError}</p>
        )}

        <div className="flex flex-wrap gap-1.5"></div>

        {paper.processingStatus === 'failed' && paper.processingError && (
          <p className="line-clamp-3 break-all text-xs text-red-700/90">{paper.processingError}</p>
        )}

        <div className="flex flex-wrap gap-1.5"></div>

        {paper.processingStatus === 'failed' && paper.processingError && (
          <p className="line-clamp-3 break-all text-xs text-red-700/90">{paper.processingError}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {paper.categorizedTags
            ?.filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()))
            .slice(0, 3)
            .map((tag) => {
              const style = getTagStyle(tag.category);
              return (
                <motion.span
                  key={tag.name}
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                  whileHover={{ scale: 1.05 }}
                >
                  {tag.name}
                </motion.span>
              );
            })}
        </div>
      </button>
    </motion.div>
  );
}

function ProcessingBadge({ status }: { status?: string }) {
  if (!status || status === 'idle') return null;

  const styles: Record<string, string> = {
    queued: 'bg-amber-50 text-amber-700',
    extracting_text: 'bg-amber-50 text-amber-700',
    extracting_metadata: 'bg-amber-50 text-amber-700',
    chunking: 'bg-amber-50 text-amber-700',
    embedding: 'bg-amber-50 text-amber-700',
    completed: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
  };

  const labels: Record<string, string> = {
    queued: 'Queued',
    extracting_text: 'Extracting',
    extracting_metadata: 'Metadata',
    chunking: 'Chunking',
    embedding: 'Indexing',
    completed: 'Indexed',
    failed: 'Needs retry',
  };

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-slate-50 text-slate-600'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function SemanticPaperCard({
  paper,
  deleting,
  retryingPaperId,
  onDelete,
  onRetry,
}: {
  paper: SemanticSearchPaper;
  deleting: string | null;
  retryingPaperId: string | null;
  onDelete: (id: string, title: string) => void;
  onRetry: (id: string) => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/papers/${paper.shortId}`, { state: { from: '/search' } });
  };

  return (
    <motion.div
      variants={cardVariants}
      layout
      className="group relative flex flex-col rounded-xl border border-notion-border bg-white p-4"
      whileHover={{
        scale: 1.02,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
      }}
    >
      {paper.processingStatus === 'failed' && (
        <motion.button
          onClick={(e) => {
            e.stopPropagation();
            onRetry(paper.id);
          }}
          disabled={retryingPaperId === paper.id}
          className="absolute right-10 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-amber-100 hover:text-amber-700 group-hover:opacity-100 disabled:opacity-100"
          title="Retry processing"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {retryingPaperId === paper.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
        </motion.button>
      )}
      <motion.button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(paper.id, paper.title);
        }}
        disabled={deleting === paper.id}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
        title="Delete paper"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        {deleting === paper.id ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </motion.button>

      <button onClick={handleClick} className="flex flex-col items-start gap-2 text-left">
        <motion.div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50"
          whileHover={{ rotate: 5 }}
        >
          <FileText size={18} className="text-blue-500" />
        </motion.div>

        <h3 className="line-clamp-2 text-sm font-medium text-notion-text">
          {cleanArxivTitle(paper.title)}
        </h3>

        {paper.relevanceReason && (
          <p className="line-clamp-3 text-xs leading-5 text-notion-text-secondary">
            {paper.relevanceReason}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {paper.submittedAt && (
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs text-notion-text-secondary">
              {new Date(paper.submittedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
          <ProcessingBadge status={paper.processingStatus} />
          {paper.tagNames
            ?.filter((t) => !EXCLUDED_TAGS.includes(t.toLowerCase()))
            .slice(0, 3)
            .map((tag) => {
              const style = getTagStyle('topic');
              return (
                <motion.span
                  key={tag}
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                  whileHover={{ scale: 1.05 }}
                >
                  {tag}
                </motion.span>
              );
            })}
        </div>
      </button>
    </motion.div>
  );
}

function AgenticPaperCard({
  paper,
  deleting,
  retryingPaperId,
  onDelete,
  onRetry,
}: {
  paper: AgenticSearchPaper;
  deleting: string | null;
  retryingPaperId: string | null;
  onDelete: (id: string, title: string) => void;
  onRetry: (id: string) => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/papers/${paper.shortId}`, { state: { from: '/search' } });
  };

  return (
    <motion.div
      variants={cardVariants}
      layout
      className="group relative flex flex-col rounded-xl border border-blue-100 bg-white p-4"
      whileHover={{
        scale: 1.02,
        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.15)',
        borderColor: 'rgba(59, 130, 246, 0.4)',
      }}
    >
      {paper.processingStatus === 'failed' && (
        <motion.button
          onClick={(e) => {
            e.stopPropagation();
            onRetry(paper.id);
          }}
          disabled={retryingPaperId === paper.id}
          className="absolute right-10 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-amber-100 hover:text-amber-700 group-hover:opacity-100 disabled:opacity-100"
          title="Retry processing"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {retryingPaperId === paper.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
        </motion.button>
      )}
      <motion.button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(paper.id, paper.title);
        }}
        disabled={deleting === paper.id}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
        title="Delete paper"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        {deleting === paper.id ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </motion.button>

      <button onClick={handleClick} className="flex flex-col items-start gap-2 text-left">
        <motion.div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50"
          whileHover={{ rotate: 5 }}
        >
          <Sparkles size={18} className="text-blue-500" />
        </motion.div>

        <h3 className="line-clamp-2 text-sm font-medium text-notion-text">
          {cleanArxivTitle(paper.title)}
        </h3>

        {paper.relevanceReason && (
          <p className="text-xs text-blue-600 line-clamp-1">{paper.relevanceReason}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {paper.submittedAt && (
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs text-notion-text-secondary">
              {new Date(paper.submittedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </span>
          )}
          <ProcessingBadge status={paper.processingStatus} />
          {paper.tagNames
            ?.filter((t) => !EXCLUDED_TAGS.includes(t.toLowerCase()))
            .slice(0, 3)
            .map((tag) => {
              const style = getTagStyle('topic'); // fallback to topic color
              return (
                <motion.span
                  key={tag}
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                  whileHover={{ scale: 1.05 }}
                >
                  {tag}
                </motion.span>
              );
            })}
        </div>
      </button>
    </motion.div>
  );
}
