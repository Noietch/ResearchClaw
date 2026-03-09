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
  History,
  Trash2,
  X,
  Send,
  MessageCircle,
  User,
  Bot,
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
  savedId: string | null;
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
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ComparisonNoteItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);

  // Translation state
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatStreamingText, setChatStreamingText] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
        if (item.chatMessages && item.chatMessages.length > 0) {
          setChatMessages(item.chatMessages);
        }
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
      if (status.message) setStatusMessage(status.message);
      if (status.error) setError(status.error);
      if (status.savedId) setCurrentSavedId(status.savedId);
    });
    return unsub;
  }, [jobId]);

  // Subscribe to translation status
  useEffect(() => {
    const unsub = onIpc('comparison:translateStatus', (_event: unknown, payload: unknown) => {
      const status = payload as {
        jobId: string;
        comparisonId: string;
        active: boolean;
        stage: string;
        partialText: string;
        error: string | null;
      };
      if (!status?.comparisonId || status.comparisonId !== currentSavedId) return;
      setTranslatedText(status.partialText || null);
      setTranslating(status.active);
      if (status.error) setTranslationError(status.error);
      if (status.stage === 'done') setTranslating(false);
    });
    return unsub;
  }, [currentSavedId]);

  // Subscribe to chat status
  useEffect(() => {
    const unsub = onIpc('comparison:chatStatus', (_event: unknown, payload: unknown) => {
      const status = payload as {
        comparisonId: string;
        active: boolean;
        stage: string;
        partialText: string;
        error: string | null;
      };
      if (!status?.comparisonId || status.comparisonId !== currentSavedId) return;
      setChatStreamingText(status.partialText || '');
      setChatStreaming(status.active);
      if (status.error) setChatError(status.error);
      if (status.stage === 'done' && status.partialText) {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: status.partialText }]);
        setChatStreamingText('');
        setChatStreaming(false);
      }
    });
    return unsub;
  }, [currentSavedId]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatStreamingText]);

  // Recover translation on mount: check active jobs first, then fall back to DB cache
  useEffect(() => {
    if (!currentSavedId) return;
    let cancelled = false;
    void (async () => {
      try {
        // Check if there's an active translation job in memory
        const jobs = await ipc.getActiveTranslationJobs();
        if (cancelled) return;
        const match = jobs.find((j) => j.comparisonId === currentSavedId);
        if (match) {
          setTranslatedText(match.partialText || null);
          setTranslating(match.active);
          if (match.error) setTranslationError(match.error);
          return;
        }
        // No active job — load cached translation from DB
        const items = await ipc.listComparisons();
        if (cancelled) return;
        const item = items.find((i) => i.id === currentSavedId);
        if (item?.translatedContentMd) {
          setTranslatedText(item.translatedContentMd);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSavedId]);

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
          if (match.message) setStatusMessage(match.message);
          if (match.error) setError(match.error);
          if (match.savedId) setCurrentSavedId(match.savedId);
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
    setStatusMessage('');
    setStage('preparing');
    setCurrentSavedId(null);
    try {
      const sessionId = `comparison-${Date.now()}`;
      const result = await ipc.startComparison({ sessionId, paperIds });
      setJobId(result.jobId);
      if (result.savedId) setCurrentSavedId(result.savedId);
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
    setStatusMessage('');
    setError(null);
    setCurrentSavedId(null);
    setTranslatedText(null);
    setTranslating(false);
    setTranslationError(null);
    setLang('en');
    setChatMessages([]);
    setChatInput('');
    setChatStreaming(false);
    setChatStreamingText('');
    setChatError(null);
    void startComparison();
  }, [startComparison]);

  const handleCopy = useCallback(async () => {
    const textToCopy = lang === 'zh' && translatedText ? translatedText : partialText;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [partialText, translatedText, lang]);

  const handleTranslate = useCallback(async () => {
    if (!currentSavedId) return;
    setTranslationError(null);
    setTranslating(true);
    setTranslatedText('');
    try {
      await ipc.translateComparison({ comparisonId: currentSavedId });
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : 'Translation failed');
      setTranslating(false);
    }
  }, [currentSavedId]);

  const handleLangToggle = useCallback(
    (target: 'en' | 'zh') => {
      setLang(target);
      if (target === 'zh' && !translatedText && !translating && currentSavedId) {
        void handleTranslate();
      }
    },
    [translatedText, translating, currentSavedId, handleTranslate],
  );

  // Chat handlers
  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !currentSavedId || chatStreaming) return;
    setChatError(null);
    const userMsg = { role: 'user' as const, content: text };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput('');
    setChatStreaming(true);
    setChatStreamingText('');
    try {
      await ipc.startComparisonChat({ comparisonId: currentSavedId, messages: newMessages });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Chat failed');
      setChatStreaming(false);
    }
  }, [chatInput, currentSavedId, chatStreaming, chatMessages]);

  const handleChatStop = useCallback(async () => {
    if (currentSavedId) {
      await ipc.killComparisonChat(currentSavedId).catch(() => undefined);
    }
  }, [currentSavedId]);

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
            {/* Language toggle */}
            {(isDone || translatedText) && (
              <div className="flex items-center rounded-lg border border-notion-border bg-notion-sidebar p-0.5">
                <button
                  onClick={() => handleLangToggle('en')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    lang === 'en'
                      ? 'bg-white text-notion-text shadow-sm'
                      : 'text-notion-text-tertiary hover:text-notion-text-secondary'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => handleLangToggle('zh')}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    lang === 'zh'
                      ? 'bg-white text-notion-text shadow-sm'
                      : 'text-notion-text-tertiary hover:text-notion-text-secondary'
                  }`}
                >
                  {translating && <Loader2 size={10} className="animate-spin" />}
                  中文
                </button>
              </div>
            )}
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
                {/* Streaming indicator */}
                {isStreaming && !partialText && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-xl border border-notion-accent/20 bg-notion-accent-light px-5 py-4"
                  >
                    <Loader2 size={16} className="animate-spin text-notion-accent" />
                    <div>
                      <p className="text-sm font-medium text-notion-text">
                        {stage === 'preparing'
                          ? 'Preparing comparison…'
                          : 'Generating comparative analysis…'}
                      </p>
                      {statusMessage && (
                        <p className="mt-0.5 text-xs text-notion-text-secondary">{statusMessage}</p>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Markdown content */}
                {partialText && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    {isStreaming && (
                      <div className="mb-4 flex items-center gap-2 text-xs text-notion-accent">
                        <Loader2 size={12} className="animate-spin" />
                        <span>Writing analysis…</span>
                      </div>
                    )}
                    {lang === 'zh' && translating && !translatedText && (
                      <div className="mb-4 flex items-center gap-2 text-xs text-notion-accent">
                        <Loader2 size={12} className="animate-spin" />
                        <span>Translating to Chinese…</span>
                      </div>
                    )}
                    {translationError && lang === 'zh' && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {translationError}
                      </div>
                    )}
                    <MarkdownContent
                      content={lang === 'zh' && translatedText ? translatedText : partialText}
                      className="comparison-article"
                      proseClassName="max-w-none break-words"
                    />
                  </motion.div>
                )}
              </div>
            )}

            {/* Chat section — visible after comparison is done */}
            {isDone && currentSavedId && partialText && (
              <div className="mt-8 space-y-4">
                <div className="flex items-center gap-2 border-t border-notion-border pt-6">
                  <MessageCircle size={16} className="text-notion-accent" />
                  <h2 className="text-sm font-medium text-notion-text">Discuss this comparison</h2>
                </div>

                {/* Chat messages */}
                {chatMessages.length > 0 && (
                  <div className="space-y-3">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-notion-accent-light">
                            <Bot size={14} className="text-notion-accent" />
                          </div>
                        )}
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-notion-accent text-white'
                              : 'border border-notion-border bg-white'
                          }`}
                        >
                          {msg.role === 'assistant' ? (
                            <MarkdownContent
                              content={msg.content}
                              className="chat-message"
                              proseClassName="max-w-none text-sm"
                            />
                          ) : (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          )}
                        </div>
                        {msg.role === 'user' && (
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-notion-sidebar">
                            <User size={14} className="text-notion-text-tertiary" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Streaming assistant response */}
                {chatStreaming && chatStreamingText && (
                  <div className="flex gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-notion-accent-light">
                      <Bot size={14} className="text-notion-accent" />
                    </div>
                    <div className="max-w-[80%] rounded-lg border border-notion-accent/20 bg-white px-4 py-3 text-sm leading-relaxed">
                      <MarkdownContent
                        content={chatStreamingText}
                        className="chat-message"
                        proseClassName="max-w-none text-sm"
                      />
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-notion-accent">
                        <Loader2 size={10} className="animate-spin" />
                        <span>Writing…</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Streaming indicator when no text yet */}
                {chatStreaming && !chatStreamingText && (
                  <div className="flex gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-notion-accent-light">
                      <Bot size={14} className="text-notion-accent" />
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-notion-accent/20 bg-white px-4 py-3 text-sm text-notion-text-secondary">
                      <Loader2 size={12} className="animate-spin text-notion-accent" />
                      Thinking…
                    </div>
                  </div>
                )}

                {/* Chat error */}
                {chatError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {chatError}
                  </div>
                )}

                <div ref={chatEndRef} />

                {/* Chat input */}
                <div className="flex items-end gap-2">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleChatSend();
                      }
                    }}
                    placeholder="Ask about this comparison… (⌘+Enter to send)"
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-notion-border bg-white px-4 py-3 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-notion-accent/50 focus:outline-none focus:ring-1 focus:ring-notion-accent/20 transition-colors"
                  />
                  {chatStreaming ? (
                    <button
                      onClick={handleChatStop}
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Square size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleChatSend()}
                      disabled={!chatInput.trim()}
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-notion-accent text-white transition-colors hover:bg-notion-accent/90 disabled:opacity-50"
                    >
                      <Send size={16} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
