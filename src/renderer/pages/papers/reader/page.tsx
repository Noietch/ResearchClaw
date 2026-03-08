import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, useBlocker } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import { useChat, type ChatMessage, type AiStatus } from '../../../hooks/use-chat';
import { PdfViewer } from '../../../components/pdf-viewer';
import { ipc, type PaperItem, type ReadingNote, type ModelConfig } from '../../../hooks/use-ipc';
import { cleanArxivTitle } from '@shared';
import {
  ArrowLeft,
  Loader2,
  GripVertical,
  Download,
  PanelLeftClose,
  PanelRightClose,
  ArrowUp,
  Square,
  Star,
  Trash2,
  FilePenLine,
  Check,
  X,
  Columns3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

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

  // ESC to close
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

// ─── AI Status Indicator ─────────────────────────────────────────────────────

function AiStatusIndicator({ status }: { status: AiStatus }) {
  if (status === 'idle') return null;

  const statusText = status === 'extracting_pdf' ? '正在提取PDF文本...' : '正在思考...';

  return (
    <div className="flex items-center gap-2 text-sm text-notion-text-tertiary">
      <Loader2 size={14} className="animate-spin text-gray-400" />
      <span>{statusText}</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferPdfUrl(paper: PaperItem): string | null {
  if (paper.pdfUrl) return paper.pdfUrl;
  if (paper.sourceUrl) {
    const m = paper.sourceUrl.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/i);
    if (m) return `https://arxiv.org/pdf/${m[1]}`;
  }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.shortId)) {
    return `https://arxiv.org/pdf/${paper.shortId}`;
  }
  return null;
}

// ─── Chat bubble ─────────────────────────────────────────────────────────────

function ChatBubble({ msg, onDelete }: { msg: ChatMessage; onDelete: () => void }) {
  const isUser = msg.role === 'user';
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`group flex items-start gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Delete button for assistant (left side) */}
      {!isUser && (
        <button
          onClick={onDelete}
          className={`mt-2 flex-shrink-0 rounded p-0.5 text-notion-text-tertiary transition-opacity hover:text-red-400 ${hovered ? 'opacity-100' : 'opacity-0'}`}
          title="Delete message"
        >
          <X size={12} />
        </button>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${
          isUser
            ? 'rounded-br-sm bg-notion-text text-white whitespace-pre-wrap'
            : 'rounded-bl-sm bg-notion-sidebar text-notion-text prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-li:my-0.5 prose-code:text-xs'
        }`}
      >
        {isUser ? msg.content : <ReactMarkdown>{msg.content}</ReactMarkdown>}
      </div>
      {/* Delete button for user (right side) */}
      {isUser && (
        <button
          onClick={onDelete}
          className={`mt-2 flex-shrink-0 rounded p-0.5 text-notion-text-tertiary transition-opacity hover:text-red-400 ${hovered ? 'opacity-100' : 'opacity-0'}`}
          title="Delete message"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReaderPage() {
  const { id: shortId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { updateTabLabel, openTab } = useTabs();

  // Global chat state (persists across page navigation)
  const {
    state: chatState,
    setChatNotes,
    setCurrentChatId,
    setMessages,
    setChatRunning,
    setStreamingContent,
    setAiStatus,
    initForPaper,
    currentChatIdRef,
  } = useChat();

  const {
    sessionId: chatSessionId,
    chatNotes,
    currentChatId,
    messages,
    chatRunning,
    streamingContent,
    aiStatus,
  } = chatState;

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Layout mode: 'pdf' = PDF only, 'chat' = Chat only, 'split' = both
  const [layoutMode, setLayoutMode] = useState<'pdf' | 'chat' | 'split'>('pdf');
  const [leftWidth, setLeftWidth] = useState(38);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(38);

  const [chatInput, setChatInput] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [chatModel, setChatModel] = useState<ModelConfig | null>(null);

  // Chat selector dropdown
  const [showChatDropdown, setShowChatDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Rating
  const [rating, setRating] = useState<number | null>(null);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const pendingNavigateRef = useRef<(() => void) | null>(null);

  // Generate notes
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [generatedNoteId, setGeneratedNoteId] = useState<string | null>(null);

  const MIN_WIDTH = 20;
  const MAX_WIDTH = 60;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowChatDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load active chat model
  useEffect(() => {
    ipc
      .getActiveModel('chat')
      .then((model) => {
        setChatModel(model);
      })
      .catch(() => undefined);
  }, []);

  // Load paper + chat sessions
  useEffect(() => {
    if (!shortId) return;

    Promise.all([ipc.getPaperByShortId(shortId), ipc.getSettings()])
      .then(([p, settings]) => {
        setPaper(p);
        setRating(p.rating ?? null);
        initForPaper(p.id);
        const shortTitle = p.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, '').slice(0, 30) || p.shortId;
        updateTabLabel(location.pathname, shortTitle);
        ipc.touchPaper(p.id).catch(() => undefined);
        return ipc.listReading(p.id);
      })
      .then((notes) => {
        const chatSessions = notes.filter((n) => n.title.startsWith('Chat:'));
        setChatNotes(chatSessions);

        // If a chat is already running, don't reset messages
        if (chatRunning) return;

        // Check if there's a specific chatId in URL params
        const chatIdParam = searchParams.get('chatId');
        if (chatIdParam) {
          const targetChat = chatSessions.find((c) => c.id === chatIdParam);
          if (targetChat) {
            setCurrentChatId(targetChat.id);
            try {
              const msgs = JSON.parse(targetChat.contentJson) as ChatMessage[];
              if (Array.isArray(msgs)) setMessages(msgs);
            } catch {
              /* ignore */
            }
            return;
          }
        }

        // Auto-load most recent chat
        if (chatSessions.length > 0) {
          const latest = chatSessions[0];
          setCurrentChatId(latest.id);
          try {
            const msgs = JSON.parse(latest.contentJson) as ChatMessage[];
            if (Array.isArray(msgs)) setMessages(msgs);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [shortId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, aiStatus]);

  const handleNewChat = useCallback(async () => {
    if (!paper) return;
    setMessages([]);
    setCurrentChatId(null);
    setStreamingContent('');
    setChatInput('');
    setShowChatDropdown(false);
  }, [paper]);

  const handleSelectChat = useCallback((chat: ReadingNote) => {
    setCurrentChatId(chat.id);
    try {
      const msgs = JSON.parse(chat.contentJson) as ChatMessage[];
      if (Array.isArray(msgs)) setMessages(msgs);
    } catch {
      /* ignore */
    }
    setShowChatDropdown(false);
  }, []);

  const handleClearChat = useCallback(async () => {
    if (!paper || !currentChatId) return;
    setMessages([]);
    setStreamingContent('');
    setChatInput('');
    await ipc.saveChat({ paperId: paper.id, noteId: currentChatId, messages: [] });
    setShowChatDropdown(false);
  }, [paper, currentChatId]);

  const handleDeleteMessage = useCallback(
    async (index: number) => {
      if (!paper) return;
      const next = messages.filter((_, i) => i !== index);
      setMessages(next);
      if (currentChatId) {
        ipc
          .saveChat({ paperId: paper.id, noteId: currentChatId, messages: next })
          .catch(() => undefined);
      }
    },
    [paper, messages, currentChatId],
  );

  const handleGenerateNotes = useCallback(async () => {
    if (!currentChatId || generatingNotes || generatedNoteId) return;
    setGeneratingNotes(true);
    try {
      const result = await ipc.generateNotes(currentChatId);
      setGeneratedNoteId(result.id);
    } catch (error) {
      console.error('Failed to generate notes:', error);
    } finally {
      setGeneratingNotes(false);
    }
  }, [currentChatId, generatingNotes, generatedNoteId]);

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatRunning || !paper || !chatModel) return;

    const userMsg: ChatMessage = { role: 'user', content: text, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setChatInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setStreamingContent('');
    setChatRunning(true);
    setAiStatus(paper.pdfPath ? 'extracting_pdf' : 'thinking');

    ipc
      .saveChat({ paperId: paper.id, noteId: currentChatIdRef.current, messages: next })
      .then((r) => {
        if (!currentChatIdRef.current) {
          setCurrentChatId(r.id);
          ipc
            .listReading(paper.id)
            .then(setChatNotes)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    const pdfUrl = inferPdfUrl(paper);
    await ipc.chat({
      sessionId: chatSessionId,
      paperId: paper.id,
      messages: next,
      pdfUrl: pdfUrl ?? undefined,
    });
  }, [chatInput, chatRunning, paper, messages, chatModel, chatSessionId]);

  const handleChatKill = useCallback(async () => {
    await ipc.killChat(chatSessionId);
    setChatRunning(false);
    setAiStatus('idle');
    if (streamingContent.trim()) {
      const msg: ChatMessage = {
        role: 'assistant',
        content: streamingContent.trim() + ' [stopped]',
        ts: Date.now(),
      };
      setMessages((prev) => {
        const next = [...prev, msg];
        if (paper)
          ipc
            .saveChat({ paperId: paper.id, noteId: currentChatIdRef.current, messages: next })
            .catch(() => undefined);
        return next;
      });
      setStreamingContent('');
    }
  }, [streamingContent, paper, chatSessionId]);

  const handleDownloadPdf = useCallback(async () => {
    if (!paper) return;
    const pdfUrl = inferPdfUrl(paper);
    if (!pdfUrl) return;
    setDownloading(true);
    try {
      const result = await ipc.downloadPdf(paper.id, pdfUrl);
      setPaper((prev) => (prev ? { ...prev, pdfPath: result.pdfPath } : prev));
    } catch {
      /* silent */
    } finally {
      setDownloading(false);
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

  // Exit prompt logic - block navigation if paper has no rating (with probability and cooldown)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Only block when navigating away from this page
    if (currentLocation.pathname === nextLocation.pathname) return false;
    // Don't block if already rated
    if (rating !== null) return false;
    // No paper loaded
    if (!paper) return false;

    // Check cooldown: 7 days since last prompt for this paper
    const lastPromptKey = `rating-prompt-${paper.id}`;
    const lastPrompt = localStorage.getItem(lastPromptKey);
    if (lastPrompt) {
      const daysSincePrompt = (Date.now() - parseInt(lastPrompt, 10)) / (1000 * 60 * 60 * 24);
      if (daysSincePrompt < 7) return false;
    }

    // Random chance: 25% probability to show prompt
    return Math.random() < 0.1;
  });

  // Handle blocked navigation - record prompt time
  useEffect(() => {
    if (blocker.state === 'blocked' && paper) {
      pendingNavigateRef.current = () => blocker.proceed();
      setShowRatingPrompt(true);
      // Record that we prompted for this paper
      localStorage.setItem(`rating-prompt-${paper.id}`, Date.now().toString());
    }
  }, [blocker, paper]);

  const handleRatingPromptRate = useCallback(
    (r: number) => {
      handleRatingChange(r);
      setShowRatingPrompt(false);
      if (pendingNavigateRef.current) {
        pendingNavigateRef.current();
        pendingNavigateRef.current = null;
      }
    },
    [handleRatingChange],
  );

  const handleRatingPromptSkip = useCallback(() => {
    setShowRatingPrompt(false);
    if (pendingNavigateRef.current) {
      pendingNavigateRef.current();
      pendingNavigateRef.current = null;
    }
  }, []);

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
  const currentChat = chatNotes.find((c) => c.id === currentChatId);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center border-b border-notion-border px-4 py-2">
        {/* Left: Back button */}
        <div className="flex items-center gap-2 w-48">
          <button
            onClick={() => {
              const from = (location.state as { from?: string })?.from;
              navigate(`/papers/${paper.shortId}`, { state: from ? { from } : undefined });
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
          >
            <ArrowLeft size={14} />
            <span className="max-w-[180px] truncate">{cleanArxivTitle(paper.title)}</span>
          </button>
        </div>

        {/* Center: Layout toggle buttons + metadata */}
        <div className="flex-1 flex items-center justify-center gap-4">
          {/* Layout toggle buttons */}
          <div className="flex items-center gap-0.5 rounded-lg border border-notion-border p-0.5">
            <button
              onClick={() => setLayoutMode('chat')}
              className={`rounded-md p-1.5 transition-colors ${
                layoutMode === 'chat'
                  ? 'bg-notion-accent-light text-notion-accent'
                  : 'text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text'
              }`}
              title="Chat only"
            >
              <PanelLeftClose size={14} />
            </button>
            <button
              onClick={() => setLayoutMode('split')}
              className={`rounded-md p-1.5 transition-colors ${
                layoutMode === 'split'
                  ? 'bg-notion-accent-light text-notion-accent'
                  : 'text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text'
              }`}
              title="Split view (Chat + PDF)"
            >
              <Columns3 size={14} />
            </button>
            <button
              onClick={() => setLayoutMode('pdf')}
              className={`rounded-md p-1.5 transition-colors ${
                layoutMode === 'pdf'
                  ? 'bg-notion-accent-light text-notion-accent'
                  : 'text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text'
              }`}
              title="PDF only"
            >
              <PanelRightClose size={14} />
            </button>
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-notion-border" />

          {/* Submitted date */}
          {paper.submittedAt && (
            <div className="flex items-center gap-1.5 text-xs text-notion-text-tertiary">
              <span>{new Date(paper.submittedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
          )}

          {/* Star Rating */}
          <div className="flex items-center gap-1">
            <StarRating rating={rating} onChange={handleRatingChange} size={16} />
          </div>
        </div>

        {/* Right: placeholder for balance */}
        <div className="w-48" />
      </div>

      {/* Split pane */}
      <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        {layoutMode !== 'pdf' && (
          <div
            className="relative flex flex-col"
            style={{ width: layoutMode === 'chat' ? '100%' : `${leftWidth}%` }}
          >
            {/* Chat Header */}
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-notion-border px-3 py-2">
              {/* Current chat title */}
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-notion-text-secondary truncate block">
                  {currentChat ? currentChat.title.replace('Chat: ', '') : 'New Chat'}
                </span>
              </div>

              {/* Generate Notes button */}
              {currentChatId && messages.length > 0 && (
                <button
                  onClick={handleGenerateNotes}
                  disabled={generatingNotes || !!generatedNoteId}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {generatingNotes ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                      <span className="text-gray-500">Generating...</span>
                    </>
                  ) : generatedNoteId ? (
                    <>
                      <Check size={14} className="text-gray-400" />
                      <span className="text-gray-500">Saved</span>
                    </>
                  ) : (
                    <>
                      <FilePenLine size={14} className="text-gray-400" />
                      <span className="text-gray-500">Save to Notes</span>
                    </>
                  )}
                </button>
              )}

            </div>

            {/* Messages */}
            <div className="notion-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 &&
                !streamingContent &&
                aiStatus === 'idle' &&
                (chatModel ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
                    <p className="text-sm font-medium text-notion-text-secondary">
                      {chatModel.name}
                    </p>
                    <p className="text-xs text-notion-text-tertiary">
                      Ask anything about this paper
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
                    <p className="text-xs text-notion-text-tertiary">
                      Set an active chat model in{' '}
                      <button
                        onClick={() => navigate('/settings')}
                        className="text-blue-500 hover:underline"
                      >
                        Settings
                      </button>{' '}
                      to chat
                    </p>
                  </div>
                ))}
              {messages.map((msg, i) => (
                <ChatBubble key={i} msg={msg} onDelete={() => handleDeleteMessage(i)} />
              ))}
              {/* AI Status Indicator */}
              {aiStatus !== 'idle' && !streamingContent && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-notion-sidebar px-3.5 py-2.5">
                    <AiStatusIndicator status={aiStatus} />
                  </div>
                </div>
              )}
              {streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-notion-sidebar px-3.5 py-2.5 text-sm leading-relaxed text-notion-text break-words prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-li:my-0.5 prose-code:text-xs">
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                    <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-notion-text-tertiary align-middle" />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="flex-shrink-0 px-4 py-3">
              <div className="rounded-2xl border border-notion-border bg-white shadow-sm transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
                {/* Textarea row */}
                <div className="px-4 pt-3 pb-2">
                  <textarea
                    ref={textareaRef}
                    value={chatInput}
                    onChange={(e) => {
                      setChatInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleChatSend();
                      }
                    }}
                    placeholder={
                      chatModel ? 'Ask anything about this paper…' : 'Configure a chat model in Settings…'
                    }
                    disabled={!chatModel}
                    rows={1}
                    className="w-full resize-none bg-transparent text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-40"
                    style={{ minHeight: '22px', maxHeight: '120px' }}
                  />
                </div>
                {/* Bottom toolbar row */}
                <div className="flex items-center justify-end px-3 pb-2.5">
                  {/* Send / Stop button */}
                  {chatRunning ? (
                    <button
                      onClick={handleChatKill}
                      className="flex-shrink-0 rounded-full bg-gray-400 p-2 text-white hover:bg-gray-500"
                      title="Stop"
                    >
                      <Square size={13} />
                    </button>
                  ) : (
                    <button
                      onClick={handleChatSend}
                      disabled={!chatInput.trim() || !chatModel}
                      className="flex-shrink-0 rounded-full bg-notion-text p-2 text-white transition-opacity hover:opacity-80 disabled:opacity-30"
                      title="Send"
                    >
                      <ArrowUp size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
        </div>
        )}

        {/* Divider */}
        {layoutMode === 'split' && (
          <div
            onMouseDown={handleMouseDown}
            className="group flex w-1.5 flex-shrink-0 cursor-col-resize items-center justify-center bg-notion-border transition-colors hover:bg-blue-400 active:bg-blue-500"
          >
            <GripVertical size={14} className="text-white opacity-0 group-hover:opacity-100" />
          </div>
        )}

        {/* Right: PDF */}
        {layoutMode !== 'chat' && (
          <div
            className="relative flex flex-col"
            style={{ width: layoutMode === 'pdf' ? '100%' : `${100 - leftWidth}%` }}
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
                  <p className="text-sm font-medium text-notion-text-secondary">No PDF downloaded</p>
                  <p className="mt-1 text-xs text-notion-text-tertiary">Download to read locally</p>
                </div>
                {inferPdfUrl(paper) && (
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
                    {downloading ? 'Downloading…' : 'Download PDF'}
                  </button>
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
