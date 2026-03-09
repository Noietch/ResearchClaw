import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc, type ScanResult, type ImportStatus, type SearchResultItem } from '../hooks/use-ipc';
import { onIpc } from '../hooks/use-ipc';
import { cleanArxivTitle } from '@shared';
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
  Search,
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

type Tab = 'chrome' | 'local' | 'search';
type Step = 'initial' | 'scanning' | 'preview' | 'importing' | 'done';

interface BatchProgress {
  total: number;
  completed: number;
  success: number;
  failed: number;
  message: string;
}

const DATE_OPTIONS = [
  { label: 'Last 1 day', value: 1 },
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'All time', value: null },
];

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

export function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<Tab>('search');
  const [step, setStep] = useState<Step>('initial');
  const [days, setDays] = useState<number | null>(1);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [localInput, setLocalInput] = useState('');
  const [localPdfFiles, setLocalPdfFiles] = useState<string[]>([]);
  const [localDoneMessage, setLocalDoneMessage] = useState('');
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Search tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSearchIds, setSelectedSearchIds] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState('');

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

  // Subscribe to batch PDF import progress
  useEffect(() => {
    const unsubscribe = onIpc('papers:importLocalPdfs:progress', (...args: unknown[]) => {
      const progress = args[1] as BatchProgress;
      setBatchProgress(progress);
    });
    return unsubscribe;
  }, []);

  // Handle Chrome history scan
  const handleScan = useCallback(async () => {
    setStep('scanning');
    setError('');
    try {
      const result = await ipc.scanChromeHistory(days);
      setScanResult(result);
      // Select all papers by default
      setSelectedIds(new Set(result.papers.map((p) => p.arxivId)));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan Chrome history');
      setStep('initial');
    }
  }, [days]);

  // Handle import from scan result (only selected papers)
  const handleImport = useCallback(async () => {
    if (!scanResult) return;
    const selectedPapers = scanResult.papers.filter((p) => selectedIds.has(p.arxivId));
    if (selectedPapers.length === 0) return;

    setStep('importing');
    setError('');
    try {
      await ipc.importScannedPapers(selectedPapers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import papers');
      setStep('preview');
    }
  }, [scanResult, selectedIds]);

  // Toggle paper selection
  const togglePaper = useCallback((arxivId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(arxivId)) {
        next.delete(arxivId);
      } else {
        next.add(arxivId);
      }
      return next;
    });
  }, []);

  // Toggle all papers
  const toggleAll = useCallback(() => {
    if (!scanResult) return;
    if (selectedIds.size === scanResult.papers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(scanResult.papers.map((p) => p.arxivId)));
    }
  }, [scanResult, selectedIds.size]);

  // Handle cancel import
  const handleCancel = useCallback(async () => {
    await ipc.cancelImport();
  }, []);

  // Search papers
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError('');
    try {
      const result = await ipc.searchPapers(searchQuery, 20);
      setSearchResults(result.results);
      setSelectedSearchIds(new Set());
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // Toggle search result selection
  const toggleSearchResult = useCallback((paperId: string) => {
    setSelectedSearchIds((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  }, []);

  // Toggle all search results
  const toggleAllSearchResults = useCallback(() => {
    if (selectedSearchIds.size === searchResults.length) {
      setSelectedSearchIds(new Set());
    } else {
      setSelectedSearchIds(new Set(searchResults.map((r) => r.paperId)));
    }
  }, [searchResults, selectedSearchIds.size]);

  // Import selected search results
  const handleImportSearchResults = useCallback(async () => {
    const selected = searchResults.filter((r) => selectedSearchIds.has(r.paperId));
    if (selected.length === 0) return;

    setStep('importing');
    let successCount = 0;
    let failedCount = 0;

    for (const result of selected) {
      try {
        const arxivId = result.externalIds.ArXiv;
        const input = arxivId ? `https://arxiv.org/abs/${arxivId}` : result.url || result.title;
        await ipc.downloadPaper(input);
        successCount++;
      } catch (err) {
        console.error('Failed to import:', result.title, err);
        failedCount++;
      }
    }

    setLocalDoneMessage(
      `Imported ${successCount} paper${successCount !== 1 ? 's' : ''}${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
    );
    setStep('done');
    if (successCount > 0) {
      onImported();
    }
  }, [searchResults, selectedSearchIds, onImported]);

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
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const pdfFiles = files
        .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
        .map((f) => f.path)
        .filter(Boolean);

      if (pdfFiles.length === 0 && files.length > 0) {
        setError('Only PDF files are supported. Please drop .pdf files.');
        return;
      }

      addPdfFiles(pdfFiles);
    },
    [addPdfFiles],
  );

  // Handle local PDF / arXiv import
  const handleLocalImport = useCallback(async () => {
    const trimmedInput = localInput.trim();
    const hasPdfFiles = localPdfFiles.length > 0;
    const hasTextInput = trimmedInput.length > 0;

    if (!hasPdfFiles && !hasTextInput) return;

    setStep('importing');
    setError('');
    setBatchProgress(null);

    try {
      // If we have PDF files, use batch import
      if (hasPdfFiles) {
        const result = await ipc.importLocalPdfs(localPdfFiles);
        onImported();
        setLocalDoneMessage(
          `${result.success} PDF${result.success !== 1 ? 's' : ''} imported successfully${result.failed > 0 ? `, ${result.failed} failed` : ''}. Background text extraction and indexing have started.`,
        );
        setStep('done');
        return;
      }

      // Otherwise use text input (arXiv ID/URL)
      if (hasTextInput) {
        await ipc.downloadPaper(trimmedInput);
        onImported();
        setLocalDoneMessage(
          'Paper imported successfully. Background text extraction and indexing have started.',
        );
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import paper');
      setStep('initial');
    }
  }, [localInput, localPdfFiles, onImported]);

  // Check if import button should be enabled
  const canImportLocal = localPdfFiles.length > 0 || localInput.trim().length > 0;

  // Reset state when switching tabs
  const handleTabChange = useCallback((newTab: Tab) => {
    setTab(newTab);
    setStep('initial');
    setScanResult(null);
    setError('');
    setLocalInput('');
    setLocalPdfFiles([]);
    setLocalDoneMessage('');
    setBatchProgress(null);
  }, []);

  // Reset to initial state
  const handleReset = useCallback(() => {
    setStep('initial');
    setScanResult(null);
    setError('');
    setLocalDoneMessage('');
    setBatchProgress(null);
  }, []);

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
                <h2 className="text-base font-semibold text-notion-text">Import Papers</h2>
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
                <button
                  onClick={() => handleTabChange('search')}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    tab === 'search'
                      ? 'border-b-2 border-blue-500 text-notion-text'
                      : 'text-notion-text-secondary hover:text-notion-text'
                  }`}
                >
                  <Search size={16} />
                  Search
                </button>
                <button
                  onClick={() => handleTabChange('chrome')}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    tab === 'chrome'
                      ? 'border-b-2 border-blue-500 text-notion-text'
                      : 'text-notion-text-secondary hover:text-notion-text'
                  }`}
                >
                  <Chrome size={16} />
                  Chrome
                </button>
                <button
                  onClick={() => handleTabChange('local')}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    tab === 'local'
                      ? 'border-b-2 border-blue-500 text-notion-text'
                      : 'text-notion-text-secondary hover:text-notion-text'
                  }`}
                >
                  <FileText size={16} />
                  Local
                </button>
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
                  <AlertCircle size={14} />
                  {error}
                </motion.div>
              )}

              {/* Search Tab */}
              {tab === 'search' && step === 'initial' && (
                <div className="space-y-4">
                  <p className="text-sm text-notion-text-secondary">
                    Search for papers by title, author, or keywords.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          handleSearch();
                        }
                      }}
                      placeholder="e.g., attention is all you need"
                      className="flex-1 rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text placeholder-notion-text-tertiary focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      onClick={handleSearch}
                      disabled={!searchQuery.trim() || isSearching}
                      className="flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                    >
                      {isSearching ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Search size={14} />
                          Search
                        </>
                      )}
                    </button>
                  </div>

                  {searchError && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                      <AlertCircle size={14} />
                      {searchError}
                    </div>
                  )}

                  {searchResults.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-notion-text-secondary">
                          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                        </p>
                        <button
                          onClick={toggleAllSearchResults}
                          className="flex items-center gap-1.5 text-xs text-notion-text-secondary hover:text-notion-text"
                        >
                          {selectedSearchIds.size === searchResults.length ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                          Select all
                        </button>
                      </div>

                      <div className="max-h-96 space-y-2 overflow-y-auto">
                        {searchResults.map((result) => (
                          <div
                            key={result.paperId}
                            onClick={() => toggleSearchResult(result.paperId)}
                            className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                              selectedSearchIds.has(result.paperId)
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-notion-border bg-white hover:border-blue-300 hover:bg-blue-50/50'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <div className="mt-0.5">
                                {selectedSearchIds.has(result.paperId) ? (
                                  <CheckSquare size={16} className="text-blue-600" />
                                ) : (
                                  <Square size={16} className="text-notion-text-tertiary" />
                                )}
                              </div>
                              <div className="flex-1 space-y-1">
                                <h4 className="text-sm font-medium text-notion-text">
                                  {result.title}
                                </h4>
                                <p className="text-xs text-notion-text-secondary">
                                  {result.authors.map((a) => a.name).join(', ')}
                                  {result.year && ` · ${result.year}`}
                                </p>
                                {result.abstract && (
                                  <p className="line-clamp-2 text-xs text-notion-text-tertiary">
                                    {result.abstract}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 text-xs text-notion-text-tertiary">
                                  {result.citationCount > 0 && (
                                    <span>{result.citationCount} citations</span>
                                  )}
                                  {result.externalIds.ArXiv && (
                                    <span className="rounded bg-notion-tag-blue px-1.5 py-0.5">
                                      arXiv:{result.externalIds.ArXiv}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
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
                        Scan your Chrome browsing history for arXiv papers.
                      </p>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-notion-text-secondary">
                          Time range
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {DATE_OPTIONS.map((opt) => (
                            <button
                              key={opt.label}
                              onClick={() => setDays(opt.value)}
                              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                                days === opt.value
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-notion-sidebar text-notion-text-secondary hover:bg-notion-sidebar-hover'
                              }`}
                            >
                              {opt.label}
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
                        Scanning Chrome history...
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
                            Found {scanResult.papers.length} papers
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
                                  Deselect All
                                </>
                              ) : (
                                <>
                                  <Square size={14} />
                                  Select All
                                </>
                              )}
                            </button>
                          </div>

                          <div className="max-h-64 overflow-y-auto rounded-lg border border-notion-border">
                            {scanResult.papers.map((paper) => {
                              const isSelected = selectedIds.has(paper.arxivId);
                              return (
                                <div
                                  key={paper.arxivId}
                                  onClick={() => togglePaper(paper.arxivId)}
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
                                      {cleanArxivTitle(paper.title)}
                                    </p>
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
                              ? 'Import cancelled'
                              : 'Import complete'}
                          </p>
                          <p className="text-xs text-notion-text-secondary">
                            {importStatus.message}
                          </p>
                          {importStatus.phase === 'completed' && importStatus.success > 0 && (
                            <p className="mt-1 text-xs text-blue-600">
                              Imported papers continue processing in the background for metadata and
                              semantic indexing.
                            </p>
                          )}
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
                      {/* Drag & drop zone */}
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                          isDragOver
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-notion-border bg-notion-sidebar hover:border-notion-accent/30'
                        }`}
                      >
                        <Upload
                          size={24}
                          className={`mb-2 ${isDragOver ? 'text-blue-500' : 'text-notion-text-tertiary'}`}
                        />
                        <p className="text-sm text-notion-text-secondary">
                          Drag & drop PDF files here
                        </p>
                        <p className="mt-1 text-xs text-notion-text-tertiary">or</p>
                        <button
                          type="button"
                          onClick={handleSelectLocalPdf}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text hover:bg-notion-sidebar-hover transition-colors"
                        >
                          <FileText size={14} />
                          Choose PDF files
                        </button>
                      </div>

                      {/* Selected files list */}
                      {localPdfFiles.length > 0 && (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-xs font-medium text-notion-text-secondary">
                              {localPdfFiles.length} file{localPdfFiles.length !== 1 ? 's' : ''}{' '}
                              selected
                            </span>
                            <button
                              onClick={() => setLocalPdfFiles([])}
                              className="text-xs text-notion-text-tertiary hover:text-red-500 transition-colors"
                            >
                              Clear all
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

                      {/* Divider */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 border-t border-notion-border" />
                        <span className="text-xs text-notion-text-tertiary">
                          or import by arXiv ID / URL
                        </span>
                        <div className="flex-1 border-t border-notion-border" />
                      </div>

                      {/* arXiv ID / URL input */}
                      <div>
                        <input
                          value={localInput}
                          onChange={(e) => setLocalInput(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === 'Enter' && !e.nativeEvent.isComposing && handleLocalImport()
                          }
                          placeholder="e.g. 2401.12345 or https://arxiv.org/abs/2401.12345"
                          className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          disabled={localPdfFiles.length > 0}
                        />
                        {localPdfFiles.length > 0 && (
                          <p className="mt-1 text-xs text-notion-text-tertiary">
                            Clear PDF files above to use arXiv ID/URL input instead.
                          </p>
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
                            {batchProgress?.message ?? 'Importing...'}
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
                          {batchProgress && batchProgress.total > 1 && (
                            <p className="mt-1 text-xs text-notion-text-tertiary">
                              {batchProgress.completed} / {batchProgress.total} completed
                              {batchProgress.failed > 0 && ` (${batchProgress.failed} failed)`}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 'done' && localDoneMessage && (
                    <div className="rounded-lg bg-green-50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Check size={16} className="text-green-600" />
                        <p className="text-sm font-medium text-green-700">Import complete</p>
                      </div>
                      <p className="mt-1 text-xs text-green-700/80">{localDoneMessage}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2.5 border-t border-notion-border px-5 py-4">
              {step === 'initial' && (
                <>
                  <button
                    onClick={handleClose}
                    className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar"
                  >
                    Cancel
                  </button>
                  {tab === 'search' ? (
                    <button
                      onClick={handleImportSearchResults}
                      disabled={selectedSearchIds.size === 0}
                      className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                    >
                      <Download size={14} />
                      Import {selectedSearchIds.size > 0 ? `${selectedSearchIds.size} ` : ''}
                      {selectedSearchIds.size === 1 ? 'paper' : 'papers'}
                    </button>
                  ) : tab === 'chrome' ? (
                    <button
                      onClick={handleScan}
                      className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
                    >
                      <Clock size={14} />
                      Scan
                    </button>
                  ) : (
                    <button
                      onClick={handleLocalImport}
                      disabled={!canImportLocal}
                      className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                    >
                      <Upload size={14} />
                      {localPdfFiles.length > 1 ? `Import ${localPdfFiles.length} PDFs` : 'Import'}
                    </button>
                  )}
                </>
              )}

              {step === 'preview' && scanResult && (
                <>
                  <button
                    onClick={handleReset}
                    className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar"
                  >
                    Back
                  </button>
                  {selectedIds.size > 0 ? (
                    <button
                      onClick={handleImport}
                      className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
                    >
                      <Download size={14} />
                      Import {selectedIds.size} paper{selectedIds.size !== 1 ? 's' : ''}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="rounded-lg bg-notion-text/50 px-4 py-2 text-sm font-medium text-white"
                    >
                      No papers selected
                    </button>
                  )}
                </>
              )}

              {step === 'importing' && tab === 'chrome' && (
                <button
                  onClick={handleCancel}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Cancel Import
                </button>
              )}

              {step === 'done' && (
                <button
                  onClick={handleClose}
                  className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
                >
                  Done
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
