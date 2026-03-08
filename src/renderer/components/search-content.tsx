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
} from '../hooks/use-ipc';
import { FileText, Search, Loader2, Trash2, X, Sparkles } from 'lucide-react';
import { cleanArxivTitle, getTagStyle } from '@shared';

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

type SearchMode = 'normal' | 'agentic';

// Fuse.js config for fuzzy search across title, tags, abstract
const FUSE_OPTIONS: IFuseOptions<PaperItem> = {
  keys: [
    { name: 'title', weight: 0.6 },
    { name: 'tagNames', weight: 0.3 },
    { name: 'abstract', weight: 0.1 },
  ],
  threshold: 0.4,
  minMatchCharLength: 2,
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

export function SearchContent() {
  const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [agenticPapers, setAgenticPapers] = useState<AgenticSearchPaper[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('normal');
  const [agenticSteps, setAgenticSteps] = useState<AgenticSearchStep[]>([]);
  const [agenticError, setAgenticError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fuseRef = useRef<Fuse<PaperItem> | null>(null);
  const navigate = useNavigate();

  // Load all papers once on mount for fuzzy search
  useEffect(() => {
    ipc
      .listPapers()
      .then((data) => {
        setAllPapers(data);
        fuseRef.current = new Fuse(data, FUSE_OPTIONS);
      })
      .catch(() => {});
  }, []);

  const doNormalSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setHasSearched(false);
        setPapers([]);
        return;
      }
      setHasSearched(true);
      if (!fuseRef.current) {
        // Fuse not ready yet, fall back to simple includes
        const lq = q.toLowerCase();
        setPapers(
          allPapers.filter(
            (p) =>
              p.title.toLowerCase().includes(lq) ||
              p.tagNames?.some((t) => t.toLowerCase().includes(lq)),
          ),
        );
        return;
      }
      setPapers(fuseTokenSearch(fuseRef.current, q));
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

  const doSearch = useCallback(
    (q: string) => {
      if (searchMode === 'agentic') {
        void doAgenticSearch(q);
      } else {
        doNormalSearch(q);
      }
    },
    [searchMode, doAgenticSearch, doNormalSearch],
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
    if (e.key === 'Enter') {
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
    inputRef.current?.focus();
  };

  const handleSearchModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setHasSearched(false);
    setPapers([]);
    setAgenticPapers([]);
    setAgenticSteps([]);
    setAgenticError(null);
    setQuery('');
  };

  const displayPapers = searchMode === 'agentic' ? agenticPapers : papers;

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
          <AnimatePresence>
            {!hasSearched && (
              <motion.p
                variants={titleVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="mb-6 text-center text-2xl font-semibold text-notion-text"
              >
                What are you reading today?
              </motion.p>
            )}
          </AnimatePresence>

          {/* Search box */}
          <motion.div
            className={`rounded-2xl border bg-white shadow-notion-hover transition-all focus-within:shadow-lg ${
              searchMode === 'agentic' ? 'border-purple-200' : 'border-notion-border'
            }`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 24 }}
          >
            <div className="flex items-center gap-3 px-5 py-4">
              {searchMode === 'agentic' ? (
                <Sparkles size={18} className="flex-shrink-0 text-purple-500" />
              ) : (
                <Search size={18} className="flex-shrink-0 text-notion-text-tertiary" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  searchMode === 'agentic'
                    ? 'Describe what you are looking for...'
                    : 'Fuzzy search by title, tag, or abstract…'
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
                      searchMode === 'agentic' ? 'text-purple-500' : 'text-notion-text-tertiary'
                    }`}
                  />
                </motion.div>
              )}
              <motion.button
                onClick={handleSearch}
                disabled={!query.trim() || loading}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40 ${
                  searchMode === 'agentic' ? 'bg-purple-600' : 'bg-notion-text'
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
                  left: searchMode === 'agentic' ? '50%' : '4px',
                  right: searchMode === 'agentic' ? '4px' : '50%',
                }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
              />
              <button
                onClick={() => handleSearchModeChange('normal')}
                className={`relative z-10 w-24 rounded-full py-1 text-sm font-medium transition-colors ${
                  searchMode === 'normal'
                    ? 'text-notion-text'
                    : 'text-notion-text-tertiary hover:text-notion-text-secondary'
                }`}
              >
                Normal
              </button>
              <button
                onClick={() => handleSearchModeChange('agentic')}
                className={`relative z-10 flex w-24 items-center justify-center gap-1 rounded-full py-1 text-sm font-medium transition-colors ${
                  searchMode === 'agentic'
                    ? 'text-purple-600'
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

          {/* Agentic search steps - real-time AI thinking process */}
          <AnimatePresence>
            {searchMode === 'agentic' && (agenticSteps.length > 0 || loading) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 rounded-xl border border-purple-100 bg-purple-50 p-3"
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
                                className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-purple-600"
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
                      className="flex items-center gap-2 text-sm text-purple-500"
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
                              onDelete={handleDelete}
                            />
                          ))
                        : papers.map((paper) => (
                            <PaperCard
                              key={paper.id}
                              paper={paper}
                              deleting={deleting}
                              onDelete={handleDelete}
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
                        : 'Try different keywords'}
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
  onDelete,
}: {
  paper: PaperItem;
  deleting: string | null;
  onDelete: (id: string, title: string) => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/papers/${paper.shortId}`);
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
          {paper.year && (
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs text-notion-text-secondary">
              {paper.year}
            </span>
          )}
          {paper.tagNames
            ?.filter((t) => !EXCLUDED_TAGS.includes(t.toLowerCase()))
            .slice(0, 3)
            .map((tag) => {
              const style = getTagStyle(tag);
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
  onDelete,
}: {
  paper: AgenticSearchPaper;
  deleting: string | null;
  onDelete: (id: string, title: string) => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/papers/${paper.shortId}`);
  };

  return (
    <motion.div
      variants={cardVariants}
      layout
      className="group relative flex flex-col rounded-xl border border-purple-100 bg-white p-4"
      whileHover={{
        scale: 1.02,
        boxShadow: '0 4px 12px rgba(139, 92, 246, 0.15)',
        borderColor: 'rgba(139, 92, 246, 0.4)',
      }}
    >
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
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50"
          whileHover={{ rotate: 5 }}
        >
          <Sparkles size={18} className="text-purple-500" />
        </motion.div>

        <h3 className="line-clamp-2 text-sm font-medium text-notion-text">
          {cleanArxivTitle(paper.title)}
        </h3>

        {paper.relevanceReason && (
          <p className="text-xs text-purple-600 line-clamp-1">{paper.relevanceReason}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {paper.year && (
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs text-notion-text-secondary">
              {paper.year}
            </span>
          )}
          {paper.tagNames
            ?.filter((t) => !EXCLUDED_TAGS.includes(t.toLowerCase()))
            .slice(0, 3)
            .map((tag) => {
              const style = getTagStyle(tag);
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
