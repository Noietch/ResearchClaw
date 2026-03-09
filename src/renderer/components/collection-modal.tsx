import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { COLLECTION_COLORS, type CollectionColor } from '@shared';

const EMOJI_OPTIONS = ['📝', '✨', '📖', '🔬', '💡', '🎯', '📚', '⭐', '🧪', '🔥', '📌', '🏷️'];

const COLOR_DISPLAY: Record<CollectionColor, string> = {
  blue: 'bg-blue-400',
  green: 'bg-green-400',
  yellow: 'bg-yellow-400',
  red: 'bg-red-400',
  purple: 'bg-purple-400',
  pink: 'bg-pink-400',
  orange: 'bg-orange-400',
  gray: 'bg-gray-400',
};

interface CollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; icon?: string; color?: string; description?: string }) => void;
  initial?: { name?: string; icon?: string; color?: string; description?: string };
  title?: string;
}

export function CollectionModal({ isOpen, onClose, onSave, initial, title }: CollectionModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '📝');
  const [color, setColor] = useState<string>(initial?.color ?? 'blue');
  const [description, setDescription] = useState(initial?.description ?? '');

  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? '');
      setIcon(initial?.icon ?? '📝');
      setColor(initial?.color ?? 'blue');
      setDescription(initial?.description ?? '');
    }
  }, [isOpen, initial]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), icon, color, description: description.trim() || undefined });
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
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-notion-text">
                {title ?? 'New Collection'}
              </h3>
              <button
                onClick={onClose}
                className="rounded-md p-1 text-notion-text-tertiary hover:bg-notion-sidebar"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-notion-text mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Collection name"
                  autoFocus
                  className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {/* Icon */}
              <div>
                <label className="block text-sm font-medium text-notion-text mb-1">Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setIcon(emoji)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition-colors ${
                        icon === emoji
                          ? 'bg-blue-100 ring-2 ring-blue-400'
                          : 'hover:bg-notion-sidebar'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-notion-text mb-1">Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLLECTION_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-7 w-7 rounded-full ${COLOR_DISPLAY[c]} transition-transform ${
                        color === c
                          ? 'scale-110 ring-2 ring-offset-2 ring-blue-400'
                          : 'hover:scale-105'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-notion-text mb-1">
                  Description <span className="text-notion-text-tertiary">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this collection for?"
                  rows={2}
                  className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
