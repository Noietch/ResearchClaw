import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, useBlocker } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import { PdfViewer } from '../../../components/pdf-viewer';
import { MarkdownContent } from '../../../components/markdown-content';
import {
  ipc,
  onIpc,
  type PaperItem,
  type PaperAnalysis,
  type ReadingNote,
  type ModelConfig,
} from '../../../hooks/use-ipc';
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
  Sparkles,
  Target,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

type AiStatus = 'idle' | 'extracting_pdf' | 'thinking';

function isPaperAnalysis(value: unknown): value is PaperAnalysis {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return [
    'summary',
    'problem',
    'method',
    'contributions',
    'evidence',
    'limitations',
    'applications',
    'questions',
    'tags',
  ].some((key) => key in source);
}

function normalizeAnalysis(value: unknown): PaperAnalysis {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const toText = (input: unknown) => (typeof input === 'string' ? input : '');
  const toList = (input: unknown) => {
    if (Array.isArray(input)) {
      return input.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
    }
    if (typeof input === 'string') {
      return input
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  };

  return {
    summary: toText(source.summary),
    problem: toText(source.problem),
    method: toText(source.method),
    contributions: toList(source.contributions),
    evidence: toText(source.evidence),
    limitations: toList(source.limitations),
    applications: toList(source.applications),
    questions: toList(source.questions),
    tags: toList(source.tags),
  };
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-notion-text-secondary">
        {title}
      </div>
      <ul className="space-y-1 text-sm text-notion-text">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-notion-text-secondary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReaderAnalysisSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-purple-100 bg-white/90 p-4 shadow-sm">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-700/80">
        {title}
      </div>
      {children}
    </div>
  );
}

function AnalysisStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-purple-100 bg-white/80 px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-500/80">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-notion-text">{value}</div>
    </div>
  );
}

function AnalysisTagPill({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
      {tag}
    </span>
  );
}

function analysisToDraft(analysis: PaperAnalysis) {
  return {
    summary: analysis.summary ?? '',
    problem: analysis.problem ?? '',
    method: analysis.method ?? '',
    contributions: (analysis.contributions ?? []).join('\n'),
    limitations: (analysis.limitations ?? []).join('\n'),
  };
}

function draftToAnalysis(
  analysis: PaperAnalysis,
  draft: ReturnType<typeof analysisToDraft>,
): PaperAnalysis {
  const toLines = (value: string) =>
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    ...analysis,
    summary: draft.summary.trim(),
    problem: draft.problem.trim(),
    method: draft.method.trim(),
    contributions: toLines(draft.contributions),
    limitations: toLines(draft.limitations),
  };
}

function analysisToNoteSections(analysis: PaperAnalysis): Record<string, string> {
  const joinList = (items: string[]) => items.map((item) => `- ${item}`).join('\n');

  return Object.fromEntries(
    [
      ['AI Summary', analysis.summary.trim()],
      ['AI Problem', analysis.problem.trim()],
      ['AI Method', analysis.method.trim()],
      ['AI Evidence', analysis.evidence.trim()],
      ['AI Contributions', joinList(analysis.contributions ?? [])],
      ['AI Applications', joinList(analysis.applications ?? [])],
      ['AI Limitations', joinList(analysis.limitations ?? [])],
      ['AI Questions', joinList(analysis.questions ?? [])],
      ['AI Tags', (analysis.tags ?? []).join(', ')],
    ].filter(([, value]) => value),
  );
}

function ReaderAnalysisCard({
  note,
  onSaved,
  onSendToNotes,
}: {
  note: ReadingNote;
  onSaved: (note: ReadingNote) => void;
  onSendToNotes: (analysis: PaperAnalysis) => Promise<void>;
}) {
  const analysis = normalizeAnalysis(note.content);
  const contributions = analysis.contributions ?? [];
  const limitations = analysis.limitations ?? [];
  const applications = analysis.applications ?? [];
  const questions = analysis.questions ?? [];
  const tags = analysis.tags ?? [];
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingToNotes, setSendingToNotes] = useState(false);
  const [viewMode, setViewMode] = useState<'pretty' | 'raw'>('pretty');
  const [draft, setDraft] = useState(() => analysisToDraft(analysis));
  const summary = analysis.summary.trim();
  const evidence = analysis.evidence.trim();
  const insightCount =
    contributions.length + limitations.length + applications.length + questions.length;
  const coverageLabel =
    insightCount >= 9
      ? 'Deep read'
      : insightCount >= 5
        ? 'Solid pass'
        : insightCount >= 2
          ? 'Quick skim'
          : 'Sparse';

  useEffect(() => {
    setDraft(analysisToDraft(analysis));
  }, [note.id, note.updatedAt]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = draftToAnalysis(analysis, draft);
      const updated = await ipc.updateReading(note.id, next as unknown as Record<string, unknown>);
      onSaved(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSendToNotes = async () => {
    setSendingToNotes(true);
    try {
      await onSendToNotes(analysis);
    } finally {
      setSendingToNotes(false);
    }
  };

  const rawContent = JSON.stringify(analysis, null, 2);

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-fuchsia-50/40 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-purple-100/80 px-4 py-4">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-purple-700">
            <Sparkles size={14} />
            AI Analysis
          </div>
          <div className="mt-1 text-xs text-notion-text-secondary">
            Structured reading notes for this paper
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden rounded-full border border-purple-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-purple-700 sm:block">
            {coverageLabel}
          </div>
          <div className="inline-flex rounded-md border border-purple-200 bg-white p-0.5 shadow-sm">
            <button
              onClick={() => setViewMode('pretty')}
              className={`rounded px-2 py-1 text-[11px] font-medium ${
                viewMode === 'pretty'
                  ? 'bg-purple-600 text-white'
                  : 'text-purple-700 hover:bg-purple-50'
              }`}
            >
              Pretty
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`rounded px-2 py-1 text-[11px] font-medium ${
                viewMode === 'raw'
                  ? 'bg-purple-600 text-white'
                  : 'text-purple-700 hover:bg-purple-50'
              }`}
            >
              Raw
            </button>
          </div>
          <button
            onClick={handleSendToNotes}
            disabled={sendingToNotes}
            className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50"
          >
            <CopyPlus size={12} />
            {sendingToNotes ? 'Sending…' : 'Send to Notes'}
          </button>
          <button
            onClick={() => {
              setDraft(analysisToDraft(analysis));
              setEditing((prev) => !prev);
            }}
            className="rounded-md border border-purple-200 bg-white px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          {editing && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-purple-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <div className="text-[11px] text-purple-600/80">
            {new Date(note.updatedAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {viewMode === 'raw' && !editing ? (
          <div className="rounded-2xl border border-purple-100 bg-[#1f1726] p-4 shadow-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-200/90">
              Raw Analysis Payload
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-purple-50">
              {rawContent}
            </pre>
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="rounded-2xl border border-purple-100 bg-white/95 p-4 shadow-sm">
                <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-600/90">
                  <Sparkles size={13} />
                  TL;DR
                </div>
                {editing ? (
                  <textarea
                    value={draft.summary}
                    onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
                    className="min-h-[120px] w-full rounded-xl border border-purple-100 bg-white/90 p-3 text-sm leading-relaxed text-notion-text shadow-sm outline-none"
                  />
                ) : summary ? (
                  <div className="text-sm leading-7 text-notion-text">
                    <MarkdownContent content={summary} />
                  </div>
                ) : (
                  <div className="text-sm text-notion-text-tertiary">No summary yet.</div>
                )}

                {!editing && tags.length > 0 && (
                  <div className="mt-4 border-t border-purple-100 pt-3">
                    <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-600/90">
                      <Tags size={13} />
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <AnalysisTagPill key={tag} tag={tag} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
                <AnalysisStat label="Coverage" value={coverageLabel} />
                <AnalysisStat label="Contributions" value={`${contributions.length} points`} />
                <AnalysisStat label="Risks" value={`${limitations.length} caveats`} />
                <AnalysisStat label="Next Steps" value={`${questions.length} questions`} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {(analysis.problem || editing) && (
                <ReaderAnalysisSection title="Problem">
                  {editing ? (
                    <textarea
                      value={draft.problem}
                      onChange={(e) => setDraft((prev) => ({ ...prev, problem: e.target.value }))}
                      className="min-h-[84px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                    />
                  ) : (
                    <MarkdownContent
                      content={analysis.problem}
                      proseClassName="prose prose-sm max-w-none break-words prose-p:my-1 prose-headings:my-2"
                    />
                  )}
                </ReaderAnalysisSection>
              )}

              {(analysis.method || editing) && (
                <ReaderAnalysisSection title="Method">
                  {editing ? (
                    <textarea
                      value={draft.method}
                      onChange={(e) => setDraft((prev) => ({ ...prev, method: e.target.value }))}
                      className="min-h-[84px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                    />
                  ) : (
                    <MarkdownContent
                      content={analysis.method}
                      proseClassName="prose prose-sm max-w-none break-words prose-p:my-1 prose-headings:my-2"
                    />
                  )}
                </ReaderAnalysisSection>
              )}

              {evidence && !editing && (
                <ReaderAnalysisSection title="Evidence">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 size={12} />
                    Supporting signals from the paper
                  </div>
                  <MarkdownContent
                    content={evidence}
                    proseClassName="prose prose-sm max-w-none break-words prose-p:my-1 prose-headings:my-2"
                  />
                </ReaderAnalysisSection>
              )}

              {(contributions.length > 0 || editing) && (
                <ReaderAnalysisSection title="Contributions">
                  {!editing && (
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                      <Target size={12} />
                      What this paper adds
                    </div>
                  )}
                  {editing ? (
                    <textarea
                      value={draft.contributions}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, contributions: e.target.value }))
                      }
                      className="min-h-[100px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                    />
                  ) : (
                    <AnalysisList title="" items={contributions} />
                  )}
                </ReaderAnalysisSection>
              )}

              {applications.length > 0 && !editing && (
                <ReaderAnalysisSection title="Applications">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    <Lightbulb size={12} />
                    Where this may be useful
                  </div>
                  <AnalysisList title="" items={applications} />
                </ReaderAnalysisSection>
              )}

              {(limitations.length > 0 || editing) && (
                <ReaderAnalysisSection title="Limitations">
                  {!editing && (
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">
                      <AlertTriangle size={12} />
                      What to be careful about
                    </div>
                  )}
                  {editing ? (
                    <textarea
                      value={draft.limitations}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, limitations: e.target.value }))
                      }
                      className="min-h-[100px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                    />
                  ) : (
                    <AnalysisList title="" items={limitations} />
                  )}
                </ReaderAnalysisSection>
              )}
            </div>

            {!editing && (questions.length > 0 || tags.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {questions.length > 0 && (
                  <ReaderAnalysisSection title="Open Questions">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                      <Search size={12} />
                      Good follow-up directions
                    </div>
                    <AnalysisList title="" items={questions} />
                  </ReaderAnalysisSection>
                )}

                {tags.length > 0 && (
                  <ReaderAnalysisSection title="Research Signals">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                      <FlaskConical size={12} />
                      Themes extracted from the paper
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <AnalysisTagPill key={tag} tag={tag} />
                      ))}
                    </div>
                  </ReaderAnalysisSection>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Star Rating Component ────────────────────────────────────────────────────

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

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${
          isUser
            ? 'rounded-br-sm bg-notion-text text-white'
            : 'rounded-bl-sm bg-notion-sidebar text-notion-text'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <MarkdownContent
            content={msg.content}
            proseClassName="prose prose-sm max-w-none break-words text-inherit prose-p:my-2 prose-headings:my-3 prose-headings:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-code:bg-black/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-black/5 prose-pre:text-inherit prose-blockquote:text-inherit prose-li:my-1"
          />
        )}
      </div>
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

  // Chat sessions
  const [chatNotes, setChatNotes] = useState<ReadingNote[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatRunning, setChatRunning] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const chatSessionId = useRef(`reader-chat-${Date.now()}`);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState<ModelConfig | null>(null);
  const [analysisNote, setAnalysisNote] = useState<ReadingNote | null>(null);
  const [analysisStreaming, setAnalysisStreaming] = useState(false);
  const [analysisStreamText, setAnalysisStreamText] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisSessionRef = useRef(`reader-analysis-${Date.now()}`);

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
        const analysis =
          notes.find((n) => n.title.startsWith('Analysis:') && isPaperAnalysis(n.content)) ?? null;
        setAnalysisNote(analysis);
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

  useEffect(() => {
    const offOutput = onIpc('analysis:output', (_event, payload) => {
      const data = payload as { sessionId?: string; chunk?: string };
      if (data.sessionId !== analysisSessionRef.current || !data.chunk) return;
      setAnalysisStreamText((prev) => prev + data.chunk);
    });

    const offDone = onIpc('analysis:done', async (_event, payload) => {
      const data = payload as { sessionId?: string };
      if (data.sessionId !== analysisSessionRef.current || !paper) return;
      setAnalysisStreaming(false);
      const updated = await ipc.listReading(paper.id).catch(() => null);
      if (updated) {
        const analysis = updated.find(
          (note) => note.title.startsWith('Analysis:') && isPaperAnalysis(note.content),
        );
        setAnalysisNote(analysis ?? null);
      }
    });

    const offError = onIpc('analysis:error', (_event, payload) => {
      const data = payload as { sessionId?: string; error?: string };
      if (data.sessionId !== analysisSessionRef.current) return;
      setAnalysisStreaming(false);
      setAnalysisError(data.error ?? 'Analysis failed');
    });

    return () => {
      offOutput();
      offDone();
      offError();
    };
  }, [paper]);

  // Chat output streaming
  useEffect(() => {
    const offOut = onIpc('chat:output', (_event, d) => {
      setStreamingContent((p) => p + String(d));
      // Once we start receiving output, we're no longer just "thinking"
      setAiStatus((prev) => (prev === 'thinking' ? 'idle' : prev));
    });
    const offErr = onIpc('chat:error', (_event, d) => setStreamingContent((p) => p + String(d)));
    const offDone = onIpc('chat:done', () => {
      setChatRunning(false);
      setAiStatus('idle');
      setStreamingContent((streamed) => {
        if (streamed.trim()) {
          const msg: ChatMessage = { role: 'assistant', content: streamed.trim(), ts: Date.now() };
          setMessages((prev) => {
            const next = [...prev, msg];
            if (paper) {
              ipc
                .saveChat({ paperId: paper.id, noteId: currentChatIdRef.current, messages: next })
                .then((r) => {
                  if (!currentChatIdRef.current) {
                    currentChatIdRef.current = r.id;
                    setCurrentChatId(r.id);
                    // Refresh chat list
                    ipc
                      .listReading(paper.id)
                      .then(setChatNotes)
                      .catch(() => undefined);
                  }
                })
                .catch(() => undefined);
            }
            return next;
          });
        }
        return '';
      });
    });
    return () => {
      offOut();
      offErr();
      offDone();
    };
  }, [paper]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, aiStatus]);

  const handleNewChat = useCallback(async () => {
    if (!paper) return;
    setMessages([]);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setStreamingContent('');
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
    setStreamingContent('');
    setChatInput('');
    await ipc.saveChat({ paperId: paper.id, noteId: currentChatId, messages: [] });
    setShowChatDropdown(false);
  }, [paper, currentChatId]);

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

    // Set initial status based on PDF availability
    if (paper.pdfPath) {
      setAiStatus('extracting_pdf');
      // Simulate PDF extraction phase
      setTimeout(() => setAiStatus('thinking'), 800);
    } else {
      setAiStatus('thinking');
    }

    ipc
      .saveChat({ paperId: paper.id, noteId: currentChatIdRef.current, messages: next })
      .then((r) => {
        if (!currentChatIdRef.current) {
          currentChatIdRef.current = r.id;
          setCurrentChatId(r.id);
          // Refresh chat list
          ipc
            .listReading(paper.id)
            .then(setChatNotes)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    const pdfUrl = inferPdfUrl(paper);
    await ipc.chat({
      sessionId: chatSessionId.current,
      paperId: paper.id,
      messages: next,
      pdfUrl: pdfUrl ?? undefined,
    });
  }, [chatInput, chatRunning, paper, messages, chatModel]);

  const handleChatKill = useCallback(async () => {
    await ipc.killChat(chatSessionId.current);
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
  }, [streamingContent, paper]);

  const handleAnalyzePaper = useCallback(async () => {
    if (!paper) return;
    analysisSessionRef.current = `reader-analysis-${Date.now()}`;
    setAnalysisStreaming(true);
    setAnalysisStreamText('');
    setAnalysisError(null);
    try {
      await ipc.analyzePaper({
        sessionId: analysisSessionRef.current,
        paperId: paper.id,
        pdfUrl: inferPdfUrl(paper) ?? undefined,
      });
    } catch (err) {
      setAnalysisStreaming(false);
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    }
  }, [paper]);

  const handleSendAnalysisToNotes = useCallback(
    async (analysis: PaperAnalysis) => {
      if (!paper) return;

      const noteSections = analysisToNoteSections(analysis);
      const allNotes = await ipc.listReading(paper.id);
      const readingNote = allNotes.find(
        (entry) => !entry.title.startsWith('Chat:') && !entry.title.startsWith('Analysis:'),
      );

      if (readingNote) {
        const currentContent = Object.fromEntries(
          Object.entries(readingNote.content ?? {}).filter(
            ([, value]) => typeof value === 'string',
          ),
        ) as Record<string, string>;
        await ipc.updateReading(readingNote.id, { ...currentContent, ...noteSections });
      } else {
        await ipc.createReading({
          paperId: paper.id,
          type: 'paper',
          title: `Reading: ${paper.title}`,
          content: noteSections,
        });
      }

      openTab(`/papers/${paper.shortId}/notes`);
    },
    [openTab, paper],
  );

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

        <button
          onClick={handleAnalyzePaper}
          disabled={analysisStreaming}
          className="inline-flex items-center gap-1.5 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
        >
          {analysisStreaming ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} />
          )}
          Analyze
        </button>

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
              <button
                onClick={handleNewChat}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-notion-text hover:bg-notion-sidebar"
              >
                <Plus size={14} className="text-blue-500" />
                New Chat
              </button>
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
                    <button
                      key={chat.id}
                      onClick={() => handleSelectChat(chat)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-notion-sidebar ${
                        chat.id === currentChatId
                          ? 'bg-notion-sidebar text-blue-600'
                          : 'text-notion-text'
                      }`}
                    >
                      <MessageSquare size={14} className="text-notion-text-tertiary" />
                      <span className="truncate">{chat.title.replace('Chat: ', '')}</span>
                    </button>
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
            <div className="notion-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {analysisNote && isPaperAnalysis(analysisNote.content) && (
                <ReaderAnalysisCard
                  note={analysisNote}
                  onSaved={(updated) => setAnalysisNote(updated)}
                  onSendToNotes={handleSendAnalysisToNotes}
                />
              )}
              {analysisStreaming && (
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700">
                    <Loader2 size={14} className="animate-spin" />
                    Analyzing paper...
                  </div>
                  <div className="max-h-56 overflow-auto rounded-lg border border-blue-100 bg-white/80 p-3 text-slate-700">
                    {analysisStreamText ? (
                      <MarkdownContent
                        content={analysisStreamText}
                        proseClassName="prose prose-sm max-w-none break-words prose-p:my-2 prose-headings:my-3 prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded"
                      />
                    ) : (
                      <div className="text-xs text-slate-500">Waiting for model output...</div>
                    )}
                  </div>
                </div>
              )}
              {analysisError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {analysisError}
                </div>
              )}
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
                <ChatBubble key={i} msg={msg} />
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
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSend();
                    }
                  }}
                  placeholder={
                    chatModel ? 'Message… (Enter to send)' : 'Configure a chat model in Settings…'
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
