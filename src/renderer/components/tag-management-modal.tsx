import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Edit2, Trash2 } from 'lucide-react';
import { ipc, type TagInfo } from '../hooks/use-ipc';
import type { TagCategory } from '@shared';
import { CATEGORY_COLORS, CATEGORY_LABELS, TAG_CATEGORIES } from '@shared';

interface TagManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function TagManagementModal({ isOpen, onClose, onRefresh }: TagManagementModalProps) {
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const tags = await ipc.listAllTags();
      setAllTags(tags);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchTags();
    }
  }, [isOpen, fetchTags]);

  // Group tags by category
  const tagsByCategory = TAG_CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = allTags.filter((t) => t.category === cat);
      return acc;
    },
    {} as Record<TagCategory, TagInfo[]>,
  );

  const handleRename = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    setSaving(true);
    try {
      await ipc.renameTag(oldName, newName.trim());
      await fetchTags();
      onRefresh();
      setEditingTag(null);
    } catch {
      alert('Failed to rename tag');
    } finally {
      setSaving(false);
    }
  };

  const handleRecategorize = async (name: string, newCategory: TagCategory) => {
    setSaving(true);
    try {
      await ipc.recategorizeTag(name, newCategory);
      await fetchTags();
      onRefresh();
    } catch {
      alert('Failed to recategorize tag');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    setSaving(true);
    try {
      await ipc.deleteTag(name);
      await fetchTags();
      onRefresh();
      setDeleteConfirm(null);
    } catch {
      alert('Failed to delete tag');
    } finally {
      setSaving(false);
    }
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
            className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-notion-border px-6 py-4">
              <h2 className="text-lg font-semibold text-notion-text">Manage Tags</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto max-h-[60vh] p-6">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
                </div>
              ) : (
                <div className="space-y-6">
                  {TAG_CATEGORIES.map((category) => {
                    const tags = tagsByCategory[category] || [];
                    if (tags.length === 0) return null;
                    const colors = CATEGORY_COLORS[category];

                    return (
                      <div key={category}>
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-notion-text-tertiary">
                          {CATEGORY_LABELS[category]} ({tags.length} tags)
                        </h3>
                        <div className="space-y-1">
                          {tags.map((tag) => {
                            const isEditing = editingTag === tag.name;
                            const isDeleting = deleteConfirm === tag.name;

                            return (
                              <div
                                key={tag.name}
                                className="group flex items-center gap-3 rounded-lg border border-notion-border bg-white px-4 py-2 transition-colors hover:bg-notion-sidebar/50"
                              >
                                {/* Tag name (editable) */}
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={async (e) => {
                                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                        await handleRename(tag.name, editValue);
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingTag(null);
                                      }
                                    }}
                                    autoFocus
                                    className="flex-1 rounded border border-notion-border px-2 py-1 text-sm"
                                  />
                                ) : (
                                  <span className="flex-1 text-sm font-medium text-notion-text">
                                    {tag.name}
                                  </span>
                                )}

                                {/* Category dropdown */}
                                <select
                                  value={tag.category}
                                  onChange={async (e) => {
                                    const newCat = e.target.value as TagCategory;
                                    if (newCat !== tag.category) {
                                      await handleRecategorize(tag.name, newCat);
                                    }
                                  }}
                                  disabled={saving}
                                  className={`rounded border border-notion-border ${colors.bg} ${colors.text} px-2 py-1 text-xs font-medium`}
                                >
                                  {TAG_CATEGORIES.map((cat) => (
                                    <option key={cat} value={cat}>
                                      {CATEGORY_LABELS[cat]}
                                    </option>
                                  ))}
                                </select>

                                {/* Count */}
                                <span className="text-xs text-notion-text-tertiary min-w-[3rem] text-right">
                                  {tag.count} papers
                                </span>

                                {/* Actions */}
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      if (isEditing) {
                                        handleRename(tag.name, editValue);
                                      } else {
                                        setEditingTag(tag.name);
                                        setEditValue(tag.name);
                                      }
                                    }}
                                    disabled={saving}
                                    className="rounded p-1 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                                  >
                                    {isEditing ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Edit2 size={14} />
                                    )}
                                  </button>

                                  {isDeleting ? (
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => handleDelete(tag.name)}
                                        disabled={saving}
                                        className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
                                      >
                                        {saving ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          'Confirm'
                                        )}
                                      </button>
                                      <button
                                        onClick={() => setDeleteConfirm(null)}
                                        className="rounded px-2 py-0.5 text-xs font-medium text-notion-text-secondary hover:bg-notion-sidebar"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setDeleteConfirm(tag.name)}
                                      className="rounded p-1 text-notion-text-tertiary hover:bg-red-50 hover:text-red-600"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
