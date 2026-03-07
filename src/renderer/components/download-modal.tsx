import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc } from '../hooks/use-ipc';
import { Download, X, Loader2 } from 'lucide-react';

// Animation variants
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
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
    scale: 0.9,
    y: 20,
    transition: {
      duration: 0.15,
    },
  },
};

const buttonVariants = {
  hover: { scale: 1.02 },
  tap: { scale: 0.98 },
};

export function DownloadModal({
  onClose,
  onDownloaded,
}: {
  onClose: () => void;
  onDownloaded: () => void;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      await ipc.downloadPaper(trimmed);
      onDownloaded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download paper');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          className="w-full max-w-md rounded-2xl border border-notion-border bg-white p-6 shadow-xl"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <motion.div
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-notion-tag-blue"
                initial={{ rotate: -10 }}
                animate={{ rotate: 0 }}
                transition={{ type: 'spring' as const, stiffness: 300, damping: 20 }}
              >
                <Download size={16} className="text-blue-600" />
              </motion.div>
              <h2 className="text-base font-semibold text-notion-text">Download Paper</h2>
            </div>
            <motion.button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-notion-text-tertiary hover:bg-notion-sidebar"
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
            >
              <X size={16} />
            </motion.button>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
              arXiv ID or URL
            </label>
            <motion.input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 2401.12345 or https://arxiv.org/abs/2401.12345"
              className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            />
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="mt-2 text-xs text-red-600"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.div
              className="mt-5 flex justify-end gap-2.5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <motion.button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar"
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
              >
                Cancel
              </motion.button>
              <motion.button
                type="submit"
                disabled={loading || !input.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {loading ? 'Downloading…' : 'Download'}
              </motion.button>
            </motion.div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
