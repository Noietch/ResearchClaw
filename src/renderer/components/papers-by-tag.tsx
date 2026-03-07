import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ipc,
  type PaperItem,
  type TagInfo,
  type TaggingStatus,
  type ImportStatus,
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TagCategory } from '@shared';
import { CATEGORY_COLORS, CATEGORY_LABELS, TAG_CATEGORIES, cleanArxivTitle } from '@shared';
import { TagManagementModal } from './tag-management-modal';

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

const DOT_COLORS: Record<string, string> = {
  domain: 'bg-blue-400',
  method: 'bg-purple-400',
  topic: 'bg-green-400',
};

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
  const [showTagModal, setShowTagModal] = useState(false);
  const [taggingStatus, setTaggingStatus] = useState<TaggingStatus | null>(null);
  const [showTagManagement, setShowTagManagement] = useState(false);

  // Selection mode state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const navigate = useNavigate();

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
  }, [fetchPapers]);

  useEffect(() => {
    ipc
      .getTaggingStatus()
      .then(setTaggingStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    papers.forEach((p) => {
      if (p.year) years.add(p.year);
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

      if (yearFilter !== null && paper.year !== yearFilter) return false;

      return true;
    });
  }, [papers, searchQuery, selectedTag, importTimeCutoff, yearFilter]);

  const tagList = useMemo(() => {
    const untaggedCount = papers.filter(
      (p) => !p.categorizedTags || p.categorizedTags.length === 0,
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
    return papers.filter((p) => !p.categorizedTags || p.categorizedTags.length === 0).length;
  }, [papers]);

  const handleBatchAutoTag = useCallback(async () => {
    try {
      await ipc.tagUntagged();
    } catch {
      // silent
    }
  }, []);

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
      if (yearFilter !== null && paper.year !== yearFilter) return false;
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-notion-border px-8 py-5">
          <h1 className="text-2xl font-bold tracking-tight text-notion-text">Library</h1>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Upload size={14} />
            Import
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center">
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-notion-border px-8 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-notion-text">Library</h1>
          <span className="rounded-full bg-notion-sidebar px-2.5 py-0.5 text-xs font-medium text-notion-text-secondary">
            {papers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {untaggedCount > 0 && (
            <motion.button
              onClick={handleBatchAutoTag}
              disabled={taggingStatus?.active}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 size={14} className={taggingStatus?.active ? 'animate-pulse' : ''} />
              Auto-tag {untaggedCount}
            </motion.button>
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
      <div className="flex-shrink-0 border-b border-notion-border px-8 py-3">
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
      <div className="flex flex-shrink-0 flex-col gap-2.5 border-b border-notion-border px-8 py-3">
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
        {taggingStatus?.active && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-shrink-0 items-center gap-3 border-b border-purple-200 bg-purple-50 px-8 py-2.5"
          >
            <Loader2 size={14} className="animate-spin text-purple-600" />
            <span className="text-sm text-purple-700">
              Auto-tagging in progress... {taggingStatus.completed}/{taggingStatus.total}
            </span>
            <button
              onClick={() => ipc.cancelTagging()}
              className="ml-auto text-xs font-medium text-purple-600 hover:text-purple-800"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papers count + actions bar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-notion-border px-8 py-2.5">
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
            className="flex flex-shrink-0 items-center justify-between border-b border-blue-200 bg-blue-50 px-8 py-2.5"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-blue-700">{selectedIds.size} selected</span>
              <button
                onClick={selectedIds.size === visiblePapers.length ? deselectAll : selectAll}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                {selectedIds.size === visiblePapers.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exitSelectMode}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedIds.size === 0 || isBatchDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBatchDeleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete
              </button>
            </div>
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

      {/* Papers list */}
      <div className="flex-1 overflow-y-auto">
        {visiblePapers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-16">
            <Tag size={32} strokeWidth={1.2} className="mb-3 text-notion-border" />
            <p className="text-sm text-notion-text-tertiary">No papers match the current filters</p>
          </div>
        ) : (
          <div className="divide-y divide-notion-border">
            {visiblePapers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                deleting={deleting}
                downloadingPdf={downloadingPdf}
                onDelete={handleDelete}
                onDownload={handleDownloadPdf}
                onOpen={(shortId) => navigate(`/papers/${shortId}`)}
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
  onDelete,
  onDownload,
  onOpen,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: {
  paper: PaperItem;
  deleting: string | null;
  downloadingPdf: string | null;
  onDelete: (id: string) => void;
  onDownload: (paper: PaperItem) => void;
  onOpen: (shortId: string) => void;
  isSelectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const visibleTags = (paper.categorizedTags || [])
    .filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()))
    .slice(0, 3);

  const firstTagCategory = visibleTags[0]?.category ?? 'topic';
  const dotColor = DOT_COLORS[firstTagCategory] ?? 'bg-gray-300';

  const authorsSnippet = paper.authors?.slice(0, 2).join(', ');
  const hasMoreAuthors = paper.authors && paper.authors.length > 2;

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
      className={`group flex flex-col border-b border-notion-border transition-colors duration-150 ${
        isSelected ? 'bg-blue-50' : showDeleteConfirm ? 'bg-red-50/40' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-4 px-8 py-3.5">
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

        {/* Accent dot */}
        <div className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />

        {/* Clickable content area */}
        <button
          onClick={() => (isSelectMode ? onToggleSelect(paper.id) : onOpen(paper.shortId))}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-notion-text">
            {cleanArxivTitle(paper.title)}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {paper.year && <span className="text-xs text-notion-text-tertiary">{paper.year}</span>}
            {authorsSnippet && (
              <span className="text-xs text-notion-text-tertiary">
                {authorsSnippet}
                {hasMoreAuthors ? ' et al.' : ''}
              </span>
            )}
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
          </div>
        </button>

        {/* Action buttons — visible on hover only */}
        {!isSelectMode && (
          <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
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
            <div className="flex items-center justify-end gap-2 bg-red-50/40 px-8 py-2">
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
