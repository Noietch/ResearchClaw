import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import { ipc, onIpc, type PaperItem, type ReadingNote, type TagInfo, type ModelConfig } from '../../../hooks/use-ipc';
import { WysiwygEditor } from '../../../components/wysiwyg-editor';
import { PdfViewer } from '../../../components/pdf-viewer';
import {
  ArrowLeft,
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
  GitBranch,
  GitCommit,
  Download,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Square,
  FilePenLine,
  Check,
  Star,
  ChevronDown,
  FolderOpen,
  BookOpen,
  NotebookPen,
  Github,
  FolderDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  TAG_CATEGORIES,
  type TagCategory,
  type CategorizedTag,
  cleanArxivTitle,
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

// ─── StarRating ───────────────────────────────────────────────────────────────

function StarRating({ rating, onChange }: { rating: number | null; onChange: (r: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = hover ?? rating ?? 0;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} onClick={() => onChange(s)}
          onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)}
          className="p-0.5 transition-transform hover:scale-110">
          <Star size={15} fill={s <= val ? '#fbbf24' : 'transparent'}
            stroke={s <= val ? '#fbbf24' : '#d1d5db'} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

// ─── ChatBubble ───────────────────────────────────────────────────────────────

interface ChatMessage { role: 'user' | 'assistant'; content: string; ts: number; }
type AiStatus = 'idle' | 'extracting_pdf' | 'thinking';

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
        isUser ? 'rounded-br-sm bg-notion-text text-white' : 'rounded-bl-sm bg-notion-sidebar text-notion-text'
      }`}>{msg.content}</div>
    </div>
  );
}

// ─── formatDate ───────────────────────────────────────────────────────────────

function formatDate(ts: string | number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
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
  const colors = CATEGORY_COLORS[category];

  // Filter suggestions: same category, not already applied, matching input
  const suggestions = allTags
    .filter(t => t.category === category)
    .filter(t => !tags.some(existing => existing.name === t.name))
    .filter(t => t.name.includes(input.toLowerCase()))
    .slice(0, 5);

  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1 text-xs font-semibold uppercase tracking-wider w-16 flex-shrink-0 ${colors.text}`}>
        {CATEGORY_LABELS[category]}
      </span>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {tags.map(tag => (
          <span key={tag.name}
            className={`inline-flex items-center gap-1 rounded-full border ${colors.bg} ${colors.text} ${colors.border} px-2.5 py-1 text-xs font-medium`}>
            {tag.name}
            <button onClick={() => onRemove(tag.name)} disabled={saving}
              className="ml-0.5 rounded-full hover:bg-black/10 p-0.5">
              <X size={10} />
            </button>
          </span>
        ))}
        {/* Inline add input */}
        <div className="relative">
          <input type="text" value={input}
            onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={e => {
              if (e.key === 'Enter' && input.trim()) { e.preventDefault(); onAdd(input.trim(), category); setInput(''); setShowSuggestions(false); }
              if (e.key === 'Escape') { setShowSuggestions(false); setInput(''); }
            }}
            placeholder="add..."
            className={`w-20 rounded-full border border-dashed ${colors.border} bg-transparent px-2.5 py-1 text-xs placeholder:text-notion-text-tertiary focus:outline-none`} />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border bg-white py-1 shadow-lg">
              {suggestions.map(s => (
                <button key={s.name}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onAdd(s.name, category); setInput(''); setShowSuggestions(false); }}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-notion-sidebar">
                  <span className={`rounded px-1.5 py-0.5 ${colors.bg} ${colors.text}`}>{s.name}</span>
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
    domain: categorizedTags.filter(t => t.category === 'domain'),
    method: categorizedTags.filter(t => t.category === 'method'),
    topic: categorizedTags.filter(t => t.category === 'topic'),
  };

  // Filter out system tags from counts
  const visibleTags = categorizedTags.filter(
    (t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()),
  );

  const handleAddTag = async (tagName: string, category: TagCategory) => {
    if (!tagName.trim()) return;
    if (categorizedTags.some(t => t.name === tagName.trim())) return;

    setSaving(true);
    try {
      const newTags = [...categorizedTags, { name: tagName.trim(), category }];
      // Note: This needs a new IPC method to update categorized tags
      // For now, fall back to old string tags (will be organized later)
      const tagNames = newTags.map(t => t.name);
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
      const tagNames = newTags.map(t => t.name);
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
      // Reload paper to get updated tags
      const updated = await ipc.getPaper(paper.id);
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
      // Reload paper to get updated tags
      const updated = await ipc.getPaper(paper.id);
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
            className="inline-flex items-center gap-1.5 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
          >
            {autoTagging ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Auto Tag
          </button>
          {visibleTags.length > 0 && (
            <button
              onClick={handleOrganize}
              disabled={organizing || saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
            >
              {organizing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Organize
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {TAG_CATEGORIES.map(category => (
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
// ─── Overview Page ────────────────────────────────────────────────────────────

export function OverviewPage() {
  const { id: shortId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { updateTabLabel, openTab } = useTabs();

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [activeCli, setActiveCli] = useState<CliConfig | null>(null);

  // Clone repo modal
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [detectingRepo, setDetectingRepo] = useState(false);
  const [detectedRepo, setDetectedRepo] = useState<string | null>(null);

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

    Promise.all([ipc.getPaperByShortId(shortId), ipc.getSettings()])
      .then(([p, settings]) => {
        setPaper(p);
        setPaperDir(`${settings.papersDir}/${p.shortId}`);
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

  // Separate notes by type
  const readingNotes = notes.filter((n) => !n.title.startsWith('Chat:'));
  const chatNotes = notes.filter((n) => n.title.startsWith('Chat:'));

  const handleOpenReader = useCallback(() => {
    if (!paper) return;
    openTab(`/papers/${paper.shortId}/reader`);
  }, [paper, openTab]);

  const handleOpenNotes = useCallback(() => {
    if (!paper) return;
    openTab(`/papers/${paper.shortId}/notes`);
  }, [paper, openTab]);

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
      await ipc.runCli({
        tool: parts[0],
        args: [
          ...parts.slice(1),
          '-p',
          `Clone the repository at ${repoUrl} into the ./code directory`,
        ],
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
          onClick={() => navigate('/papers')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
        >
          <ArrowLeft size={16} />
          Library
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
              onClick={() => setShowCloneModal(true)}
              disabled={!activeCli}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              <Github size={16} />
              Clone Repo
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

          {/* Meta info: Authors, Year */}
          {(paper.authors?.length || paper.year) && (
            <div className="flex flex-wrap items-center gap-4 text-sm text-notion-text-secondary">
              {paper.authors && paper.authors.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Authors:</span>
                  <span>{paper.authors.join(', ')}</span>
                </div>
              )}
              {paper.year && (
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Year:</span>
                  <span>{paper.year}</span>
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          <TagEditor paper={paper} onUpdate={setPaper} />

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

          {/* Reading Notes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider">
                Reading Notes
              </h2>
              <button
                onClick={handleCreateNote}
                className="inline-flex items-center gap-1.5 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
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
                  onClick={handleOpenReader}
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
                    onClick={() => openTab(`/papers/${paper.shortId}/reader?chatId=${note.id}`)}
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
