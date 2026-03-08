import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, useBlocker } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import { PdfViewer } from '../../../components/pdf-viewer';
import { MarkdownContent } from '../../../components/markdown-content';
import { ipc, type PaperItem, type ReadingNote, type ModelConfig } from '../../../hooks/use-ipc';
import { useChat, type ChatMessage, type AiStatus } from '../../../hooks/use-chat';
import { cleanArxivTitle } from '@shared';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  CopyPlus,
  Loader2,
  GripVertical,
  Download,
  FlaskConical,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Search,
  Square,
  Plus,
  MessageSquare,
  ChevronDown,
  Star,
  Tags,
  Trash2,
  FilePenLine,
  Check,
  Target,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

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
            fill={star <= displayValue ? '#fbbf24' : 'transparent'}
            stroke={star <= displayValue ? '#fbbf24' : '#d1d5db'}
            strokeWidth={2}
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

interface ChatBubbleProps {
  msg: ChatMessage;
  index: number;
  onEdit: (index: number, newContent: string) => void;
  onDelete: (index: number) => void;
  onRegenerate?: (index: number) => void;
}

function ChatBubble({ msg, index, onEdit, onDelete, onRegenerate }: ChatBubbleProps) {
  const isUser = msg.role === 'user';
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing]);

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== msg.content) {
      onEdit(index, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(msg.content);
    setIsEditing(false);
  };

  const handleConfirmDelete = () => {
    onDelete(index);
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className={`group flex items-start gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Action buttons - show on hover (left side for user, right side for AI) */}
      {!isUser && isHovered && !isEditing && !showDeleteConfirm && (
        <div className="flex gap-0.5 self-start pt-1">
          <button
            onClick={() => setIsEditing(true)}
            className="rounded p-0.5 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text-secondary"
            title="Edit message"
          >
            <FilePenLine size={12} />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded p-0.5 text-notion-text-tertiary hover:bg-red-50 hover:text-red-500"
            title="Delete message"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-white p-2 shadow-lg self-start">
          <span className="text-xs text-notion-text-secondary">Delete?</span>
          <button
            onClick={handleConfirmDelete}
            className="rounded bg-red-500 px-2 py-0.5 text-xs text-white hover:bg-red-600"
          >
            Delete
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="rounded bg-notion-sidebar px-2 py-0.5 text-xs text-notion-text-secondary hover:bg-notion-border"
          >
            Cancel
          </button>
        </div>
      )}

      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${
          isUser
            ? 'rounded-br-sm bg-notion-text text-white'
            : 'rounded-bl-sm bg-notion-sidebar text-notion-text'
        }`}
      >
        {isEditing ? (
          <div className="flex flex-col gap-2">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSaveEdit();
                }
                if (e.key === 'Escape') {
                  handleCancelEdit();
                }
              }}
              className="min-h-[60px] w-full resize-none rounded border border-notion-border bg-white px-2 py-1 text-notion-text focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="flex justify-end gap-1">
              <button
                onClick={handleCancelEdit}
                className="rounded px-2 py-0.5 text-xs text-notion-text-tertiary hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
              >
                Save
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <MarkdownContent
            content={msg.content}
            proseClassName="prose prose-sm max-w-none break-words text-inherit prose-p:my-2 prose-headings:my-3 prose-headings:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-code:bg-black/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-black/5 prose-pre:text-inherit prose-blockquote:text-inherit prose-li:my-1"
          />
        )}
      </div>

      {/* Action buttons - show on hover (right side for user) */}
      {isUser && isHovered && !isEditing && !showDeleteConfirm && (
        <div className="flex gap-0.5 self-start pt-1">
          {onRegenerate && (
            <button
              onClick={() => onRegenerate(index)}
              className="rounded p-0.5 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text-secondary"
              title="Regenerate from here"
            >
              <Target size={12} />
            </button>
          )}
          <button
            onClick={() => setIsEditing(true)}
            className="rounded p-0.5 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text-secondary"
            title="Edit message"
          >
            <FilePenLine size={12} />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded p-0.5 text-notion-text-tertiary hover:bg-red-50 hover:text-red-500"
            title="Delete message"
          >
            <Trash2 size={12} />
          </button>
        </div>
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

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [leftWidth, setLeftWidth] = useState(38);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(38);

  // Chat job subscription
  const { jobs: chatJobList, startChat, cancelChat } = useChat();

  // Chat sessions (UI-specific state)
  const [chatNotes, setChatNotes] = useState<ReadingNote[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const skipAutoScrollRef = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState<ModelConfig | null>(null);

  // Derive chat state from active job
  const activeChatJob = paper ? chatJobList.find((j) => j.paperId === paper.id && j.active) : null;
  const chatRunning = !!activeChatJob;
  const streamingContent = activeChatJob?.partialText ?? '';
  const aiStatus: AiStatus = activeChatJob?.stage === 'preparing' ? 'thinking' : 'idle';

  // Track completed jobs to trigger message refresh
  const lastCompletedJobIdRef = useRef<string | null>(null);

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
  const activePanel = searchParams.get('panel');

  useEffect(() => {
    if (activePanel === 'chat') {
      setChatCollapsed(false);
    }
  }, [activePanel]);

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
        setPaperDir(`${settings.papersDir}/${p.shortId}`);
        const shortTitle = p.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, '').slice(0, 30) || p.shortId;
        updateTabLabel(location.pathname, shortTitle);
        ipc.touchPaper(p.id).catch(() => undefined);
        return ipc.listReading(p.id);
      })
      .then((notes) => {
        const chatSessions = notes.filter((n) => n.title.startsWith('Chat:'));
        setChatNotes(chatSessions);

        // Check if there's a specific chatId in URL params
        const chatIdParam = searchParams.get('chatId');
        if (chatIdParam) {
          const targetChat = chatSessions.find((c) => c.id === chatIdParam);
          if (targetChat) {
            setCurrentChatId(targetChat.id);
            currentChatIdRef.current = targetChat.id;
            try {
              const msgs = JSON.parse(targetChat.contentJson) as ChatMessage[];
              if (Array.isArray(msgs)) setMessages(msgs);
            } catch {
              /* ignore */
            }
            return;
          }
        }

        // Auto-load most recent chat or create new
        if (chatSessions.length > 0) {
          const latest = chatSessions[0];
          setCurrentChatId(latest.id);
          currentChatIdRef.current = latest.id;
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
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  // Chat completion effect — when job completes, refresh messages from DB
  useEffect(() => {
    if (!paper) return;

    // Find the most recent completed job for this paper
    const completedJob = chatJobList.find(
      (j) => j.paperId === paper.id && j.stage === 'done' && !j.active,
    );

    if (!completedJob) return;
    if (completedJob.jobId === lastCompletedJobIdRef.current) return; // Already processed

    // Mark as processed
    lastCompletedJobIdRef.current = completedJob.jobId;

    // Load final messages from DB
    const noteId = completedJob.chatNoteId;
    if (noteId) {
      ipc
        .getReading(noteId)
        .then((note) => {
          try {
            const msgs = JSON.parse(note.contentJson) as ChatMessage[];
            if (Array.isArray(msgs)) {
              setMessages(msgs);
              setCurrentChatId(noteId);
              currentChatIdRef.current = noteId;
            }
          } catch {
            /* ignore */
          }
        })
        .catch(() => undefined);

      // Refresh chat notes list
      ipc
        .listReading(paper.id)
        .then(setChatNotes)
        .catch(() => undefined);
    }
  }, [paper, chatJobList]);

  // Auto-scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    if (userScrolledUpRef.current) return; // User scrolled up, don't auto-scroll
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, aiStatus]);

  // Detect user scroll to pause auto-scroll
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
      userScrolledUpRef.current = !isAtBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Reset scroll lock when starting new message
  useEffect(() => {
    if (chatRunning) {
      userScrolledUpRef.current = false;
    }
  }, [chatRunning]);

  const handleNewChat = useCallback(async () => {
    if (!paper) return;
    setMessages([]);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setChatInput('');
    setShowChatDropdown(false);
  }, [paper]);

  const handleSelectChat = useCallback((chat: ReadingNote) => {
    setCurrentChatId(chat.id);
    currentChatIdRef.current = chat.id;
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
    setChatInput('');
    await ipc.saveChat({ paperId: paper.id, noteId: currentChatId, messages: [] });
    setShowChatDropdown(false);
  }, [paper, currentChatId]);

  const handleDeleteChat = useCallback(
    async (chatId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!paper) return;
      await ipc.deleteReading(chatId);
      const updated = chatNotes.filter((c) => c.id !== chatId);
      setChatNotes(updated);
      if (chatId === currentChatId) {
        setMessages([]);
        setCurrentChatId(null);
        currentChatIdRef.current = null;
        setChatInput('');
      }
    },
    [paper, chatNotes, currentChatId],
  );

  const handleEditMessage = useCallback(
    async (index: number, newContent: string) => {
      if (!paper) return;
      skipAutoScrollRef.current = true;
      const updatedMessages = [...messages];
      updatedMessages[index] = { ...updatedMessages[index], content: newContent };
      setMessages(updatedMessages);
      // Save to database
      if (currentChatId) {
        await ipc.saveChat({ paperId: paper.id, noteId: currentChatId, messages: updatedMessages });
      }
    },
    [paper, messages, currentChatId],
  );

  const handleRegenerateFromMessage = useCallback(
    async (index: number) => {
      if (!paper || !chatModel || chatRunning) return;

      // Truncate messages up to and including this index, remove any assistant responses after
      const truncatedMessages = messages.slice(0, index + 1);
      setMessages(truncatedMessages);

      // Save truncated messages
      if (currentChatId) {
        await ipc.saveChat({
          paperId: paper.id,
          noteId: currentChatId,
          messages: truncatedMessages,
        });
      }

      // Trigger new chat with truncated history
      const pdfUrl = inferPdfUrl(paper);
      await startChat({
        paperId: paper.id,
        messages: truncatedMessages,
        pdfUrl: pdfUrl ?? undefined,
        chatNoteId: currentChatId,
      });
    },
    [paper, chatModel, chatRunning, messages, currentChatId, startChat],
  );

  const handleDeleteMessage = useCallback(
    async (index: number) => {
      if (!paper) return;
      skipAutoScrollRef.current = true;
      const updatedMessages = messages.filter((_, i) => i !== index);
      setMessages(updatedMessages);
      // Save to database
      if (currentChatId) {
        if (updatedMessages.length === 0) {
          // If no messages left, delete the chat session
          await ipc.deleteReading(currentChatId);
          setChatNotes((prev) => prev.filter((c) => c.id !== currentChatId));
          setCurrentChatId(null);
          currentChatIdRef.current = null;
        } else {
          await ipc.saveChat({
            paperId: paper.id,
            noteId: currentChatId,
            messages: updatedMessages,
          });
        }
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

    const pdfUrl = inferPdfUrl(paper);
    await startChat({
      paperId: paper.id,
      messages: next,
      pdfUrl: pdfUrl ?? undefined,
      chatNoteId: currentChatIdRef.current,
    });
  }, [chatInput, chatRunning, paper, messages, chatModel, startChat]);

  const handleChatKill = useCallback(async () => {
    if (!activeChatJob) return;
    await cancelChat(activeChatJob.jobId);
  }, [activeChatJob, cancelChat]);

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
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-notion-border px-4 py-2">
        <button
          onClick={() => navigate(`/papers/${paper.shortId}`)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
        >
          <ArrowLeft size={14} />
          <span className="max-w-[200px] truncate">{cleanArxivTitle(paper.title)}</span>
        </button>

        {/* Star Rating */}
        <div className="ml-3 flex items-center gap-1">
          <StarRating rating={rating} onChange={handleRatingChange} size={16} />
        </div>

        <div className="flex-1" />

        {/* Chat selector */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setShowChatDropdown((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
          >
            <MessageSquare size={13} />
            <span className="max-w-[100px] truncate">
              {currentChat ? currentChat.title.replace('Chat: ', '') : 'New Chat'}
            </span>
            <ChevronDown size={12} />
          </button>

          {showChatDropdown && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-notion-border bg-white py-1 shadow-lg">
              {currentChatId && messages.length > 0 && (
                <button
                  onClick={handleClearChat}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  Clear Chat
                </button>
              )}
              {chatNotes.length > 0 && (
                <div className="border-t border-notion-border mt-1 pt-1">
                  {chatNotes.map((chat) => (
                    <div
                      key={chat.id}
                      className={`group flex items-center gap-1 px-1 py-1 text-sm hover:bg-notion-sidebar ${
                        chat.id === currentChatId
                          ? 'bg-notion-sidebar text-blue-600'
                          : 'text-notion-text'
                      }`}
                    >
                      <button
                        onClick={() => handleSelectChat(chat)}
                        className="flex flex-1 items-center gap-2 px-2 py-1 text-left"
                      >
                        <MessageSquare size={14} className="text-notion-text-tertiary" />
                        <span className="truncate">{chat.title.replace('Chat: ', '')}</span>
                      </button>
                      <button
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-notion-text-tertiary hover:text-red-500 hover:bg-red-50 rounded"
                        title="Delete chat"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Split pane */}
      <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        {!chatCollapsed && (
          <div className="flex flex-col" style={{ width: `${leftWidth}%` }}>
            {/* Chat Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-notion-border px-4 py-2">
              <button
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
              >
                <Plus size={14} />
                New Chat
              </button>
              {currentChatId && messages.length > 0 && (
                <button
                  onClick={handleGenerateNotes}
                  disabled={generatingNotes || !!generatedNoteId}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {generatingNotes ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                      <span className="text-gray-500">Generating...</span>
                    </>
                  ) : generatedNoteId ? (
                    <>
                      <Check size={14} className="text-gray-400" />
                      <span className="text-gray-500">Notes saved</span>
                    </>
                  ) : (
                    <>
                      <FilePenLine size={14} className="text-gray-400" />
                      <span className="text-gray-500">Generate Notes</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Messages */}
            <div
              ref={chatContainerRef}
              className="notion-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-3"
            >
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
                <ChatBubble
                  key={i}
                  msg={msg}
                  index={i}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  onRegenerate={msg.role === 'user' ? handleRegenerateFromMessage : undefined}
                />
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
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-notion-sidebar px-3.5 py-2.5 text-sm leading-relaxed text-notion-text break-words">
                    <MarkdownContent
                      content={streamingContent}
                      proseClassName="prose prose-sm max-w-none break-words text-inherit prose-p:my-2 prose-headings:my-3 prose-headings:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-code:bg-black/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-black/5 prose-pre:text-inherit prose-blockquote:text-inherit prose-li:my-1"
                    />
                    <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-notion-text-tertiary align-middle" />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="flex-shrink-0 border-t border-notion-border px-4 py-3">
              <div className="flex items-end gap-2 rounded-xl border border-notion-border bg-white px-3.5 py-2.5 transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
                <textarea
                  ref={textareaRef}
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleChatSend();
                    }
                  }}
                  placeholder={
                    chatModel
                      ? 'Message… (⌘/Ctrl+Enter to send)'
                      : 'Configure a chat model in Settings…'
                  }
                  disabled={!chatModel}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-40"
                  style={{ minHeight: '22px', maxHeight: '120px' }}
                />
                {chatRunning ? (
                  <button
                    onClick={handleChatKill}
                    className="flex-shrink-0 rounded-lg bg-gray-400 p-1.5 text-white hover:bg-gray-500"
                    title="Stop"
                  >
                    <Square size={13} />
                  </button>
                ) : (
                  <button
                    onClick={handleChatSend}
                    disabled={!chatInput.trim() || !chatModel}
                    className="flex-shrink-0 rounded-lg bg-notion-text p-1.5 text-white transition-opacity hover:opacity-80 disabled:opacity-30"
                    title="Send"
                  >
                    <ArrowUp size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Divider */}
        {!chatCollapsed && (
          <div
            onMouseDown={handleMouseDown}
            className="group flex w-1.5 cursor-col-resize items-center justify-center bg-notion-border transition-colors hover:bg-blue-400 active:bg-blue-500"
          >
            <GripVertical size={14} className="text-white opacity-0 group-hover:opacity-100" />
          </div>
        )}

        {/* Right: PDF */}
        <div
          className="relative flex flex-col"
          style={{ width: chatCollapsed ? '100%' : `${100 - leftWidth}%` }}
        >
          {/* Toggle chat — floating side center */}
          <button
            onClick={() => setChatCollapsed((v) => !v)}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 inline-flex items-center justify-center rounded-md border border-notion-border bg-white/90 p-1.5 shadow-sm backdrop-blur-sm text-notion-text-secondary transition-colors hover:bg-white hover:text-notion-text"
            title={chatCollapsed ? 'Show chat' : 'Hide chat'}
          >
            {chatCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>

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
