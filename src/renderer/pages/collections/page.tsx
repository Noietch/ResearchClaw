import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ipc,
  type CollectionItem,
  type PaperItem,
  type ResearchProfile,
} from '../../hooks/use-ipc';
import { useTabs } from '../../hooks/use-tabs';
import { LoadingSpinner } from '../../components/loading-spinner';
import { CollectionModal } from '../../components/collection-modal';
import { ResearchProfileView } from '../../components/research-profile';
import { ArrowLeft, Trash2, Pencil, FileText, Loader2, Plus, Search, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cleanArxivTitle } from '@shared';
import { useToast } from '../../components/toast';

type TabType = 'papers' | 'profile';

export function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { updateTabLabel } = useTabs();

  const [collection, setCollection] = useState<CollectionItem | null>(null);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [profile, setProfile] = useState<ResearchProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('papers');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAddPapers, setShowAddPapers] = useState(false);
  const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const toast = useToast();

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [collections, paperList] = await Promise.all([
        ipc.listCollections(),
        ipc.listCollectionPapers(id),
      ]);
      const col = collections.find((c) => c.id === id) ?? null;
      setCollection(col);
      setPapers(paperList);
      if (col) {
        updateTabLabel(`/collections/${id}`, `${col.icon ?? ''} ${col.name}`.trim());
      }
    } catch (err) {
      console.error('Failed to load collection:', err);
    } finally {
      setLoading(false);
    }
  }, [id, updateTabLabel]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load profile on tab switch
  useEffect(() => {
    if (activeTab === 'profile' && id && !profile) {
      ipc.getResearchProfile(id).then(setProfile).catch(console.error);
    }
  }, [activeTab, id, profile]);

  const handleRemovePaper = useCallback(
    async (paperId: string) => {
      if (!id) return;
      try {
        await ipc.removePaperFromCollection(id, paperId);
        setPapers((prev) => prev.filter((p) => p.id !== paperId));
        setProfile(null);
        toast.success('Paper removed from collection');
      } catch {
        toast.error('Failed to remove paper');
      }
    },
    [id, toast],
  );

  const handleAddPaperToCollection = useCallback(
    async (paperId: string) => {
      if (!id) return;
      try {
        await ipc.addPaperToCollection(id, paperId);
        // Reload papers list
        const updated = await ipc.listCollectionPapers(id);
        setPapers(updated);
        setProfile(null);
        toast.success('Paper added to collection');
      } catch {
        toast.error('Failed to add paper');
      }
    },
    [id, toast],
  );

  const openAddPapers = useCallback(async () => {
    try {
      const all = await ipc.listPapers();
      setAllPapers(all);
      setShowAddPapers(true);
      setAddSearch('');
    } catch {
      toast.error('Failed to load papers');
    }
  }, [toast]);

  const handleEdit = useCallback(
    async (data: { name: string; icon?: string; color?: string; description?: string }) => {
      if (!id) return;
      try {
        await ipc.updateCollection(id, data);
        setShowEditModal(false);
        loadData();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to update');
      }
    },
    [id, loadData],
  );

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await ipc.deleteCollection(id);
      navigate('/papers');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  }, [id, navigate]);

  // ESC for modals
  useEffect(() => {
    if (!showDeleteConfirm && !showAddPapers) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDeleteConfirm(false);
        setShowAddPapers(false);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [showDeleteConfirm, showAddPapers]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-notion-text-tertiary">
        Collection not found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-8 py-5">
        <button
          onClick={() => navigate('/papers')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
        >
          <ArrowLeft size={16} />
          Library
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {collection.icon && <span className="text-xl">{collection.icon}</span>}
          <h1 className="text-xl font-bold tracking-tight text-notion-text truncate">
            {collection.name}
          </h1>
          <span className="text-sm text-notion-text-tertiary">
            {papers.length} paper{papers.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAddPapers}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Plus size={14} />
            Add Papers
          </button>
          <button
            onClick={() => setShowEditModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            <Pencil size={14} />
            Edit
          </button>
          {!collection.isDefault && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-notion-border px-8">
        {(['papers', 'profile'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'text-notion-text'
                : 'text-notion-text-tertiary hover:text-notion-text-secondary'
            }`}
          >
            {tab === 'papers' ? 'Papers' : 'Research Profile'}
            {activeTab === tab && (
              <motion.div
                layoutId="collectionTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-notion-text"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto">
          {activeTab === 'papers' && (
            <div>
              {papers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-notion-border py-12 text-center">
                  <FileText
                    size={32}
                    strokeWidth={1.2}
                    className="mx-auto mb-2 text-notion-border"
                  />
                  <p className="text-sm text-notion-text-tertiary">No papers in this collection</p>
                  <p className="text-xs text-notion-text-tertiary mt-1">
                    Add papers from the Library or paper detail page
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {papers.map((paper) => (
                    <div
                      key={paper.id}
                      className="flex items-center gap-4 rounded-lg border border-notion-border px-4 py-3 transition-colors hover:bg-notion-sidebar/50"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                        <FileText size={16} className="text-blue-600" />
                      </div>
                      <button
                        onClick={() => navigate(`/papers/${paper.shortId}`)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="text-sm font-medium text-notion-text truncate">
                          {cleanArxivTitle(paper.title)}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-notion-text-tertiary">
                          {paper.authors && paper.authors.length > 0 && (
                            <span>{paper.authors.slice(0, 3).join(', ')}</span>
                          )}
                          {paper.year && <span>{paper.year}</span>}
                        </div>
                      </button>
                      <button
                        onClick={() => handleRemovePaper(paper.id)}
                        className="flex-shrink-0 rounded-md p-1.5 text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Remove from collection"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div>
              {profile ? (
                <ResearchProfileView profile={profile} />
              ) : (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner size="md" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <CollectionModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleEdit}
        initial={{
          name: collection.name,
          icon: collection.icon ?? undefined,
          color: collection.color ?? undefined,
          description: collection.description ?? undefined,
        }}
        title="Edit Collection"
      />

      {/* Delete Confirmation */}
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
              <h3 className="text-lg font-semibold text-notion-text">Delete Collection</h3>
              <p className="mt-2 text-sm text-notion-text-secondary">
                Are you sure you want to delete &quot;{collection.name}&quot;? Papers will not be
                deleted.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Papers Modal */}
      <AnimatePresence>
        {showAddPapers && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setShowAddPapers(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-notion-text">Add Papers from Library</h3>
              <div className="relative mt-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
                />
                <input
                  type="text"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder="Search papers..."
                  className="w-full rounded-lg border border-notion-border py-2 pl-9 pr-3 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
              </div>
              <div className="mt-3 flex-1 overflow-y-auto">
                {(() => {
                  const paperIds = new Set(papers.map((p) => p.id));
                  const filtered = allPapers.filter((p) => {
                    if (!addSearch.trim()) return true;
                    const q = addSearch.toLowerCase();
                    return (
                      p.title.toLowerCase().includes(q) ||
                      p.authors?.some((a) => a.toLowerCase().includes(q))
                    );
                  });
                  if (filtered.length === 0) {
                    return (
                      <p className="py-8 text-center text-sm text-notion-text-tertiary">
                        No papers found
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-1">
                      {filtered.map((paper) => {
                        const isAdded = paperIds.has(paper.id);
                        return (
                          <button
                            key={paper.id}
                            onClick={() => {
                              if (isAdded) {
                                handleRemovePaper(paper.id);
                              } else {
                                handleAddPaperToCollection(paper.id);
                              }
                            }}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              isAdded
                                ? 'bg-blue-50 hover:bg-blue-100/70'
                                : 'hover:bg-notion-sidebar/50'
                            }`}
                          >
                            <div
                              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded ${
                                isAdded
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-notion-border text-transparent'
                              }`}
                            >
                              <Check size={12} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-notion-text">
                                {cleanArxivTitle(paper.title)}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-notion-text-tertiary">
                                {paper.authors && paper.authors.length > 0 && (
                                  <span>{paper.authors.slice(0, 2).join(', ')}</span>
                                )}
                                {paper.year && <span>{paper.year}</span>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setShowAddPapers(false)}
                  className="rounded-lg bg-notion-sidebar px-4 py-2 text-sm font-medium text-notion-text transition-colors hover:bg-notion-border"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
