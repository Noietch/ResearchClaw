import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, useBlocker } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import { PdfViewer } from '../../../components/pdf-viewer';
import { ipc, onIpc, type PaperItem, type ModelConfig } from '../../../hooks/use-ipc';
import { useAgentStream } from '../../../hooks/use-agent-stream';
import { MessageStream } from '../../../components/agent-todo/MessageStream';
import { AgentLogo } from '../../../components/agent-todo/AgentLogo';
import { arxivPdfUrl } from '@shared';
import {
  ArrowLeft,
  Loader2,
  GripVertical,
  Download,
  ArrowUp,
  Square,
  Plus,
  Star,
  ChevronDown,
  Columns2,
  FileText,
  MessageSquare,
  Search,
  X,
} from 'lucide-react';
import type { AgentConfigItem } from '@shared';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Star Rating ──────────────────────────────────────────────────────────────

function StarRating({
  rating,
  onChange,
  size = 20,
}: {
  rating: number | null;
  onChange: (rating: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const displayValue = hover ?? rating ?? 0;

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          className="p-0.5 transition-transform hover:scale-110"
        >
          <Star
            size={size}
            fill={star <= displayValue ? '#f59e0b' : 'transparent'}
            stroke={star <= displayValue ? '#d97706' : '#d1d5db'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Rating Prompt Modal ─────────────────────────────────────────────────────

function RatingPromptModal({
  isOpen,
  onRate,
  onSkip,
}: {
  isOpen: boolean;
  onRate: (rating: number) => void;
  onSkip: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onSkip]);

  const handleRate = () => {
    if (rating) {
      onRate(rating);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="w-72 rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-center text-lg font-semibold text-notion-text">Rate this paper</h3>
            <div className="mt-5 flex justify-center">
              <StarRating rating={rating} onChange={setRating} size={28} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={onSkip}
                className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
              >
                Skip
              </button>
              <button
                onClick={handleRate}
                disabled={!rating}
                className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-30"
              >
                Rate
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferPdfUrl(paper: PaperItem): string | null {
  if (paper.pdfUrl) return paper.pdfUrl;
  if (paper.sourceUrl) {
    const m = paper.sourceUrl.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/i);
    if (m) return arxivPdfUrl(m[1]);
  }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.shortId)) {
    return arxivPdfUrl(paper.shortId);
  }
  return null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReaderPage() {
  const { id: shortId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { updateTabLabel } = useTabs();

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);

  // Layout mode: 'split' = chat+pdf side by side, 'chat-only' = chat full, 'pdf-only' = pdf full
  const [layoutMode, setLayoutMode] = useState<'split' | 'chat-only' | 'pdf-only'>('pdf-only');
  const [leftWidth, setLeftWidth] = useState(38);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(38);

  // Chat input state
  const [chatInput, setChatInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState<ModelConfig | null>(null);
  const [allAgents, setAllAgents] = useState<AgentConfigItem[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  // Attached papers for comparison context
  const [attachedPapers, setAttachedPapers] = useState<PaperItem[]>([]);
  const [showPaperPicker, setShowPaperPicker] = useState(false);
  const [paperSearch, setPaperSearch] = useState('');
  const [paperSearchResults, setPaperSearchResults] = useState<PaperItem[]>([]);
  const paperPickerRef = useRef<HTMLDivElement>(null);

  // Agent mode state
  const [agentTodoId, setAgentTodoId] = useState<string | null>(null);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const agentRunIdRef = useRef<string | null>(null);
  // Synchronous ref updated immediately in handleChatSend before runAgentTodo,
  // so IPC stream callbacks see the correct todoId without waiting for React re-render.
  const agentTodoIdRef = useRef<string>('');

  // Persisted messages loaded from DB when restoring a previous chat session
  const [historicMessages, setHistoricMessages] = useState<
    {
      id: string;
      msgId: string;
      type: string;
      role: string;
      content: unknown;
      status: string | null;
      toolCallId?: string | null;
      toolName?: string | null;
      createdAt: string;
    }[]
  >([]);

  // Local user messages injected before the agent stream arrives
  const [localUserMessages, setLocalUserMessages] = useState<
    { id: string; msgId: string; type: string; role: string; content: unknown; status: null }[]
  >([]);

  // Agent stream (uses MessageStream, same as task detail page)
  const {
    messages: agentMessages,
    status: agentStatus,
    permissionRequest: agentPermissionRequest,
    setPermissionRequest: setAgentPermissionRequest,
  } = useAgentStream(agentTodoId ?? '', agentTodoIdRef);
  const agentRunning = agentStatus === 'running' || agentStatus === 'initializing';

  // Use live stream messages if available, otherwise fall back to historic messages
  const streamBased = agentMessages.length > 0 ? agentMessages : historicMessages;
  // Show local user messages only until the stream has its own user messages
  const streamHasUserMessages = streamBased.some((m) => m.role === 'user');
  const displayMessages = streamHasUserMessages
    ? streamBased
    : localUserMessages.length > 0
      ? [...localUserMessages, ...streamBased]
      : streamBased;

  // Rating
  const [rating, setRating] = useState<number | null>(null);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);

  const MIN_WIDTH = 20;
  const MAX_WIDTH = 60;
  const activePanel = searchParams.get('panel');

  useEffect(() => {
    if (activePanel === 'chat') {
      setLayoutMode('split');
    }
  }, [activePanel]);

  // Subscribe to PDF download progress events
  useEffect(() => {
    if (!paper) return;
    return onIpc('papers:downloadProgress', (...args) => {
      const payload = args[0] as { paperId: string; downloaded: number; total: number };
      if (payload.paperId === paper.id) {
        setDownloadProgress({ downloaded: payload.downloaded, total: payload.total });
      }
    });
  }, [paper?.id]);

  // Load all CLI agents for picker; default to first enabled one
  useEffect(() => {
    ipc
      .listAgents()
      .then((agents) => {
        const enabled = agents.filter((a) => a.enabled);
        setAllAgents(enabled);
        if (enabled.length > 0) {
          const first = enabled[0];
          setChatModel({
            id: first.id,
            name: first.name,
            backend: 'cli',
            agentTool: first.agentTool,
          } as ModelConfig);
        }
      })
      .catch(() => undefined);
  }, []);

  // Close model picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close paper picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (paperPickerRef.current && !paperPickerRef.current.contains(e.target as Node)) {
        setShowPaperPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search papers for picker (debounced)
  useEffect(() => {
    if (!showPaperPicker) return;
    const timer = setTimeout(() => {
      ipc
        .listPapers({ q: paperSearch || undefined })
        .then((results) => {
          // Exclude the current paper from results
          setPaperSearchResults(results.filter((p) => p.id !== paper?.id).slice(0, 20));
        })
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [paperSearch, showPaperPicker, paper?.id]);

  // Load paper
  useEffect(() => {
    if (!shortId) return;

    Promise.all([ipc.getPaperByShortId(shortId), ipc.getSettings()])
      .then(([p, settings]) => {
        setPaper(p);
        setRating(p.rating ?? null);
        setPaperDir(`${settings.papersDir}/${p.shortId}`);
        const shortTitle = p.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, '').slice(0, 30) || p.shortId;
        updateTabLabel(location.pathname, shortTitle);
        ipc.touchPaper(p.id).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [shortId]);

  useEffect(() => {
    agentRunIdRef.current = agentRunId;
  }, [agentRunId]);

  // Restore previous chat session when paper loads
  useEffect(() => {
    if (!paper) return;
    const titlePrefix = `Chat: ${paper.title.slice(0, 60)}`;
    ipc
      .listAgentTodos()
      .then(async (todos) => {
        const match = todos
          .filter((t) => t.title === titlePrefix)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (!match) return;

        const runs = await ipc.listAgentTodoRuns(match.id);
        if (runs.length === 0) return;

        const latestRun = runs[0];
        agentTodoIdRef.current = match.id;
        setAgentTodoId(match.id);
        setAgentRunId(latestRun.id);
        agentRunIdRef.current = latestRun.id;

        // First check if the task is still actively running in main process
        const activeStatus = await ipc.getActiveAgentTodoStatus(match.id);
        if (
          activeStatus &&
          (activeStatus.status === 'running' ||
            activeStatus.status === 'initializing' ||
            activeStatus.status === 'waiting_permission')
        ) {
          // Task is still running - use live messages from runner
          // These messages are already accumulated correctly in the runner
          setHistoricMessages(
            activeStatus.messages.map((m) => ({
              ...m,
              content: typeof m.content === 'string' ? JSON.parse(m.content as string) : m.content,
              status: m.status ?? null,
            })),
          );
          return;
        }

        // Task completed/failed - load persisted messages from DB
        const msgs = await ipc.getAgentTodoRunMessages(latestRun.id);
        const parsed = msgs.map((m) => ({
          ...m,
          content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
        }));
        // Merge chunked messages (same logic as task detail page)
        const merged: typeof parsed = [];
        const seen = new Map<string, number>();
        for (const m of parsed) {
          const existing = seen.get(m.msgId);
          if (existing !== undefined && m.type === 'text') {
            const prev = merged[existing];
            const prevText = (prev.content as { text: string }).text;
            const newText = (m.content as { text: string }).text;
            merged[existing] = { ...prev, content: { text: prevText + newText } };
          } else if (existing !== undefined && m.type === 'tool_call') {
            const prev = merged[existing];
            const prevContent = prev.content as Record<string, unknown>;
            const newContent = m.content as Record<string, unknown>;
            const mergedContent: Record<string, unknown> = { ...prevContent };
            for (const [k, v] of Object.entries(newContent)) {
              if (v !== undefined && v !== null && v !== '') mergedContent[k] = v;
            }
            merged[existing] = { ...prev, status: m.status || prev.status, content: mergedContent };
          } else if (existing !== undefined && m.type === 'plan') {
            merged[existing] = m;
          } else {
            seen.set(m.msgId, merged.length);
            merged.push(m);
          }
        }
        setHistoricMessages(merged);
      })
      .catch(() => undefined);
  }, [paper?.id]);

  // Reset agent state for new chat
  const handleNewChat = useCallback(() => {
    setChatInput('');
    setAgentTodoId(null);
    setAgentRunId(null);
    setLocalUserMessages([]);
    setHistoricMessages([]);
    agentRunIdRef.current = null;
    agentTodoIdRef.current = '';
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || agentRunning || !paper || !chatModel) return;

    setChatInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Augment prompt with attached papers context
    let fullText = text;
    if (attachedPapers.length > 0) {
      const ctx = attachedPapers
        .map((p) => `Paper: "${p.title}"\nAbstract: ${p.abstract ?? 'N/A'}`)
        .join('\n\n');
      fullText = `${text}\n\n--- Attached Papers ---\n${ctx}`;
    }
    setAttachedPapers([]);

    const msgId = `local-user-${Date.now()}`;
    const userMsg = {
      id: msgId,
      msgId,
      type: 'text' as const,
      role: 'user' as const,
      content: { text },
      status: null,
    };
    setLocalUserMessages((prev) => [...prev, userMsg]);

    const cwd = paperDir ?? undefined;
    const agentId = chatModel.id;

    if (!agentTodoId) {
      // First message: create a new todo and run it.
      // Inject paper context with file paths so agent can directly access them
      const paperContext = [
        `当前文章: "${paper.title}"`,
        ...(cwd ? [`工作目录: ${cwd}`] : []),
        ...(cwd ? [`PDF路径: ${cwd}/paper.pdf`] : []),
        ...(cwd ? [`文本路径: ${cwd}/text.txt`] : []),
      ].join('\n');
      const promptWithContext = `${paperContext}\n\n---\n\n用户问题: ${fullText}`;

      // Update agentTodoIdRef synchronously BEFORE runAgentTodo so that
      // IPC stream callbacks see the correct todoId immediately, without
      // waiting for React to re-render with the new agentTodoId state.
      const todo = await ipc.createAgentTodo({
        title: `Chat: ${paper.title.slice(0, 60)}`,
        prompt: promptWithContext,
        cwd: cwd ?? '',
        agentId,
      });
      agentTodoIdRef.current = todo.id;
      setAgentTodoId(todo.id);
      const run = await ipc.runAgentTodo(todo.id);
      setAgentRunId(run.id);
      agentRunIdRef.current = run.id;
    } else {
      // Follow-up message: send to existing run
      const runId = agentRunIdRef.current;
      if (runId) {
        await ipc.sendAgentMessage(agentTodoId, runId, fullText);
      }
    }
  }, [chatInput, agentRunning, paper, chatModel, agentTodoId, paperDir, attachedPapers]);

  const handleChatKill = useCallback(async () => {
    if (agentTodoId) {
      await ipc.stopAgentTodo(agentTodoId);
    }
  }, [agentTodoId]);

  const handleDownloadPdf = useCallback(async () => {
    if (!paper) return;
    const pdfUrl = inferPdfUrl(paper);
    if (!pdfUrl) return;
    setDownloading(true);
    setDownloadProgress(null);
    try {
      const result = await ipc.downloadPdf(paper.id, pdfUrl);
      setPaper((prev) => (prev ? { ...prev, pdfPath: result.pdfPath } : prev));
    } catch {
      /* silent */
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }, [paper]);

  // Resizing
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - startXRef.current) / rect.width) * 100;
      setLeftWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + pct)));
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsDragging(true);
  };

  // Rating change handler
  const handleRatingChange = useCallback(
    async (newRating: number) => {
      if (!paper) return;
      setRating(newRating);
      try {
        await ipc.updatePaperRating(paper.id, newRating);
      } catch {
        /* ignore */
      }
    },
    [paper],
  );

  // Exit prompt logic - block navigation if paper has no rating
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false;
    if (rating !== null) return false;
    if (!paper) return false;

    const lastPromptKey = `rating-prompt-${paper.id}`;
    const lastPrompt = localStorage.getItem(lastPromptKey);
    if (lastPrompt) {
      const daysSincePrompt = (Date.now() - parseInt(lastPrompt, 10)) / (1000 * 60 * 60 * 24);
      if (daysSincePrompt < 7) return false;
    }

    return Math.random() < 0.1;
  });

  useEffect(() => {
    if (blocker.state === 'blocked' && paper) {
      setShowRatingPrompt(true);
      localStorage.setItem(`rating-prompt-${paper.id}`, Date.now().toString());
    }
  }, [blocker.state, paper]);

  const handleRatingPromptRate = useCallback(
    (r: number) => {
      handleRatingChange(r);
      setShowRatingPrompt(false);
      if (blocker.state === 'blocked') blocker.proceed();
    },
    [handleRatingChange, blocker],
  );

  const handleRatingPromptSkip = useCallback(() => {
    setShowRatingPrompt(false);
    if (blocker.state === 'blocked') blocker.proceed();
  }, [blocker]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-notion-border border-t-notion-text" />
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-notion-text-tertiary">
        Paper not found
      </div>
    );
  }

  const pdfPath = paper.pdfPath;
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="relative flex flex-shrink-0 items-center border-b border-notion-border px-4 py-2">
        {/* Left: back + star */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/papers/${paper.shortId}`)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="ml-1 flex items-center gap-1">
            <StarRating rating={rating} onChange={handleRatingChange} size={16} />
          </div>
        </div>

        {/* Center: layout toggle buttons (absolutely centered) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-0.5 rounded-lg border border-notion-border bg-notion-sidebar p-0.5">
            <button
              onClick={() => setLayoutMode('chat-only')}
              title="Chat only"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                layoutMode === 'chat-only'
                  ? 'bg-white text-notion-accent shadow-sm'
                  : 'text-notion-text-secondary hover:bg-white/60 hover:text-notion-text'
              }`}
            >
              <MessageSquare size={14} />
            </button>
            <button
              onClick={() => setLayoutMode('split')}
              title="Split view"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                layoutMode === 'split'
                  ? 'bg-white text-notion-accent shadow-sm'
                  : 'text-notion-text-secondary hover:bg-white/60 hover:text-notion-text'
              }`}
            >
              <Columns2 size={14} />
            </button>
            <button
              onClick={() => setLayoutMode('pdf-only')}
              title="PDF only"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                layoutMode === 'pdf-only'
                  ? 'bg-white text-notion-accent shadow-sm'
                  : 'text-notion-text-secondary hover:bg-white/60 hover:text-notion-text'
              }`}
            >
              <FileText size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Split pane */}
      <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        {layoutMode !== 'pdf-only' && (
          <div
            className="flex flex-col"
            style={{ width: layoutMode === 'chat-only' ? '100%' : `${leftWidth}%` }}
          >
            {/* Chat Header */}
            <div className="flex flex-shrink-0 items-center border-b border-notion-border px-4 py-2">
              <button
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
              >
                <Plus size={14} />
                New Chat
              </button>
            </div>

            {/* Messages */}
            <div className="notion-scrollbar flex-1 overflow-y-auto">
              {!agentTodoId &&
                (chatModel ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
                    <AgentLogo tool={chatModel.agentTool} size={24} />
                    <p className="text-sm font-medium text-notion-text-secondary">
                      {chatModel.name}
                    </p>
                    <p className="text-xs text-notion-text-tertiary">
                      Send a message to start the agent
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
                    <p className="text-xs text-notion-text-tertiary">
                      Select an agent above to chat about this paper
                    </p>
                  </div>
                ))}

              {/* Agent stream rendered with MessageStream (same as task detail page) */}
              {agentTodoId && (
                <MessageStream
                  messages={displayMessages}
                  todoId={agentTodoId}
                  status={agentStatus}
                  permissionRequest={agentPermissionRequest}
                  onPermissionResolved={() => setAgentPermissionRequest(null)}
                />
              )}
            </div>

            {/* Input */}
            <div className="flex-shrink-0 px-4 py-4">
              <div className="mx-auto w-full max-w-2xl">
                <div className="rounded-2xl border border-notion-border bg-white shadow-sm transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
                  {/* Attached paper chips */}
                  {attachedPapers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                      {attachedPapers.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 rounded-md bg-notion-accent-light px-2 py-0.5 text-xs text-notion-accent"
                        >
                          <FileText size={10} />
                          <span className="max-w-[160px] truncate">{p.title}</span>
                          <button
                            onClick={() =>
                              setAttachedPapers((prev) => prev.filter((a) => a.id !== p.id))
                            }
                            className="ml-0.5 rounded hover:text-red-400"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2 px-4 pt-3.5">
                    <textarea
                      ref={textareaRef}
                      value={chatInput}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleChatSend();
                        }
                      }}
                      placeholder={chatModel ? 'Ask anything\u2026' : 'Select an agent first\u2026'}
                      disabled={!chatModel}
                      rows={1}
                      className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-40"
                      style={{ minHeight: '52px', maxHeight: '160px' }}
                    />
                  </div>
                  {/* Bottom bar: agent picker + attach button + send button */}
                  <div className="flex items-center justify-between px-3 pb-3 pt-2">
                    {/* Left side: agent picker + attach button */}
                    <div className="flex items-center gap-1">
                      {/* Agent picker */}
                      <div ref={modelPickerRef} className="relative">
                        <button
                          onClick={() => setShowModelPicker((v) => !v)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                        >
                          {chatModel ? (
                            <>
                              <AgentLogo tool={chatModel.agentTool} size={13} />
                              <span className="max-w-[120px] truncate font-medium">
                                {chatModel.name}
                              </span>
                            </>
                          ) : (
                            <span className="text-notion-text-tertiary">Select agent…</span>
                          )}
                          <ChevronDown size={10} className="opacity-60" />
                        </button>

                        <AnimatePresence>
                          {showModelPicker && (
                            <motion.div
                              initial={{ opacity: 0, y: 4, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.97 }}
                              transition={{ duration: 0.1 }}
                              className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border border-notion-border bg-white py-1.5 shadow-lg"
                            >
                              {allAgents.length > 0 ? (
                                allAgents.map((agent) => (
                                  <button
                                    key={agent.id}
                                    onClick={() => {
                                      setChatModel({
                                        id: agent.id,
                                        name: agent.name,
                                        backend: 'cli',
                                        agentTool: agent.agentTool,
                                      } as ModelConfig);
                                      setShowModelPicker(false);
                                    }}
                                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-notion-accent-light ${
                                      chatModel?.id === agent.id
                                        ? 'bg-notion-accent-light text-notion-accent'
                                        : 'text-notion-text-secondary'
                                    }`}
                                  >
                                    <span className="flex-shrink-0">
                                      <AgentLogo tool={agent.agentTool} size={14} />
                                    </span>
                                    <span className="truncate font-medium">{agent.name}</span>
                                  </button>
                                ))
                              ) : (
                                <div className="px-3 py-3 text-center text-xs text-notion-text-tertiary">
                                  No agents configured.{' '}
                                  <button
                                    onClick={() => {
                                      navigate('/settings');
                                      setShowModelPicker(false);
                                    }}
                                    className="text-blue-500 hover:underline"
                                  >
                                    Go to Settings
                                  </button>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Paper picker (attach comparison papers) */}
                      <div ref={paperPickerRef} className="relative">
                        <button
                          onClick={() => {
                            setShowPaperPicker((v) => !v);
                            setPaperSearch('');
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                          title="Attach paper for comparison"
                        >
                          <Plus size={13} />
                        </button>

                        <AnimatePresence>
                          {showPaperPicker && (
                            <motion.div
                              initial={{ opacity: 0, y: 4, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.97 }}
                              transition={{ duration: 0.1 }}
                              className="absolute bottom-full left-0 z-50 mb-1 w-72 rounded-lg border border-notion-border bg-white shadow-lg"
                            >
                              <div className="flex items-center gap-2 border-b border-notion-border px-3 py-2">
                                <Search
                                  size={12}
                                  className="flex-shrink-0 text-notion-text-tertiary"
                                />
                                <input
                                  autoFocus
                                  value={paperSearch}
                                  onChange={(e) => setPaperSearch(e.target.value)}
                                  placeholder="Search papers…"
                                  className="flex-1 bg-transparent text-xs text-notion-text placeholder:text-notion-text-tertiary focus:outline-none"
                                />
                              </div>
                              <div className="max-h-48 overflow-y-auto py-1">
                                {paperSearchResults.length > 0 ? (
                                  paperSearchResults.map((p) => {
                                    const isAttached = attachedPapers.some((a) => a.id === p.id);
                                    return (
                                      <button
                                        key={p.id}
                                        onClick={() => {
                                          if (isAttached) {
                                            setAttachedPapers((prev) =>
                                              prev.filter((a) => a.id !== p.id),
                                            );
                                          } else {
                                            setAttachedPapers((prev) => [...prev, p]);
                                          }
                                          setShowPaperPicker(false);
                                        }}
                                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-notion-accent-light ${
                                          isAttached
                                            ? 'bg-notion-accent-light text-notion-accent'
                                            : 'text-notion-text-secondary'
                                        }`}
                                      >
                                        <FileText
                                          size={11}
                                          className="mt-0.5 flex-shrink-0 opacity-60"
                                        />
                                        <span className="line-clamp-2 leading-snug">{p.title}</span>
                                      </button>
                                    );
                                  })
                                ) : (
                                  <div className="px-3 py-3 text-center text-xs text-notion-text-tertiary">
                                    {paperSearch ? 'No papers found.' : 'Loading…'}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    {/* end left side */}

                    {/* Send / Stop button */}
                    {agentRunning ? (
                      <button
                        onClick={handleChatKill}
                        className="flex-shrink-0 rounded-full bg-gray-400 p-1.5 text-white hover:bg-gray-500"
                        title="Stop"
                      >
                        <Square size={13} />
                      </button>
                    ) : (
                      <button
                        onClick={handleChatSend}
                        disabled={!chatInput.trim() || !chatModel || agentRunning}
                        className="flex-shrink-0 rounded-full bg-notion-text p-1.5 text-white transition-opacity hover:opacity-80 disabled:opacity-30"
                        title="Send"
                      >
                        <ArrowUp size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Divider */}
        {layoutMode === 'split' && (
          <div
            onMouseDown={handleMouseDown}
            className="group flex w-1.5 cursor-col-resize items-center justify-center bg-notion-border transition-colors hover:bg-blue-400 active:bg-blue-500"
          >
            <GripVertical size={14} className="text-white opacity-0 group-hover:opacity-100" />
          </div>
        )}

        {/* Right: PDF */}
        {layoutMode !== 'chat-only' && (
          <div
            className="relative flex flex-col"
            style={{ width: layoutMode === 'pdf-only' ? '100%' : `${100 - leftWidth}%` }}
          >
            {pdfPath ? (
              <PdfViewer
                path={pdfPath}
                onFileNotFound={() =>
                  setPaper((prev) => (prev ? { ...prev, pdfPath: undefined } : prev))
                }
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-notion-sidebar">
                  <Download size={24} strokeWidth={1.5} className="text-notion-text-tertiary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-notion-text-secondary">
                    No PDF downloaded
                  </p>
                  <p className="mt-1 text-xs text-notion-text-tertiary">Download to read locally</p>
                </div>
                {inferPdfUrl(paper) && (
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleDownloadPdf}
                      disabled={downloading}
                      className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-50"
                    >
                      {downloading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      {downloading ? 'Downloading\u2026' : 'Download PDF'}
                    </button>
                    {downloading && (
                      <div className="w-48">
                        {downloadProgress && downloadProgress.total > 0 ? (
                          <>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-notion-border">
                              <div
                                className="h-full rounded-full bg-notion-accent transition-all duration-150"
                                style={{
                                  width: `${Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100)}%`,
                                }}
                              />
                            </div>
                            <p className="mt-1 text-center text-xs text-notion-text-tertiary">
                              {(downloadProgress.downloaded / 1024 / 1024).toFixed(1)} /{' '}
                              {(downloadProgress.total / 1024 / 1024).toFixed(1)} MB
                            </p>
                          </>
                        ) : (
                          <p className="text-center text-xs text-notion-text-tertiary">
                            {downloadProgress
                              ? `${(downloadProgress.downloaded / 1024 / 1024).toFixed(1)} MB`
                              : 'Connecting\u2026'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}
      </div>

      {/* Rating Prompt Modal */}
      <RatingPromptModal
        isOpen={showRatingPrompt}
        onRate={handleRatingPromptRate}
        onSkip={handleRatingPromptSkip}
      />
    </div>
  );
}
