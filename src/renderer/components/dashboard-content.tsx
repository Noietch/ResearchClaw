import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ipc, type PaperItem } from '../hooks/use-ipc';
import { ImportModal } from './import-modal';
import { LoadingSpinner } from './loading-spinner';
import { FileText, Loader2, Trash2, Download, BookOpen, Clock } from 'lucide-react';
import { getTagStyle } from '@shared';

const EXCLUDED_TAGS = [
  'arxiv',
  'chrome',
  'manual',
  'pdf',
  'research-paper',
  'research paper',
  'paper',
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 24,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.15 },
  },
};

export function DashboardContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [todayPapers, setTodayPapers] = useState<PaperItem[]>([]);
  const [recentlyRead, setRecentlyRead] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const fetchTodayPapers = useCallback(async () => {
    setLoading(true);
    try {
      const [data, allPapers] = await Promise.all([
        ipc.listTodayPapers(),
        ipc.listPapers({ importedWithin: 'all' }),
      ]);
      setTodayPapers(data);
      // Get recently read papers (have lastReadAt and reading progress)
      const read = allPapers
        .filter((p) => p.lastReadAt && p.lastReadPage && p.totalPages)
        .sort((a, b) => new Date(b.lastReadAt!).getTime() - new Date(a.lastReadAt!).getTime())
        .slice(0, 5);
      setRecentlyRead(read);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeleteRequest = useCallback((paperId: string, title: string) => {
    setDeleteTarget({ id: paperId, title });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    try {
      await ipc.deletePaper(deleteTarget.id);
      setTodayPapers((prev) => prev.filter((p) => p.id !== deleteTarget.id));
    } catch {
      // silent - toast could be added later
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  useEffect(() => {
    fetchTodayPapers();
  }, [fetchTodayPapers]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <section>
          <div className="mb-6 flex items-center gap-2">
            <FileText size={20} className="text-blue-500" />
            <h2 className="text-xl font-semibold text-notion-text">
              {t('dashboardContent.todaysPapers')}
            </h2>
            {!loading && todayPapers.length > 0 && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                {todayPapers.length}
              </span>
            )}
            {!loading && todayPapers.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  <Download size={14} />
                  Import Papers
                </button>
              </div>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner size="lg" />
            </div>
          )}

          <AnimatePresence mode="wait">
            {!loading && todayPapers.length > 0 && (
              <motion.div
                key="papers"
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <AnimatePresence mode="popLayout">
                  {todayPapers.map((paper) => (
                    <PaperCard
                      key={paper.id}
                      paper={paper}
                      deleting={deleting}
                      onDelete={handleDeleteRequest}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!loading && todayPapers.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-xl border border-notion-border bg-white p-6 text-center shadow-notion"
              >
                <p className="text-base text-notion-text-secondary">
                  {t('dashboardContent.noNewPapers', 'No new papers today')}
                </p>
                <p className="mt-1 text-sm text-notion-text-tertiary">
                  {t('dashboardContent.importHint', 'Import papers to get started')}
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setShowImportModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-blue-600"
                  >
                    <Download size={12} />
                    {t('dashboardContent.importPapers', 'Import Papers')}
                  </button>
                  <Link
                    to="/papers"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary no-underline hover:bg-notion-sidebar"
                  >
                    {t('dashboardContent.goToLibrary', 'Go to Library')}
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Continue Reading — show recently read papers with progress */}
        {!loading && recentlyRead.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <BookOpen size={18} className="text-green-500" />
              <h2 className="text-lg font-semibold text-notion-text">
                {t('dashboardContent.continueReading', 'Continue Reading')}
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {recentlyRead.map((paper) => {
                const progress = Math.round(
                  ((paper.lastReadPage ?? 0) / (paper.totalPages ?? 1)) * 100,
                );
                return (
                  <button
                    key={paper.id}
                    onClick={() =>
                      navigate(`/papers/${paper.shortId}/reader`, {
                        state: { from: '/dashboard' },
                      })
                    }
                    className="group flex items-center gap-3 rounded-lg border border-notion-border bg-white px-4 py-3 text-left transition-colors hover:bg-blue-50 hover:border-blue-200"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50">
                      <BookOpen size={14} className="text-green-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-notion-text">{paper.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-notion-sidebar">
                          <div
                            className="h-full rounded-full bg-green-400 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-notion-text-tertiary">
                          {progress}% · {t('dashboardContent.page', 'p.')}
                          {paper.lastReadPage}/{paper.totalPages}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-notion-text-tertiary">
                      <Clock size={10} />
                      {paper.lastReadAt ? new Date(paper.lastReadAt).toLocaleDateString() : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {showImportModal && (
        <ImportModal onClose={() => setShowImportModal(false)} onImported={fetchTodayPapers} />
      )}

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setDeleteTarget(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDeleteTarget(null);
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
              <p className="mt-2 text-sm font-medium text-notion-text">{deleteTarget.title}</p>
              <p className="mt-2 text-sm text-notion-text-secondary">
                {t('papers.deleteConfirmMessage')}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting === deleteTarget.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting === deleteTarget.id && <Loader2 size={14} className="animate-spin" />}
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

function PaperCard({
  paper,
  deleting,
  onDelete,
}: {
  paper: PaperItem;
  deleting: string | null;
  onDelete: (id: string, title: string) => void;
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/papers/${paper.shortId}`, { state: { from: '/dashboard' } });
  };

  return (
    <motion.div
      variants={cardVariants}
      layout
      className="group relative flex flex-col rounded-xl border border-notion-border bg-white p-4"
      whileHover={{
        scale: 1.02,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
      }}
    >
      <motion.button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(paper.id, paper.title);
        }}
        disabled={deleting === paper.id}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
        title="Delete paper"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        {deleting === paper.id ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </motion.button>

      <button onClick={handleClick} className="flex flex-col items-start gap-2 text-left">
        <div className="flex items-start gap-2.5">
          <motion.div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50"
            whileHover={{ rotate: 5 }}
          >
            <FileText size={16} className="text-blue-500" />
          </motion.div>
          <h3 className="line-clamp-2 pr-6 text-sm font-medium text-notion-text">{paper.title}</h3>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {paper.submittedAt && (
            <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs text-notion-text-secondary">
              {new Date(paper.submittedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </span>
          )}
          {paper.categorizedTags
            ?.filter((t) => !EXCLUDED_TAGS.includes(t.name.toLowerCase()))
            .slice(0, 3)
            .map((tag) => {
              const style = getTagStyle(tag.category);
              return (
                <motion.span
                  key={tag.name}
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                  whileHover={{ scale: 1.05 }}
                >
                  {tag.name}
                </motion.span>
              );
            })}
        </div>
      </button>
    </motion.div>
  );
}
