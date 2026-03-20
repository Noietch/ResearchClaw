import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  X,
  Download,
  Loader2,
  FileText,
  Calendar,
  Users,
  ExternalLink,
  AlertCircle,
  Check,
} from 'lucide-react';
import type { SearchResult } from '../../main/services/paper-search.service';
import { ipc } from '../hooks/use-ipc';

interface RecentDownload {
  filePath: string;
  fileName: string;
  browser: string;
  downloadTime: string;
  fileSize: number;
}

function formatTimeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

function NoPdfBanner({
  url,
  onOpenWebsite,
}: {
  url: string;
  onOpenWebsite?: (url: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [downloads, setDownloads] = useState<RecentDownload[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDl, setSelectedDl] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const [showDownloads, setShowDownloads] = useState(false);

  const handleOpen = () => {
    onOpenWebsite?.(url);
    setOpened(true);
  };

  const handleShowDownloads = () => {
    setShowDownloads(true);
    loadDownloads();
  };

  const loadDownloads = async () => {
    setLoading(true);
    try {
      const result = await ipc.scanBrowserDownloads(7);
      setDownloads(result);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedDl) return;
    setImporting(true);
    setImportResult(null);
    try {
      const paper = await ipc.importLocalPdf(selectedDl, true);
      setImportResult(
        `Imported "${paper.title}" to Reading List. You can add it to Library later.`,
      );
    } catch (err) {
      setImportResult(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mb-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <AlertCircle size={14} className="text-yellow-600 flex-shrink-0" />
        <p className="text-xs text-yellow-700 flex-1">{t('pdf.citation.noPdf')}</p>
      </div>

      {opened
        ? !showDownloads && (
            <div className="flex items-center gap-2">
              {onOpenWebsite && (
                <button
                  onClick={handleOpen}
                  className="inline-flex items-center gap-1 rounded-md bg-white border border-yellow-300 px-2 py-1 text-[11px] font-medium text-yellow-800 hover:bg-yellow-100"
                >
                  <ExternalLink size={11} />
                  {t('pdf.citation.openWebsite')}
                </button>
              )}
              <button
                onClick={handleShowDownloads}
                className="inline-flex items-center gap-1 rounded-md bg-notion-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-80"
              >
                <Download size={11} />
                Import from downloads
              </button>
            </div>
          )
        : onOpenWebsite && (
            <button
              onClick={handleOpen}
              className="inline-flex items-center gap-1 rounded-md bg-white border border-yellow-300 px-2 py-1 text-[11px] font-medium text-yellow-800 hover:bg-yellow-100"
            >
              <ExternalLink size={11} />
              {t('pdf.citation.openWebsite')}
            </button>
          )}

      {showDownloads && (
        <>
          {loading ? (
            <div className="flex items-center gap-1.5 text-[10px] text-notion-text-tertiary">
              <Loader2 size={10} className="animate-spin" />
              Scanning downloads...
            </div>
          ) : downloads.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-yellow-600">Select a PDF:</p>
                <button onClick={loadDownloads} className="text-[10px] text-yellow-600 underline">
                  Refresh
                </button>
              </div>
              <div className="max-h-24 overflow-y-auto rounded border border-yellow-200 bg-white">
                {downloads.map((dl) => (
                  <div
                    key={dl.filePath}
                    onClick={() => setSelectedDl(dl.filePath)}
                    className={`flex items-center gap-2 border-b border-yellow-100 px-2 py-1 last:border-b-0 cursor-pointer ${
                      selectedDl === dl.filePath
                        ? 'bg-blue-50 border-blue-200'
                        : 'hover:bg-yellow-50'
                    }`}
                  >
                    <FileText size={11} className="flex-shrink-0 text-red-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-notion-text">{dl.fileName}</p>
                      <p className="text-[9px] text-notion-text-tertiary">
                        {dl.browser} · {formatTimeAgo(dl.downloadTime)}
                        {dl.fileSize > 0 && ` · ${(dl.fileSize / 1024 / 1024).toFixed(1)}MB`}
                      </p>
                    </div>
                    {selectedDl === dl.filePath && (
                      <Check size={11} className="flex-shrink-0 text-notion-accent" />
                    )}
                  </div>
                ))}
              </div>
              {selectedDl && !importResult && (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-notion-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-80 disabled:opacity-50"
                >
                  {importing ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Download size={11} />
                  )}
                  {importing ? 'Importing...' : 'Import selected PDF'}
                </button>
              )}
              {importResult && (
                <div className="flex items-center gap-1.5 rounded-md bg-green-50 border border-green-200 px-2 py-1.5">
                  <Check size={11} className="flex-shrink-0 text-green-600" />
                  <p className="text-[10px] text-green-700">{importResult}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-[10px] text-yellow-600">
              No recent PDF downloads found.{' '}
              <button onClick={loadDownloads} className="underline font-medium">
                Refresh
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface PaperPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (result: SearchResult) => void;
  onOpenWebsite?: (url: string) => void;
  isDownloading: boolean;
  /** Set to a DOI/URL when download succeeded but no PDF was available */
  noPdfUrl?: string | null;
  results: SearchResult[];
  isLoading: boolean;
  query: string;
}

export function PaperPreviewModal({
  isOpen,
  onClose,
  onDownload,
  onOpenWebsite,
  isDownloading,
  noPdfUrl,
  results,
  isLoading,
  query,
}: PaperPreviewModalProps) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen || results.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !isDownloading) {
        e.preventDefault();
        onDownload(results[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, isDownloading, onDownload]);

  const selectedResult = results[selectedIndex];

  const formatDate = (year: number | null) => {
    if (!year) return '';
    return year.toString();
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
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-notion-border px-4 py-3">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-notion-accent" />
                <h2 className="text-sm font-semibold text-notion-text">{t('pdf.preview.title')}</h2>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover"
              >
                <X size={16} className="text-notion-text-secondary" />
              </button>
            </div>

            {/* Search query */}
            <div className="border-b border-notion-border bg-notion-sidebar px-4 py-2">
              <p className="text-xs text-notion-text-secondary">
                {t('pdf.preview.searchFor')} "
                <span className="font-medium text-notion-text">{query}</span>"
              </p>
            </div>

            {/* Content */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Results list */}
              <div className="w-1/2 border-r border-notion-border overflow-y-auto">
                {isLoading ? (
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-notion-accent" />
                  </div>
                ) : results.length === 0 ? (
                  <div className="flex h-40 items-center justify-center">
                    <p className="text-sm text-notion-text-secondary">
                      {t('pdf.preview.noResults')}
                    </p>
                  </div>
                ) : (
                  <div className="p-2">
                    {results.map((result, index) => (
                      <button
                        key={result.paperId}
                        onClick={() => setSelectedIndex(index)}
                        className={`w-full rounded-lg p-3 text-left transition-colors ${
                          index === selectedIndex
                            ? 'bg-notion-accent-light border border-notion-accent/30'
                            : 'hover:bg-notion-sidebar-hover border border-transparent'
                        }`}
                      >
                        <p className="text-xs font-medium text-notion-text line-clamp-2">
                          {result.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          {result.year && (
                            <span className="flex items-center gap-0.5 text-[10px] text-notion-text-tertiary">
                              <Calendar size={10} />
                              {result.year}
                            </span>
                          )}
                          {result.authors.length > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-notion-text-tertiary">
                              <Users size={10} />
                              {result.authors[0].name}
                              {result.authors.length > 1 && ` +${result.authors.length - 1}`}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {result.venue && (
                            <span className="inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600 truncate max-w-[180px]">
                              {result.venue}
                            </span>
                          )}
                          {result.externalIds.ArXiv && (
                            <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                              arXiv
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected result details */}
              <div className="w-1/2 overflow-y-auto p-4">
                {selectedResult ? (
                  <div className="space-y-4">
                    {/* Title */}
                    <h3 className="text-sm font-semibold text-notion-text leading-snug">
                      {selectedResult.title}
                    </h3>

                    {/* Authors */}
                    {selectedResult.authors.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-notion-text-secondary mb-1">
                          {t('pdf.preview.authors')}
                        </p>
                        <p className="text-xs text-notion-text">
                          {selectedResult.authors.map((a) => a.name).join(', ')}
                        </p>
                      </div>
                    )}

                    {/* Year & Citations */}
                    <div className="flex gap-4">
                      {selectedResult.year && (
                        <div>
                          <p className="text-xs font-medium text-notion-text-secondary mb-1">
                            {t('pdf.preview.year')}
                          </p>
                          <p className="text-xs text-notion-text">{selectedResult.year}</p>
                        </div>
                      )}
                      {selectedResult.citationCount > 0 && (
                        <div>
                          <p className="text-xs font-medium text-notion-text-secondary mb-1">
                            {t('pdf.preview.citations')}
                          </p>
                          <p className="text-xs text-notion-text">{selectedResult.citationCount}</p>
                        </div>
                      )}
                    </div>

                    {/* Abstract */}
                    {selectedResult.abstract && (
                      <div>
                        <p className="text-xs font-medium text-notion-text-secondary mb-1">
                          {t('pdf.preview.abstract')}
                        </p>
                        <p className="text-xs text-notion-text leading-relaxed line-clamp-8">
                          {selectedResult.abstract}
                        </p>
                      </div>
                    )}

                    {/* Venue & source badges */}
                    {selectedResult.venue && (
                      <div>
                        <p className="text-xs font-medium text-notion-text-secondary mb-1">Venue</p>
                        <p className="text-xs text-notion-text">{selectedResult.venue}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {selectedResult.externalIds.ArXiv && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-600">
                          arXiv: {selectedResult.externalIds.ArXiv}
                        </span>
                      )}
                      {selectedResult.externalIds.DOI && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs text-green-600 break-all">
                          DOI: {selectedResult.externalIds.DOI}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-notion-text-tertiary">
                      {t('pdf.preview.selectPaper')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer with actions */}
            {selectedResult && (
              <div className="flex-shrink-0 border-t border-notion-border bg-notion-sidebar px-4 py-3 max-h-[40vh] overflow-y-auto">
                {noPdfUrl && (
                  <NoPdfBanner url={noPdfUrl} onOpenWebsite={onOpenWebsite} onClose={onClose} />
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-notion-text-tertiary">
                    {t('pdf.preview.keyboardHint')}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={onClose}
                      className="rounded-lg border border-notion-border bg-white px-3 py-1.5 text-xs font-medium text-notion-text hover:bg-notion-sidebar-hover"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={() => onDownload(selectedResult)}
                      disabled={isDownloading}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-notion-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-notion-accent/90 disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t('pdf.preview.downloading')}
                        </>
                      ) : (
                        <>
                          <Download size={14} />
                          {t('pdf.preview.downloadAndRead')}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type { SearchResult };
