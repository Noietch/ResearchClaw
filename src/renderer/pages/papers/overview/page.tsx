import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import {
  ipc,
  type PaperItem,
  type PaperAnalysis,
  type ReadingNote,
  type TagInfo,
  type ModelConfig,
  type CliConfig,
  type SourceEvent,
  type CollectionItem,
} from '../../../hooks/use-ipc';
import { useAnalysis } from '../../../hooks/use-analysis';
import { useToast } from '../../../components/toast';
import { WysiwygEditor } from '../../../components/wysiwyg-editor';
import { PdfViewer } from '../../../components/pdf-viewer';
import { MarkdownContent } from '../../../components/markdown-content';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  ExternalLink,
  MessageSquare,
  Calendar,
  Plus,
  Tag,
  X,
  Trash2,
  Wand2,
  RefreshCw,
  FlaskConical,
  GitBranch,
  GitCommit,
  Download,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Search,
  Square,
  FilePenLine,
  Check,
  Star,
  Tags,
  ChevronDown,
  FolderOpen,
  BookOpen,
  NotebookPen,
  Github,
  FolderDown,
  Lightbulb,
  Sparkles,
  Target,
  Library,
  Copy,
  GitCompareArrows,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import {
  CATEGORY_LABELS,
  TAG_CATEGORIES,
  type TagCategory,
  type CategorizedTag,
  cleanArxivTitle,
  getTagStyle,
  paperToBibtex,
} from '@shared';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXCLUDED_TAGS = ['arxiv', 'chrome', 'manual', 'pdf'];

type Tab = 'paper' | 'code' | 'notes' | 'chat';

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

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DEFAULT_TEMPLATE = `# Research Problem\n\n\n# Core Method\n\n\n# Key Findings\n\n\n# Limitations\n\n\n# Future Work\n\n`;

function sectionsToMarkdown(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([heading, body]) => `# ${heading}\n\n${body}`)
    .join('\n\n');
}

function markdownToSections(md: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = md.split(/^# /m).filter(Boolean);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl >= 0 ? part.slice(0, nl) : part).trim();
    const body = nl >= 0 ? part.slice(nl + 1).trim() : '';
    if (heading) sections[heading] = body;
  }
  return sections;
}

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
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-notion-text-secondary">
        {title}
      </div>
      <ul className="space-y-1.5 text-sm text-notion-text">
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

function AnalysisSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-purple-100 bg-white/90 p-4 shadow-sm">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-700/80">
        {title}
      </div>
      <div>{children}</div>
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
    evidence: analysis.evidence ?? '',
    contributions: (analysis.contributions ?? []).join('\n'),
    limitations: (analysis.limitations ?? []).join('\n'),
    applications: (analysis.applications ?? []).join('\n'),
    questions: (analysis.questions ?? []).join('\n'),
    tags: (analysis.tags ?? []).join(', '),
  };
}

function draftToAnalysis(draft: ReturnType<typeof analysisToDraft>): PaperAnalysis {
  const splitLines = (value: string) =>
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const splitTags = (value: string) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    summary: draft.summary.trim(),
    problem: draft.problem.trim(),
    method: draft.method.trim(),
    evidence: draft.evidence.trim(),
    contributions: splitLines(draft.contributions),
    limitations: splitLines(draft.limitations),
    applications: splitLines(draft.applications),
    questions: splitLines(draft.questions),
    tags: splitTags(draft.tags),
  };
}

function AnalysisCard({
  note,
  onSaved,
}: {
  note: ReadingNote;
  onSaved: (note: ReadingNote) => void;
}) {
  const analysis = normalizeAnalysis(note.content);
  const contributions = analysis.contributions ?? [];
  const limitations = analysis.limitations ?? [];
  const applications = analysis.applications ?? [];
  const questions = analysis.questions ?? [];
  const tags = analysis.tags ?? [];
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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
      const next = draftToAnalysis(draft);
      const updated = await ipc.updateReading(note.id, next as unknown as Record<string, unknown>);
      onSaved(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-fuchsia-50/40 shadow-sm">
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setDraft(analysisToDraft(analysis));
                setEditing((prev) => !prev);
              }}
              className="rounded-lg border border-purple-200 bg-white px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50"
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
            {editing && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-purple-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            <div className="text-xs text-purple-600/80">Updated {formatDate(note.updatedAt)}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
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
            <AnalysisSection title="Problem">
              {editing ? (
                <textarea
                  value={draft.problem}
                  onChange={(e) => setDraft((prev) => ({ ...prev, problem: e.target.value }))}
                  className="min-h-[96px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                />
              ) : (
                <MarkdownContent
                  content={analysis.problem}
                  proseClassName="prose prose-sm max-w-none break-words prose-p:my-1 prose-headings:my-2"
                />
              )}
            </AnalysisSection>
          )}
          {(analysis.method || editing) && (
            <AnalysisSection title="Method">
              {editing ? (
                <textarea
                  value={draft.method}
                  onChange={(e) => setDraft((prev) => ({ ...prev, method: e.target.value }))}
                  className="min-h-[96px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                />
              ) : (
                <MarkdownContent
                  content={analysis.method}
                  proseClassName="prose prose-sm max-w-none break-words prose-p:my-1 prose-headings:my-2"
                />
              )}
            </AnalysisSection>
          )}

          {evidence && !editing && (
            <AnalysisSection title="Evidence">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 size={12} />
                Supporting signals from the paper
              </div>
              <MarkdownContent
                content={analysis.evidence}
                proseClassName="prose prose-sm max-w-none break-words prose-p:my-1 prose-headings:my-2"
              />
            </AnalysisSection>
          )}

          {(contributions.length > 0 || editing) && (
            <AnalysisSection title="Contributions">
              {!editing && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                  <Target size={12} />
                  What this paper adds
                </div>
              )}
              {editing ? (
                <textarea
                  value={draft.contributions}
                  onChange={(e) => setDraft((prev) => ({ ...prev, contributions: e.target.value }))}
                  className="min-h-[120px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                />
              ) : (
                <AnalysisList title="" items={contributions} />
              )}
            </AnalysisSection>
          )}

          {applications.length > 0 && !editing && (
            <AnalysisSection title="Applications">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                <Lightbulb size={12} />
                Where this may be useful
              </div>
              <AnalysisList title="" items={applications} />
            </AnalysisSection>
          )}

          {(limitations.length > 0 || editing) && (
            <AnalysisSection title="Limitations">
              {!editing && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">
                  <AlertTriangle size={12} />
                  What to be careful about
                </div>
              )}
              {editing ? (
                <textarea
                  value={draft.limitations}
                  onChange={(e) => setDraft((prev) => ({ ...prev, limitations: e.target.value }))}
                  className="min-h-[120px] w-full rounded-lg border border-notion-border px-3 py-2 text-sm outline-none"
                />
              ) : (
                <AnalysisList title="" items={limitations} />
              )}
            </AnalysisSection>
          )}
        </div>

        {!editing && (questions.length > 0 || tags.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {questions.length > 0 && (
              <AnalysisSection title="Open Questions">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                  <Search size={12} />
                  Good follow-up directions
                </div>
                <AnalysisList title="" items={questions} />
              </AnalysisSection>
            )}

            {tags.length > 0 && (
              <AnalysisSection title="Research Signals">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                  <FlaskConical size={12} />
                  Themes extracted from the paper
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <AnalysisTagPill key={tag} tag={tag} />
                  ))}
                </div>
              </AnalysisSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StarRating ───────────────────────────────────────────────────────────────

function StarRating({
  rating,
  onChange,
}: {
  rating: number | null;
  onChange: (r: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const val = hover ?? rating ?? 0;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(null)}
          className="p-0.5 transition-transform hover:scale-110"
        >
          <Star
            size={15}
            fill={s <= val ? '#f59e0b' : 'transparent'}
            stroke={s <= val ? '#d97706' : '#d1d5db'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}

// ─── ChatBubble ───────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}
type AiStatus = 'idle' | 'extracting_pdf' | 'thinking';

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

// ─── formatDate ───────────────────────────────────────────────────────────────

function formatDate(ts: string | number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Tag Editor Component ─────────────────────────────────────────────────────

function CategoryTagRow({
  category,
  tags,
  allTags,
  onAdd,
  onRemove,
  saving,
}: {
  category: TagCategory;
  tags: CategorizedTag[];
  allTags: TagInfo[];
  onAdd: (name: string, category: TagCategory) => void;
  onRemove: (name: string) => void;
  saving: boolean;
}) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const style = getTagStyle(category);

  // Filter suggestions: same category, not already applied, matching input
  const suggestions = allTags
    .filter((t) => t.category === category)
    .filter((t) => !tags.some((existing) => existing.name === t.name))
    .filter((t) => t.name.includes(input.toLowerCase()))
    .slice(0, 5);

  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-1 text-xs font-semibold uppercase tracking-wider w-16 flex-shrink-0 ${style.text}`}
      >
        {CATEGORY_LABELS[category]}
      </span>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {tags.map((tag) => (
          <span
            key={tag.name}
            className={`inline-flex items-center gap-1 rounded-full ${style.bg} ${style.text} px-2.5 py-1 text-xs font-medium`}
          >
            {tag.name}
            <button
              onClick={() => onRemove(tag.name)}
              disabled={saving}
              className="ml-0.5 rounded-full hover:bg-black/10 p-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {/* Inline add input */}
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && input.trim()) {
                e.preventDefault();
                onAdd(input.trim(), category);
                setInput('');
                setShowSuggestions(false);
              }
              if (e.key === 'Escape') {
                setShowSuggestions(false);
                setInput('');
              }
            }}
            placeholder="add..."
            className="w-20 rounded-full border border-dashed border-notion-border bg-transparent px-2.5 py-1 text-xs placeholder:text-notion-text-tertiary focus:outline-none"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border bg-white py-1 shadow-lg">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onAdd(s.name, category);
                    setInput('');
                    setShowSuggestions(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-notion-sidebar"
                >
                  <span className={`rounded px-1.5 py-0.5 ${style.bg} ${style.text}`}>
                    {s.name}
                  </span>
                  <span className="ml-1 text-notion-text-tertiary">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TagEditor({
  paper,
  onUpdate,
}: {
  paper: PaperItem;
  onUpdate: (updated: PaperItem) => void;
}) {
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [organizing, setOrganizing] = useState(false);

  // Load all tags for autocomplete
  useEffect(() => {
    ipc
      .listAllTags()
      .then(setAllTags)
      .catch(() => {});
  }, []);

  // Group categorized tags by category
  const categorizedTags = paper.categorizedTags || [];
  const tagsByCategory: Record<TagCategory, CategorizedTag[]> = {
    domain: categorizedTags.filter((t): t is CategorizedTag => t.category === 'domain'),
    method: categorizedTags.filter((t): t is CategorizedTag => t.category === 'method'),
    topic: categorizedTags.filter((t): t is CategorizedTag => t.category === 'topic'),
  };

  // Filter out system tags from counts
  const visibleTags = categorizedTags.filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()));

  const handleAddTag = async (tagName: string, category: TagCategory) => {
    if (!tagName.trim()) return;
    if (categorizedTags.some((t) => t.name === tagName.trim())) return;

    setSaving(true);
    try {
      const newTags = [...categorizedTags, { name: tagName.trim(), category }];
      // Note: This needs a new IPC method to update categorized tags
      // For now, fall back to old string tags (will be organized later)
      const tagNames = newTags.map((t) => t.name);
      const updated = await ipc.updatePaperTags(paper.id, tagNames);
      onUpdate(updated!);
    } catch {
      alert('Failed to add tag');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    setSaving(true);
    try {
      const newTags = categorizedTags.filter((t) => t.name !== tagName);
      const tagNames = newTags.map((t) => t.name);
      const updated = await ipc.updatePaperTags(paper.id, tagNames);
      onUpdate(updated!);
    } catch {
      alert('Failed to remove tag');
    } finally {
      setSaving(false);
    }
  };

  const handleAutoTag = async () => {
    setAutoTagging(true);
    try {
      const result = await ipc.tagPaper(paper.id);
      onUpdate({
        ...paper,
        categorizedTags: result,
        tagNames: result.map((tag) => tag.name),
      });

      const updated = await ipc.getPaper(paper.id).catch(() => null);
      if (updated) onUpdate(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Auto-tagging failed');
    } finally {
      setAutoTagging(false);
    }
  };

  const handleOrganize = async () => {
    setOrganizing(true);
    try {
      const result = await ipc.organizePaperTags(paper.id);
      onUpdate({
        ...paper,
        categorizedTags: result,
        tagNames: result.map((tag) => tag.name),
      });

      const updated = await ipc.getPaper(paper.id).catch(() => null);
      if (updated) onUpdate(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to organize tags');
    } finally {
      setOrganizing(false);
    }
  };

  return (
    <div className="rounded-xl border border-notion-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Tag size={14} className="text-notion-text-secondary" />
          <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider">
            Tags
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoTag}
            disabled={autoTagging || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
          >
            {autoTagging ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Auto Tag
          </button>
          {visibleTags.length > 0 && (
            <button
              onClick={handleOrganize}
              disabled={organizing || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
            >
              {organizing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Organize
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {TAG_CATEGORIES.map((category) => (
          <CategoryTagRow
            key={category}
            category={category}
            tags={tagsByCategory[category]}
            allTags={allTags}
            onAdd={handleAddTag}
            onRemove={handleRemoveTag}
            saving={saving || autoTagging || organizing}
          />
        ))}
      </div>
    </div>
  );
}
// ─── Collection Picker ────────────────────────────────────────────────────────

function CollectionPicker({ paperId }: { paperId: string }) {
  const toast = useToast();
  const [allCollections, setAllCollections] = useState<CollectionItem[]>([]);
  const [paperCollections, setPaperCollections] = useState<CollectionItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([ipc.listCollections(), ipc.getCollectionsForPaper(paperId)])
      .then(([all, current]) => {
        setAllCollections(all);
        setPaperCollections(current);
      })
      .catch(() => {});
  }, [paperId]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const isInCollection = (colId: string) => paperCollections.some((c) => c.id === colId);

  const toggle = async (colId: string) => {
    try {
      const col = allCollections.find((c) => c.id === colId);
      if (isInCollection(colId)) {
        await ipc.removePaperFromCollection(colId, paperId);
        setPaperCollections((prev) => prev.filter((c) => c.id !== colId));
        toast.success(`Removed from ${col?.name ?? 'collection'}`);
      } else {
        await ipc.addPaperToCollection(colId, paperId);
        if (col) setPaperCollections((prev) => [...prev, col]);
        toast.success(`Added to ${col?.name ?? 'collection'}`);
      }
    } catch {
      toast.error('Failed to update collection');
    }
  };

  return (
    <div className="rounded-xl border border-notion-border p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Library size={14} className="text-notion-text-secondary" />
          <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider">
            Collections
          </h2>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {paperCollections.map((col) => (
          <span
            key={col.id}
            className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
          >
            {col.icon ?? '📁'} {col.name}
            <button
              onClick={() => toggle(col.id)}
              className="ml-0.5 rounded-full hover:bg-blue-100 p-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-notion-border px-2.5 py-1 text-xs text-notion-text-tertiary hover:border-notion-text-secondary hover:text-notion-text-secondary"
          >
            <Plus size={10} />
            Add
          </button>
          {open && (
            <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border bg-white py-1 shadow-lg">
              {allCollections.map((col) => (
                <button
                  key={col.id}
                  onClick={() => toggle(col.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-notion-sidebar"
                >
                  <span>{col.icon ?? '📁'}</span>
                  <span className="flex-1 truncate">{col.name}</span>
                  {isInCollection(col.id) && (
                    <Check size={12} className="text-blue-600 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Overview Page ────────────────────────────────────────────────────────────

export function OverviewPage() {
  const { id: shortId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { updateTabLabel, openTab } = useTabs();
  const { jobs: analysisJobs, startAnalysis, cancelAnalysis } = useAnalysis();

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [activeCli, setActiveCli] = useState<CliConfig | null>(null);

  // Citations
  const [citationCounts, setCitationCounts] = useState<{
    references: number;
    citedBy: number;
  } | null>(null);
  const [extractingCitations, setExtractingCitations] = useState(false);

  // Clone repo modal
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [detectingRepo, setDetectingRepo] = useState(false);
  const [detectedRepo, setDetectedRepo] = useState<string | null>(null);

  // Compare with... modal
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareSearch, setCompareSearch] = useState('');
  const [comparePapers, setComparePapers] = useState<PaperItem[]>([]);
  const [compareSelected, setCompareSelected] = useState<Set<string>>(new Set());

  // Load active CLI tool
  useEffect(() => {
    ipc
      .listCliConfigs()
      .then((tools) => {
        const active = tools.find((t) => t.active) ?? null;
        setActiveCli(active);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!shortId) return;

    Promise.all([ipc.getPaperByShortId(shortId), ipc.getStorageRoot()])
      .then(([p, storageRoot]) => {
        setPaper(p);
        setRating(p.rating ?? null);
        setPaperDir(`${storageRoot}/papers/${p.shortId}`);
        const shortTitle = p.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, '').slice(0, 30) || p.shortId;
        updateTabLabel(location.pathname, shortTitle);
        return ipc.listReading(p.id);
      })
      .then((readingNotes) => {
        setNotes(readingNotes);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [shortId]);

  // Load citation counts
  useEffect(() => {
    if (!paper) return;
    ipc
      .getCitationCounts(paper.id)
      .then(setCitationCounts)
      .catch(() => undefined);
  }, [paper?.id]);

  // Separate notes by type
  const analysisNote = notes.find(
    (n) => n.title.startsWith('Analysis:') && isPaperAnalysis(n.content),
  );
  const paperAnalysisJobs = useMemo(() => {
    if (!paper) return [];
    return analysisJobs.filter((job) => job.paperId === paper.id);
  }, [analysisJobs, paper]);
  const activeAnalysisJob = paperAnalysisJobs.find((job) => job.active) ?? null;
  const latestAnalysisJob = paperAnalysisJobs[0] ?? null;
  const analysisError =
    latestAnalysisJob && !latestAnalysisJob.active && latestAnalysisJob.stage !== 'done'
      ? latestAnalysisJob.message
      : null;
  const readingNotes = notes.filter(
    (n) => !n.title.startsWith('Chat:') && !n.title.startsWith('Analysis:'),
  );
  const chatNotes = notes.filter((n) => n.title.startsWith('Chat:'));

  useEffect(() => {
    if (!paper) return;
    if (latestAnalysisJob?.stage !== 'done') return;

    ipc
      .listReading(paper.id)
      .then(setNotes)
      .catch(() => undefined);
  }, [latestAnalysisJob?.jobId, latestAnalysisJob?.stage, paper]);

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

  const handleOpenReader = useCallback(() => {
    if (!paper) return;
    const from = (location.state as { from?: string })?.from;
    openTab(`/papers/${paper.shortId}/reader`, from ? { from } : undefined);
  }, [paper, openTab, location.state]);

  const handleStartConversation = useCallback(() => {
    if (!paper) return;
    const from = (location.state as { from?: string })?.from;
    openTab(`/papers/${paper.shortId}/reader?panel=chat`, from ? { from } : undefined);
  }, [paper, openTab, location.state]);

  const handleOpenNotes = useCallback(() => {
    if (!paper) return;
    const from = (location.state as { from?: string })?.from;
    openTab(`/papers/${paper.shortId}/notes`, from ? { from } : undefined);
  }, [paper, openTab, location.state]);

  const handleOpenSource = useCallback(() => {
    if (!paper?.sourceUrl) return;
    window.open(paper.sourceUrl, '_blank');
  }, [paper]);

  const handleDetectRepo = useCallback(async () => {
    if (!paper || !activeCli) return;
    setDetectingRepo(true);
    setDetectedRepo(null);
    try {
      // Use CLI to detect repo from paper abstract or source
      const prompt = `Find the GitHub repository URL for this paper. Paper title: "${paper.title}". Abstract: ${paper.abstract || 'N/A'}. Return ONLY the GitHub URL if found, or "NONE" if not found.`;
      const parts = activeCli.command.trim().split(/\s+/);
      // We'll use a simple approach: check abstract for GitHub URL
      const githubMatch = paper.abstract?.match(/github\.com\/[\w-]+\/[\w.-]+/);
      if (githubMatch) {
        setDetectedRepo(`https://${githubMatch[0]}`);
      }
    } finally {
      setDetectingRepo(false);
    }
  }, [paper, activeCli]);

  const handleCloneRepo = useCallback(async () => {
    if (!repoUrl.trim() || !paperDir || !activeCli) return;
    setCloning(true);
    try {
      const parts = activeCli.command.trim().split(/\s+/);
      const prompt = `Clone the repository at ${repoUrl} into the ./code directory`;
      const args =
        parts[0] === 'codex'
          ? [...parts.slice(1), 'exec', prompt]
          : [...parts.slice(1), '-p', prompt];
      await ipc.runCli({
        tool: parts[0],
        args,
        sessionId: `clone-${Date.now()}`,
        cwd: paperDir,
        envVars: activeCli.envVars || undefined,
      });
      setShowCloneModal(false);
      setRepoUrl('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clone');
    } finally {
      setCloning(false);
    }
  }, [repoUrl, paperDir, activeCli]);

  const handleCreateNote = useCallback(async () => {
    if (!paper) return;
    try {
      await ipc.createReading({
        paperId: paper.id,
        type: 'paper',
        title: `Note ${notes.length + 1}`,
        content: {},
      });
      const updated = await ipc.listReading(paper.id);
      setNotes(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create note');
    }
  }, [paper, notes.length]);

  const handleAnalyzePaper = useCallback(async () => {
    if (!paper) return;
    try {
      await startAnalysis({
        paperId: paper.id,
        pdfUrl: inferPdfUrl(paper) ?? undefined,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Analysis failed');
    }
  }, [paper, startAnalysis]);

  const toast = useToast();
  const [copyingBibtex, setCopyingBibtex] = useState(false);
  const [bibtexContent, setBibtexContent] = useState<string | null>(null);
  const [bibtexCopied, setBibtexCopied] = useState(false);

  const handleCopyBibtex = useCallback(async () => {
    if (!paper) return;
    setCopyingBibtex(true);
    try {
      const bibtex = await ipc.exportBibtex([paper.id]);
      setBibtexContent(bibtex);
      setBibtexCopied(false);
    } catch {
      toast.error('Failed to get BibTeX');
    } finally {
      setCopyingBibtex(false);
    }
  }, [paper, toast]);

  const handleExtractCitations = useCallback(async () => {
    if (!paper) return;
    setExtractingCitations(true);
    try {
      const result = await ipc.extractCitations({
        id: paper.id,
        shortId: paper.shortId,
        title: paper.title,
        sourceUrl: paper.sourceUrl,
      });
      toast.success(
        `Found ${result.referencesFound} references, ${result.citationsFound} citations (${result.matched} matched locally)`,
      );
      const counts = await ipc.getCitationCounts(paper.id);
      setCitationCounts(counts);
    } catch {
      toast.error('Failed to extract citations');
    } finally {
      setExtractingCitations(false);
    }
  }, [paper, toast]);

  const handleDeletePaper = useCallback(async () => {
    if (!paper) return;
    if (!confirm(`Delete "${paper.title}"? This action cannot be undone.`)) return;
    setDeleting(true);
    try {
      await ipc.deletePaper(paper.id);
      navigate('/papers');
    } catch {
      alert('Failed to delete paper');
      setDeleting(false);
    }
  }, [paper, navigate]);

  const openCompareModal = useCallback(async () => {
    try {
      const all = await ipc.listPapers();
      setComparePapers(all.filter((p) => p.id !== paper?.id));
      setCompareSelected(new Set());
      setCompareSearch('');
      setShowCompareModal(true);
    } catch {
      toast.error('Failed to load papers');
    }
  }, [paper, toast]);

  const handleCompareGo = useCallback(() => {
    if (!paper || compareSelected.size === 0) return;
    const ids = [paper.id, ...Array.from(compareSelected)].join(',');
    navigate(`/compare?ids=${ids}`);
  }, [paper, compareSelected, navigate]);

  // Auto-detect repo on mount
  useEffect(() => {
    if (paper?.abstract) {
      const githubMatch = paper.abstract.match(/github\.com\/[\w-]+\/[\w.-]+/);
      if (githubMatch) {
        setDetectedRepo(`https://${githubMatch[0]}`);
      }
    }
  }, [paper]);

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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-8 py-5">
        <button
          onClick={() => {
            const from = (location.state as { from?: string })?.from;
            navigate(from ?? '/papers');
          }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
        >
          <ArrowLeft size={16} />
          {(location.state as { from?: string })?.from === '/dashboard' ||
          (location.state as { from?: string })?.from === '/search'
            ? 'Back'
            : 'Library'}
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-notion-text truncate">
            {cleanArxivTitle(paper.title)}
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleOpenReader}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar"
            >
              <BookOpen size={16} />
              Open Reader
            </button>
            <button
              onClick={handleOpenNotes}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar"
            >
              <NotebookPen size={16} />
              Notes
            </button>
            {paper.sourceUrl && (
              <button
                onClick={handleOpenSource}
                className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar"
              >
                <ExternalLink size={16} />
                Source
              </button>
            )}
            <button
              onClick={handleAnalyzePaper}
              disabled={!!activeAnalysisJob}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              {activeAnalysisJob ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {activeAnalysisJob ? 'Analyzing…' : 'Analyze'}
            </button>
            <button
              onClick={() => setShowCloneModal(true)}
              disabled={!activeCli}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              <Github size={16} />
              Clone Repo
            </button>
            <button
              onClick={handleCopyBibtex}
              disabled={copyingBibtex}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              {copyingBibtex ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
              Copy BibTeX
            </button>
            <button
              onClick={openCompareModal}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar"
            >
              <GitCompareArrows size={16} />
              Compare with…
            </button>
            <button
              onClick={handleExtractCitations}
              disabled={extractingCitations}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              {extractingCitations ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <GitBranch size={16} />
              )}
              Extract Citations
            </button>
            <button
              onClick={handleDeletePaper}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-50 disabled:opacity-40"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete
            </button>
          </div>

          {/* Meta info: Authors, Year, Rating */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-notion-text-secondary">
            {paper.authors && paper.authors.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Authors:</span>
                <span>{paper.authors.join(', ')}</span>
              </div>
            )}
            {paper.submittedAt && (
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Submitted:</span>
                <span>
                  {new Date(paper.submittedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <StarRating rating={rating} onChange={handleRatingChange} />
            </div>
          </div>

          {/* Tags */}
          <TagEditor paper={paper} onUpdate={setPaper} />

          {/* Collections */}
          <CollectionPicker paperId={paper.id} />

          {/* Citation Stats */}
          {citationCounts && (citationCounts.references > 0 || citationCounts.citedBy > 0) && (
            <div className="flex items-center gap-4 rounded-xl border border-notion-border p-4">
              <div className="flex items-center gap-2 text-sm text-notion-text-secondary">
                <GitBranch size={14} className="text-notion-text-tertiary" />
                <span>
                  <strong className="text-notion-text">{citationCounts.references}</strong>{' '}
                  references
                </span>
                <span className="text-notion-text-tertiary">·</span>
                <span>
                  <strong className="text-notion-text">{citationCounts.citedBy}</strong> cited by
                </span>
              </div>
              <button
                onClick={() => navigate('/graph')}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-notion-sidebar px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text"
              >
                View in Graph
                <ExternalLink size={12} />
              </button>
            </div>
          )}

          {/* Abstract */}
          {paper.abstract && (
            <div className="rounded-xl border border-notion-border p-5">
              <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider mb-3">
                Abstract
              </h2>
              <p className="text-sm text-notion-text leading-relaxed whitespace-pre-wrap">
                {paper.abstract}
              </p>
            </div>
          )}

          {(analysisNote || activeAnalysisJob || analysisError) && (
            <div className="space-y-3">
              {analysisNote && isPaperAnalysis(analysisNote.content) && (
                <AnalysisCard
                  note={analysisNote}
                  onSaved={(updated) =>
                    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
                  }
                />
              )}
              {activeAnalysisJob && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-700">
                    <Loader2 size={14} className="animate-spin" />
                    {activeAnalysisJob.message || 'Analyzing paper...'}
                    <button
                      onClick={() => void cancelAnalysis(activeAnalysisJob.jobId)}
                      className="ml-auto text-xs font-medium text-blue-700 hover:text-blue-900"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="max-h-64 overflow-auto rounded-lg border border-blue-100 bg-white/80 p-3 text-slate-700">
                    {activeAnalysisJob.partialText ? (
                      <MarkdownContent
                        content={activeAnalysisJob.partialText}
                        proseClassName="prose prose-sm max-w-none break-words prose-p:my-2 prose-headings:my-3 prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded"
                      />
                    ) : (
                      <div className="text-xs text-slate-500">Waiting for model output...</div>
                    )}
                  </div>
                </div>
              )}
              {analysisError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {analysisError}
                </div>
              )}
            </div>
          )}

          {/* Reading Notes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider">
                Reading Notes
              </h2>
              <button
                onClick={handleCreateNote}
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
              >
                <Plus size={12} />
                New Note
              </button>
            </div>
            {readingNotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-notion-border py-8 text-center">
                <FileText size={32} strokeWidth={1.2} className="mx-auto mb-2 text-notion-border" />
                <p className="text-sm text-notion-text-tertiary">No reading notes yet</p>
                <button
                  onClick={handleOpenNotes}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                >
                  <NotebookPen size={14} />
                  Create your first note
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {readingNotes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => openTab(`/papers/${paper.shortId}/notes?noteId=${note.id}`)}
                    className="w-full flex items-center gap-4 rounded-lg border border-notion-border px-4 py-3 text-left transition-colors hover:bg-notion-sidebar/50"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50">
                      <FileText size={16} className="text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-notion-text truncate">
                        {note.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-notion-text-tertiary">
                        <Calendar size={11} />
                        {formatDate(note.updatedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chat History */}
          <div>
            <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider mb-3">
              Chat History
            </h2>
            {chatNotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-notion-border py-8 text-center">
                <MessageSquare
                  size={32}
                  strokeWidth={1.2}
                  className="mx-auto mb-2 text-notion-border"
                />
                <p className="text-sm text-notion-text-tertiary">No chat history yet</p>
                <button
                  onClick={handleStartConversation}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                >
                  <BookOpen size={14} />
                  Start a conversation
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {chatNotes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() =>
                      openTab(`/papers/${paper.shortId}/reader?panel=chat&chatId=${note.id}`)
                    }
                    className="w-full flex items-center gap-4 rounded-lg border border-notion-border px-4 py-3 text-left transition-colors hover:bg-notion-sidebar/50"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      <MessageSquare size={16} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-notion-text truncate">
                        {note.title.replace('Chat: ', '')}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-notion-text-tertiary">
                        <Calendar size={11} />
                        {formatDate(note.updatedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BibTeX Modal */}
      <AnimatePresence>
        {bibtexContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setBibtexContent(null)}
            onKeyDown={(e) => e.key === 'Escape' && setBibtexContent(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-notion-text">BibTeX</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(bibtexContent);
                      setBibtexCopied(true);
                      setTimeout(() => setBibtexCopied(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-notion-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-notion-accent/90"
                  >
                    {bibtexCopied ? <Check size={14} /> : <Copy size={14} />}
                    {bibtexCopied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => setBibtexContent(null)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <pre className="max-h-96 overflow-auto rounded-lg bg-notion-sidebar p-4 text-xs text-notion-text font-mono whitespace-pre-wrap">
                {bibtexContent}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compare with... Modal */}
      <AnimatePresence>
        {showCompareModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setShowCompareModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-notion-text">Compare with…</h3>
              <p className="mt-1 text-xs text-notion-text-tertiary">
                Select 1-2 papers to compare with the current paper.
              </p>
              <div className="relative mt-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
                />
                <input
                  type="text"
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                  placeholder="Search papers..."
                  className="w-full rounded-lg border border-notion-border py-2 pl-9 pr-3 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
              </div>
              <div className="mt-3 flex-1 overflow-y-auto">
                {(() => {
                  const filtered = comparePapers.filter((p) => {
                    if (!compareSearch.trim()) return true;
                    const q = compareSearch.toLowerCase();
                    return (
                      p.title.toLowerCase().includes(q) ||
                      p.authors?.some((a) => a.toLowerCase().includes(q))
                    );
                  });
                  if (filtered.length === 0) {
                    return (
                      <p className="py-8 text-center text-sm text-notion-text-tertiary">
                        No papers found
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-1">
                      {filtered.map((p) => {
                        const isSelected = compareSelected.has(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              setCompareSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) {
                                  next.delete(p.id);
                                } else if (next.size < 2) {
                                  next.add(p.id);
                                }
                                return next;
                              });
                            }}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              isSelected ? 'bg-notion-accent-light' : 'hover:bg-notion-sidebar/50'
                            }`}
                          >
                            <div
                              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded ${
                                isSelected
                                  ? 'bg-notion-accent text-white'
                                  : 'border border-notion-border text-transparent'
                              }`}
                            >
                              <Check size={12} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-notion-text">
                                {cleanArxivTitle(p.title)}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-notion-text-tertiary">
                                {p.authors && p.authors.length > 0 && (
                                  <span>{p.authors.slice(0, 2).join(', ')}</span>
                                )}
                                {p.year && <span>{p.year}</span>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-notion-text-tertiary">
                  {compareSelected.size} of 2 selected
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCompareModal(false)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCompareGo}
                    disabled={compareSelected.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-notion-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-notion-accent/90 disabled:opacity-50"
                  >
                    <GitCompareArrows size={14} />
                    Compare
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clone Repo Modal */}
      {showCloneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-notion-border bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-notion-text mb-4">Clone Repository</h3>

            {detectedRepo && (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                <p className="text-xs text-green-700">Detected repository:</p>
                <p className="text-sm font-mono text-green-800 break-all">{detectedRepo}</p>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-sm font-medium text-notion-text">Repository URL</label>
              <input
                type="text"
                value={repoUrl || detectedRepo || ''}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo"
                className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="text-xs text-notion-text-tertiary">Will be cloned to {paperDir}/code</p>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCloneModal(false);
                  setRepoUrl('');
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
              >
                Cancel
              </button>
              <button
                onClick={handleCloneRepo}
                disabled={cloning || (!repoUrl.trim() && !detectedRepo)}
                className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                {cloning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Cloning...
                  </>
                ) : (
                  <>
                    <FolderDown size={14} />
                    Clone
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
