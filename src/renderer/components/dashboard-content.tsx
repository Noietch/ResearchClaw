import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc, type PaperItem } from '../hooks/use-ipc';
import { ImportModal } from './import-modal';
import { LoadingSpinner } from './loading-spinner';
import { FileText, Loader2, Trash2, Sparkles, Download } from 'lucide-react';
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

// Animation variants
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
  const [todayPapers, setTodayPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const navigate = useNavigate();

  const fetchTodayPapers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipc.listTodayPapers();
      setTodayPapers(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (paperId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This action cannot be undone.`)) return;
    setDeleting(paperId);
    try {
      await ipc.deletePaper(paperId);
      setTodayPapers((prev) => prev.filter((p) => p.id !== paperId));
    } catch {
      alert('Failed to delete paper');
    } finally {
      setDeleting(null);
    }
  }, []);

  useEffect(() => {
    fetchTodayPapers();
  }, [fetchTodayPapers]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-2">
          <Sparkles size={20} className="text-blue-500" />
          <h1 className="text-xl font-semibold text-notion-text">Today's Papers</h1>
          {!loading && todayPapers.length > 0 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
              {todayPapers.length}
            </span>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {/* Papers grid */}
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
                    onDelete={handleDelete}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        <AnimatePresence>
          {!loading && todayPapers.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <p className="text-base text-notion-text-secondary">No new papers today</p>
              <p className="mt-1 text-sm text-notion-text-tertiary">Import papers to get started</p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-blue-600"
                >
                  <Download size={12} />
                  Import Papers
                </button>
                <Link
                  to="/papers"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary no-underline hover:bg-notion-sidebar"
                >
                  Go to Library
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showImportModal && (
        <ImportModal onClose={() => setShowImportModal(false)} onImported={fetchTodayPapers} />
      )}
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
      {/* Delete button */}
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

      {/* Card content - clickable */}
      <button onClick={handleClick} className="flex flex-col items-start gap-2 text-left">
        {/* Icon + Title row */}
        <div className="flex items-start gap-2.5">
          <motion.div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50"
            whileHover={{ rotate: 5 }}
          >
            <FileText size={16} className="text-blue-500" />
          </motion.div>
          <h3 className="line-clamp-2 text-sm font-medium text-notion-text">{paper.title}</h3>
        </div>

        {/* Meta */}
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
