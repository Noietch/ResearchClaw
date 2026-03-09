import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ipc, type PaperItem, onIpc } from '../../hooks/use-ipc';
import { MarkdownContent } from '../../components/markdown-content';
import { cleanArxivTitle } from '@shared';
import type { ComparisonNoteItem } from '@shared';
import {
  ArrowLeft,
  Loader2,
  Square,
  Copy,
  Check,
  RotateCcw,
  FileText,
  Calendar,
  Users,
  GitCompareArrows,
  Save,
  History,
  Trash2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ComparisonStatus {
  jobId: string;
  paperIds: string[];
  active: boolean;
  stage: 'preparing' | 'streaming' | 'done' | 'error' | 'cancelled';
  partialText: string;
  message: string;
  error: string | null;
}

export function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawIds = searchParams.get('ids') ?? '';
  const savedId = searchParams.get('saved') ?? '';
  const paperIds = useMemo(
    () =>
      rawIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [rawIds],
  );

  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<ComparisonStatus['stage'] | null>(null);
  const [partialText, setPartialText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ComparisonNoteItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Keep jobIdRef in sync
  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  // Load saved comparison if ?saved=id
  useEffect(() => {
    if (!savedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const items = await ipc.listComparisons();
        const item = items.find((i) => i.id === savedId);
        if (!item || cancelled) return;
        setCurrentSavedId(item.id);
        setPartialText(item.contentMd);
        setStage('done');
        setSaved(true);
        // Load paper details
        const results = await Promise.all(item.paperIds.map((id) => ipc.getPaper(id)));
        if (!cancelled) {
          setPapers(results);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load saved comparison');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [savedId]);

  // Load papers (for new comparisons via ?ids=)
  useEffect(() => {
    if (savedId || paperIds.length < 2) return;
    let cancelled = false;
    void (async () => {
      try {
        const results = await Promise.all(paperIds.map((id) => ipc.getPaper(id)));
        if (!cancelled) setPapers(results);
      } catch {
        if (!cancelled) setError('Failed to load papers');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperIds.join(','), savedId]);

  // Subscribe to comparison status
  useEffect(() => {
    const unsub = onIpc('comparison:status', (_event: unknown, payload: unknown) => {
      const status = payload as ComparisonStatus;
      if (!status?.jobId) return;
      if (status.jobId !== jobId && jobId !== null) return;
      if (jobId === null) setJobId(status.jobId);
      setStage(status.stage);
      setPartialText(status.partialText);
      if (status.error) setError(status.error);
    });
    return unsub;
  }, [jobId]);

  // Recover existing job on mount (e.g. when navigating back to the page)
  useEffect(() => {
    if (savedId || startedRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const jobs = await ipc.getActiveComparisonJobs();
        if (cancelled) return;
        // Find a job matching current paperIds (active or recently completed)
        const sortedIds = [...paperIds].sort().join(',');
        const match = jobs.find((job) => [...job.paperIds].sort().join(',') === sortedIds);
        if (match) {
          startedRef.current = true;
          setJobId(match.jobId);
          setStage(match.stage);
          setPartialText(match.partialText);
          if (match.error) setError(match.error);
        }
      } catch {
        // ignore — will fall through to auto-start
      } finally {
        if (!cancelled) setRecoveryDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperIds.join(','), savedId]);

  // Start comparison
  const startComparison = useCallback(async () => {
    setError(null);
    setPartialText('');
    setStage('preparing');
    setCurrentSavedId(null);
    setSaved(false);
    try {
      const sessionId = `comparison-${Date.now()}`;
      const result = await ipc.startComparison({ sessionId, paperIds });
      setJobId(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start comparison');
      setStage('error');
    }
  }, [paperIds]);

  // Auto-start on mount (only for new comparisons, not saved ones, after recovery check)
  useEffect(() => {
    if (!loading && recoveryDone && papers.length >= 2 && !startedRef.current && !savedId) {
      startedRef.current = true;
      void startComparison();
    }
  }, [loading, recoveryDone, papers.length, startComparison, savedId]);

  const handleStop = useCallback(async () => {
    if (jobId) {
      await ipc.killComparison(jobId).catch(() => undefined);
    }
  }, [jobId]);

  const handleRegenerate = useCallback(() => {
    startedRef.current = false;
    setJobId(null);
    setStage(null);
    setPartialText('');
    setError(null);
    setCurrentSavedId(null);
    setSaved(false);
    void startComparison();
  }, [startComparison]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(partialText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [partialText]);

  // Save comparison
  const handleSave = useCallback(async () => {
    if (!partialText || saving) return;
    setSaving(true);
    try {
      const activePaperIds = papers.map((p) => p.id);
      const titles = papers.map((p) => cleanArxivTitle(p.title));
      const result = await ipc.saveComparison({
        paperIds: activePaperIds,
        titles,
        contentMd: partialText,
      });
      setCurrentSavedId(result.id);
      setSaved(true);
      // Update URL to reflect saved state
      setSearchParams({ saved: result.id }, { replace: true });
    } catch {
      setError('Failed to save comparison');
    } finally {
      setSaving(false);
    }
  }, [partialText, papers, saving, setSearchParams]);

  // Load history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const items = await ipc.listComparisons();
      setHistory(items);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleToggleHistory = useCallback(() => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) void loadHistory();
  }, [showHistory, loadHistory]);

  const handleLoadSaved = useCallback(
    (item: ComparisonNoteItem) => {
      setSearchParams({ saved: item.id }, { replace: true });
    },
    [setSearchParams],
  );

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      try {
        await ipc.deleteComparison(id);
        setHistory((prev) => prev.filter((i) => i.id !== id));
        if (currentSavedId === id) {
          setCurrentSavedId(null);
          setSaved(false);
        }
      } catch {
        // ignore
      }
    },
    [currentSavedId],
  );

  // Determine active paper IDs for display
  const activePaperIds = savedId ? papers.map((p) => p.id) : paperIds;

  if (activePaperIds.length < 2 && !savedId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <GitCompareArrows size={40} className="mx-auto mb-3 text-notion-text-tertiary" />
          <p className="text-sm font-medium text-notion-text">No papers selected for comparison</p>
          <p className="mt-1 text-xs text-notion-text-tertiary">
            Select 2-3 papers from the Library to compare.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 rounded-lg bg-notion-accent px-4 py-2 text-sm font-medium text-white"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const isStreaming = stage === 'preparing' || stage === 'streaming';
  const isDone = stage === 'done' || stage === 'cancelled';

  return (
    <div className="flex h-full">
      {/* History sidebar */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex h-full flex-shrink-0 flex-col border-r border-notion-border bg-notion-sidebar overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-notion-border">
              <h3 className="text-sm font-medium text-notion-text">History</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-notion-sidebar-hover"
              >
                <X size={14} className="text-notion-text-tertiary" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-notion-text-tertiary" />
                </div>
              ) : history.length === 0 ? (
                <div className="py-8 text-center text-xs text-notion-text-tertiary">
                  No saved comparisons yet
                </div>
              ) : (
                <div className="space-y-1">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className={`group relative cursor-pointer rounded-lg px-3 py-2.5 transition-colors ${
                        currentSavedId === item.id
                          ? 'bg-notion-accent-light border border-notion-accent/30'
                          : 'hover:bg-notion-sidebar-hover border border-transparent'
                      }`}
                      onClick={() => handleLoadSaved(item)}
                    >
                      <p className="text-xs font-medium text-notion-text line-clamp-2">
                        {item.titles.join(' vs ')}
                      </p>
                      <p className="mt-1 text-[10px] text-notion-text-tertiary">
                        {new Date(item.createdAt).toLocaleDateString()} · {item.paperIds.length}{' '}
                        papers
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteSaved(item.id);
                        }}
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-8 py-5">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <GitCompareArrows size={20} className="text-notion-accent" />
            <h1 className="text-xl font-bold tracking-tight text-notion-text">Paper Comparison</h1>
          </div>
          <div className="flex-1" />
          {/* Action buttons in header */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleHistory}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                showHistory
                  ? 'border-notion-accent/30 bg-notion-accent-light text-notion-accent'
                  : 'border-notion-border text-notion-text-secondary hover:bg-notion-sidebar'
              }`}
            >
              <History size={14} />
              History
            </button>
            {isStreaming && (
              <button
                onClick={handleStop}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                <Square size={14} />
                Stop
              </button>
            )}
            {isDone && (
              <>
                {!saved && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-notion-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-notion-accent/90 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                )}
                {saved && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700">
                    <Check size={14} />
                    Saved
                  </span>
                )}
                <button
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  <RotateCcw size={14} />
                  Regenerate
                </button>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-4xl space-y-6">
            {/* Paper cards */}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-notion-text-secondary">
                <Loader2 size={16} className="animate-spin" />
                Loading papers…
              </div>
            ) : (
              <div className={`grid gap-4 ${papers.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {papers.map((paper, i) => (
                  <motion.div
                    key={paper.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.05 }}
                    className="group rounded-lg border border-notion-border bg-white p-5 shadow-notion transition-colors hover:border-notion-accent/30 hover:bg-notion-accent-light"
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-notion-accent-light">
                        <FileText size={14} className="text-notion-accent" />
                      </div>
                      <span className="rounded-full bg-notion-sidebar px-2 py-0.5 text-[10px] font-medium text-notion-text-tertiary uppercase tracking-wider">
                        Paper {i + 1}
                      </span>
                    </div>
                    <h3
                      className="cursor-pointer text-sm font-semibold leading-snug text-notion-text line-clamp-2 hover:text-notion-accent"
                      onClick={() => navigate(`/papers/${paper.shortId}`)}
                    >
                      {cleanArxivTitle(paper.title)}
                    </h3>
                    {paper.authors && paper.authors.length > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-notion-text-tertiary">
                        <Users size={11} />
                        <span className="truncate">{paper.authors.slice(0, 3).join(', ')}</span>
                      </div>
                    )}
                    {paper.submittedAt && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-notion-text-tertiary">
                        <Calendar size={11} />
                        <span>{new Date(paper.submittedAt).getFullYear()}</span>
                      </div>
                    )}
                    {paper.abstract && (
                      <p className="mt-3 text-xs leading-relaxed text-notion-text-secondary line-clamp-3">
                        {paper.abstract}
                      </p>
                    )}
                    {paper.categorizedTags && paper.categorizedTags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {paper.categorizedTags.slice(0, 4).map((tag) => (
                          <span
                            key={tag.name}
                            className="rounded-full bg-notion-tag-blue px-2 py-0.5 text-[10px] text-notion-text-secondary"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Analysis */}
            {(isStreaming || isDone || partialText) && (
              <div className="space-y-4">
                {/* Section header */}
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-notion-border" />
                  <span className="text-xs font-medium uppercase tracking-wider text-notion-text-tertiary">
                    Comparative Analysis
                  </span>
                  <div className="h-px flex-1 bg-notion-border" />
                </div>

                {/* Streaming indicator */}
                {isStreaming && !partialText && (
                  <div className="flex items-center gap-2 rounded-lg border border-notion-border bg-notion-sidebar px-4 py-3 text-sm text-notion-text-secondary">
                    <Loader2 size={14} className="animate-spin text-notion-accent" />
                    {stage === 'preparing'
                      ? 'Reading papers and preparing comparison…'
                      : 'Generating comparative analysis…'}
                  </div>
                )}

                {/* Markdown content */}
                {partialText && (
                  <div className="rounded-lg border border-notion-border bg-white p-6 shadow-notion">
                    <MarkdownContent content={partialText} />
                    {isStreaming && (
                      <div className="mt-4 flex items-center gap-2 border-t border-notion-border pt-3 text-xs text-notion-text-tertiary">
                        <Loader2 size={12} className="animate-spin" />
                        Generating…
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
