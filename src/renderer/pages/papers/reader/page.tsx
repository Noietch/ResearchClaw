import { useEffect, useState, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { useTabs } from '../../../hooks/use-tabs';
import { PdfViewer } from '../../../components/pdf-viewer';
import type { CachedReference } from '../../../components/pdf/PdfDocument';
import {
  ipc,
  onIpc,
  type PaperItem,
  type ModelConfig,
  type HighlightItem,
} from '../../../hooks/use-ipc';
import { useAgentStream } from '../../../hooks/use-agent-stream';
import { MessageStream } from '../../../components/agent-todo/MessageStream';
import { AgentLogo } from '../../../components/agent-todo/AgentLogo';
import { arxivPdfUrl, cleanCitationSearchQuery } from '@shared';
import { useToast } from '../../../components/toast';
import { PaperPreviewModal, type SearchResult } from '../../../components/PaperPreviewModal';
import { saveReaderState, loadReaderState } from '../../../utils/reader-state-cache';
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
  Zap,
  History,
  Maximize2,
  Minimize2,
  StickyNote,
  Sparkles,
  ClipboardCopy,
  List,
  ChevronsUpDown,
} from 'lucide-react';
import type { AgentConfigItem } from '@shared';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Helper Functions ───────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString();
}

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

// ─── Annotation Card ────────────────────────────────────────────────────────

const HIGHLIGHT_COLOR_BG: Record<string, string> = {
  yellow: 'bg-yellow-100 border-yellow-300',
  green: 'bg-green-100 border-green-300',
  blue: 'bg-blue-100 border-blue-300',
  pink: 'bg-pink-100 border-pink-300',
  purple: 'bg-purple-100 border-purple-300',
};

interface NoteEntry {
  id: string;
  text: string;
  createdAt: string;
}

function AnnotationCard({
  highlight,
  onAddNote,
  onUpdateNoteEntry,
  onDeleteNoteEntry,
  onDelete,
  onJumpToPage,
  onGenerateAiNote,
}: {
  highlight: HighlightItem;
  onAddNote: (text: string) => void;
  onUpdateNoteEntry: (noteId: string, text: string) => void;
  onDeleteNoteEntry: (noteId: string) => void;
  onDelete: () => void;
  onJumpToPage?: (page: number) => void;
  onGenerateAiNote?: () => Promise<void>;
}) {
  const [addingNote, setAddingNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [aiNoteLoading, setAiNoteLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);
  const { t } = useTranslation();
  const colorClass = HIGHLIGHT_COLOR_BG[highlight.color] ?? 'bg-yellow-100 border-yellow-300';

  const noteEntries: NoteEntry[] = useMemo(() => {
    try {
      const parsed = JSON.parse(highlight.notes || '[]');
      // Migrate legacy single note into array if notes array is empty
      if (parsed.length === 0 && highlight.note) {
        return [{ id: '_legacy', text: highlight.note, createdAt: highlight.createdAt }];
      }
      return parsed;
    } catch {
      return [];
    }
  }, [highlight.notes, highlight.note, highlight.createdAt]);

  // Detect whether the text is actually clamped (overflows 3 lines)
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    }
  }, [highlight.text, expanded]);

  return (
    <div
      className={`group mx-2 my-1.5 rounded-md border-l-2 px-2.5 py-2 transition-colors hover:brightness-95 ${colorClass}`}
    >
      {/* Highlight text — click to jump, expandable */}
      <p
        ref={textRef}
        className={`cursor-pointer text-xs leading-relaxed text-notion-text ${expanded ? '' : 'line-clamp-3'}`}
        onClick={() => onJumpToPage?.(highlight.pageNumber)}
      >
        &ldquo;{highlight.text}&rdquo;
      </p>
      {/* Expand / Collapse toggle */}
      {(isClamped || expanded) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-0.5 text-[10px] font-medium text-blue-600 hover:underline"
        >
          {expanded
            ? t('reader.annotation.collapse', 'Collapse ▲')
            : t('reader.annotation.expand', 'Show full text ▼')}
        </button>
      )}

      {/* AI Note (read-only display with regenerate button) */}
      {(highlight.aiNote || aiNoteLoading) && (
        <div className="mt-1.5 rounded-md bg-white/60 px-2 py-1.5">
          <div className="flex items-start gap-1">
            {aiNoteLoading ? (
              <Loader2 size={10} className="mt-0.5 flex-shrink-0 animate-spin text-blue-600" />
            ) : (
              <Sparkles size={10} className="mt-0.5 flex-shrink-0 text-blue-600" />
            )}
            <p className="flex-1 text-[10px] leading-relaxed text-notion-text-secondary">
              {aiNoteLoading && !highlight.aiNote
                ? t('reader.annotation.aiNoteLoading', 'Generating…')
                : highlight.aiNote}
            </p>
            {onGenerateAiNote && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (aiNoteLoading) return;
                  setAiNoteLoading(true);
                  try {
                    await onGenerateAiNote();
                  } finally {
                    setAiNoteLoading(false);
                  }
                }}
                disabled={aiNoteLoading}
                title={t('reader.annotation.regenerateAiNote', 'Regenerate AI Note')}
                className="flex-shrink-0 rounded p-0.5 text-notion-text-tertiary opacity-0 transition-opacity hover:text-blue-600 group-hover:opacity-100 disabled:opacity-50"
              >
                {aiNoteLoading ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <Sparkles size={9} />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* User notes list (multiple notes) */}
      {noteEntries.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {noteEntries.map((entry) =>
            editingNoteId === entry.id ? (
              <div key={entry.id}>
                <textarea
                  autoFocus
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (editNoteText.trim()) onUpdateNoteEntry(entry.id, editNoteText.trim());
                      setEditingNoteId(null);
                    }
                    if (e.key === 'Escape') setEditingNoteId(null);
                  }}
                  onBlur={() => {
                    if (editNoteText.trim()) onUpdateNoteEntry(entry.id, editNoteText.trim());
                    setEditingNoteId(null);
                  }}
                  placeholder="Edit note…"
                  className="w-full resize-none rounded border border-notion-border bg-white px-2 py-1 text-xs text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-blue-100"
                  rows={2}
                />
              </div>
            ) : (
              <div key={entry.id} className="group/note flex items-start gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingNoteId(entry.id);
                    setEditNoteText(entry.text);
                  }}
                  className="flex-1 min-w-0 text-left text-[10px] italic leading-relaxed text-notion-text-secondary hover:text-notion-text"
                >
                  <StickyNote size={9} className="mr-0.5 inline-block align-middle opacity-60" />
                  {entry.text}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNoteEntry(entry.id);
                  }}
                  className="flex-shrink-0 rounded p-0.5 text-notion-text-tertiary opacity-0 transition-opacity hover:text-red-500 group-hover/note:opacity-100"
                >
                  <X size={9} />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {/* Add new note textarea */}
      {addingNote && (
        <div className="mt-1.5">
          <textarea
            autoFocus
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (newNoteText.trim()) {
                  onAddNote(newNoteText.trim());
                  setNewNoteText('');
                }
                setAddingNote(false);
              }
              if (e.key === 'Escape') {
                setNewNoteText('');
                setAddingNote(false);
              }
            }}
            onBlur={() => {
              if (newNoteText.trim()) {
                onAddNote(newNoteText.trim());
                setNewNoteText('');
              }
              setAddingNote(false);
            }}
            placeholder="Add a note…"
            className="w-full resize-none rounded border border-notion-border bg-white px-2 py-1 text-xs text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-blue-100"
            rows={2}
          />
        </div>
      )}

      {/* Action buttons */}
      {!addingNote && (
        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAddingNote(true);
            }}
            className="text-[10px] text-notion-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
          >
            + note
          </button>
          {!highlight.aiNote && onGenerateAiNote && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (aiNoteLoading) return;
                setAiNoteLoading(true);
                try {
                  await onGenerateAiNote();
                } finally {
                  setAiNoteLoading(false);
                }
              }}
              disabled={aiNoteLoading}
              title={t('reader.annotation.aiNote', 'AI Note')}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-blue-600 opacity-0 transition-opacity hover:bg-blue-50 group-hover:opacity-100 disabled:opacity-50"
            >
              {aiNoteLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Sparkles size={10} />
              )}
              {aiNoteLoading
                ? t('reader.annotation.aiNoteLoading', 'Generating…')
                : t('reader.annotation.aiNote', 'AI Note')}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="ml-auto flex-shrink-0 rounded p-0.5 text-notion-text-tertiary opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
          >
            <X size={10} />
          </button>
        </div>
      )}
    </div>
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
  const { t } = useTranslation();
  const { id: shortId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { updateTabLabel, openTab } = useTabs();
  const {
    error: showError,
    warning: showWarning,
    info: showInfo,
    success: showSuccess,
  } = useToast();

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);

  // Restore cached state for this reader tab
  const cachedState = shortId ? loadReaderState(shortId) : null;

  // Layout mode: 'split' = chat+pdf side by side, 'chat-only' = chat full, 'pdf-only' = pdf full
  const [layoutMode, setLayoutMode] = useState<'split' | 'chat-only' | 'pdf-only'>(
    cachedState?.layoutMode ?? 'pdf-only',
  );
  const [leftWidth, setLeftWidth] = useState(cachedState?.leftWidth ?? 38);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(38);

  // Chat input state
  const [chatInput, setChatInput] = useState(cachedState?.chatInput ?? '');
  const [attachedQuotes, setAttachedQuotes] = useState<string[]>([]);
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

  // Chat history dropdown state
  const [chatSessions, setChatSessions] = useState<
    { id: string; title: string; createdAt: string; runId: string | null }[]
  >([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  // Q&A index dropdown state
  const [showQaIndex, setShowQaIndex] = useState(false);
  const qaIndexRef = useRef<HTMLDivElement>(null);

  // Local user messages injected before the agent stream arrives
  const [localUserMessages, setLocalUserMessages] = useState<
    { id: string; msgId: string; type: string; role: string; content: unknown; status: null }[]
  >([]);

  // Paper preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(cachedState?.previewModalOpen ?? false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>(
    (cachedState?.searchResults as SearchResult[]) ?? [],
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(cachedState?.searchQuery ?? '');
  const [previewDownloading, setPreviewDownloading] = useState(false);
  const [previewNoPdfUrl, setPreviewNoPdfUrl] = useState<string | null>(
    cachedState?.previewNoPdfUrl ?? null,
  );

  // Citation sidebar state
  const [showCitationSidebar, setShowCitationSidebar] = useState(
    cachedState?.showCitationSidebar ?? false,
  );

  // AI Outline sidebar state (mutually exclusive with citation sidebar)
  const [showAIOutlineSidebar, setShowAIOutlineSidebar] = useState(false);

  // Focus mode: hide top toolbar for distraction-free reading
  const [focusMode, setFocusMode] = useState(false);

  // Annotation sidebar: show highlights grouped by page
  const [showAnnotationSidebar, setShowAnnotationSidebar] = useState(false);
  const [annotationSidebarWidth, setAnnotationSidebarWidth] = useState(288);
  const annotationResizing = useRef(false);

  // AI reading summary generation state
  const [generatingSummary, setGeneratingSummary] = useState(false);

  // Ref to call goToPage on the PDF viewer from outside (e.g. annotation sidebar)
  const goToPageRef = useRef<((page: number) => void) | null>(null);

  // Save reader state to cache on unmount (preserve state across tab switches)
  const stateRef = useRef({
    layoutMode,
    leftWidth,
    showCitationSidebar,
    chatInput,
    previewModalOpen,
    searchResults: searchResults as unknown[],
    searchQuery,
    previewNoPdfUrl,
  });
  // Keep ref in sync without triggering effect
  stateRef.current = {
    layoutMode,
    leftWidth,
    showCitationSidebar,
    chatInput,
    previewModalOpen,
    searchResults: searchResults as unknown[],
    searchQuery,
    previewNoPdfUrl,
  };
  useEffect(() => {
    return () => {
      if (shortId) {
        saveReaderState(shortId, stateRef.current);
      }
    };
  }, [shortId]);
  const [selectedCitation, setSelectedCitation] = useState<{
    marker: any;
    reference: any;
  } | null>(null);
  const [cachedReferences, setCachedReferences] = useState<CachedReference[]>([]);

  // Agent stream (uses MessageStream, same as task detail page)
  const {
    messages: agentMessages,
    status: agentStatus,
    permissionRequest: agentPermissionRequest,
    setPermissionRequest: setAgentPermissionRequest,
  } = useAgentStream(agentTodoId ?? '', agentTodoIdRef);
  const agentRunning = agentStatus === 'running' || agentStatus === 'initializing';

  // When agent stops (cancelled/failed), clear the runId so the next message
  // triggers a new run on the same todo (which will resume the previous session).
  useEffect(() => {
    if (agentStatus === 'cancelled' || agentStatus === 'failed') {
      setAgentRunId(null);
      agentRunIdRef.current = null;
    }
  }, [agentStatus]);

  // Combine historic messages with live stream messages so the full conversation is visible.
  // Deduplicate by msgId in case historic and stream overlap during recovery.
  const streamBased = useMemo(() => {
    if (agentMessages.length === 0) return historicMessages;
    const historicIds = new Set(historicMessages.map((m: any) => m.msgId));
    const newStreamMsgs = agentMessages.filter((m: any) => !historicIds.has(m.msgId));
    return [...historicMessages, ...newStreamMsgs];
  }, [historicMessages, agentMessages]);
  // Merge local user messages with stream/historic messages chronologically.
  // Local user messages have createdAt timestamps; stream messages also have createdAt.
  // This ensures multi-turn conversations display in correct order:
  //   user1 → assistant1 → user2 → assistant2 (not user1 → user2 → assistant1 → assistant2)
  const streamMsgIds = new Set(streamBased.map((m: any) => m.msgId as string));
  const pendingLocalMessages = localUserMessages.filter((m) => !streamMsgIds.has(m.msgId));
  const displayMessages = (() => {
    if (pendingLocalMessages.length === 0) return streamBased;
    if (streamBased.length === 0) return [...pendingLocalMessages];
    // Merge by createdAt timestamp for correct chronological order
    const all = [...pendingLocalMessages, ...streamBased];
    all.sort((a: any, b: any) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });
    return all;
  })();

  // Debug logging for message display
  if (localUserMessages.length > 0) {
    console.log('[ReaderChat] Message display debug:', {
      localUserMessages: localUserMessages.length,
      agentMessages: agentMessages.length,
      historicMessages: historicMessages.length,
      streamBased: streamBased.length,
      displayMessages: displayMessages.length,
    });
  }

  // Extract user questions for Q&A index navigation
  const qaQuestions = useMemo(() => {
    let idx = 0;
    return displayMessages
      .filter((m: any) => m.type === 'text' && m.role === 'user')
      .map((m: any) => {
        idx++;
        const text = (m.content as { text: string }).text;
        return { index: idx, text: text.slice(0, 80), msgId: m.msgId };
      });
  }, [displayMessages]);

  // Rating
  const [rating, setRating] = useState<number | null>(null);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);

  const MIN_WIDTH = 20;
  const MAX_WIDTH = 60;
  const activePanel = searchParams.get('panel');

  // Load a specific chat session by todoId
  const loadChatSession = useCallback(
    async (todoId: string) => {
      try {
        const runs = await ipc.listAgentTodoRuns(todoId);
        if (runs.length === 0) return;

        const latestRun = runs[0];
        agentTodoIdRef.current = todoId;
        setAgentTodoId(todoId);
        setAgentRunId(latestRun.id);
        agentRunIdRef.current = latestRun.id;

        // First check if the task is still actively running in main process
        const activeStatus = await ipc.getActiveAgentTodoStatus(todoId);
        if (
          activeStatus &&
          (activeStatus.status === 'running' ||
            activeStatus.status === 'initializing' ||
            activeStatus.status === 'waiting_permission')
        ) {
          // Task is still running — combine DB messages from ALL runs with live runner messages.
          // Runner memory only has assistant/tool messages (pushUserMessage is a no-op).
          // User messages come from DB (persisted by createMessage in runTodo/sendMessage).
          const allDbMsgs: Awaited<ReturnType<typeof ipc.getAgentTodoRunMessages>> = [];
          for (const run of runs) {
            const runMsgs = await ipc.getAgentTodoRunMessages(run.id);
            allDbMsgs.push(...runMsgs);
          }
          const dbMsgs = allDbMsgs;
          const dbUserMsgs = dbMsgs
            .filter((m) => m.role === 'user')
            .map((m) => ({
              ...m,
              content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
              status: m.status ?? null,
            }));
          const liveMessages = activeStatus.messages.map((m) => ({
            ...m,
            content: typeof m.content === 'string' ? JSON.parse(m.content as string) : m.content,
            status: m.status ?? null,
          }));
          // Clean up user messages that may contain paper context
          for (const m of dbUserMsgs) {
            if (m.type === 'text') {
              const text = (m.content as { text: string }).text;
              const match = text.match(/(?:用户问题:\s*)([\s\S]*?)$/);
              if (match) {
                (m.content as { text: string }).text = match[1].trim();
              }
            }
          }
          const combined = [...dbUserMsgs, ...liveMessages];
          combined.sort((a: any, b: any) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return ta - tb;
          });
          setHistoricMessages(combined);
          return;
        }

        // Task completed/failed - load persisted messages from ALL runs of this todo.
        // Each follow-up creates a new run, so we need messages from all of them
        // to reconstruct the full conversation history.
        const allMsgs: Awaited<ReturnType<typeof ipc.getAgentTodoRunMessages>> = [];
        for (const run of runs) {
          const runMsgs = await ipc.getAgentTodoRunMessages(run.id);
          allMsgs.push(...runMsgs);
        }
        const msgs = allMsgs;
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
        // Clean up old user messages that may contain injected paper context.
        // Extract just the user question from "...用户问题: <question>" format.
        for (const m of merged) {
          if (m.role === 'user' && m.type === 'text') {
            const text = (m.content as { text: string }).text;
            const match = text.match(/(?:用户问题:\s*)([\s\S]*?)$/);
            if (match) {
              (m.content as { text: string }).text = match[1].trim();
            }
          }
        }
        // Sort chronologically — runs are loaded in desc order but messages should display asc
        merged.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ta - tb;
        });
        setHistoricMessages(merged);
      } catch (error) {
        console.error('Failed to load chat session:', error);
      }
    },
    [setAgentTodoId, setAgentRunId, setHistoricMessages],
  );

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
        // Load highlights
        ipc
          .listHighlights(p.id)
          .then(setHighlights)
          .catch(() => undefined);
        // Load cached references
        ipc
          .getExtractedRefs(p.id)
          .then((refs) => {
            setCachedReferences(
              refs.map((r) => ({
                id: r.id,
                refNumber: r.refNumber,
                text: r.text,
                title: r.title,
                authors: r.authors,
                year: r.year,
                doi: r.doi,
                arxivId: r.arxivId,
                url: (r as any).url ?? null,
                venue: (r as any).venue ?? null,
              })),
            );
          })
          .catch(() => undefined);
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

    // Check if URL specifies a specific todoId to load
    const urlTodoId = searchParams.get('todoId');
    if (urlTodoId) {
      // Load the specific chat session from URL
      loadChatSession(urlTodoId);
      return;
    }

    // Otherwise, auto-restore the most recent chat session for this paper
    const titlePrefix = `Chat: ${paper.title.slice(0, 60)}`;
    ipc
      .listAgentTodos()
      .then(async (todos) => {
        const match = todos
          .filter((t) => t.title === titlePrefix)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (match) {
          await loadChatSession(match.id);
        }
      })
      .catch(() => undefined);
  }, [paper?.id, searchParams, loadChatSession]);

  // Load chat sessions for history dropdown
  useEffect(() => {
    if (!paper) return;
    const titlePrefix = `Chat: ${paper.title.slice(0, 60)}`;
    ipc
      .listAgentTodos()
      .then(async (todos) => {
        const chatTodos = todos
          .filter((t) => t.title === titlePrefix)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // For each chat todo, get the latest run
        const sessions: { id: string; title: string; createdAt: string; runId: string | null }[] =
          [];
        for (const todo of chatTodos.slice(0, 10)) {
          const runs = await ipc.listAgentTodoRuns(todo.id);
          sessions.push({
            id: todo.id,
            title: todo.title,
            createdAt: todo.createdAt,
            runId: runs.length > 0 ? runs[0].id : null,
          });
        }
        setChatSessions(sessions);
      })
      .catch(() => undefined);
  }, [paper?.id]);

  // Close chat history / Q&A index dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (chatHistoryRef.current && !chatHistoryRef.current.contains(e.target as Node)) {
        setShowChatHistory(false);
      }
      if (qaIndexRef.current && !qaIndexRef.current.contains(e.target as Node)) {
        setShowQaIndex(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handler to load a chat session from history
  const handleLoadChatSession = useCallback(
    async (session: { id: string; title: string; runId: string | null }) => {
      if (!session.runId) return;

      // Reset current state first
      setAgentTodoId(null);
      setAgentRunId(null);
      setLocalUserMessages([]);
      agentRunIdRef.current = null;
      agentTodoIdRef.current = '';

      // Set todo/run refs so useAgentStream can pick up live events
      agentTodoIdRef.current = session.id;
      setAgentTodoId(session.id);
      setAgentRunId(session.runId);
      agentRunIdRef.current = session.runId;

      // Load messages from ALL runs of this todo
      const allRuns = await ipc.listAgentTodoRuns(session.id);

      // Check if the task is still actively running — recover live state if so
      const activeStatus = await ipc.getActiveAgentTodoStatus(session.id);
      if (
        activeStatus &&
        (activeStatus.status === 'running' ||
          activeStatus.status === 'initializing' ||
          activeStatus.status === 'waiting_permission')
      ) {
        // Combine DB messages from ALL runs with live runner messages
        const allDbMsgs: Awaited<ReturnType<typeof ipc.getAgentTodoRunMessages>> = [];
        for (const run of allRuns) {
          const runMsgs = await ipc.getAgentTodoRunMessages(run.id);
          allDbMsgs.push(...runMsgs);
        }
        const dbUserMsgs = allDbMsgs
          .filter((m) => m.role === 'user')
          .map((m) => ({
            ...m,
            content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
            status: m.status ?? null,
          }));
        const liveMessages = activeStatus.messages.map((m) => ({
          ...m,
          content: typeof m.content === 'string' ? JSON.parse(m.content as string) : m.content,
          status: m.status ?? null,
        }));
        for (const m of dbUserMsgs) {
          if (m.type === 'text') {
            const text = (m.content as { text: string }).text;
            const match = text.match(/(?:用户问题:\s*)([\s\S]*?)$/);
            if (match) {
              (m.content as { text: string }).text = match[1].trim();
            }
          }
        }
        const combined = [...dbUserMsgs, ...liveMessages];
        combined.sort((a: any, b: any) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ta - tb;
        });
        setHistoricMessages(combined);
        setShowChatHistory(false);
        setTimeout(() => textareaRef.current?.focus(), 0);
        return;
      }

      // Task completed/failed — load persisted messages from ALL runs
      const allMsgs: Awaited<ReturnType<typeof ipc.getAgentTodoRunMessages>> = [];
      for (const run of allRuns) {
        const runMsgs = await ipc.getAgentTodoRunMessages(run.id);
        allMsgs.push(...runMsgs);
      }
      const msgs = allMsgs;
      const parsed = msgs.map((m) => ({
        ...m,
        content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
      }));

      // Merge chunked messages (same logic as restore)
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

      // Clean up old user messages that may contain injected paper context
      for (const m of merged) {
        if (m.role === 'user' && m.type === 'text') {
          const text = (m.content as { text: string }).text;
          const match = text.match(/(?:用户问题:\s*)([\s\S]*?)$/);
          if (match) {
            (m.content as { text: string }).text = match[1].trim();
          }
        }
      }
      setHistoricMessages(merged);
      setShowChatHistory(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [],
  );

  // Reset agent state for new chat
  const handleNewChat = useCallback(() => {
    setChatInput('');
    setAgentTodoId(null);
    setAgentRunId(null);
    setLocalUserMessages([]);
    setHistoricMessages([]);
    agentRunIdRef.current = null;
    agentTodoIdRef.current = '';
    // Refresh chat sessions list
    if (paper) {
      const titlePrefix = `Chat: ${paper.title.slice(0, 60)}`;
      ipc
        .listAgentTodos()
        .then(async (todos) => {
          const chatTodos = todos
            .filter((t) => t.title === titlePrefix)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const sessions: { id: string; title: string; createdAt: string; runId: string | null }[] =
            [];
          for (const todo of chatTodos.slice(0, 10)) {
            const runs = await ipc.listAgentTodoRuns(todo.id);
            sessions.push({
              id: todo.id,
              title: todo.title,
              createdAt: todo.createdAt,
              runId: runs.length > 0 ? runs[0].id : null,
            });
          }
          setChatSessions(sessions);
        })
        .catch(() => undefined);
    }
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [paper]);

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text && attachedQuotes.length === 0) return;
    if (agentRunning) {
      showWarning('Agent is still running, please wait');
      return;
    }
    if (!paper) {
      showError('Paper data not loaded');
      return;
    }
    if (!chatModel) {
      showError('Please select an agent first (Settings > Agents)');
      return;
    }

    setChatInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Build full prompt: attached quotes (from PDF selections) + user message + attached papers
    let fullText = text;
    if (attachedQuotes.length > 0) {
      const userQuestion = text || 'Explain these passages';
      const quotesText = attachedQuotes.map((q, i) => `[${i + 1}] "${q}"`).join('\n\n');
      fullText = `${userQuestion}\n\n--- Selected text from paper ---\n${quotesText}`;
      setAttachedQuotes([]);
    }
    if (attachedPapers.length > 0) {
      const ctx = attachedPapers
        .map((p) => `Paper: "${p.title}"\nAbstract: ${p.abstract ?? 'N/A'}`)
        .join('\n\n');
      fullText = `${fullText}\n\n--- Attached Papers ---\n${ctx}`;
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
      createdAt: new Date().toISOString(),
    };
    setLocalUserMessages((prev) => [...prev, userMsg]);

    const cwd = paperDir ?? undefined;
    const agentId = chatModel.id;

    try {
      const runId = agentRunIdRef.current;
      const isRunning = agentStatus === 'running' || agentStatus === 'initializing';

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
      } else if (!runId || !isRunning) {
        // No active run or agent stopped: resume the existing todo with a new run.
        await ipc.updateAgentTodo(agentTodoId, { prompt: fullText });
        const run = await ipc.runAgentTodo(agentTodoId);
        setAgentRunId(run.id);
        agentRunIdRef.current = run.id;
      } else {
        // Follow-up message: send to existing active run
        await ipc.sendAgentMessage(agentTodoId, runId, fullText);
      }
    } catch (err) {
      showError(`Failed to send message: ${(err as Error).message}`);
    }
  }, [
    chatInput,
    agentRunning,
    paper,
    chatModel,
    agentTodoId,
    paperDir,
    attachedPapers,
    agentStatus,
    showError,
    showWarning,
  ]);

  const handleChatKill = useCallback(async () => {
    if (agentTodoId) {
      await ipc.stopAgentTodo(agentTodoId);
    }
  }, [agentTodoId]);

  const handleSummarize = useCallback(async () => {
    if (agentRunning || !paper || !chatModel) return;
    const prompt = t('papers.summarizePrompt');
    const msgId = `local-user-${Date.now()}`;
    setLocalUserMessages((prev) => [
      ...prev,
      {
        id: msgId,
        msgId,
        type: 'text' as const,
        role: 'user' as const,
        content: { text: prompt },
        status: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    const cwd = paperDir ?? undefined;
    const agentId = chatModel.id;
    if (!agentTodoId) {
      const paperContext = [
        t('papers.currentPaper', { title: paper.title }),
        ...(cwd ? [t('papers.workingDirectory', { dir: cwd })] : []),
        ...(cwd ? [`PDF路径: ${cwd}/paper.pdf`] : []),
        ...(cwd ? [`文本路径: ${cwd}/text.txt`] : []),
      ].join('\n');
      const todo = await ipc.createAgentTodo({
        title: `Chat: ${paper.title.slice(0, 60)}`,
        prompt: `${paperContext}\n\n---\n\n用户问题: ${prompt}`,
        cwd: cwd ?? '',
        agentId,
      });
      agentTodoIdRef.current = todo.id;
      setAgentTodoId(todo.id);
      const run = await ipc.runAgentTodo(todo.id);
      setAgentRunId(run.id);
      agentRunIdRef.current = run.id;
    } else {
      const runId = agentRunIdRef.current;
      const isRunning = agentStatus === 'running' || agentStatus === 'initializing';
      if (!runId || !isRunning) {
        // No active run: create a new run
        await ipc.updateAgentTodo(agentTodoId, { prompt });
        const run = await ipc.runAgentTodo(agentTodoId);
        setAgentRunId(run.id);
        agentRunIdRef.current = run.id;
      } else {
        // Send to existing active run
        await ipc.sendAgentMessage(agentTodoId, runId, prompt);
      }
    }
  }, [t, agentRunning, paper, chatModel, agentTodoId, paperDir, agentStatus]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
        return;

      switch (e.key) {
        case 'f':
          // F = toggle focus mode
          e.preventDefault();
          setFocusMode((v) => !v);
          break;
        case '1':
          // 1 = chat only
          setLayoutMode('chat-only');
          break;
        case '2':
          // 2 = split
          setLayoutMode('split');
          break;
        case '3':
          // 3 = pdf only
          setLayoutMode('pdf-only');
          break;
        case 'Escape':
          // ESC exits focus mode
          if (focusMode) {
            setFocusMode(false);
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode]);

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
      {/* Toolbar - hidden in focus mode */}
      {!focusMode && (
        <div className="relative flex flex-shrink-0 items-center border-b border-notion-border px-4 py-2">
          {/* Left: back + star */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                // If chat/split view is open, first go back to PDF-only
                if (layoutMode !== 'pdf-only') {
                  setLayoutMode('pdf-only');
                  return;
                }
                const from = (location.state as { from?: string })?.from;
                if (from === '/discovery' || from === '/discovery/preview') {
                  navigate(from);
                } else {
                  navigate(`/papers/${paper.shortId}`);
                }
              }}
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
                title="Chat only (1)"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  layoutMode === 'chat-only'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-notion-text-secondary hover:bg-white/60 hover:text-notion-text'
                }`}
              >
                <MessageSquare size={14} />
              </button>
              <button
                onClick={() => setLayoutMode('split')}
                title="Split view (2)"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  layoutMode === 'split'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-notion-text-secondary hover:bg-white/60 hover:text-notion-text'
                }`}
              >
                <Columns2 size={14} />
              </button>
              <button
                onClick={() => setLayoutMode('pdf-only')}
                title="PDF only (3)"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  layoutMode === 'pdf-only'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-notion-text-secondary hover:bg-white/60 hover:text-notion-text'
                }`}
              >
                <FileText size={14} />
              </button>
            </div>
          </div>

          {/* Right: annotations + focus mode + shortcuts hint */}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowAnnotationSidebar((v) => !v)}
              title={t('reader.annotations')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                showAnnotationSidebar
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-notion-text-secondary hover:bg-notion-sidebar/50'
              }`}
            >
              <StickyNote size={14} />
            </button>
            <button
              onClick={async () => {
                if (!paper) return;
                try {
                  const result = await ipc.exportHighlightsMarkdown(paper.id);
                  if (
                    !result.markdown.includes('## Highlights') &&
                    !result.markdown.includes('## Reading Notes')
                  ) {
                    showInfo(t('reader.noHighlightsToExport' as any));
                    return;
                  }
                  await navigator.clipboard.writeText(result.markdown);
                  showSuccess(t('reader.exportCopied' as any));
                } catch {
                  showError('Export failed');
                }
              }}
              title={t('reader.exportHighlights' as any)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
            >
              <ClipboardCopy size={14} />
            </button>
            <button
              onClick={() => setFocusMode(true)}
              title={t('reader.focusMode') + ' (F)'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Focus mode: minimal floating controls */}
      {focusMode && (
        <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-notion-border/50 bg-white/80 p-1 shadow-sm backdrop-blur-sm">
          <button
            onClick={() => setFocusMode(false)}
            title={t('reader.exitFocusMode') + ' (Esc)'}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Minimize2 size={12} />
          </button>
        </div>
      )}

      {/* Split pane */}
      <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        {layoutMode !== 'pdf-only' && (
          <div
            className="flex flex-col"
            style={{ width: layoutMode === 'chat-only' ? '100%' : `${leftWidth}%` }}
          >
            {/* Chat Header */}
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-notion-border px-4 py-2">
              <button
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
              >
                <Plus size={14} />
                New Chat
              </button>

              {/* Chat History Dropdown */}
              <div ref={chatHistoryRef} className="relative">
                <button
                  onClick={() => setShowChatHistory(!showChatHistory)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                >
                  <History size={14} />
                  History
                  <ChevronDown size={12} />
                </button>

                <AnimatePresence>
                  {showChatHistory && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-notion-border bg-white shadow-lg"
                    >
                      <div className="max-h-64 overflow-y-auto notion-scrollbar p-1">
                        {chatSessions.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-notion-text-tertiary">
                            No chat history
                          </div>
                        ) : (
                          chatSessions.map((session) => (
                            <div
                              key={session.id}
                              className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-notion-sidebar"
                            >
                              <button
                                onClick={() => handleLoadChatSession(session)}
                                className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-sm text-notion-text-secondary transition-colors hover:text-notion-text"
                              >
                                <MessageSquare size={14} className="flex-shrink-0" />
                                <span
                                  className="truncate text-xs"
                                  title={session.title.replace('Chat: ', '')}
                                >
                                  {session.title.replace('Chat: ', '')}
                                </span>
                                <span className="flex-shrink-0 text-[10px] text-notion-text-tertiary">
                                  {formatRelativeTime(session.createdAt)}
                                </span>
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm('Delete this chat history?')) {
                                    await ipc.deleteAgentTodo(session.id);
                                    setChatSessions((prev) =>
                                      prev.filter((s) => s.id !== session.id),
                                    );
                                    // If the deleted session is currently displayed, clear chat state
                                    if (agentTodoId === session.id) {
                                      setAgentTodoId(null);
                                      setAgentRunId(null);
                                      setLocalUserMessages([]);
                                      setHistoricMessages([]);
                                      agentRunIdRef.current = null;
                                      agentTodoIdRef.current = '';
                                    }
                                  }
                                }}
                                className="flex-shrink-0 rounded p-1 text-notion-text-tertiary hover:bg-red-50 hover:text-red-500"
                                title="Delete"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Q&A Index Dropdown */}
              {agentTodoId && qaQuestions.length > 0 && (
                <div ref={qaIndexRef} className="relative ml-auto">
                  <button
                    onClick={() => setShowQaIndex(!showQaIndex)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                    title={t('reader.ai.qaIndex', 'Jump to Q&A')}
                  >
                    <List size={14} />
                    <span className="tabular-nums">{qaQuestions.length}</span>
                    <ChevronsUpDown size={12} />
                  </button>

                  <AnimatePresence>
                    {showQaIndex && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-notion-border bg-white shadow-lg"
                      >
                        <div className="border-b border-notion-border px-3 py-2">
                          <p className="text-xs font-medium text-notion-text-secondary">
                            {t('reader.ai.qaIndexTitle', 'Questions')} ({qaQuestions.length})
                          </p>
                        </div>
                        <div className="max-h-72 overflow-y-auto notion-scrollbar p-1">
                          {qaQuestions.map((q) => (
                            <button
                              key={q.index}
                              onClick={() => {
                                const el = document.getElementById(`qa-user-${q.index}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  // Brief highlight effect
                                  el.classList.add('ring-2', 'ring-blue-400', 'rounded-lg');
                                  setTimeout(() => {
                                    el.classList.remove('ring-2', 'ring-blue-400', 'rounded-lg');
                                  }, 1500);
                                }
                                setShowQaIndex(false);
                              }}
                              className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-notion-sidebar"
                            >
                              <span className="flex-shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-notion-sidebar text-[10px] font-semibold text-notion-text-secondary tabular-nums">
                                {q.index}
                              </span>
                              <span className="line-clamp-2 text-xs text-notion-text leading-relaxed">
                                {q.text}
                              </span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="notion-scrollbar flex-1 overflow-y-auto">
              {!agentTodoId &&
                (chatModel ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 pt-12 text-center">
                    <AgentLogo tool={chatModel.agentTool} size={24} />
                    <p className="text-sm font-medium text-notion-text-secondary">
                      {chatModel.name}
                    </p>
                    <p className="text-xs text-notion-text-tertiary">
                      {t('reader.ai.chatHint', 'Ask anything about this paper')}
                    </p>
                    {/* Preset question buttons */}
                    <div className="mt-2 flex flex-col gap-1.5 w-full max-w-xs">
                      {[
                        {
                          key: 'contribution',
                          label: t('reader.ai.presetContribution', "What's the main contribution?"),
                        },
                        {
                          key: 'methodology',
                          label: t('reader.ai.presetMethodology', 'Explain the methodology'),
                        },
                        {
                          key: 'results',
                          label: t('reader.ai.presetResults', 'Summarize the key results'),
                        },
                        {
                          key: 'limitations',
                          label: t('reader.ai.presetLimitations', 'What are the limitations?'),
                        },
                      ].map((q) => (
                        <button
                          key={q.key}
                          onClick={() => {
                            setChatInput(q.label);
                            setTimeout(() => handleChatSend(), 50);
                          }}
                          disabled={agentRunning}
                          className="rounded-lg border border-notion-border bg-white px-3 py-2 text-left text-xs text-notion-text-secondary transition-colors hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 disabled:opacity-40"
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
                    <p className="text-xs text-notion-text-tertiary">
                      {t('reader.ai.selectAgent', 'Select an agent above to chat about this paper')}
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
              <div className="mx-auto mb-2 flex w-full max-w-2xl gap-1.5 flex-wrap">
                <button
                  onClick={handleSummarize}
                  disabled={agentRunning || !chatModel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-xs font-medium text-notion-text-secondary shadow-sm transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
                >
                  <Zap size={12} />
                  {t('reader.ai.summarize', 'Summarize')}
                </button>
                <button
                  onClick={() => {
                    setChatInput(
                      t('reader.ai.presetContribution', "What's the main contribution?"),
                    );
                    setTimeout(() => handleChatSend(), 50);
                  }}
                  disabled={agentRunning || !chatModel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-xs font-medium text-notion-text-secondary shadow-sm transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
                >
                  {t('reader.ai.presetContribution', "What's the main contribution?")}
                </button>
              </div>
              <div className="mx-auto w-full max-w-2xl">
                <div className="rounded-2xl border border-notion-border bg-white shadow-sm transition-all">
                  {/* Attached quotes from PDF selections */}
                  {attachedQuotes.length > 0 && (
                    <div className="mx-3 mt-3 flex flex-col gap-1.5">
                      {attachedQuotes.map((q, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-3 text-xs italic text-notion-text-secondary leading-relaxed">
                              &ldquo;{q}&rdquo;
                            </p>
                            <button
                              onClick={() =>
                                setAttachedQuotes((prev) => prev.filter((_, j) => j !== i))
                              }
                              className="mt-0.5 flex-shrink-0 rounded p-0.5 text-notion-text-tertiary hover:text-red-400"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Attached paper chips */}
                  {attachedPapers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                      {attachedPapers.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-600"
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
                                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 ${
                                      chatModel?.id === agent.id
                                        ? 'bg-blue-50 text-blue-600'
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
                                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-blue-50 ${
                                          isAttached
                                            ? 'bg-blue-50 text-blue-600'
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
                        disabled={
                          (!chatInput.trim() && attachedQuotes.length === 0) ||
                          !chatModel ||
                          agentRunning
                        }
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
            className="relative flex min-w-0 flex-1 flex-col overflow-x-clip"
            style={
              layoutMode !== 'pdf-only'
                ? { maxWidth: `${100 - leftWidth}%`, flexBasis: `${100 - leftWidth}%` }
                : undefined
            }
          >
            {pdfPath ? (
              <PdfViewer
                path={pdfPath}
                paperId={paper?.id}
                cachedReferences={cachedReferences}
                onReferencesExtracted={(refs) => setCachedReferences(refs)}
                initialPage={
                  (location.state as { initialPage?: number } | null)?.initialPage ??
                  paper?.lastReadPage ??
                  undefined
                }
                forceInitialPage={
                  (location.state as { initialPage?: number } | null)?.initialPage != null
                }
                initialPageYOffset={
                  (location.state as { initialPageYOffset?: number } | null)?.initialPageYOffset
                }
                onFileNotFound={() =>
                  setPaper((prev) => (prev ? { ...prev, pdfPath: undefined } : prev))
                }
                onPageChange={(page, total) => {
                  if (paper) {
                    ipc.updateReadingProgress(paper.id, page, total).catch(() => undefined);
                  }
                }}
                onAskAI={(text) => {
                  setAttachedQuotes((prev) => [...prev, text]);
                  if (layoutMode === 'pdf-only') setLayoutMode('split');
                  setTimeout(() => textareaRef.current?.focus(), 100);
                }}
                highlights={highlights}
                onCreateHighlight={
                  paper
                    ? (params) => {
                        ipc
                          .createHighlight({ ...params, paperId: paper.id })
                          .then((h) => {
                            setHighlights((prev) => [...prev, h]);
                            // Auto-open annotation sidebar so user can add a note
                            setShowAnnotationSidebar(true);
                            // Fire-and-forget: auto-suggest AI note for longer highlights
                            if (h.text && h.text.length > 20) {
                              ipc
                                .readerInlineAI({
                                  paperId: paper.id,
                                  action: 'suggestNote',
                                  selectedText: h.text,
                                  language: i18n.language,
                                })
                                .then((aiResult) => {
                                  if (aiResult?.result) {
                                    ipc
                                      .updateHighlight(h.id, { aiNote: aiResult.result })
                                      .then((updated) => {
                                        setHighlights((prev) =>
                                          prev.map((x) => (x.id === h.id ? updated : x)),
                                        );
                                        showSuccess(t('reader.ai.noteSuggested'));
                                      })
                                      .catch(() => undefined);
                                  }
                                })
                                .catch(() => undefined);
                            }
                          })
                          .catch(() => undefined);
                      }
                    : undefined
                }
                onDeleteHighlight={(id) => {
                  ipc
                    .deleteHighlight(id)
                    .then(() => setHighlights((prev) => prev.filter((x) => x.id !== id)))
                    .catch(() => undefined);
                }}
                onOpenUrl={(url) => {
                  // Try to detect arXiv ID from various URL patterns
                  const arxivMatch = url.match(
                    /(?:arxiv\.org\/(?:abs|pdf)|alphaxiv\.org\/(?:abs|overview))\/(\d{4}\.\d{4,5})/,
                  );
                  if (arxivMatch) {
                    const arxivId = arxivMatch[1];
                    ipc
                      .getPaperByShortId(arxivId)
                      .then((existing) => {
                        if (existing) {
                          openTab(`/papers/${existing.shortId}/reader`);
                        } else {
                          showInfo(`Downloading ${arxivId}...`);
                          ipc
                            .downloadPaper(arxivId, [], true)
                            .then((result) => {
                              if (result?.paper) {
                                showSuccess('Paper ready');
                                openTab(`/papers/${result.paper.shortId}/reader`);
                              }
                            })
                            .catch(() => {
                              showError('Download failed');
                            });
                        }
                      })
                      .catch(() => showError('Failed to check paper'));
                  } else {
                    // For DOI and other URLs, try to import via the download service
                    // which can resolve DOIs and direct PDF URLs
                    showInfo('Opening paper...');
                    ipc
                      .downloadPaper(url, [], true)
                      .then((result) => {
                        if (result?.paper) {
                          showSuccess('Paper ready');
                          openTab(`/papers/${result.paper.shortId}/reader`);
                        } else {
                          showError('Could not import paper');
                        }
                      })
                      .catch(() => {
                        showError('Failed to import paper');
                      });
                  }
                }}
                onSearchPaper={(query) => {
                  // Search for paper by selected text (title/reference)
                  // Use smart cleaning to strip venue info, author prefixes, etc.
                  const cleanQuery = cleanCitationSearchQuery(query);

                  // Detect input type
                  const arxivMatch = cleanQuery.match(/(\d{4}\.\d{4,5})/);
                  const arxivId = arxivMatch ? arxivMatch[1] : undefined;
                  const isDoi = /^10\.\d{4,}\/\S+$/.test(cleanQuery);

                  // Show preview modal with search results
                  setSearchQuery(cleanQuery);
                  setSearchLoading(true);
                  setSearchResults([]);
                  setPreviewNoPdfUrl(null);
                  setPreviewModalOpen(true);

                  // If DOI, try to download/import directly instead of text search
                  if (isDoi) {
                    ipc
                      .downloadPaper(cleanQuery, [], true)
                      .then((result) => {
                        if (result?.paper) {
                          const p = result.paper;
                          setSearchResults([
                            {
                              paperId: p.id,
                              title: p.title,
                              authors: (p.authors ?? []).map((name: string) => ({ name })),
                              year: p.submittedAt ? new Date(p.submittedAt).getFullYear() : null,
                              abstract: p.abstract ?? null,
                              citationCount: 0,
                              externalIds: { ArXiv: p.shortId || undefined },
                              url: p.sourceUrl ?? null,
                            },
                          ]);
                        } else {
                          showInfo(t('pdf.preview.noResults'));
                        }
                      })
                      .catch(() => {
                        // DOI resolve failed, fall back to text search
                        return ipc.searchPapers(cleanQuery, 10).then((response) => {
                          setSearchResults(response.results);
                          if (response.results.length === 0) {
                            showInfo(t('pdf.preview.noResults'));
                          }
                        });
                      })
                      .finally(() => setSearchLoading(false));
                    return;
                  }

                  // First try local DB match, then fall back to OpenAlex search
                  ipc
                    .matchReference({ arxivId, title: cleanQuery })
                    .then((localPaper) => {
                      if (localPaper) {
                        // Convert PaperItem to SearchResult format
                        const localResult: SearchResult = {
                          paperId: localPaper.id,
                          title: localPaper.title,
                          authors: (localPaper.authors ?? []).map((name) => ({ name })),
                          year:
                            localPaper.year ??
                            (localPaper.submittedAt
                              ? new Date(localPaper.submittedAt).getFullYear()
                              : null),
                          abstract: localPaper.abstract ?? null,
                          citationCount: 0,
                          externalIds: {
                            ArXiv: localPaper.shortId || undefined,
                          },
                          url: localPaper.sourceUrl ?? null,
                        };
                        setSearchResults([localResult]);
                        setSearchLoading(false);
                        return;
                      }

                      // No local match, fall back to OpenAlex search
                      return ipc.searchPapers(cleanQuery, 10).then((response) => {
                        setSearchResults(response.results);
                        if (response.results.length === 0) {
                          showInfo(t('pdf.preview.noResults'));
                        }
                      });
                    })
                    .catch((err) => {
                      // Show error in modal instead of opening browser
                      setPreviewModalOpen(false);
                      showError(
                        `Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                      );
                    })
                    .finally(() => {
                      setSearchLoading(false);
                    });
                }}
                onUpdateHighlight={(id, params) => {
                  ipc
                    .updateHighlight(id, params)
                    .then((updated) =>
                      setHighlights((prev) => prev.map((x) => (x.id === id ? updated : x))),
                    )
                    .catch(() => undefined);
                }}
                showCitationSidebar={showCitationSidebar}
                onToggleCitationSidebar={() => {
                  setShowCitationSidebar((v) => !v);
                  setShowAIOutlineSidebar(false);
                }}
                showAIOutlineSidebar={showAIOutlineSidebar}
                onToggleAIOutlineSidebar={() => {
                  setShowAIOutlineSidebar((v) => !v);
                  setShowCitationSidebar(false);
                }}
                shortId={shortId}
                goToPageRef={goToPageRef}
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
                                className="h-full rounded-full bg-blue-500 transition-all duration-150"
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

        {/* Annotation sidebar */}
        {showAnnotationSidebar && (
          <>
            {/* Resize handle */}
            <div
              className="group flex w-1 cursor-col-resize items-center justify-center hover:bg-blue-400/50 active:bg-blue-400 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                annotationResizing.current = true;
                const startX = e.clientX;
                const startW = annotationSidebarWidth;
                const onMove = (ev: MouseEvent) => {
                  if (!annotationResizing.current) return;
                  // Dragging left increases width
                  const newW = Math.max(200, Math.min(500, startW - (ev.clientX - startX)));
                  setAnnotationSidebarWidth(newW);
                };
                const onUp = () => {
                  annotationResizing.current = false;
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <div
              className="flex flex-shrink-0 flex-col border-l border-notion-border bg-white"
              style={{ width: annotationSidebarWidth }}
            >
              <div className="flex items-center justify-between border-b border-notion-border px-3 py-2">
                <span className="text-xs font-medium text-notion-text">
                  {t('reader.annotations')} ({highlights.length})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (!paper || highlights.length === 0 || generatingSummary) return;
                      setGeneratingSummary(true);
                      ipc
                        .readerReadingSummary({
                          paperId: paper.id,
                          highlights: highlights.map((h) => ({
                            text: h.text,
                            note: h.note || '',
                            color: h.color,
                            page: h.pageNumber,
                          })),
                          language: i18n.language,
                        })
                        .then((res) => {
                          if (res?.summary) {
                            setChatInput(res.summary);
                            if (layoutMode === 'pdf-only') setLayoutMode('split');
                            setTimeout(() => textareaRef.current?.focus(), 100);
                          }
                        })
                        .catch(() => showError('Failed to generate summary'))
                        .finally(() => setGeneratingSummary(false));
                    }}
                    disabled={highlights.length === 0 || generatingSummary}
                    title={t('reader.ai.generateSummary')}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
                  >
                    {generatingSummary ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    {generatingSummary
                      ? t('reader.ai.generatingSummary')
                      : t('reader.ai.generateSummary')}
                  </button>
                  <button
                    onClick={() => setShowAnnotationSidebar(false)}
                    className="rounded p-1 text-notion-text-tertiary hover:bg-notion-sidebar"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="notion-scrollbar flex-1 overflow-y-auto">
                {highlights.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-notion-text-tertiary">
                    {t('reader.noAnnotations')}
                  </div>
                ) : (
                  (() => {
                    // Group highlights by page
                    const byPage = new Map<number, typeof highlights>();
                    for (const h of [...highlights].sort((a, b) => a.pageNumber - b.pageNumber)) {
                      const arr = byPage.get(h.pageNumber) ?? [];
                      arr.push(h);
                      byPage.set(h.pageNumber, arr);
                    }
                    return Array.from(byPage.entries()).map(([page, items]) => (
                      <div key={page} className="border-b border-notion-border/50">
                        <div className="sticky top-0 bg-notion-sidebar/50 px-3 py-1">
                          <span className="text-[10px] font-medium text-notion-text-tertiary">
                            {t('reader.page')} {page}
                          </span>
                        </div>
                        {items.map((h) => (
                          <AnnotationCard
                            key={h.id}
                            highlight={h}
                            onJumpToPage={(page) => goToPageRef.current?.(page)}
                            onAddNote={(text) => {
                              ipc
                                .addHighlightNote(h.id, text)
                                .then((updated) =>
                                  setHighlights((prev) =>
                                    prev.map((x) => (x.id === h.id ? updated : x)),
                                  ),
                                )
                                .catch(() => undefined);
                            }}
                            onUpdateNoteEntry={(noteId, text) => {
                              ipc
                                .updateHighlightNote(h.id, noteId, text)
                                .then((updated) =>
                                  setHighlights((prev) =>
                                    prev.map((x) => (x.id === h.id ? updated : x)),
                                  ),
                                )
                                .catch(() => undefined);
                            }}
                            onDeleteNoteEntry={(noteId) => {
                              ipc
                                .deleteHighlightNote(h.id, noteId)
                                .then((updated) =>
                                  setHighlights((prev) =>
                                    prev.map((x) => (x.id === h.id ? updated : x)),
                                  ),
                                )
                                .catch(() => undefined);
                            }}
                            onDelete={() => {
                              ipc
                                .deleteHighlight(h.id)
                                .then(() =>
                                  setHighlights((prev) => prev.filter((x) => x.id !== h.id)),
                                )
                                .catch(() => undefined);
                            }}
                            onGenerateAiNote={
                              paper
                                ? async () => {
                                    try {
                                      const aiResult = await ipc.readerInlineAI({
                                        paperId: paper.id,
                                        action: 'suggestNote',
                                        selectedText: h.text,
                                        language: i18n.language,
                                      });
                                      if (aiResult?.result) {
                                        const updated = await ipc.updateHighlight(h.id, {
                                          aiNote: aiResult.result,
                                        });
                                        setHighlights((prev) =>
                                          prev.map((x) => (x.id === h.id ? updated : x)),
                                        );
                                        showSuccess(t('reader.ai.noteSuggested'));
                                      }
                                    } catch {
                                      // silently ignore
                                    }
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    ));
                  })()
                )}
              </div>
            </div>
          </>
        )}

        {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}
      </div>

      {/* Rating Prompt Modal */}
      <RatingPromptModal
        isOpen={showRatingPrompt}
        onRate={handleRatingPromptRate}
        onSkip={handleRatingPromptSkip}
      />

      {/* Paper Preview Modal */}
      <PaperPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        results={searchResults}
        isLoading={searchLoading}
        query={searchQuery}
        isDownloading={previewDownloading}
        noPdfUrl={previewNoPdfUrl}
        onOpenWebsite={(url) => {
          window.electronAPI?.openBrowser(url);
        }}
        onDownload={async (result) => {
          setPreviewDownloading(true);
          setPreviewNoPdfUrl(null);
          try {
            // Prefer arXiv ID, then DOI, then title as last resort
            const downloadInput = result.externalIds.ArXiv
              ? result.externalIds.ArXiv
              : result.externalIds.DOI
                ? result.externalIds.DOI
                : result.title;

            const downloadResult = await ipc.downloadPaper(downloadInput, [], true);
            if (downloadResult?.paper) {
              if (downloadResult.download?.success) {
                showSuccess(t('pdf.citation.downloaded'));
                setPreviewModalOpen(false);
                openTab(`/papers/${downloadResult.paper.shortId}/reader`);
              } else {
                // No PDF — stay in modal, show "Open website" option
                const doi = result.externalIds.DOI;
                setPreviewNoPdfUrl(doi ? `https://doi.org/${doi}` : (result.url ?? null));
              }
            } else {
              showError('Download failed - paper not found');
            }
          } catch (err) {
            showError(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          } finally {
            setPreviewDownloading(false);
          }
        }}
      />
    </div>
  );
}
