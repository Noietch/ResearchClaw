import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ipc,
  type PaperItem,
  type TagInfo,
  type TaggingStatus,
  type ImportStatus,
  type ModelConfig,
  onIpc,
} from '../hooks/use-ipc';
import {
  FileText,
  Loader2,
  Trash2,
  Tag,
  Download,
  X,
  ChevronDown,
  CheckSquare,
  Square,
  Wand2,
  Settings,
  Upload,
  Search,
  RotateCcw,
  Copy,
  Check,
  GitCompareArrows,
  Sparkles,
  Database,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TagCategory } from '@shared';
import { CATEGORY_COLORS, CATEGORY_LABELS, TAG_CATEGORIES, cleanArxivTitle } from '@shared';
import { TagManagementModal } from './tag-management-modal';
import { useToast } from './toast';

const EXCLUDED_TAGS = ['arxiv', 'chrome', 'manual', 'pdf'];
const MAX_VISIBLE_CHIPS = 8;

type ImportTimeFilter = 'all' | 'today' | 'week' | 'month';
type CategoryFilter = 'all' | TagCategory;

const TIME_FILTER_OPTIONS: { value: ImportTimeFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const CATEGORY_FILTER_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'domain', label: 'Domain' },
  { value: 'method', label: 'Method' },
  { value: 'topic', label: 'Topic' },
];

function ProcessingBadge({ status }: { status?: string }) {
  if (!status || status === 'idle' || status === 'queued' || status === 'completed') return null;

  const styles: Record<string, string> = {
    extracting_text: 'bg-amber-50 text-amber-700',
    extracting_metadata: 'bg-amber-50 text-amber-700',
    chunking: 'bg-amber-50 text-amber-700',
    embedding: 'bg-amber-50 text-amber-700',
    failed: 'bg-red-50 text-red-700',
  };

  const labels: Record<string, string> = {
    extracting_text: 'Extracting',
    extracting_metadata: 'Metadata',
    chunking: 'Chunking',
    embedding: 'Indexing',
    failed: 'Needs retry',
  };

  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-slate-50 text-slate-600'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

// Generic pill dropdown
function PillDropdown<T extends string>({
  options,
  selected,
  onSelect,
  label,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const selectedLabel = options.find((o) => o.value === selected)?.label ?? label ?? selected;
  const isActive = selected !== options[0]?.value;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
          isActive
            ? 'bg-notion-text text-white'
            : 'bg-notion-sidebar text-notion-text-secondary hover:bg-notion-border'
        }`}
      >
        {selectedLabel}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full z-20 mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-notion-border bg-white py-1 shadow-lg"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
                className={`block w-full px-4 py-1.5 text-left text-xs transition-colors ${
                  selected === opt.value
                    ? 'bg-notion-sidebar font-medium text-notion-text'
                    : 'text-notion-text-secondary hover:bg-notion-sidebar'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Year dropdown
function YearDropdown({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number | null;
  onSelect: (year: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
          selected !== null
            ? 'bg-notion-text text-white'
            : 'bg-notion-sidebar text-notion-text-secondary hover:bg-notion-border'
        }`}
      >
        {selected ?? 'Year'}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-notion-border bg-white py-1 shadow-lg"
          >
            <button
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className={`block w-full px-4 py-1.5 text-left text-xs transition-colors ${
                selected === null
                  ? 'bg-notion-sidebar font-medium text-notion-text'
                  : 'text-notion-text-secondary hover:bg-notion-sidebar'
              }`}
            >
              All years
            </button>
            {years.map((year) => (
              <button
                key={year}
                onClick={() => {
                  onSelect(selected === year ? null : year);
                  setOpen(false);
                }}
                className={`block w-full px-4 py-1.5 text-left text-xs transition-colors ${
                  selected === year
                    ? 'bg-notion-sidebar font-medium text-notion-text'
                    : 'text-notion-text-secondary hover:bg-notion-sidebar'
                }`}
              >
                {year}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PapersByTag({
  importStatus: _importStatus,
  onOpenImport,
}: {
  importStatus?: ImportStatus | null;
  onOpenImport?: () => void;
}) {
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [importTimeFilter, setImportTimeFilter] = useState<ImportTimeFilter>('all');
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const [retryingPaperId, setRetryingPaperId] = useState<string | null>(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [taggingStatus, setTaggingStatus] = useState<TaggingStatus | null>(null);
  const [showTagManagement, setShowTagManagement] = useState(false);

  // Single paper auto-tag, index and analyze state
  const [autoTaggingPaperId, setAutoTaggingPaperId] = useState<string | null>(null);
  const [indexingPaperId, setIndexingPaperId] = useState<string | null>(null);
  const [analyzingPaperId, setAnalyzingPaperId] = useState<string | null>(null);

  // Batch operation progress state
  const [batchTagProgress, setBatchTagProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [batchIndexProgress, setBatchIndexProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  // Use ref to track progress without triggering re-renders

  // Lightweight model state for auto-tag feature
  const [lightweightModel, setLightweightModel] = useState<ModelConfig | null>(null);

  // Embedding config state for index feature
  const [embeddingConfig, setEmbeddingConfig] = useState<{
    configs: Array<{ id: string; name: string }>;
    activeId: string | null;
  } | null>(null);

  // Selection mode state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isExportingBibtex, setIsExportingBibtex] = useState(false);
  const [bibtexContent, setBibtexContent] = useState<string | null>(null);
  const [bibtexCopied, setBibtexCopied] = useState(false);

  const navigate = useNavigate();
  const toast = useToast();

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    try {
      const [paperData, tagData] = await Promise.all([ipc.listPapers(), ipc.listAllTags()]);
      setPapers(paperData);
      setAllTags(tagData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const lastRefreshCountRef = useRef(0);
  const lastPapersRefreshCountRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onIpc('tagging:status', (_event, status) => {
      const typedStatus = status as TaggingStatus;
      setTaggingStatus(typedStatus);

      if (typedStatus.stage === 'error' && typedStatus.message) {
        const isNoModel =
          typedStatus.message.includes('No usable lightweight API model') ||
          typedStatus.message.includes('No API key configured') ||
          typedStatus.message.includes('No lightweight model configured');
        if (isNoModel) {
          toast.warning('Lightweight model not configured. Please set it up in Settings > Models.');
        }
      }

      const shouldRefreshTags =
        (!typedStatus.active && typedStatus.completed > 0) ||
        (typedStatus.active && typedStatus.completed - lastRefreshCountRef.current >= 2);

      const shouldRefreshPapers =
        (!typedStatus.active && typedStatus.completed > 0) ||
        (typedStatus.active && typedStatus.completed - lastPapersRefreshCountRef.current >= 5);

      if (shouldRefreshTags) {
        lastRefreshCountRef.current = typedStatus.completed;
        ipc
          .listAllTags()
          .then(setAllTags)
          .catch(() => undefined);
      }

      if (shouldRefreshPapers) {
        lastPapersRefreshCountRef.current = typedStatus.completed;
        ipc
          .listPapers()
          .then(setPapers)
          .catch(() => undefined);
      }

      if (!typedStatus.active && typedStatus.completed > 0) {
        fetchPapers();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [fetchPapers, toast]);

  useEffect(() => {
    ipc
      .getTaggingStatus()
      .then(setTaggingStatus)
      .catch(() => undefined);
  }, []);

  // Fetch lightweight model status for auto-tag feature
  useEffect(() => {
    ipc
      .getActiveModel('lightweight')
      .then(setLightweightModel)
      .catch(() => undefined);
  }, []);

  // Fetch embedding config for index feature
  useEffect(() => {
    ipc
      .listEmbeddingConfigs()
      .then(setEmbeddingConfig)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  useEffect(() => {
    return onIpc('papers:processingStatus', (_event, payload) => {
      const { paperId, status } = payload as { paperId: string; status: string; error?: string };
      setPapers((prev) =>
        prev.map((p) =>
          p.id === paperId
            ? {
                ...p,
                processingStatus: status,
                indexedAt: status === 'completed' ? new Date().toISOString() : p.indexedAt,
              }
            : p,
        ),
      );
    });
  }, []);

  // Check if lightweight model is available for auto-tag
  const canAutoTag = useMemo(() => {
    if (!lightweightModel) return false;
    // For API models, need to have API key configured
    if (lightweightModel.backend === 'api' && !lightweightModel.hasApiKey) return false;
    return true;
  }, [lightweightModel]);

  // Check if embedding config is available for index feature
  const canIndex = useMemo(() => {
    return embeddingConfig?.activeId != null;
  }, [embeddingConfig]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    papers.forEach((p) => {
      if (p.submittedAt) years.add(new Date(p.submittedAt).getUTCFullYear());
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [papers]);

  const importTimeCutoff = useMemo(() => {
    if (importTimeFilter === 'all') return null;
    const now = new Date();
    switch (importTimeFilter) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      default:
        return null;
    }
  }, [importTimeFilter]);

  const visiblePapers = useMemo(() => {
    return papers.filter((paper) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = paper.title.toLowerCase().includes(q);
        const matchesAuthors = (paper.authors || []).some((a) => a.toLowerCase().includes(q));
        if (!matchesTitle && !matchesAuthors) return false;
      }

      if (selectedTag) {
        const tags = (paper.categorizedTags || [])
          .filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()))
          .map((t) => t.name);
        if (selectedTag === 'Untagged' && tags.length > 0) return false;
        if (selectedTag !== 'Untagged' && !tags.includes(selectedTag)) return false;
      }

      if (importTimeCutoff && paper.createdAt) {
        const created = new Date(paper.createdAt);
        if (created < importTimeCutoff) return false;
      }

      if (
        yearFilter !== null &&
        (paper.submittedAt ? new Date(paper.submittedAt).getUTCFullYear() : null) !== yearFilter
      )
        return false;

      return true;
    });
  }, [papers, searchQuery, selectedTag, importTimeCutoff, yearFilter]);

  const tagList = useMemo(() => {
    const untaggedCount = papers.filter(
      (p) =>
        !p.categorizedTags ||
        p.categorizedTags.filter((t) => !EXCLUDED_TAGS.includes(t.name)).length === 0,
    ).length;

    let tags = allTags.filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()));

    if (categoryFilter !== 'all') {
      tags = tags.filter((t) => t.category === categoryFilter);
    }

    const tagStats = tags.map((t) => ({ name: t.name, count: t.count, category: t.category }));

    if (categoryFilter === 'all' || untaggedCount > 0) {
      tagStats.push({ name: 'Untagged', count: untaggedCount, category: 'topic' });
    }

    return tagStats.sort((a, b) => {
      if (a.name === 'Untagged') return 1;
      if (b.name === 'Untagged') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [allTags, papers, categoryFilter]);

  const untaggedCount = useMemo(() => {
    return papers.filter(
      (p) =>
        !p.categorizedTags ||
        p.categorizedTags.filter((t) => !EXCLUDED_TAGS.includes(t.name)).length === 0,
    ).length;
  }, [papers]);

  const unindexedCount = useMemo(() => {
    return papers.filter((p) => !p.indexedAt && p.abstract).length;
  }, [papers]);

  const handleBatchAutoTag = useCallback(async () => {
    // Check if lightweight model is configured
    if (!canAutoTag) {
      toast.warning('Lightweight model not configured. Please set it up in Settings > Models.');
      return;
    }

    // Get untagged papers (excluding system tags)
    const untaggedPapers = papers.filter(
      (p) =>
        !p.categorizedTags ||
        p.categorizedTags.filter((t) => !EXCLUDED_TAGS.includes(t.name)).length === 0,
    );
    if (untaggedPapers.length === 0) {
      toast.info('No untagged papers to process');
      return;
    }

    setBatchTagProgress({ current: 0, total: untaggedPapers.length });

    try {
      for (let i = 0; i < untaggedPapers.length; i++) {
        const paper = untaggedPapers[i];
        setBatchTagProgress({ current: i + 1, total: untaggedPapers.length });
        try {
          await ipc.tagPaper(paper.id);
        } catch {
          // Continue with next paper even if one fails
        }
        // Small delay to prevent overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      toast.success(`Auto-tagged ${untaggedPapers.length} papers`);
      void fetchPapers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auto-tagging failed';
      toast.error(msg);
    } finally {
      setBatchTagProgress(null);
    }
  }, [canAutoTag, papers, toast, fetchPapers]);

  const handleBatchIndex = useCallback(async () => {
    // Check if embedding model is configured
    if (!canIndex) {
      toast.warning(
        'Embedding model not configured. Please set it up in Settings > Semantic Search.',
      );
      return;
    }

    const unindexedPapers = papers.filter((p) => !p.indexedAt && p.abstract);
    if (unindexedPapers.length === 0) {
      toast.info('No unindexed papers to process');
      return;
    }

    setBatchIndexProgress({ current: 0, total: unindexedPapers.length });

    try {
      const CONCURRENCY = 5;
      let completed = 0;
      const now = new Date().toISOString();

      for (let i = 0; i < unindexedPapers.length; i += CONCURRENCY) {
        const batch = unindexedPapers.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (paper) => {
            try {
              await ipc.retryPaperProcessing(paper.id);
              setPapers((prev) =>
                prev.map((p) => (p.id === paper.id ? { ...p, indexedAt: now } : p)),
              );
            } catch {
              // Continue with next paper even if one fails
            }
            completed += 1;
            setBatchIndexProgress({ current: completed, total: unindexedPapers.length });
          }),
        );
      }
      toast.success(`Indexed ${unindexedPapers.length} papers`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Indexing failed';
      toast.error(msg);
    } finally {
      setBatchIndexProgress(null);
    }
  }, [canIndex, papers, toast]);

  const handleDelete = useCallback(async (paperId: string) => {
    setDeleting(paperId);
    try {
      await ipc.deletePaper(paperId);
      setPapers((prev) => prev.filter((p) => p.id !== paperId));
    } catch {
      // silent
    } finally {
      setDeleting(null);
    }
  }, []);

  const handleDownloadPdf = useCallback(
    async (paper: PaperItem) => {
      if (!paper.pdfUrl || downloadingPdf === paper.id) return;
      setDownloadingPdf(paper.id);
      try {
        const result = await ipc.downloadPdf(paper.id, paper.pdfUrl);
        setPapers((prev) =>
          prev.map((p) => (p.id === paper.id ? { ...p, pdfPath: result.pdfPath } : p)),
        );
      } catch {
        // silent
      } finally {
        setDownloadingPdf(null);
      }
    },
    [downloadingPdf],
  );

  const handleRetryProcessing = useCallback(
    async (paperId: string) => {
      setRetryingPaperId(paperId);
      try {
        await ipc.retryPaperProcessing(paperId);
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Retrying paper processing failed');
      } finally {
        setRetryingPaperId(null);
      }
    },
    [fetchPapers],
  );

  const handleAutoTagPaper = useCallback(
    async (paperId: string) => {
      // Check if lightweight model is configured before proceeding
      if (!canAutoTag) {
        toast.warning('Lightweight model not configured. Please set it up in Settings > Models.');
        return;
      }
      setAutoTaggingPaperId(paperId);
      try {
        await ipc.tagPaper(paperId);
        toast.success('Auto-tagging started');
        // Refresh papers after a short delay to show new tags
        setTimeout(() => void fetchPapers(), 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Auto-tagging failed';
        const isNoModel =
          msg.includes('No usable lightweight API model') ||
          msg.includes('No API key configured for the selected lightweight model') ||
          msg.includes('No lightweight model configured');
        if (isNoModel) {
          toast.warning('Lightweight model not configured. Please set it up in Settings > Models.');
        } else {
          toast.error(msg);
        }
      } finally {
        setAutoTaggingPaperId(null);
      }
    },
    [canAutoTag, fetchPapers, toast],
  );

  const handleIndexPaper = useCallback(
    async (paperId: string) => {
      // Check if embedding config is set up before proceeding
      if (!canIndex) {
        toast.warning(
          'Embedding model not configured. Please set it up in Settings > Semantic Search.',
        );
        return;
      }
      setIndexingPaperId(paperId);
      try {
        await ipc.retryPaperProcessing(paperId);
        setPapers((prev) =>
          prev.map((p) => (p.id === paperId ? { ...p, indexedAt: new Date().toISOString() } : p)),
        );
        toast.success('Indexed');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Indexing failed';
        toast.error(msg);
      } finally {
        setIndexingPaperId(null);
      }
    },
    [canIndex, toast],
  );

  const handleAnalyzePaper = useCallback(
    async (paper: PaperItem) => {
      setAnalyzingPaperId(paper.id);
      try {
        const pdfUrl = paper.pdfUrl || (paper.pdfPath ? `file://${paper.pdfPath}` : undefined);
        const result = await ipc.analyzePaper({ paperId: paper.id, pdfUrl });
        if (result.started) {
          toast.success('Analysis started - view progress in paper details');
        } else if (result.alreadyRunning) {
          toast.info('Analysis already in progress');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Analysis failed';
        toast.error(msg);
      } finally {
        setAnalyzingPaperId(null);
      }
    },
    [toast],
  );

  const toggleSelect = useCallback((paperId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const filtered = papers.filter((paper) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = paper.title.toLowerCase().includes(q);
        const matchesAuthors = (paper.authors || []).some((a) => a.toLowerCase().includes(q));
        if (!matchesTitle && !matchesAuthors) return false;
      }
      if (selectedTag) {
        const tags = (paper.categorizedTags || [])
          .filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()))
          .map((t) => t.name);
        if (selectedTag === 'Untagged' && tags.length > 0) return false;
        if (selectedTag !== 'Untagged' && !tags.includes(selectedTag)) return false;
      }
      if (importTimeCutoff && paper.createdAt) {
        const created = new Date(paper.createdAt);
        if (created < importTimeCutoff) return false;
      }
      if (
        yearFilter !== null &&
        (paper.submittedAt ? new Date(paper.submittedAt).getUTCFullYear() : null) !== yearFilter
      )
        return false;
      return true;
    });
    setSelectedIds(new Set(filtered.map((p) => p.id)));
  }, [papers, searchQuery, selectedTag, importTimeCutoff, yearFilter]);

  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsBatchDeleting(true);
    try {
      await ipc.deletePapers(Array.from(selectedIds));
      setPapers((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
      setIsSelectMode(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to delete papers: ${message}`);
    } finally {
      setIsBatchDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [selectedIds]);

  const handleExportBibtex = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsExportingBibtex(true);
    try {
      const bibtex = await ipc.exportBibtex(Array.from(selectedIds));
      setBibtexContent(bibtex);
      setBibtexCopied(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to generate BibTeX: ${message}`);
    } finally {
      setIsExportingBibtex(false);
    }
  }, [selectedIds, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between border-b border-notion-border py-5">
          <h1 className="text-2xl font-bold tracking-tight text-notion-text">Library</h1>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Upload size={14} />
            Import
          </button>
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <FileText size={36} strokeWidth={1.2} className="mb-3 text-notion-border" />
          <p className="text-sm text-notion-text-tertiary">No papers yet</p>
          <p className="text-xs text-notion-text-tertiary">
            Import from Chrome history or add manually
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-notion-border py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-notion-text">Library</h1>
          <span className="rounded-full bg-notion-sidebar px-2.5 py-0.5 text-xs font-medium text-notion-text-secondary">
            {papers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Batch Auto Tag */}
          {untaggedCount > 0 && (
            <div className="flex flex-col gap-1">
              <motion.button
                onClick={handleBatchAutoTag}
                disabled={batchTagProgress !== null || !canAutoTag}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wand2 size={14} />
                Auto Tag {untaggedCount}
              </motion.button>
              {/* Batch Tag Progress */}
              {batchTagProgress && (
                <div className="w-full">
                  <div className="flex items-center justify-between text-[10px] text-notion-text-tertiary mb-0.5">
                    <span>
                      {batchTagProgress.current}/{batchTagProgress.total}
                    </span>
                  </div>
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-blue-500 transition-[width] duration-150 ease-out"
                      style={{
                        width: `${(batchTagProgress.current / batchTagProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Batch Index */}
          {unindexedCount > 0 && (
            <div className="relative">
              <motion.button
                onClick={handleBatchIndex}
                disabled={batchIndexProgress !== null || !canIndex}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Database size={14} />
                Index {unindexedCount}
              </motion.button>
              {/* Batch Index Progress - absolute positioned below button */}
              {batchIndexProgress && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white rounded-lg border border-notion-border shadow-notion p-2">
                  <div className="flex items-center justify-between text-[10px] text-notion-text-tertiary mb-1">
                    <span>
                      {batchIndexProgress.current}/{batchIndexProgress.total}
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-blue-500 transition-[width] duration-200 ease-out"
                      style={{
                        width: `${(batchIndexProgress.current / batchIndexProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Upload size={14} />
            Import
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="border-b border-notion-border py-3">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
          />
          <input
            type="text"
            placeholder="Search papers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchQuery('');
            }}
            className="w-full rounded-xl border border-notion-border bg-notion-sidebar/40 py-2 pl-9 pr-9 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 transition-all duration-150"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary hover:text-notion-text"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2.5 border-b border-notion-border py-3">
        {/* Row 1: Category tabs + Time/Year dropdowns */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            {CATEGORY_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setCategoryFilter(opt.value);
                  setSelectedTag(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  categoryFilter === opt.value
                    ? 'bg-notion-text text-white'
                    : 'text-notion-text-secondary hover:bg-notion-sidebar'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <PillDropdown
              options={TIME_FILTER_OPTIONS}
              selected={importTimeFilter}
              onSelect={setImportTimeFilter}
              label="Time"
            />
            {availableYears.length > 0 && (
              <YearDropdown years={availableYears} selected={yearFilter} onSelect={setYearFilter} />
            )}
            {(importTimeFilter !== 'all' || yearFilter !== null) && (
              <button
                onClick={() => {
                  setImportTimeFilter('all');
                  setYearFilter(null);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text"
                title="Clear time/year filters"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Scrollable tag chip strip */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSelectedTag(null)}
                className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedTag === null
                    ? 'bg-notion-text text-white'
                    : 'bg-notion-sidebar text-notion-text-secondary hover:bg-notion-border'
                }`}
              >
                All
                <span
                  className={`text-xs ${selectedTag === null ? 'opacity-70' : 'text-notion-text-tertiary'}`}
                >
                  {papers.length}
                </span>
              </button>
              {tagList.slice(0, MAX_VISIBLE_CHIPS).map(({ name, count, category }) => {
                const colors = CATEGORY_COLORS[category as TagCategory] || CATEGORY_COLORS.topic;
                const isSelected = selectedTag === name;
                return (
                  <button
                    key={name}
                    onClick={() => setSelectedTag(isSelected ? null : name)}
                    className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? `${colors.selectedBg} text-white`
                        : `${colors.bg} ${colors.text} hover:opacity-80`
                    }`}
                  >
                    {name}
                    <span className={`text-xs ${isSelected ? 'opacity-70' : 'opacity-60'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {tagList.length > MAX_VISIBLE_CHIPS && (
              <button
                onClick={() => setShowTagModal(true)}
                className="inline-flex items-center gap-1 rounded-full bg-notion-sidebar px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-border"
              >
                +{tagList.length - MAX_VISIBLE_CHIPS}
              </button>
            )}
            {selectedTag && (
              <button
                onClick={() => setSelectedTag(null)}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X size={10} />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tagging progress banner */}
      <AnimatePresence>
        {taggingStatus?.active && taggingStatus.stage !== 'error' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 py-2.5"
          >
            <Loader2 size={14} className="animate-spin text-blue-600" />
            <span className="text-sm text-blue-700">
              {taggingStatus.message || 'Auto-tagging in progress...'} {taggingStatus.completed}/
              {taggingStatus.total}
            </span>
            {taggingStatus.currentPaperTitle && (
              <span className="truncate text-xs text-blue-600">
                {taggingStatus.currentPaperTitle}
              </span>
            )}
            <button
              onClick={() => ipc.cancelTagging()}
              className="ml-auto text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papers count + actions bar */}
      <div className="flex items-center justify-between py-2.5">
        <p className="text-sm text-notion-text-tertiary">
          {visiblePapers.length} paper{visiblePapers.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          {!isSelectMode && visiblePapers.length > 0 && (
            <button
              onClick={() => setIsSelectMode(true)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
            >
              <CheckSquare size={13} />
              Select
            </button>
          )}
          <button
            onClick={() => setShowTagManagement(true)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Settings size={13} />
            Manage Tags
          </button>
        </div>
      </div>

      {/* Selection toolbar */}
      <AnimatePresence>
        {isSelectMode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3 border-b border-notion-border bg-notion-sidebar py-2"
          >
            <span className="text-sm font-medium text-notion-text">
              {selectedIds.size} selected
            </span>
            <button
              onClick={selectedIds.size === visiblePapers.length ? deselectAll : selectAll}
              className="text-xs text-notion-accent hover:underline"
            >
              {selectedIds.size === visiblePapers.length ? 'Deselect all' : 'Select all'}
            </button>
            <div className="h-4 w-px bg-notion-border" />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => navigate(`/compare?ids=${Array.from(selectedIds).join(',')}`)}
                disabled={selectedIds.size < 2 || selectedIds.size > 3}
                title={
                  selectedIds.size < 2
                    ? 'Select 2-3 papers to compare'
                    : selectedIds.size > 3
                      ? 'Compare supports up to 3 papers'
                      : 'Compare selected papers'
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover disabled:opacity-50"
              >
                <GitCompareArrows size={12} />
                Compare
              </button>
              <button
                onClick={handleExportBibtex}
                disabled={selectedIds.size === 0 || isExportingBibtex}
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover disabled:opacity-50"
              >
                {isExportingBibtex ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Copy size={12} />
                )}
                BibTeX
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedIds.size === 0 || isBatchDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                {isBatchDeleting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                Delete
              </button>
            </div>
            <div className="flex-1" />
            <button
              onClick={exitSelectMode}
              className="flex h-6 w-6 items-center justify-center rounded-md text-notion-text-tertiary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-notion-text">Delete Papers</h3>
              <p className="mt-2 text-sm text-notion-text-secondary">
                Are you sure you want to delete {selectedIds.size} paper
                {selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={isBatchDeleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {isBatchDeleting && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BibTeX modal */}
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

      {/* Papers list */}
      <div>
        {visiblePapers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Tag size={32} strokeWidth={1.2} className="mb-3 text-notion-border" />
            <p className="text-sm text-notion-text-tertiary">No papers match the current filters</p>
          </div>
        ) : (
          <div className="rounded-xl border border-notion-border bg-white overflow-hidden">
            {visiblePapers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                deleting={deleting}
                downloadingPdf={downloadingPdf}
                retryingPaperId={retryingPaperId}
                autoTaggingPaperId={autoTaggingPaperId}
                indexingPaperId={indexingPaperId}
                analyzingPaperId={analyzingPaperId}
                canAutoTag={canAutoTag}
                canIndex={canIndex}
                onDelete={handleDelete}
                onDownload={handleDownloadPdf}
                onRetry={handleRetryProcessing}
                onAutoTag={handleAutoTagPaper}
                onIndex={handleIndexPaper}
                onAnalyze={handleAnalyzePaper}
                onOpen={(shortId, state) => navigate(`/papers/${shortId}`, { state })}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(paper.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tag selection modal */}
      <AnimatePresence>
        {showTagModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setShowTagModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-notion-border px-6 py-4">
                <h3 className="text-lg font-semibold text-notion-text">All Tags</h3>
                <button
                  onClick={() => setShowTagModal(false)}
                  className="rounded-lg p-1.5 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-6">
                <div className="flex flex-wrap gap-2">
                  {tagList.map(({ name, count, category }) => {
                    const colors =
                      CATEGORY_COLORS[category as TagCategory] || CATEGORY_COLORS.topic;
                    const isSelected = selectedTag === name;
                    return (
                      <button
                        key={name}
                        onClick={() => {
                          setSelectedTag(isSelected ? null : name);
                          setShowTagModal(false);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                          isSelected
                            ? `${colors.selectedBg} text-white`
                            : `${colors.bg} ${colors.text} hover:opacity-80`
                        }`}
                      >
                        {name}
                        <span className={`text-xs ${isSelected ? 'opacity-70' : 'opacity-60'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tag Management Modal */}
      <TagManagementModal
        isOpen={showTagManagement}
        onClose={() => setShowTagManagement(false)}
        onRefresh={fetchPapers}
      />
    </div>
  );
}

function PaperCard({
  paper,
  deleting,
  downloadingPdf,
  retryingPaperId,
  autoTaggingPaperId,
  indexingPaperId,
  analyzingPaperId,
  canAutoTag,
  canIndex,
  onDelete,
  onDownload,
  onRetry,
  onAutoTag,
  onIndex,
  onAnalyze,
  onOpen,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: {
  paper: PaperItem;
  deleting: string | null;
  downloadingPdf: string | null;
  retryingPaperId: string | null;
  autoTaggingPaperId: string | null;
  indexingPaperId: string | null;
  analyzingPaperId: string | null;
  canAutoTag: boolean;
  canIndex: boolean;
  onDelete: (id: string) => void;
  onDownload: (paper: PaperItem) => void;
  onRetry: (id: string) => void;
  onAutoTag: (id: string) => void;
  onIndex: (id: string) => void;
  onAnalyze: (paper: PaperItem) => void;
  onOpen: (shortId: string, state?: unknown) => void;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const visibleTags = (paper.categorizedTags || [])
    .filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()))
    .slice(0, 3);

  const authorsSnippet = paper.authors?.slice(0, 2).join(', ');
  const hasMoreAuthors = paper.authors && paper.authors.length > 2;
  const isNew =
    !!paper.createdAt &&
    !paper.lastReadAt &&
    Date.now() - new Date(paper.createdAt).getTime() < 24 * 60 * 60 * 1000;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete(paper.id);
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className={`group flex flex-col border-b border-notion-border last:border-b-0 transition-colors duration-150 ${
        isSelected ? 'bg-blue-50' : showDeleteConfirm ? 'bg-red-50/40' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-4 px-4 py-3.5">
        {/* Select mode checkbox */}
        <AnimatePresence>
          {isSelectMode && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => onToggleSelect(paper.id)}
              className="flex-shrink-0"
            >
              {isSelected ? (
                <CheckSquare size={18} className="text-blue-600" />
              ) : (
                <Square size={18} className="text-notion-border" />
              )}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Icon */}
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
          <FileText size={16} className="text-blue-500" />
        </div>

        {/* Clickable content area */}
        <button
          onClick={() =>
            isSelectMode ? onToggleSelect(paper.id) : onOpen(paper.shortId, { from: '/papers' })
          }
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-notion-text">
            {cleanArxivTitle(paper.title)}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {paper.submittedAt && (
              <span className="text-xs text-notion-text-tertiary">
                {new Date(paper.submittedAt).getUTCFullYear()}
              </span>
            )}
            {authorsSnippet && (
              <span className="text-xs text-notion-text-tertiary">
                {authorsSnippet}
                {hasMoreAuthors ? ' et al.' : ''}
              </span>
            )}
            <ProcessingBadge status={paper.processingStatus} />
          </div>
          {paper.processingStatus === 'failed' && paper.processingError && (
            <p className="mt-1 line-clamp-2 break-all text-xs text-red-700/90">
              {paper.processingError}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {visibleTags.map((tag) => {
              const colors = CATEGORY_COLORS[tag.category as TagCategory] || CATEGORY_COLORS.topic;
              return (
                <span
                  key={tag.name}
                  className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
                >
                  {tag.name}
                </span>
              );
            })}
            {paper.pdfPath && (
              <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-600">
                PDF
              </span>
            )}
            {paper.indexedAt && (
              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600">
                indexed
              </span>
            )}
          </div>
        </button>

        {/* Action buttons — visible on hover only */}
        {!isSelectMode && (
          <div
            className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {/* Auto-tag button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAutoTag(paper.id);
              }}
              disabled={autoTaggingPaperId === paper.id || !canAutoTag}
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                !canAutoTag
                  ? 'text-notion-text-tertiary opacity-50 cursor-not-allowed'
                  : 'text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text'
              } disabled:opacity-100`}
              title={
                !canAutoTag
                  ? 'Set up lightweight model in Settings'
                  : paper.categorizedTags?.length
                    ? 'Re-tag paper'
                    : 'Auto-tag paper'
              }
            >
              {autoTaggingPaperId === paper.id ? (
                <Loader2 size={14} className="animate-spin text-notion-accent" />
              ) : (
                <Tag size={14} />
              )}
            </button>
            {/* Index button - show if paper is not indexed and has abstract */}
            {!paper.indexedAt && paper.abstract && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onIndex(paper.id);
                }}
                disabled={indexingPaperId === paper.id || !canIndex}
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  !canIndex
                    ? 'text-notion-text-tertiary opacity-50 cursor-not-allowed'
                    : 'text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text'
                } disabled:opacity-100`}
                title={
                  !canIndex
                    ? 'Set up embedding model in Settings'
                    : 'Index paper for semantic search'
                }
              >
                {indexingPaperId === paper.id ? (
                  <Loader2 size={14} className="animate-spin text-notion-accent" />
                ) : (
                  <Database size={14} />
                )}
              </button>
            )}
            {/* Analyze button - show if paper has PDF */}
            {(paper.pdfPath || paper.pdfUrl) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onAnalyze(paper);
                }}
                disabled={analyzingPaperId === paper.id}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-secondary hover:bg-amber-50 hover:text-amber-600 disabled:opacity-100"
                title="Analyze paper"
              >
                {analyzingPaperId === paper.id ? (
                  <Loader2 size={14} className="animate-spin text-amber-600" />
                ) : (
                  <Sparkles size={14} />
                )}
              </button>
            )}
            {paper.processingStatus === 'failed' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(paper.id);
                }}
                disabled={retryingPaperId === paper.id}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-amber-50 hover:text-amber-700 disabled:opacity-100"
                title="Retry processing"
              >
                {retryingPaperId === paper.id ? (
                  <Loader2 size={14} className="animate-spin text-amber-600" />
                ) : (
                  <RotateCcw size={14} />
                )}
              </button>
            )}
            {!paper.pdfPath && paper.pdfUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(paper);
                }}
                disabled={downloadingPdf === paper.id}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-blue-50 hover:text-blue-600 disabled:opacity-100"
                title="Download PDF"
              >
                {downloadingPdf === paper.id ? (
                  <Loader2 size={14} className="animate-spin text-blue-500" />
                ) : (
                  <Download size={14} />
                )}
              </button>
            )}
            <button
              onClick={handleDeleteClick}
              disabled={deleting === paper.id}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              title="Delete paper"
            >
              {deleting === paper.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
            </button>
          </div>
        )}

        {/* New indicator dot */}
        {isNew && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />}
      </div>

      {/* Delete confirmation row */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-end gap-2 bg-red-50/40 px-4 py-2">
              <span className="text-xs text-red-600">Delete this paper?</span>
              <button
                onClick={handleConfirmDelete}
                className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded px-2 py-0.5 text-xs font-medium text-notion-text-secondary hover:bg-notion-sidebar"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
