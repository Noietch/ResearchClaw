import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import {
  ipc,
  onIpc,
  onStreamingPort,
  type PaperItem,
  type TagInfo,
  type ModelConfig,
  type SourceEvent,
  type ProjectItem,
} from '../../../hooks/use-ipc';
import type { AgentConfigItem, AgentTodoItem } from '@shared';
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
  Github,
  FolderDown,
  Lightbulb,
  Target,
  FolderKanban,
  Copy,
  LayoutDashboard,
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
  arxivPdfUrl,
} from '@shared';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXCLUDED_TAGS = ['arxiv', 'chrome', 'manual', 'pdf'];

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
  const locale = i18n.language === 'zh' ? 'zh-CN' : 'en-US';
  return new Date(ts).toLocaleDateString(locale, {
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
  const toast = useToast();
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [lightweightModel, setLightweightModel] = useState<ModelConfig | null>(null);

  // Load all tags for autocomplete
  useEffect(() => {
    ipc
      .listAllTags()
      .then(setAllTags)
      .catch(() => {});
  }, []);

  // Load lightweight model status
  useEffect(() => {
    ipc
      .getActiveModel('lightweight')
      .then(setLightweightModel)
      .catch(() => undefined);
  }, []);

  const canAutoTag = useMemo(() => {
    if (!lightweightModel) return false;
    if (lightweightModel.backend === 'api' && !lightweightModel.hasApiKey) return false;
    return true;
  }, [lightweightModel]);

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
    if (!canAutoTag) {
      toast.warning('Lightweight model not configured. Please set it up in Settings > Models.');
      return;
    }
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
      const msg = err instanceof Error ? err.message : 'Auto-tagging failed';
      toast.error(msg);
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
            title={!canAutoTag ? 'Set up lightweight model in Settings' : 'Auto-tag paper'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              !canAutoTag
                ? 'border-notion-border text-notion-text-tertiary opacity-50 cursor-not-allowed'
                : 'border-notion-border text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text'
            } disabled:opacity-40`}
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
// ─── Project Adder ────────────────────────────────────────────────────────────

function ProjectAdder({ paperId }: { paperId: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [allProjects, setAllProjects] = useState<ProjectItem[]>([]);
  const [memberProjects, setMemberProjects] = useState<ProjectItem[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const loadData = useCallback(() => {
    Promise.all([ipc.listProjects(), ipc.getProjectsForPaper(paperId)])
      .then(([all, members]) => {
        setAllProjects(all);
        setMemberProjects(members);
      })
      .catch(() => {});
  }, [paperId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const addToProject = async (projectId: string, projectName: string) => {
    setAdding(projectId);
    try {
      await ipc.addPaperToProject(projectId, paperId);
      toast.success(`Added to ${projectName}`);
      setOpen(false);
      loadData();
    } catch {
      toast.error('Failed to add to project');
    } finally {
      setAdding(null);
    }
  };

  const memberIds = new Set(memberProjects.map((p) => p.id));
  const availableProjects = allProjects.filter((p) => !memberIds.has(p.id));

  if (allProjects.length === 0) return null;

  return (
    <div className="rounded-xl border border-notion-border p-5">
      <div className="flex flex-wrap items-center gap-2">
        <FolderKanban size={14} className="text-notion-text-secondary flex-shrink-0" />
        <span className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider flex-shrink-0">
          Projects
        </span>
        {memberProjects.map((project) => (
          <button
            key={project.id}
            onClick={() => navigate(`/projects?id=${project.id}`)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
          >
            <FolderKanban size={11} />
            {project.name}
          </button>
        ))}

        {availableProjects.length > 0 && (
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-notion-border px-2.5 py-1 text-xs text-notion-text-tertiary hover:border-notion-text-secondary hover:text-notion-text-secondary transition-colors"
            >
              <Plus size={11} />
              Add to project
            </button>
            {open && (
              <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-notion-border bg-white py-1 shadow-lg">
                {availableProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => void addToProject(project.id, project.name)}
                    disabled={adding === project.id}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-notion-sidebar disabled:opacity-50"
                  >
                    {adding === project.id ? (
                      <Loader2
                        size={11}
                        className="animate-spin flex-shrink-0 text-notion-text-tertiary"
                      />
                    ) : (
                      <FolderKanban size={11} className="flex-shrink-0 text-notion-text-tertiary" />
                    )}
                    <span className="flex-1 truncate text-notion-text">{project.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
  const { t } = useTranslation();

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [chatSessions, setChatSessions] = useState<AgentTodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<AgentConfigItem | null>(null);

  // Citations
  const [citationCounts, setCitationCounts] = useState<{
    references: number;
    citedBy: number;
  } | null>(null);

  // Clone repo modal
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [detectingRepo, setDetectingRepo] = useState(false);
  const [detectedRepo, setDetectedRepo] = useState<string | null>(null);

  // Load active agent
  useEffect(() => {
    ipc
      .listAgents()
      .then((agents) => {
        const active = agents.find((a) => a.enabled) ?? null;
        setActiveAgent(active);
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
        ipc.touchPaper(p.id).catch(() => undefined);
        const titlePrefix = `Chat: ${p.title.slice(0, 60)}`;
        return ipc
          .listAgentTodos()
          .then((todos) =>
            todos
              .filter((t) => t.title === titlePrefix)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
          );
      })
      .then((sessions) => {
        setChatSessions(sessions);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [shortId]);

  // Auto-open reader if navigated with openReader flag
  useEffect(() => {
    if (!paper || loading) return;
    const state = location.state as {
      openReader?: boolean;
      from?: string;
      initialPage?: number;
      initialPageYOffset?: number;
    } | null;
    if (state?.openReader && paper.pdfPath) {
      const navState: Record<string, unknown> = {};
      if (state.from) navState.from = state.from;
      if (state.initialPage != null) navState.initialPage = state.initialPage;
      if (state.initialPageYOffset != null) navState.initialPageYOffset = state.initialPageYOffset;
      openTab(`/papers/${paper.shortId}/reader`, navState);
    }
  }, [paper, loading, location.state, openTab]);

  // Load citation counts
  useEffect(() => {
    if (!paper) return;
    ipc
      .getCitationCounts(paper.id)
      .then(setCitationCounts)
      .catch(() => undefined);
  }, [paper?.id]);

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

  const handleDownloadPdf = useCallback(async () => {
    if (!paper) return;
    const pdfUrl = inferPdfUrl(paper);
    if (!pdfUrl) return;
    setDownloading(true);
    try {
      const result = await ipc.downloadPdf(paper.id, pdfUrl);
      setPaper((prev) => (prev ? { ...prev, pdfPath: result.pdfPath } : prev));
      const from = (location.state as { from?: string })?.from;
      openTab(`/papers/${paper.shortId}/reader`, from ? { from } : undefined);
    } catch {
      /* silent */
    } finally {
      setDownloading(false);
    }
  }, [paper, openTab, location.state]);

  const handleStartConversation = useCallback(() => {
    if (!paper) return;
    const from = (location.state as { from?: string })?.from;
    openTab(`/papers/${paper.shortId}/reader?panel=chat`, from ? { from } : undefined);
  }, [paper, openTab, location.state]);

  const handleOpenSource = useCallback(() => {
    if (!paper?.sourceUrl) return;
    window.open(paper.sourceUrl, '_blank');
  }, [paper]);

  // null = not yet detected, undefined = detection ran but found nothing
  const [detectRanOnce, setDetectRanOnce] = useState(false);

  const handleDetectRepo = useCallback(async () => {
    if (!paper) return;
    setDetectingRepo(true);
    setDetectedRepo(null);
    setDetectRanOnce(false);
    try {
      const result = await ipc.extractGithubUrl({
        title: paper.title,
        abstract: paper.abstract ?? undefined,
      });
      setDetectedRepo(result ?? null);
      setDetectRanOnce(true);
    } catch {
      setDetectRanOnce(true);
    } finally {
      setDetectingRepo(false);
    }
  }, [paper]);

  const handleCloneRepo = useCallback(async () => {
    const url = repoUrl.trim() || detectedRepo || '';
    if (!url || !paperDir || !activeAgent) return;
    setCloning(true);
    try {
      const prompt = `Clone the repository at ${url} into the ./code directory. Run: git clone ${url} code`;
      const todo = await ipc.createAgentTodo({
        title: `Clone repo for ${paper?.title ?? 'paper'}`,
        prompt,
        cwd: paperDir,
        agentId: activeAgent.id,
        yoloMode: true,
      });
      await ipc.runAgentTodo(todo.id);
      setShowCloneModal(false);
      setRepoUrl('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clone');
    } finally {
      setCloning(false);
    }
  }, [repoUrl, detectedRepo, paperDir, activeAgent, paper]);

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

  const handleDeletePaper = useCallback(async () => {
    if (!paper) return;
    setDeleting(true);
    try {
      await ipc.deletePaper(paper.id);
      navigate('/papers');
    } catch {
      toast.error(t('papers.deleteFailed'));
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [paper, navigate, toast, t]);

  // ESC to close delete confirmation modal
  useEffect(() => {
    if (!showDeleteConfirm) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDeleteConfirm(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showDeleteConfirm]);

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
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
        >
          <ArrowLeft size={16} />
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            {!paper.pdfPath && inferPdfUrl(paper) && (
              <button
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-600 shadow-sm transition-all hover:bg-blue-500/10 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {downloading ? 'Downloading…' : 'Download PDF'}
              </button>
            )}
            <button
              onClick={handleOpenReader}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar"
            >
              <BookOpen size={16} />
              Open Reader
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
              onClick={() => {
                setShowCloneModal(true);
                setRepoUrl('');
                setDetectedRepo(null);
                setDetectRanOnce(false);
                handleDetectRepo();
              }}
              disabled={!activeAgent}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              <Github size={16} />
              GitHub Repo
            </button>
            <button
              onClick={handleCopyBibtex}
              disabled={copyingBibtex}
              className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2.5 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
            >
              {copyingBibtex ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
              BibTeX
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-50 disabled:opacity-40"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {t('common.delete')}
            </button>
          </div>

          {/* Tags */}
          <TagEditor paper={paper} onUpdate={setPaper} />

          {/* Projects */}
          <ProjectAdder paperId={paper.id} />

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

          {/* Abstract / AI Summary */}
          <AbstractSection
            abstract={paper.abstract || ''}
            paperId={paper.id}
            shortId={paper.shortId}
            title={paper.title}
            pdfUrl={paper.pdfUrl}
            pdfPath={paper.pdfPath}
            onUpdate={(newAbstract) => setPaper((p) => (p ? { ...p, abstract: newAbstract } : p))}
          />

          {/* Chat History */}
          <div>
            <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider mb-3">
              Chat History
            </h2>
            {chatSessions.length === 0 ? (
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
                {chatSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() =>
                      openTab(`/papers/${paper.shortId}/reader?panel=chat&todoId=${session.id}`)
                    }
                    className="w-full flex items-center gap-4 rounded-lg border border-notion-border px-4 py-3 text-left transition-colors hover:bg-notion-sidebar/50"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      <MessageSquare size={16} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-notion-text truncate">
                        {session.title.replace('Chat: ', '')}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-notion-text-tertiary">
                        <Calendar size={11} />
                        {formatDate(session.updatedAt)}
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500/90"
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

      {/* Clone Repo Modal */}
      {showCloneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-notion-border bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-notion-text mb-4">Clone Repository</h3>

            {/* AI detection status */}
            {detectingRepo ? (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2">
                <Loader2 size={13} className="animate-spin text-notion-text-secondary" />
                <p className="text-xs text-notion-text-secondary">Detecting repository with AI…</p>
              </div>
            ) : detectRanOnce && detectedRepo ? (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                <p className="text-xs text-green-700 mb-0.5">Detected repository:</p>
                <p className="text-sm font-mono text-green-800 break-all">{detectedRepo}</p>
              </div>
            ) : detectRanOnce && !detectedRepo ? (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                <p className="text-xs text-amber-700">
                  No official repository detected. Enter the URL manually.
                </p>
              </div>
            ) : null}

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

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && paper && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setShowDeleteConfirm(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowDeleteConfirm(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="mx-4 max-w-sm rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-notion-text">
                {t('papers.deleteConfirmTitle')}
              </h3>
              <p className="mt-2 text-sm font-medium text-notion-text">
                {cleanArxivTitle(paper.title)}
              </p>
              <p className="mt-2 text-sm text-notion-text-secondary">
                {t('papers.deleteConfirmMessage')}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDeletePaper}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  {t('common.delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Parse abstract to detect AlphaXiv summary
 * Returns { alphaXivSummary, originalAbstract } or null if no AlphaXiv content
 */
function parseAlphaXivAbstract(abstract: string): {
  alphaXivSummary: string;
  originalAbstract: string;
} | null {
  const marker = '**AI-Generated Summary (AlphaXiv):**';
  const divider = '\n\n---\n\n**Original Abstract:**';

  if (!abstract.includes(marker)) {
    return null;
  }

  const startIndex = abstract.indexOf(marker) + marker.length;
  const dividerIndex = abstract.indexOf(divider);

  if (dividerIndex === -1) {
    return null;
  }

  const alphaXivSummary = abstract.slice(startIndex, dividerIndex).trim();
  const originalAbstract = abstract.slice(dividerIndex + divider.length).trim();

  return { alphaXivSummary, originalAbstract };
}

/**
 * Abstract section with tabs for AlphaXiv summary vs original abstract.
 * Supports generating AI summary for ANY paper (not just arXiv) when no AlphaXiv data exists.
 */
function AbstractSection({
  abstract,
  paperId,
  shortId,
  title,
  pdfUrl,
  pdfPath,
  onUpdate,
}: {
  abstract: string;
  paperId: string;
  shortId: string;
  title: string;
  pdfUrl?: string;
  pdfPath?: string;
  onUpdate: (newAbstract: string) => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'alphaxiv' | 'abstract'>('abstract');
  const [fetching, setFetching] = useState(false);
  const [localAiSummary, setLocalAiSummary] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState<string>('');
  const parsed = parseAlphaXivAbstract(abstract);

  // Ref-based chunk buffer: accumulate chunks without triggering renders,
  // then flush to state once per animation frame for smooth streaming.
  const chunkBufferRef = useRef<string>('');
  const rafRef = useRef<number>(0);

  // Check if shortId looks like an arXiv ID
  const isArxivPaper = /^\d{4}\.\d{4,5}/.test(shortId);

  // Reset state when paper changes
  useEffect(() => {
    setLocalAiSummary(null);
    setStreamingContent('');
    chunkBufferRef.current = '';
    setActiveTab('abstract');
    setGenerating(false);
    setGenPhase('');
  }, [paperId]);

  // Listen for streaming events via MessagePort (bypasses Electron IPC batching)
  // Phase, Done, and Error still use regular IPC (they're one-shot events, not affected by batching)
  useEffect(() => {
    // MessagePort-based chunk streaming — chunks arrive individually, not batched
    const unsubPort = onStreamingPort(
      paperId,
      (chunk: string) => {
        // Accumulate in ref (no render), schedule RAF flush
        chunkBufferRef.current += chunk;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const buf = chunkBufferRef.current;
            setStreamingContent(buf);
          });
        }
      },
      () => {
        // onDone from port — no action needed, we rely on IPC done event for final summary
      },
      (error: string) => {
        console.error('AI summary streaming port error:', error);
      },
    );

    // Fallback: also listen for IPC-based chunks in case MessagePort isn't available
    const unsubChunk = onIpc('papers:aiSummaryChunk', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; chunk: string };
      if (data?.paperId === paperId) {
        chunkBufferRef.current += data.chunk;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const buf = chunkBufferRef.current;
            setStreamingContent(buf);
          });
        }
      }
    });
    const unsubPhase = onIpc('papers:aiSummaryPhase', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; phase: string };
      if (data?.paperId === paperId) {
        setGenPhase(data.phase);
      }
    });
    const unsubDone = onIpc('papers:aiSummaryDone', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; summary: string };
      if (data?.paperId === paperId) {
        // Cancel any pending RAF
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        chunkBufferRef.current = '';
        setLocalAiSummary(data.summary);
        setStreamingContent('');
        setGenerating(false);
      }
    });
    const unsubError = onIpc('papers:aiSummaryError', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; error: string };
      if (data?.paperId === paperId) {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        chunkBufferRef.current = '';
        console.error('AI summary generation failed:', data.error);
        setGenerating(false);
      }
    });
    return () => {
      unsubPort();
      unsubChunk();
      unsubPhase();
      unsubDone();
      unsubError();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [paperId]);

  // On mount: try AlphaXiv for arXiv papers, then check local cache for all papers
  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      // 1. For arXiv papers without embedded summary, try AlphaXiv first
      if (isArxivPaper && !parsed) {
        setFetching(true);
        try {
          const newAbstract = await ipc.fetchAlphaXiv(paperId, shortId);
          if (!cancelled && newAbstract) {
            onUpdate(newAbstract);
            setFetching(false);
            return;
          }
        } catch {
          // AlphaXiv failed, continue to local cache
        }
        if (!cancelled) setFetching(false);
      }

      // 2. Check for locally generated AI summary (any paper type)
      if (!parsed) {
        try {
          const cached = await ipc.getAiSummary(shortId);
          if (!cancelled && cached) {
            setLocalAiSummary(cached);
          }
        } catch {
          // ignore
        }
      }
    }

    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [paperId, shortId]);

  const handleGenerate = useCallback(() => {
    setGenerating(true);
    setStreamingContent('');
    chunkBufferRef.current = '';
    setGenPhase('');
    setActiveTab('alphaxiv');
    // Pure event-based: send triggers generation, results arrive via on() listeners
    ipc.startAiSummary({
      paperId,
      shortId,
      title,
      abstract,
      pdfUrl,
      pdfPath,
      language: i18n.language as 'en' | 'zh',
    });
  }, [paperId, shortId, title, abstract, pdfUrl, pdfPath]);

  const handleRegenerate = useCallback(async () => {
    // Delete cached file, but keep localAiSummary visible until streaming replaces it
    try {
      await ipc.deleteAiSummary(shortId);
    } catch {
      // ignore
    }
    handleGenerate();
  }, [shortId, handleGenerate]);

  const hasSummary = parsed || localAiSummary || generating;
  const isStreaming = generating && streamingContent.length > 0;

  // Show generate button in header when appropriate
  const generateButton =
    !fetching && !parsed ? (
      <button
        onClick={hasSummary ? handleRegenerate : handleGenerate}
        disabled={generating}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-50"
      >
        {generating ? (
          <Loader2 size={12} className="animate-spin" />
        ) : hasSummary ? (
          <RefreshCw size={12} />
        ) : (
          <Wand2 size={12} />
        )}
        {generating
          ? t('paper.aiSummaryGenerating')
          : hasSummary
            ? t('paper.regenerateAiSummary')
            : t('paper.generateAiSummary')}
      </button>
    ) : null;

  // No summary and not streaming — show abstract with generate button
  if (!hasSummary && !isStreaming) {
    return (
      <div className="rounded-xl border border-notion-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-notion-text-secondary uppercase tracking-wider">
            Abstract
          </h2>
          <div className="flex items-center gap-2">
            {fetching && (
              <div className="flex items-center gap-1.5 text-purple-500 text-xs">
                <Loader2 size={12} className="animate-spin" />
                {t('paper.alphaXivLoading')}
              </div>
            )}
            {generateButton}
          </div>
        </div>
        {abstract ? (
          <div className="text-sm text-notion-text leading-relaxed">
            <MarkdownContent content={abstract} />
          </div>
        ) : (
          <p className="text-sm text-notion-text-tertiary italic">{t('paper.noAbstract')}</p>
        )}
      </div>
    );
  }

  const summaryContent = generating
    ? streamingContent
    : parsed?.alphaXivSummary || localAiSummary || '';
  const originalAbstract = parsed?.originalAbstract || abstract;
  const summaryLabel = parsed ? 'AI Summary (AlphaXiv)' : t('paper.aiSummaryLocal');

  return (
    <div className="rounded-xl border border-notion-border p-5">
      {/* Tab Header */}
      <div className="flex items-center gap-1 mb-3">
        <button
          onClick={() => setActiveTab('abstract')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'abstract'
              ? 'bg-blue-50 text-blue-600'
              : 'text-notion-text-secondary hover:bg-notion-sidebar'
          }`}
        >
          Abstract
        </button>
        <button
          onClick={() => setActiveTab('alphaxiv')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'alphaxiv'
              ? 'bg-purple-100 text-purple-700'
              : 'text-notion-text-secondary hover:bg-notion-sidebar'
          }`}
        >
          {summaryLabel}
          {generating && <Loader2 size={10} className="ml-1 inline animate-spin" />}
        </button>
        <div className="ml-auto">{generateButton}</div>
      </div>

      {/* Tab Content */}
      {activeTab === 'alphaxiv' ? (
        <div className="max-h-[400px] overflow-y-auto rounded-lg border border-purple-100 bg-purple-50/30 p-4">
          {generating && !streamingContent ? (
            <div className="flex items-center gap-2 text-sm text-purple-500">
              <Loader2 size={14} className="animate-spin" />
              {genPhase === 'extracting'
                ? t('paper.aiSummaryExtracting')
                : genPhase === 'generating'
                  ? t('paper.aiSummaryWaitingLLM')
                  : t('paper.aiSummaryGenerating')}
            </div>
          ) : (
            <MarkdownContent content={summaryContent} />
          )}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5" />
          )}
        </div>
      ) : (
        <div>
          {originalAbstract ? (
            <MarkdownContent content={originalAbstract} />
          ) : (
            <p className="text-sm text-notion-text-tertiary italic">{t('paper.noAbstract')}</p>
          )}
        </div>
      )}
    </div>
  );
}
