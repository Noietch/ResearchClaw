import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PapersByTag } from '../../components/papers-by-tag';
import { ipc, onIpc, type ImportStatus, type PaperItem } from '../../hooks/use-ipc';
import { ImportModal } from '../../components/import-modal';
import { BookOpen, Clock, LibraryBig, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cleanArxivTitle } from '@shared';
import { useToast } from '../../components/toast';

function ReadingListTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipc.listPapers({ temporary: true });
      setPapers(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  const handleImport = useCallback(
    async (paper: PaperItem) => {
      setImportingId(paper.id);
      try {
        await ipc.importTemporary(paper.id);
        toast.success(t('papers.readingList.imported'));
        setPapers((prev) => prev.filter((p) => p.id !== paper.id));
      } catch {
        toast.error('Import failed');
      } finally {
        setImportingId(null);
      }
    },
    [t, toast],
  );

  const handleDelete = useCallback(
    async (paper: PaperItem) => {
      setDeletingId(paper.id);
      try {
        await ipc.deletePaper(paper.id);
        setPapers((prev) => prev.filter((p) => p.id !== paper.id));
      } catch {
        toast.error('Delete failed');
      } finally {
        setDeletingId(null);
      }
    },
    [toast],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <Clock size={32} className="text-notion-text-tertiary" />
        <p className="text-sm text-notion-text-secondary">{t('papers.readingList.empty')}</p>
        <p className="text-xs text-notion-text-tertiary">{t('papers.readingList.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <p className="text-xs text-notion-text-tertiary mb-3">
        {papers.length} {t('papers.readingList.count')}
      </p>
      <AnimatePresence>
        {papers.map((paper) => (
          <motion.div
            key={paper.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="group mb-2 rounded-lg border border-notion-border bg-white p-3 hover:border-blue-200 hover:bg-blue-50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => navigate(`/papers/${paper.shortId}/reader`)}
                  className="text-sm font-medium text-notion-text hover:text-blue-600 text-left line-clamp-2"
                >
                  {cleanArxivTitle(paper.title)}
                </button>
                <div className="flex items-center gap-2 mt-1">
                  {paper.authors && paper.authors.length > 0 && (
                    <span className="text-[10px] text-notion-text-tertiary truncate max-w-[200px]">
                      {paper.authors.slice(0, 3).join(', ')}
                      {paper.authors.length > 3 && ' et al.'}
                    </span>
                  )}
                  {paper.submittedAt && (
                    <span className="text-[10px] text-notion-text-tertiary">
                      {new Date(paper.submittedAt).getFullYear()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {paper.pdfPath && (
                  <button
                    onClick={() => navigate(`/papers/${paper.shortId}/reader`)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover"
                    title={t('pdf.citation.read')}
                  >
                    <BookOpen size={14} className="text-blue-600" />
                  </button>
                )}
                <button
                  onClick={() => handleImport(paper)}
                  disabled={importingId === paper.id}
                  className="flex h-7 items-center gap-1.5 rounded-lg px-2 hover:bg-green-50 text-green-700 text-xs font-medium disabled:opacity-50"
                  title={t('pdf.citation.importToLibrary')}
                >
                  {importingId === paper.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <LibraryBig size={14} />
                  )}
                  {t('pdf.citation.importToLibrary', 'Add to Library')}
                </button>
                <button
                  onClick={() => handleDelete(paper)}
                  disabled={deletingId === paper.id}
                  className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-500 text-notion-text-tertiary disabled:opacity-50"
                  title="Delete"
                >
                  {deletingId === paper.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type LibraryTab = 'library' | 'reading-list';

export function PapersPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<LibraryTab>('library');
  const [refreshKey, setRefreshKey] = useState(0);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    ipc
      .getImportStatus()
      .then((status) => setImportStatus(status))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsub = onIpc('ingest:status', (...args) => {
      const status = args[1] as ImportStatus;
      setImportStatus(status);
      if (!status.active) setRefreshKey((k) => k + 1);
    });
    return unsub;
  }, []);

  const handleImported = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const tabs: { id: LibraryTab; label: string; icon: React.ElementType }[] = [
    { id: 'library', label: t('papers.tabs.library'), icon: LibraryBig },
    { id: 'reading-list', label: t('papers.tabs.readingList'), icon: Clock },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-notion-border px-4 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-400 text-blue-600'
                : 'border-transparent text-notion-text-tertiary hover:text-notion-text'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'library' ? (
        <PapersByTag
          key={refreshKey}
          importStatus={importStatus}
          onOpenImport={() => setShowImportModal(true)}
        />
      ) : (
        <ReadingListTab key={refreshKey} />
      )}

      {showImportModal && (
        <ImportModal onClose={() => setShowImportModal(false)} onImported={handleImported} />
      )}
    </div>
  );
}
