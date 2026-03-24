import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ipc,
  type ScanResult,
  type ImportStatus,
  type ZoteroScanResult,
  type ZoteroScannedItem,
  type ZoteroImportStatus,
  type SearchResultItem,
  type OverleafProject,
} from '../hooks/use-ipc';
import { onIpc } from '../hooks/use-ipc';
import { cleanArxivTitle, type ParsedPaperEntry } from '@shared';
import { useTranslation } from 'react-i18next';
import {
  Download,
  X,
  Loader2,
  Chrome,
  FileText,
  Check,
  AlertCircle,
  Clock,
  Upload,
  CheckSquare,
  Square,
  Trash2,
  BookOpen,
  FileCode,
  FolderSearch,
  FileUp,
  Search,
  Leaf,
  RefreshCw,
  ChevronDown,
  FolderOpen,
  MessageCircle,
} from 'lucide-react';

// Animation variants
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: {
      duration: 0.15,
    },
  },
};

type Tab = 'chrome' | 'local' | 'zotero' | 'bibtex' | 'search' | 'overleaf';
type Step = 'initial' | 'scanning' | 'preview' | 'importing' | 'done';

interface BatchProgress {
  total: number;
  completed: number;
  success: number;
  duplicates?: number;
  failed: number;
  message: string;
  done?: boolean;
}

const DATE_OPTIONS = [
  { labelKey: 'importModal.last1Day', value: 1 },
  { labelKey: 'importModal.last7Days', value: 7 },
  { labelKey: 'importModal.last30Days', value: 30 },
  { labelKey: 'importModal.allTime', value: null },
];

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('local');
  const [step, setStep] = useState<Step>('initial');
  const [days, setDays] = useState<number | null>(1);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [localInput, setLocalInput] = useState('');
  const [localPdfFiles, setLocalPdfFiles] = useState<string[]>([]);
  const [localDoneMessage, setLocalDoneMessage] = useState('');

  // Browser downloads state
  interface DownloadedPdfItem {
    filePath: string;
    fileName: string;
    browser: string;
    downloadTime: string;
    fileSize: number;
  }
  const [recentDownloads, setRecentDownloads] = useState<DownloadedPdfItem[]>([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadsLoaded, setDownloadsLoaded] = useState(false);
  const [downloadsDropdownOpen, setDownloadsDropdownOpen] = useState(false);
  const downloadsDropdownRef = useRef<HTMLDivElement>(null);
  // WeChat files state
  interface WeChatFileItem {
    filePath: string;
    fileName: string;
    modifiedTime: string;
    fileSize: number;
  }
  const [wechatFiles, setWechatFiles] = useState<WeChatFileItem[]>([]);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [wechatLoaded, setWechatLoaded] = useState(false);
  const [wechatDropdownOpen, setWechatDropdownOpen] = useState(false);

  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedAction, setLastFailedAction] = useState<(() => void) | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Zotero state
  const [zoteroScanResult, setZoteroScanResult] = useState<ZoteroScanResult | null>(null);
  const [zoteroSelectedKeys, setZoteroSelectedKeys] = useState<Set<string>>(new Set());
  const [zoteroStatus, setZoteroStatus] = useState<ZoteroImportStatus | null>(null);
  const [zoteroDbPath, setZoteroDbPath] = useState<string>('');
  const [zoteroDetected, setZoteroDetected] = useState<boolean | null>(null);
  const [zoteroCollectionFilter, setZoteroCollectionFilter] = useState<string>('');
  const [zoteroCollections, setZoteroCollections] = useState<
    Array<{ name: string; itemCount: number }>
  >([]);

  // BibTeX state
  const [bibtexEntries, setBibtexEntries] = useState<ParsedPaperEntry[]>([]);
  const [bibtexSelectedIdx, setBibtexSelectedIdx] = useState<Set<number>>(new Set());
  const [bibtexDoneMessage, setBibtexDoneMessage] = useState('');
  const [bibtexErrorDetail, setBibtexErrorDetail] = useState('');
  const [bibtexErrorExpanded, setBibtexErrorExpanded] = useState(false);

  // Search tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState('');

  // Overleaf tab state
  const [overleafProjects, setOverleafProjects] = useState<OverleafProject[]>([]);
  const [overleafImportedMap, setOverleafImportedMap] = useState<
    Record<string, { paperId: string; importedAt: string }>
  >({});
  const [overleafLoading, setOverleafLoading] = useState(false);
  const [overleafImporting, setOverleafImporting] = useState<string | null>(null);
  const [overleafBatchImporting, setOverleafBatchImporting] = useState(false);
  const [overleafBatchProgress, setOverleafBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [overleafSelected, setOverleafSelected] = useState<Set<string>>(new Set());
  const [overleafSearch, setOverleafSearch] = useState('');
  const [overleafError, setOverleafError] = useState('');

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Trigger entrance animation on mount
  useEffect(() => {
    setIsVisible(true);
  }, []);

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsVisible(false);
  }, []);

  // Call onClose after exit animation completes
  const handleAnimationComplete = useCallback(() => {
    if (!isVisible) {
      onClose();
    }
  }, [isVisible, onClose]);

  // Subscribe to Overleaf batch import progress
  useEffect(() => {
    const unsubscribe = onIpc('overleaf:importProgress', (...args: unknown[]) => {
      const progress = args[1] as { current: number; total: number };
      setOverleafBatchProgress(progress);
    });
    return unsubscribe;
  }, []);

  // Subscribe to import status updates (Chrome history)
  useEffect(() => {
    const unsubscribe = onIpc('ingest:status', (...args: unknown[]) => {
      const status = args[1] as ImportStatus;
      setImportStatus(status);
      if (status.phase === 'completed' || status.phase === 'cancelled') {
        setStep('done');
        if (status.phase === 'completed' && status.success > 0) {
          onImported();
        }
      }
    });
    return unsubscribe;
  }, [onImported]);

  // Subscribe to batch PDF import progress — also handles completion (done: true)
  useEffect(() => {
    const unsubscribe = onIpc('papers:importLocalPdfs:progress', (...args: unknown[]) => {
      const progress = args[1] as BatchProgress;
      setBatchProgress(progress);
      if (progress.done) {
        if (progress.success > 0) onImported();
        const parts: string[] = [];
        if (progress.success > 0)
          parts.push(`${progress.success} new PDF${progress.success !== 1 ? 's' : ''} imported`);
        if (progress.duplicates && progress.duplicates > 0)
          parts.push(`${progress.duplicates} already in your library (skipped)`);
        if (progress.failed > 0) parts.push(`${progress.failed} failed`);
        setLocalDoneMessage(
          parts.join(', ') +
            (progress.success > 0
              ? '. Background text extraction and indexing have started.'
              : '.'),
        );
        setStep('done');
      }
    });
    return unsubscribe;
  }, [onImported]);

  // Subscribe to Zotero import status
  useEffect(() => {
    const unsubscribe = onIpc('zotero:status', (...args: unknown[]) => {
      const status = args[1] as ZoteroImportStatus;
      setZoteroStatus(status);
      if (status.phase === 'completed' || status.phase === 'cancelled') {
        setStep('done');
        if (status.phase === 'completed' && status.success > 0) {
          onImported();
        }
      }
    });
    return unsubscribe;
  }, [onImported]);

  // Auto-detect Zotero when switching to Zotero tab
  useEffect(() => {
    if (tab === 'zotero' && zoteroDetected === null) {
      ipc
        .zoteroDetect()
        .then((result) => {
          setZoteroDetected(result.found);
          if (result.found && result.dbPath) {
            setZoteroDbPath(result.dbPath);
            // Pre-load collections list (lightweight query)
            ipc
              .zoteroCollections(result.dbPath)
              .then(setZoteroCollections)
              .catch(() => setZoteroCollections([]));
          }
        })
        .catch(() => setZoteroDetected(false));
    }
  }, [tab, zoteroDetected]);

  // Handle Chrome history scan with 30s timeout
  const handleScan = useCallback(async () => {
    setStep('scanning');
    setError('');
    setLastFailedAction(null);
    try {
      const timeoutMs = 30_000;
      const result = await Promise.race([
        ipc.scanChromeHistory(days),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('__SCAN_TIMEOUT__')), timeoutMs),
        ),
      ]);
      setScanResult(result);
      // Select only new papers by default (not ones already in library)
      setSelectedIds(new Set(result.papers.filter((p) => !p.existing).map((p) => p.arxivId)));
      setStep('preview');
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === '__SCAN_TIMEOUT__';
      setError(
        isTimeout
          ? t('importModal.chromeScanTimeout')
          : err instanceof Error
            ? err.message
            : 'Failed to scan Chrome history',
      );
      setLastFailedAction(() => handleScan);
      setStep('initial');
    }
  }, [days, t]);

  // Handle import from scan result (only selected papers)
  const handleImport = useCallback(async () => {
    if (!scanResult) return;
    const selectedPapers = scanResult.papers.filter((p) => selectedIds.has(p.arxivId));
    if (selectedPapers.length === 0) return;

    setStep('importing');
    setError('');
    setLastFailedAction(null);
    try {
      await ipc.importScannedPapers(selectedPapers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import papers');
      setLastFailedAction(() => handleImport);
      setStep('preview');
    }
  }, [scanResult, selectedIds]);

  // Toggle paper selection
  const togglePaper = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Toggle all papers
  const toggleAll = useCallback(() => {
    if (!scanResult) return;
    const newPapers = scanResult.papers.filter((p) => !p.existing);
    if (selectedIds.size >= newPapers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(newPapers.map((p) => p.arxivId)));
    }
  }, [scanResult, selectedIds.size]);

  // Handle cancel import
  const handleCancel = useCallback(async () => {
    if (tab === 'zotero') {
      await ipc.zoteroCancel();
    } else {
      await ipc.cancelImport();
    }
  }, [tab]);

  // Add PDF files (deduplicating)
  const addPdfFiles = useCallback((newFiles: string[]) => {
    setLocalPdfFiles((prev) => {
      const existing = new Set(prev);
      const filtered = newFiles.filter((f) => !existing.has(f));
      return [...prev, ...filtered];
    });
  }, []);

  // Remove a single PDF file from list
  const removePdfFile = useCallback((filePath: string) => {
    setLocalPdfFiles((prev) => prev.filter((f) => f !== filePath));
  }, []);

  const handleSelectLocalPdf = useCallback(async () => {
    try {
      const selected = await ipc.selectPdfFile();
      if (selected && selected.length > 0) {
        addPdfFiles(selected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select PDF file');
    }
  }, [addPdfFiles]);

  // Handle drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);

      if (tab === 'bibtex') {
        const bibFiles = files.filter(
          (f) => f.name.toLowerCase().endsWith('.bib') || f.name.toLowerCase().endsWith('.ris'),
        );
        if (bibFiles.length > 0) {
          handleParseBibtexFile((bibFiles[0] as File & { path: string }).path);
        } else {
          setError(t('importModal.bibtex.unsupportedFormat'));
        }
        return;
      }

      // Separate PDFs and folders
      const pdfFiles: string[] = [];
      const folderPaths: string[] = [];

      for (const file of files) {
        // Use webUtils.getPathForFile (Electron 32+) with fallback to legacy file.path
        const filePath =
          window.electronAPI?.getPathForFile?.(file) ||
          (file as File & { path?: string }).path ||
          '';
        if (!filePath) continue;
        if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
          pdfFiles.push(filePath);
        } else if (file.type === '' || !file.type) {
          // Likely a folder (folders have no type)
          folderPaths.push(filePath);
        }
      }

      // Scan folders for PDFs
      if (folderPaths.length > 0) {
        try {
          for (const folder of folderPaths) {
            const pdfs = await ipc.scanFolderForPdfs(folder);
            pdfFiles.push(...pdfs);
          }
        } catch {
          setError(t('importModal.folderScanFailed'));
        }
      }

      if (pdfFiles.length === 0 && files.length > 0 && folderPaths.length === 0) {
        setError(t('importModal.onlyPdfSupported'));
        return;
      }

      if (pdfFiles.length > 0) {
        addPdfFiles(pdfFiles);
      }
    },
    [addPdfFiles, tab, t],
  );

  // Handle search import
  const handleSearchImport = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchLoading(true);
    setError('');
    setLastFailedAction(null);
    setSearchDone('');
    try {
      const result = await ipc.downloadPaper(query);
      if (result.existed) {
        setSearchDone(`"${result.paper.title}" is already in your library`);
      } else {
        setSearchDone(`Imported "${result.paper.title}" successfully`);
        onImported();
      }
      setSearchQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setLastFailedAction(() => handleSearchImport);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, onImported]);

  // Handle local PDF / arXiv / DOI import
  const handleLocalImport = useCallback(async () => {
    const trimmedInput = localInput.trim();
    const hasPdfFiles = localPdfFiles.length > 0;
    const hasTextInput = trimmedInput.length > 0;

    if (!hasPdfFiles && !hasTextInput) return;

    setStep('importing');
    setError('');
    setLastFailedAction(null);
    setBatchProgress(null);

    try {
      if (hasPdfFiles) {
        // Fire-and-forget — import runs in background
        void ipc.importLocalPdfs(localPdfFiles);
        // Close modal immediately so user can use the app; Library refreshes via IPC events
        setLocalDoneMessage(
          `Importing ${localPdfFiles.length} PDF${localPdfFiles.length !== 1 ? 's' : ''} in background…`,
        );
        setStep('done');
        return;
      }

      if (hasTextInput) {
        // downloadPaper now handles arXiv ID, arXiv URL, DOI, and general URLs
        await ipc.downloadPaper(trimmedInput);
        onImported();
        setLocalDoneMessage(t('importModal.importSuccess'));
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import paper');
      setLastFailedAction(() => handleLocalImport);
      setStep('initial');
    }
  }, [localInput, localPdfFiles, onImported, t]);

  // ── Zotero handlers ──────────────────────────────────────────────────

  const handleZoteroScan = useCallback(async () => {
    setStep('scanning');
    setError('');
    setLastFailedAction(null);
    try {
      const result = await ipc.zoteroScan({
        dbPath: zoteroDbPath || undefined,
        collection: zoteroCollectionFilter || undefined,
      });
      setZoteroScanResult(result);
      setZoteroSelectedKeys(new Set(result.items.map((i) => i.zoteroKey)));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('importModal.zotero.scanFailed'));
      setLastFailedAction(() => handleZoteroScan);
      setStep('initial');
    }
  }, [zoteroDbPath, zoteroCollectionFilter, t]);

  const handleZoteroImport = useCallback(async () => {
    if (!zoteroScanResult) return;
    const selected = zoteroScanResult.items.filter((i) => zoteroSelectedKeys.has(i.zoteroKey));
    if (selected.length === 0) return;

    setStep('importing');
    setError('');
    setLastFailedAction(null);
    try {
      await ipc.zoteroImport(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import from Zotero');
      setLastFailedAction(() => handleZoteroImport);
      setStep('preview');
    }
  }, [zoteroScanResult, zoteroSelectedKeys]);

  const toggleZoteroItem = useCallback((key: string) => {
    setZoteroSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Compute filtered Zotero items based on collection filter
  const filteredZoteroItems = zoteroScanResult
    ? zoteroScanResult.items.filter(
        (item) => !zoteroCollectionFilter || item.collections.includes(zoteroCollectionFilter),
      )
    : [];

  const filteredZoteroSelectedCount = filteredZoteroItems.filter((i: ZoteroScannedItem) =>
    zoteroSelectedKeys.has(i.zoteroKey),
  ).length;

  const toggleAllZotero = useCallback(() => {
    if (!filteredZoteroItems.length) return;
    const allFilteredSelected = filteredZoteroItems.every((i: ZoteroScannedItem) =>
      zoteroSelectedKeys.has(i.zoteroKey),
    );
    if (allFilteredSelected) {
      // Deselect only filtered items (keep others selected)
      setZoteroSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const item of filteredZoteroItems) next.delete(item.zoteroKey);
        return next;
      });
    } else {
      // Select all filtered items (keep others as-is)
      setZoteroSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const item of filteredZoteroItems) next.add(item.zoteroKey);
        return next;
      });
    }
  }, [filteredZoteroItems, zoteroSelectedKeys]);

  // ── BibTeX handlers ──────────────────────────────────────────────────

  const handleParseBibtexFile = useCallback(
    async (filePath: string) => {
      setStep('scanning');
      setError('');
      setBibtexErrorDetail('');
      setBibtexErrorExpanded(false);
      setLastFailedAction(null);
      try {
        const isRis = filePath.toLowerCase().endsWith('.ris');
        const entries = isRis ? await ipc.parseRis(filePath) : await ipc.parseBibtex(filePath);
        setBibtexEntries(entries);
        setBibtexSelectedIdx(new Set(entries.map((_, i) => i)));
        setStep('preview');
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        setError(t('importModal.bibtex.parseFailed'));
        setBibtexErrorDetail(rawMessage);
        setLastFailedAction(() => () => handleParseBibtexFile(filePath));
        setStep('initial');
      }
    },
    [t],
  );

  const handleSelectBibtexFile = useCallback(async () => {
    try {
      const selected = await ipc.selectPdfFile(); // reuse file picker
      if (selected && selected.length > 0) {
        await handleParseBibtexFile(selected[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select file');
    }
  }, [handleParseBibtexFile]);

  const handleBibtexImport = useCallback(async () => {
    const selected = bibtexEntries.filter((_, i) => bibtexSelectedIdx.has(i));
    if (selected.length === 0) return;

    setStep('importing');
    setError('');
    setLastFailedAction(null);
    try {
      const result = await ipc.importParsedEntries(selected);
      onImported();
      setBibtexDoneMessage(
        `${result.imported} ${t('importModal.bibtex.papersImported')}${result.skipped > 0 ? `, ${result.skipped} skipped` : ''}`,
      );
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
      setLastFailedAction(() => handleBibtexImport);
      setStep('preview');
    }
  }, [bibtexEntries, bibtexSelectedIdx, onImported, t]);

  const toggleBibtexItem = useCallback((idx: number) => {
    setBibtexSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleAllBibtex = useCallback(() => {
    if (bibtexSelectedIdx.size === bibtexEntries.length) {
      setBibtexSelectedIdx(new Set());
    } else {
      setBibtexSelectedIdx(new Set(bibtexEntries.map((_, i) => i)));
    }
  }, [bibtexEntries, bibtexSelectedIdx.size]);

  // Check if import button should be enabled
  const canImportLocal = localPdfFiles.length > 0 || localInput.trim().length > 0;

  // Reset state when switching tabs
  const loadOverleafProjects = useCallback(async () => {
    setOverleafLoading(true);
    setOverleafError('');
    try {
      const { projects, importedMap } = await ipc.listOverleafProjects();
      setOverleafProjects(projects);
      setOverleafImportedMap(importedMap);
    } catch (err) {
      setOverleafError(err instanceof Error ? err.message : 'Failed to load Overleaf projects');
    } finally {
      setOverleafLoading(false);
    }
  }, []);

  const [overleafSuccess, setOverleafSuccess] = useState('');

  const toggleOverleafSelect = useCallback((projectId: string) => {
    setOverleafSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const handleOverleafImport = useCallback(
    async (projectId: string) => {
      setOverleafImporting(projectId);
      setOverleafError('');
      setOverleafSuccess('');
      try {
        const project = overleafProjects.find((p) => p.id === projectId);
        await ipc.prepareOverleafImport(projectId);
        setOverleafImportedMap((prev) => ({
          ...prev,
          [projectId]: { paperId: projectId, importedAt: new Date().toISOString() },
        }));
        setOverleafSuccess(
          `"${project?.name ?? 'Project'}" imported. Auto-tag & index running in background.`,
        );
        onImported();
        setTimeout(() => setOverleafSuccess(''), 5000);
      } catch (err) {
        setOverleafError(err instanceof Error ? err.message : 'Failed to import project');
      } finally {
        setOverleafImporting(null);
      }
    },
    [onImported, overleafProjects],
  );

  const handleOverleafBatchImport = useCallback(async () => {
    if (overleafSelected.size === 0) return;
    setOverleafBatchImporting(true);
    setOverleafError('');
    setOverleafSuccess('');
    setOverleafBatchProgress({ current: 0, total: overleafSelected.size });

    try {
      const projectIds = Array.from(overleafSelected);
      const results = await ipc.batchOverleafImport(projectIds);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      // Update imported map
      const now = new Date().toISOString();
      setOverleafImportedMap((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.success) next[r.projectId] = { paperId: r.projectId, importedAt: now };
        }
        return next;
      });
      setOverleafSelected(new Set());

      setOverleafSuccess(
        `Imported ${succeeded} project${succeeded !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}. Auto-tag & index running in background.`,
      );
      if (succeeded > 0) onImported();
      setTimeout(() => setOverleafSuccess(''), 5000);
    } catch (err) {
      setOverleafError(err instanceof Error ? err.message : 'Batch import failed');
    } finally {
      setOverleafBatchImporting(false);
      setOverleafBatchProgress(null);
    }
  }, [overleafSelected, onImported]);

  // Close downloads dropdown when clicking outside
  useEffect(() => {
    if (!downloadsDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        downloadsDropdownRef.current &&
        !downloadsDropdownRef.current.contains(e.target as Node)
      ) {
        setDownloadsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [downloadsDropdownOpen]);

  const loadRecentDownloads = useCallback(async () => {
    setDownloadsLoading(true);
    try {
      const downloads = await ipc.scanBrowserDownloads(7);
      setRecentDownloads(downloads);
      setDownloadsLoaded(true);
    } catch {
      // Silent fail
    } finally {
      setDownloadsLoading(false);
    }
  }, []);

  const loadWeChatFiles = useCallback(async () => {
    setWechatLoading(true);
    try {
      const result = await ipc.scanWeChatFiles(30);
      setWechatFiles(result.files);
      setWechatLoaded(true);
    } catch {
      // Silent fail — WeChat may not be installed
    } finally {
      setWechatLoading(false);
    }
  }, []);

  const handleSelectFolder = useCallback(async () => {
    try {
      const pdfs = await ipc.selectFolderForPdfs();
      if (pdfs && pdfs.length > 0) {
        addPdfFiles(pdfs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan folder');
    }
  }, [addPdfFiles]);

  const handleTabChange = useCallback(
    (newTab: Tab) => {
      setTab(newTab);
      setStep('initial');
      setScanResult(null);
      setError('');
      setLocalInput('');
      setLocalPdfFiles([]);
      setLocalDoneMessage('');
      setBatchProgress(null);
      setZoteroScanResult(null);
      setZoteroSelectedKeys(new Set());
      setBibtexEntries([]);
      setBibtexSelectedIdx(new Set());
      setBibtexDoneMessage('');
      setBibtexErrorDetail('');
      setBibtexErrorExpanded(false);
      setSearchQuery('');
      setSearchDone('');
      if (newTab === 'overleaf' && overleafProjects.length === 0) {
        loadOverleafProjects();
      }
      if (newTab === 'local' && !downloadsLoaded) {
        loadRecentDownloads();
      }
      if (newTab === 'local' && !wechatLoaded) {
        loadWeChatFiles();
      }
    },
    [
      overleafProjects.length,
      loadOverleafProjects,
      downloadsLoaded,
      loadRecentDownloads,
      wechatLoaded,
      loadWeChatFiles,
    ],
  );

  // Reset to initial state
  const handleReset = useCallback(() => {
    setStep('initial');
    setScanResult(null);
    setError('');
    setLocalDoneMessage('');
    setBatchProgress(null);
    setZoteroScanResult(null);
    setBibtexEntries([]);
    setBibtexDoneMessage('');
    setBibtexErrorDetail('');
    setBibtexErrorExpanded(false);
  }, []);

  // Load recent downloads and WeChat files on initial mount (default tab is 'local')
  useEffect(() => {
    if (!downloadsLoaded) loadRecentDownloads();
    if (!wechatLoaded) loadWeChatFiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Get the current action button for footer
  const getFooterButtons = () => {
    if (step === 'done') {
      return (
        <button
          onClick={handleClose}
          className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
        >
          {t('importModal.done')}
        </button>
      );
    }

    if (step === 'importing') {
      if (tab === 'chrome' || tab === 'zotero') {
        return (
          <button
            onClick={handleCancel}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {t('importModal.cancelImport')}
          </button>
        );
      }
      return null;
    }

    if (step === 'preview') {
      const count =
        tab === 'chrome'
          ? selectedIds.size
          : tab === 'zotero'
            ? zoteroSelectedKeys.size
            : bibtexSelectedIdx.size;
      const handleImportAction =
        tab === 'chrome'
          ? handleImport
          : tab === 'zotero'
            ? handleZoteroImport
            : handleBibtexImport;

      return (
        <>
          <button
            onClick={handleReset}
            className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar"
          >
            {t('importModal.back')}
          </button>
          {count > 0 ? (
            <button
              onClick={handleImportAction}
              className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
            >
              <Download size={14} />
              {t('importModal.importCount', { count })}
            </button>
          ) : (
            <button
              disabled
              className="rounded-lg bg-notion-text/50 px-4 py-2 text-sm font-medium text-white"
            >
              {t('importModal.noPapersSelected')}
            </button>
          )}
        </>
      );
    }

    // step === 'initial'
    return (
      <>
        <button
          onClick={handleClose}
          className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar"
        >
          {t('importModal.cancel')}
        </button>
        {tab === 'chrome' && (
          <button
            onClick={handleScan}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
          >
            <Clock size={14} />
            {t('importModal.scan')}
          </button>
        )}
        {tab === 'local' && (
          <button
            onClick={handleLocalImport}
            disabled={!canImportLocal}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            <Upload size={14} />
            {localPdfFiles.length > 1
              ? t('importModal.importPdfs', { count: localPdfFiles.length })
              : t('importModal.import')}
          </button>
        )}
        {tab === 'zotero' && (
          <button
            onClick={handleZoteroScan}
            disabled={!zoteroDetected}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            <FolderSearch size={14} />
            {t('importModal.zotero.scanLibrary')}
          </button>
        )}
        {tab === 'bibtex' && (
          <button
            onClick={handleSelectBibtexFile}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
          >
            <FileUp size={14} />
            {t('importModal.bibtex.chooseFile')}
          </button>
        )}
      </>
    );
  };

  return (
    <AnimatePresence onExitComplete={handleAnimationComplete}>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            ref={modalRef}
            className="w-full max-w-lg rounded-2xl border border-notion-border bg-white shadow-xl"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-notion-border px-5 py-4">
              <div className="flex items-center gap-2.5">
                <motion.div
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50"
                  initial={{ rotate: -10 }}
                  animate={{ rotate: 0 }}
                  transition={{ type: 'spring' as const, stiffness: 300, damping: 20 }}
                >
                  <Download size={16} className="text-blue-600" />
                </motion.div>
                <h2 className="text-base font-semibold text-notion-text">
                  {t('importModal.title')}
                </h2>
              </div>
              <motion.button
                onClick={handleClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
              >
                <X size={16} />
              </motion.button>
            </div>

            {/* Tab bar */}
            {step === 'initial' && (
              <div className="flex border-b border-notion-border">
                {(
                  [
                    { key: 'search' as Tab, icon: Search, label: t('importModal.tabs.search') },
                    { key: 'chrome' as Tab, icon: Chrome, label: t('importModal.tabs.chrome') },
                    { key: 'local' as Tab, icon: FileText, label: t('importModal.tabs.local') },
                    { key: 'zotero' as Tab, icon: BookOpen, label: t('importModal.tabs.zotero') },
                    { key: 'bibtex' as Tab, icon: FileCode, label: t('importModal.tabs.bibtex') },
                    { key: 'overleaf' as Tab, icon: Leaf, label: 'Overleaf' },
                  ] as const
                ).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => handleTabChange(key)}
                    className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      tab === key
                        ? 'border-b-2 border-blue-500 text-notion-text'
                        : 'text-notion-text-secondary hover:text-notion-text'
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Content */}
            <div className="p-5">
              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
                >
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span className="flex-1">{error}</span>
                  {lastFailedAction && (
                    <button
                      onClick={() => {
                        setError('');
                        lastFailedAction();
                      }}
                      className="ml-2 flex-shrink-0 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
                    >
                      {t('common.retry')}
                    </button>
                  )}
                </motion.div>
              )}
              {/* BibTeX collapsible error details */}
              {tab === 'bibtex' && bibtexErrorDetail && error && (
                <div className="mb-4 -mt-2">
                  <button
                    onClick={() => setBibtexErrorExpanded((v) => !v)}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${bibtexErrorExpanded ? '' : '-rotate-90'}`}
                    />
                    {t('importModal.bibtex.parseErrorDetails')}
                  </button>
                  {bibtexErrorExpanded && (
                    <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-red-50 p-2 text-xs text-red-600 whitespace-pre-wrap break-words">
                      {bibtexErrorDetail}
                    </pre>
                  )}
                </div>
              )}

              {/* Search Tab */}
              {tab === 'search' && (
                <div className="space-y-4">
                  <p className="text-sm text-notion-text-secondary">
                    {t('importModal.searchDesc')}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter' && searchQuery.trim()) {
                          handleSearchImport();
                        }
                      }}
                      placeholder="e.g. Attention Is All You Need, 2301.12345, 10.1234/..."
                      className="flex-1 rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    />
                    <button
                      onClick={handleSearchImport}
                      disabled={!searchQuery.trim() || searchLoading}
                      className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                    >
                      {searchLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      Import
                    </button>
                  </div>
                  {searchDone && (
                    <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                      <Check size={14} />
                      {searchDone}
                    </div>
                  )}
                </div>
              )}

              {/* Chrome History Tab */}
              {tab === 'chrome' && (
                <>
                  {step === 'initial' && (
                    <div className="space-y-4">
                      <p className="text-sm text-notion-text-secondary">
                        {t('importModal.chromeDesc')}
                      </p>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-notion-text-secondary">
                          {t('importModal.timeRange')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {DATE_OPTIONS.map((opt) => (
                            <button
                              key={opt.labelKey}
                              onClick={() => setDays(opt.value)}
                              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                                days === opt.value
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-notion-sidebar text-notion-text-secondary hover:bg-notion-sidebar-hover'
                              }`}
                            >
                              {t(opt.labelKey as never)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 'scanning' && (
                    <div className="flex flex-col items-center py-8">
                      <Loader2 size={24} className="animate-spin text-blue-500" />
                      <p className="mt-3 text-sm text-notion-text-secondary">
                        {t('importModal.scanning')}
                      </p>
                    </div>
                  )}

                  {step === 'preview' && scanResult && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                          <Check size={16} className="text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-notion-text">
                            {t('importModal.foundPapers', { count: scanResult.papers.length })}
                          </p>
                          <p className="text-xs text-notion-text-secondary">
                            {scanResult.newCount} new, {scanResult.existingCount} already in library
                          </p>
                        </div>
                      </div>

                      {scanResult.papers.length > 0 && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-notion-text-secondary">
                              {selectedIds.size} of {scanResult.papers.length} selected
                            </span>
                            <button
                              onClick={toggleAll}
                              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {selectedIds.size === scanResult.papers.length ? (
                                <>
                                  <CheckSquare size={14} />
                                  {t('importModal.deselectAll')}
                                </>
                              ) : (
                                <>
                                  <Square size={14} />
                                  {t('importModal.selectAll')}
                                </>
                              )}
                            </button>
                          </div>

                          <div className="max-h-64 overflow-y-auto rounded-lg border border-notion-border">
                            {scanResult.papers.map((paper) => {
                              const isSelected = selectedIds.has(paper.arxivId);
                              const isExisting = !!paper.existing;
                              return (
                                <div
                                  key={paper.arxivId}
                                  onClick={() => !isExisting && togglePaper(paper.arxivId)}
                                  className={`flex items-start gap-3 border-b border-notion-border px-3 py-2 last:border-b-0 transition-colors ${
                                    isExisting
                                      ? 'bg-notion-sidebar opacity-60 cursor-default'
                                      : isSelected
                                        ? 'bg-blue-50 cursor-pointer'
                                        : 'hover:bg-notion-sidebar cursor-pointer'
                                  }`}
                                >
                                  <div className="mt-0.5 flex-shrink-0">
                                    {isExisting ? (
                                      <Check size={16} className="text-green-500" />
                                    ) : isSelected ? (
                                      <CheckSquare size={16} className="text-blue-600" />
                                    ) : (
                                      <Square size={16} className="text-notion-text-tertiary" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="line-clamp-2 text-sm text-notion-text">
                                        {cleanArxivTitle(paper.title)}
                                      </p>
                                      {isExisting && (
                                        <span className="flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                          In Library
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-0.5 text-xs text-notion-text-tertiary">
                                      {paper.arxivId}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {step === 'importing' && importStatus && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Loader2 size={20} className="animate-spin text-blue-500" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-notion-text">
                            {importStatus.message}
                          </p>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-notion-sidebar">
                            <motion.div
                              className="h-full rounded-full bg-blue-500"
                              initial={{ width: 0 }}
                              animate={{
                                width: `${
                                  importStatus.total > 0
                                    ? (importStatus.completed / importStatus.total) * 100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 'done' && importStatus && (
                    <div className="space-y-4">
                      <div
                        className={`flex items-center gap-3 rounded-lg px-4 py-3 ${
                          importStatus.phase === 'cancelled' ? 'bg-yellow-50' : 'bg-green-50'
                        }`}
                      >
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full ${
                            importStatus.phase === 'cancelled' ? 'bg-yellow-100' : 'bg-green-100'
                          }`}
                        >
                          {importStatus.phase === 'cancelled' ? (
                            <Clock size={16} className="text-yellow-600" />
                          ) : (
                            <Check size={16} className="text-green-600" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-notion-text">
                            {importStatus.phase === 'cancelled'
                              ? t('importModal.cancelled')
                              : t('importModal.completed')}
                          </p>
                          <p className="text-xs text-notion-text-secondary">
                            {importStatus.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Local PDF Tab */}
              {tab === 'local' && (
                <div className="space-y-4">
                  {step === 'initial' && (
                    <>
                      {/* Recent browser downloads — dropdown */}
                      {(downloadsLoading || recentDownloads.length > 0) && (
                        <div ref={downloadsDropdownRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setDownloadsDropdownOpen((v) => !v)}
                            className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text hover:border-blue-200 transition-colors"
                          >
                            <span className="flex items-center gap-2">
                              <Clock size={14} className="text-notion-text-tertiary" />
                              <span className="font-medium">
                                {t('importModal.recentDownloads', 'Recent PDF downloads')}
                              </span>
                              {recentDownloads.length > 0 && (
                                <span className="rounded-full bg-notion-sidebar px-1.5 py-0.5 text-[10px] text-notion-text-tertiary">
                                  {recentDownloads.length}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-1">
                              {downloadsLoading && (
                                <Loader2
                                  size={12}
                                  className="animate-spin text-notion-text-tertiary"
                                />
                              )}
                              <ChevronDown
                                size={14}
                                className={`text-notion-text-tertiary transition-transform duration-150 ${downloadsDropdownOpen ? 'rotate-180' : ''}`}
                              />
                            </span>
                          </button>
                          <AnimatePresence>
                            {downloadsDropdownOpen &&
                              !downloadsLoading &&
                              recentDownloads.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-notion-border bg-white shadow-lg"
                                >
                                  <div className="flex items-center justify-end border-b border-notion-border px-3 py-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        loadRecentDownloads();
                                      }}
                                      className="flex items-center gap-1 text-[10px] text-notion-text-tertiary hover:text-notion-text"
                                    >
                                      <RefreshCw size={10} />
                                      {t('common.refresh', 'Refresh')}
                                    </button>
                                  </div>
                                  {recentDownloads.map((dl) => (
                                    <div
                                      key={dl.filePath}
                                      className="group flex items-center gap-2 border-b border-notion-border px-3 py-1.5 last:border-b-0 hover:bg-blue-50 cursor-pointer"
                                      onClick={() => {
                                        setLocalPdfFiles((prev) =>
                                          prev.includes(dl.filePath)
                                            ? prev
                                            : [...prev, dl.filePath],
                                        );
                                        setDownloadsDropdownOpen(false);
                                      }}
                                    >
                                      <FileText size={14} className="flex-shrink-0 text-red-400" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm text-notion-text">
                                          {dl.fileName}
                                        </p>
                                        <p className="text-[10px] text-notion-text-tertiary">
                                          {dl.browser} · {formatRelativeTime(dl.downloadTime)}
                                          {dl.fileSize > 0 &&
                                            ` · ${(dl.fileSize / 1024 / 1024).toFixed(1)} MB`}
                                        </p>
                                      </div>
                                      {localPdfFiles.includes(dl.filePath) ? (
                                        <Check size={14} className="flex-shrink-0 text-green-500" />
                                      ) : (
                                        <Download
                                          size={14}
                                          className="flex-shrink-0 text-notion-text-tertiary opacity-0 group-hover:opacity-100"
                                        />
                                      )}
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                          </AnimatePresence>
                        </div>
                      )}

                      {/* WeChat recent files — dropdown */}
                      {(wechatLoading || wechatFiles.length > 0) && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setWechatDropdownOpen((v) => !v)}
                            className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text hover:border-notion-accent/30 transition-colors"
                          >
                            <span className="flex items-center gap-2">
                              <MessageCircle size={14} className="text-green-500" />
                              <span className="font-medium">{t('importModal.wechatFiles')}</span>
                              {wechatFiles.length > 0 && (
                                <span className="rounded-full bg-notion-sidebar px-1.5 py-0.5 text-[10px] text-notion-text-tertiary">
                                  {wechatFiles.length}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-1">
                              {wechatLoading && (
                                <Loader2
                                  size={12}
                                  className="animate-spin text-notion-text-tertiary"
                                />
                              )}
                              <ChevronDown
                                size={14}
                                className={`text-notion-text-tertiary transition-transform duration-150 ${wechatDropdownOpen ? 'rotate-180' : ''}`}
                              />
                            </span>
                          </button>
                          <AnimatePresence>
                            {wechatDropdownOpen && !wechatLoading && wechatFiles.length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                                className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-notion-border bg-white shadow-lg"
                              >
                                <div className="flex items-center justify-end border-b border-notion-border px-3 py-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setWechatLoaded(false);
                                      loadWeChatFiles();
                                    }}
                                    className="flex items-center gap-1 text-[10px] text-notion-text-tertiary hover:text-notion-text"
                                  >
                                    <RefreshCw size={10} />
                                    {t('common.refresh', 'Refresh')}
                                  </button>
                                </div>
                                {wechatFiles.map((wf) => (
                                  <div
                                    key={wf.filePath}
                                    className="group flex items-center gap-2 border-b border-notion-border px-3 py-1.5 last:border-b-0 hover:bg-notion-accent-light cursor-pointer"
                                    onClick={() => {
                                      setLocalPdfFiles((prev) =>
                                        prev.includes(wf.filePath) ? prev : [...prev, wf.filePath],
                                      );
                                    }}
                                  >
                                    <FileText size={14} className="flex-shrink-0 text-red-400" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm text-notion-text">
                                        {wf.fileName}
                                      </p>
                                      <p className="text-[10px] text-notion-text-tertiary">
                                        {formatRelativeTime(wf.modifiedTime)}
                                        {wf.fileSize > 0 &&
                                          ` · ${(wf.fileSize / 1024 / 1024).toFixed(1)} MB`}
                                      </p>
                                    </div>
                                    {localPdfFiles.includes(wf.filePath) ? (
                                      <Check size={14} className="flex-shrink-0 text-green-500" />
                                    ) : (
                                      <Download
                                        size={14}
                                        className="flex-shrink-0 text-notion-text-tertiary opacity-0 group-hover:opacity-100"
                                      />
                                    )}
                                  </div>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      {/* Drag & drop zone */}
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                          isDragOver
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-notion-border bg-notion-sidebar hover:border-blue-200'
                        }`}
                      >
                        <Upload
                          size={24}
                          className={`mb-2 ${isDragOver ? 'text-blue-500' : 'text-notion-text-tertiary'}`}
                        />
                        <p className="text-sm text-notion-text-secondary">
                          {t('importModal.dragDropPdfOrFolder')}
                        </p>
                        <p className="mt-1 text-xs text-notion-text-tertiary">
                          {t('importModal.or')}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleSelectLocalPdf}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text hover:bg-notion-sidebar-hover transition-colors"
                          >
                            <FileText size={14} />
                            {t('importModal.choosePdf')}
                          </button>
                          <button
                            type="button"
                            onClick={handleSelectFolder}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text hover:bg-notion-sidebar-hover transition-colors"
                          >
                            <FolderOpen size={14} />
                            {t('importModal.chooseFolder')}
                          </button>
                        </div>
                      </div>

                      {localPdfFiles.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-xs font-medium text-notion-text-secondary">
                              {localPdfFiles.length} file
                              {localPdfFiles.length !== 1 ? 's' : ''} selected
                            </span>
                            <button
                              onClick={() => setLocalPdfFiles([])}
                              className="text-xs text-notion-text-tertiary hover:text-red-500 transition-colors"
                            >
                              {t('importModal.clearAll')}
                            </button>
                          </div>
                          <div className="max-h-40 overflow-y-auto rounded-lg border border-notion-border">
                            {localPdfFiles.map((filePath) => (
                              <div
                                key={filePath}
                                className="group flex items-center gap-2 border-b border-notion-border px-3 py-1.5 last:border-b-0"
                              >
                                <FileText
                                  size={14}
                                  className="flex-shrink-0 text-notion-text-tertiary"
                                />
                                <span className="min-w-0 flex-1 truncate text-sm text-notion-text">
                                  {getFileName(filePath)}
                                </span>
                                <button
                                  onClick={() => removePdfFile(filePath)}
                                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2
                                    size={14}
                                    className="text-notion-text-tertiary hover:text-red-500"
                                  />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <div className="flex-1 border-t border-notion-border" />
                        <span className="text-xs text-notion-text-tertiary">
                          {t('importModal.orImportByIdUrl')}
                        </span>
                        <div className="flex-1 border-t border-notion-border" />
                      </div>

                      <div>
                        <input
                          value={localInput}
                          onChange={(e) => setLocalInput(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === 'Enter' && !e.nativeEvent.isComposing && handleLocalImport()
                          }
                          placeholder={t('importModal.inputPlaceholder')}
                          className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          disabled={localPdfFiles.length > 0}
                        />
                        {localPdfFiles.length > 0 ? (
                          <p className="mt-1 text-xs text-notion-text-tertiary">
                            {t('importModal.clearPdfFirst')}
                          </p>
                        ) : (
                          localInput.trim() && (
                            <p className="mt-1 text-xs text-notion-text-tertiary">
                              {/^\d{4}\.\d{4,5}/.test(localInput.trim())
                                ? '📄 arXiv ID'
                                : /^10\.\d{4,}\//.test(localInput.trim())
                                  ? '🔗 DOI'
                                  : localInput.trim().startsWith('http')
                                    ? '🌐 URL'
                                    : '📄 arXiv ID'}
                            </p>
                          )
                        )}
                      </div>
                    </>
                  )}

                  {step === 'importing' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <Loader2 size={20} className="animate-spin text-blue-500" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-notion-text">
                            {batchProgress?.message ?? t('importModal.importing')}
                          </p>
                          {batchProgress && batchProgress.total > 1 && (
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-notion-sidebar">
                              <motion.div
                                className="h-full rounded-full bg-blue-500"
                                initial={{ width: 0 }}
                                animate={{
                                  width: `${batchProgress.total > 0 ? (batchProgress.completed / batchProgress.total) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 'done' && localDoneMessage && (
                    <div className="rounded-lg bg-green-50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Check size={16} className="text-green-600" />
                        <p className="text-sm font-medium text-green-700">
                          {t('importModal.completed')}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-green-700/80">{localDoneMessage}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Zotero Tab */}
              {tab === 'zotero' && (
                <div className="space-y-4">
                  {step === 'initial' && (
                    <>
                      {zoteroDetected === null && (
                        <div className="flex flex-col items-center py-6">
                          <Loader2 size={20} className="animate-spin text-blue-500" />
                          <p className="mt-2 text-sm text-notion-text-secondary">
                            {t('importModal.zotero.detecting')}
                          </p>
                        </div>
                      )}

                      {zoteroDetected === false && (
                        <div className="space-y-3">
                          <div className="rounded-lg bg-yellow-50 px-3 py-2">
                            <div className="flex items-center gap-2 text-sm text-yellow-700">
                              <AlertCircle size={14} className="flex-shrink-0" />
                              {t('importModal.zotero.notFound')}
                            </div>
                            <p className="mt-1 ml-5 text-xs text-yellow-600">
                              {t('importModal.zotero.notFoundHint')}
                            </p>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-notion-text-secondary">
                              {t('importModal.zotero.customPath')}
                            </label>
                            <input
                              value={zoteroDbPath}
                              onChange={(e) => setZoteroDbPath(e.target.value)}
                              placeholder="~/Zotero/zotero.sqlite"
                              className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2 text-sm text-notion-text placeholder-notion-text-tertiary outline-none focus:border-blue-400"
                            />
                          </div>
                        </div>
                      )}

                      {zoteroDetected === true && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                            <Check size={14} />
                            {t('importModal.zotero.detected')}
                          </div>
                          <p className="text-xs text-notion-text-tertiary truncate">
                            {zoteroDbPath}
                          </p>

                          {/* Collection selector before scan */}
                          {zoteroCollections.length > 0 && (
                            <div>
                              <label className="mb-1 block text-xs font-medium text-notion-text-secondary">
                                {t('importModal.zotero.selectCollection')}
                              </label>
                              <select
                                value={zoteroCollectionFilter}
                                onChange={(e) => setZoteroCollectionFilter(e.target.value)}
                                className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-1.5 text-sm text-notion-text outline-none"
                              >
                                <option value="">{t('importModal.zotero.allCollections')}</option>
                                {zoteroCollections.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name} ({c.itemCount})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <p className="text-sm text-notion-text-secondary">
                            {t('importModal.zotero.scanDesc')}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {step === 'scanning' && (
                    <div className="flex flex-col items-center py-8">
                      <Loader2 size={24} className="animate-spin text-blue-500" />
                      <p className="mt-3 text-sm text-notion-text-secondary">
                        {t('importModal.zotero.scanning')}
                      </p>
                    </div>
                  )}

                  {step === 'preview' && zoteroScanResult && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                          <Check size={16} className="text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-notion-text">
                            {t('importModal.foundPapers', {
                              count: zoteroScanResult.items.length,
                            })}
                          </p>
                          <p className="text-xs text-notion-text-secondary">
                            {zoteroScanResult.newCount} new, {zoteroScanResult.existingCount}{' '}
                            already in library
                          </p>
                        </div>
                      </div>

                      {/* Collection filter */}
                      {zoteroScanResult.collections.length > 0 && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-notion-text-secondary">
                            {t('importModal.zotero.filterByCollection')}
                          </label>
                          <select
                            value={zoteroCollectionFilter}
                            onChange={(e) => setZoteroCollectionFilter(e.target.value)}
                            className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-1.5 text-sm text-notion-text outline-none"
                          >
                            <option value="">{t('importModal.zotero.allCollections')}</option>
                            {zoteroScanResult.collections.map((c: string) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {filteredZoteroItems.length > 0 && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-notion-text-secondary">
                              {filteredZoteroSelectedCount} of {filteredZoteroItems.length} selected
                              {zoteroCollectionFilter && (
                                <span className="ml-1 text-notion-text-tertiary">(filtered)</span>
                              )}
                            </span>
                            <button
                              onClick={toggleAllZotero}
                              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {filteredZoteroSelectedCount === filteredZoteroItems.length ? (
                                <>
                                  <CheckSquare size={14} />
                                  {t('importModal.deselectAll')}
                                </>
                              ) : (
                                <>
                                  <Square size={14} />
                                  {t('importModal.selectAll')}
                                </>
                              )}
                            </button>
                          </div>

                          <div className="max-h-64 overflow-y-auto rounded-lg border border-notion-border">
                            {filteredZoteroItems.map((item: ZoteroScannedItem) => {
                              const isSelected = zoteroSelectedKeys.has(item.zoteroKey);
                              return (
                                <div
                                  key={item.zoteroKey}
                                  onClick={() => toggleZoteroItem(item.zoteroKey)}
                                  className={`flex cursor-pointer items-start gap-3 border-b border-notion-border px-3 py-2 last:border-b-0 transition-colors ${
                                    isSelected ? 'bg-blue-50' : 'hover:bg-notion-sidebar'
                                  }`}
                                >
                                  <div className="mt-0.5 flex-shrink-0">
                                    {isSelected ? (
                                      <CheckSquare size={16} className="text-blue-600" />
                                    ) : (
                                      <Square size={16} className="text-notion-text-tertiary" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="line-clamp-2 text-sm text-notion-text">
                                      {item.title}
                                    </p>
                                    <div className="mt-0.5 flex items-center gap-2 text-xs text-notion-text-tertiary">
                                      {item.year && <span>{item.year}</span>}
                                      {item.authors.length > 0 && (
                                        <span className="truncate">
                                          {item.authors.slice(0, 2).join(', ')}
                                          {item.authors.length > 2 && ' et al.'}
                                        </span>
                                      )}
                                      {item.doi && (
                                        <span className="rounded bg-blue-50 px-1 text-blue-600">
                                          DOI
                                        </span>
                                      )}
                                      {item.pdfPath && (
                                        <span className="rounded bg-green-50 px-1 text-green-600">
                                          PDF
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {step === 'importing' && zoteroStatus && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Loader2 size={20} className="animate-spin text-blue-500" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-notion-text">
                            {zoteroStatus.message}
                          </p>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-notion-sidebar">
                            <motion.div
                              className="h-full rounded-full bg-blue-500"
                              initial={{ width: 0 }}
                              animate={{
                                width: `${
                                  zoteroStatus.total > 0
                                    ? (zoteroStatus.completed / zoteroStatus.total) * 100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 'done' && zoteroStatus && (
                    <div className="rounded-lg bg-green-50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Check size={16} className="text-green-600" />
                        <p className="text-sm font-medium text-green-700">
                          {t('importModal.completed')}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-green-700/80">{zoteroStatus.message}</p>
                    </div>
                  )}
                </div>
              )}

              {/* BibTeX Tab */}
              {tab === 'bibtex' && (
                <div className="space-y-4">
                  {step === 'initial' && (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
                        isDragOver
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-notion-border bg-notion-sidebar hover:border-blue-200'
                      }`}
                    >
                      <FileCode
                        size={24}
                        className={`mb-2 ${isDragOver ? 'text-blue-500' : 'text-notion-text-tertiary'}`}
                      />
                      <p className="text-sm text-notion-text-secondary">
                        {t('importModal.bibtex.dragDrop')}
                      </p>
                      <p className="mt-1 text-xs text-notion-text-tertiary">
                        {t('importModal.bibtex.supportedFormats')}
                      </p>
                    </div>
                  )}

                  {step === 'scanning' && (
                    <div className="flex flex-col items-center py-8">
                      <Loader2 size={24} className="animate-spin text-blue-500" />
                      <p className="mt-3 text-sm text-notion-text-secondary">
                        {t('importModal.bibtex.parsing')}
                      </p>
                    </div>
                  )}

                  {step === 'preview' && bibtexEntries.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                          <Check size={16} className="text-blue-600" />
                        </div>
                        <p className="text-sm font-medium text-notion-text">
                          {t('importModal.bibtex.foundEntries', {
                            count: bibtexEntries.length,
                          })}
                        </p>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-notion-text-secondary">
                          {bibtexSelectedIdx.size} of {bibtexEntries.length} selected
                        </span>
                        <button
                          onClick={toggleAllBibtex}
                          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          {bibtexSelectedIdx.size === bibtexEntries.length ? (
                            <>
                              <CheckSquare size={14} />
                              {t('importModal.deselectAll')}
                            </>
                          ) : (
                            <>
                              <Square size={14} />
                              {t('importModal.selectAll')}
                            </>
                          )}
                        </button>
                      </div>

                      <div className="max-h-64 overflow-y-auto rounded-lg border border-notion-border">
                        {bibtexEntries.map((entry, idx) => {
                          const isSelected = bibtexSelectedIdx.has(idx);
                          return (
                            <div
                              key={idx}
                              onClick={() => toggleBibtexItem(idx)}
                              className={`flex cursor-pointer items-start gap-3 border-b border-notion-border px-3 py-2 last:border-b-0 transition-colors ${
                                isSelected ? 'bg-blue-50' : 'hover:bg-notion-sidebar'
                              }`}
                            >
                              <div className="mt-0.5 flex-shrink-0">
                                {isSelected ? (
                                  <CheckSquare size={16} className="text-blue-600" />
                                ) : (
                                  <Square size={16} className="text-notion-text-tertiary" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-sm text-notion-text">
                                  {entry.title}
                                </p>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-notion-text-tertiary">
                                  {entry.year && <span>{entry.year}</span>}
                                  {entry.authors.length > 0 && (
                                    <span className="truncate">
                                      {entry.authors.slice(0, 2).join(', ')}
                                      {entry.authors.length > 2 && ' et al.'}
                                    </span>
                                  )}
                                  {entry.doi && (
                                    <span className="rounded bg-blue-50 px-1 text-blue-600">
                                      DOI
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {step === 'importing' && (
                    <div className="flex items-center gap-3 py-4">
                      <Loader2 size={20} className="animate-spin text-blue-500" />
                      <p className="text-sm font-medium text-notion-text">
                        {t('importModal.importing')}
                      </p>
                    </div>
                  )}

                  {step === 'done' && bibtexDoneMessage && (
                    <div className="rounded-lg bg-green-50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Check size={16} className="text-green-600" />
                        <p className="text-sm font-medium text-green-700">
                          {t('importModal.completed')}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-green-700/80">{bibtexDoneMessage}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Overleaf Tab */}
              {tab === 'overleaf' && (
                <div className="space-y-4">
                  {overleafSuccess && (
                    <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                      <Check size={14} />
                      {overleafSuccess}
                    </div>
                  )}
                  {overleafError && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                      <AlertCircle size={14} className="flex-shrink-0" />
                      <span className="flex-1">{overleafError}</span>
                      <button
                        onClick={() => {
                          setOverleafError('');
                          void loadOverleafProjects();
                        }}
                        className="ml-2 flex-shrink-0 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
                      >
                        {t('common.retry')}
                      </button>
                    </div>
                  )}

                  {overleafLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
                      <span className="ml-2 text-sm text-notion-text-secondary">
                        Loading Overleaf projects...
                      </span>
                    </div>
                  ) : (
                    <>
                      {overleafProjects.length === 0 && !overleafError ? (
                        <div className="py-8 text-center text-sm text-notion-text-tertiary">
                          No projects found. Please configure your Overleaf cookie in Settings
                          first.
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                value={overleafSearch}
                                onChange={(e) => setOverleafSearch(e.target.value)}
                                placeholder="Filter projects..."
                                className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 pr-10 text-sm text-notion-text placeholder-notion-text-tertiary focus:border-blue-500 focus:outline-none"
                              />
                              <Search
                                size={16}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
                              />
                            </div>
                            <button
                              onClick={loadOverleafProjects}
                              disabled={overleafLoading}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-notion-border text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text"
                              title="Refresh"
                            >
                              <RefreshCw size={14} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-notion-text-tertiary">
                              {overleafProjects.length} projects
                              {overleafSelected.size > 0 && (
                                <span className="ml-1 text-blue-600">
                                  · {overleafSelected.size} selected
                                </span>
                              )}
                            </p>
                            {overleafSelected.size > 0 && (
                              <button
                                onClick={handleOverleafBatchImport}
                                disabled={overleafBatchImporting || overleafImporting !== null}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:opacity-80 disabled:opacity-50"
                              >
                                {overleafBatchImporting ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Download size={12} />
                                )}
                                {overleafBatchImporting
                                  ? `Importing ${overleafBatchProgress?.current ?? 0}/${overleafBatchProgress?.total ?? 0}...`
                                  : `Import ${overleafSelected.size}`}
                              </button>
                            )}
                          </div>
                          <div className="max-h-96 space-y-1.5 overflow-y-auto">
                            {overleafProjects
                              .filter(
                                (p) =>
                                  !overleafSearch ||
                                  p.name.toLowerCase().includes(overleafSearch.toLowerCase()),
                              )
                              .map((project) => {
                                const imported = overleafImportedMap[project.id];
                                const remoteTime = project.lastUpdated
                                  ? new Date(project.lastUpdated).getTime()
                                  : 0;
                                const importedTime = imported
                                  ? new Date(imported.importedAt).getTime()
                                  : 0;
                                const hasRemoteUpdate =
                                  imported &&
                                  remoteTime > 0 &&
                                  importedTime > 0 &&
                                  remoteTime > importedTime;
                                const isSelected = overleafSelected.has(project.id);
                                return (
                                  <div
                                    key={project.id}
                                    onClick={() => toggleOverleafSelect(project.id)}
                                    className={`group flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'border-blue-400 bg-blue-50'
                                        : hasRemoteUpdate
                                          ? 'border-orange-200 bg-orange-50/30 hover:bg-orange-50/60'
                                          : imported
                                            ? 'border-green-200 bg-green-50/30 hover:bg-green-50/60'
                                            : 'border-notion-border bg-white hover:bg-blue-50 hover:border-blue-200'
                                    }`}
                                  >
                                    <div className="flex-shrink-0">
                                      {isSelected ? (
                                        <CheckSquare size={16} className="text-blue-600" />
                                      ) : (
                                        <Square size={16} className="text-notion-text-tertiary" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <h4 className="truncate text-sm font-medium text-notion-text">
                                          {project.name}
                                        </h4>
                                        {imported && !hasRemoteUpdate && (
                                          <span className="flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                            Imported
                                          </span>
                                        )}
                                        {hasRemoteUpdate && (
                                          <span className="flex-shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                                            Has Updates
                                          </span>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-xs text-notion-text-tertiary">
                                        {project.lastUpdated
                                          ? formatRelativeTime(project.lastUpdated)
                                          : ''}
                                        {project.accessLevel && (
                                          <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5">
                                            {project.accessLevel}
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                    {hasRemoteUpdate ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOverleafImport(project.id);
                                        }}
                                        disabled={
                                          overleafImporting !== null || overleafBatchImporting
                                        }
                                        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-50"
                                      >
                                        {overleafImporting === project.id ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <RefreshCw size={12} />
                                        )}
                                        {overleafImporting === project.id
                                          ? 'Updating...'
                                          : 'Update'}
                                      </button>
                                    ) : imported ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOverleafImport(project.id);
                                        }}
                                        disabled={
                                          overleafImporting !== null || overleafBatchImporting
                                        }
                                        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-xs font-medium text-notion-text-secondary hover:bg-notion-sidebar-hover disabled:opacity-50"
                                      >
                                        {overleafImporting === project.id ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <RefreshCw size={12} />
                                        )}
                                        {overleafImporting === project.id
                                          ? 'Importing...'
                                          : 'Re-import'}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOverleafImport(project.id);
                                        }}
                                        disabled={
                                          overleafImporting !== null || overleafBatchImporting
                                        }
                                        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-50"
                                      >
                                        {overleafImporting === project.id ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <Download size={12} />
                                        )}
                                        {overleafImporting === project.id
                                          ? 'Compiling...'
                                          : 'Import'}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2.5 border-t border-notion-border px-5 py-4">
              {getFooterButtons()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
