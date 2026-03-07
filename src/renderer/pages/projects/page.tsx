import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ipc,
  type ProjectItem,
  type ProjectTodo,
  type ProjectRepo,
  type ProjectIdea,
  type CommitInfo,
} from '../../hooks/use-ipc';
import { useTabs } from '../../hooks/use-tabs';
import {
  FolderKanban,
  Plus,
  Trash2,
  Check,
  GitCommit,
  GitBranch,
  Lightbulb,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';

// ── Animation variants ────────────────────────────────────────────────────────

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

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.15 },
  },
};

const todoItemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
  exit: {
    opacity: 0,
    x: 10,
    transition: { duration: 0.15 },
  },
};

const cardHoverVariants = {
  hover: {
    y: -2,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
    transition: { type: 'spring' as const, stiffness: 300, damping: 20 },
  },
};

const expandVariants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      height: { type: 'spring' as const, stiffness: 300, damping: 30 },
      opacity: { duration: 0.2 },
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'todos' | 'code' | 'ideas';

// ── TodoList ─────────────────────────────────────────────────────────────────

function TodoItem({
  todo,
  onToggle,
  onDelete,
  onEdit,
}: {
  todo: ProjectTodo;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);

  const commitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== todo.text) onEdit(trimmed);
    else setEditText(todo.text);
    setEditing(false);
  };

  return (
    <motion.li
      variants={todoItemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      layout
      className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-notion-sidebar-hover"
    >
      <motion.button
        onClick={onToggle}
        className={clsx(
          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
          todo.done
            ? 'border-notion-text bg-notion-text text-white'
            : 'border-notion-border bg-transparent',
        )}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        {todo.done && <Check size={10} strokeWidth={3} />}
      </motion.button>

      {editing ? (
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') {
              setEditText(todo.text);
              setEditing(false);
            }
          }}
          className="flex-1 rounded border border-notion-border bg-transparent px-2 py-0.5 text-sm text-notion-text focus:outline-none focus:ring-1 focus:ring-notion-text/20"
        />
      ) : (
        <span
          onDoubleClick={() => !todo.done && setEditing(true)}
          className={clsx(
            'flex-1 cursor-default select-none text-sm',
            todo.done ? 'text-notion-text-tertiary line-through' : 'text-notion-text',
          )}
          title={todo.done ? undefined : 'Double-click to edit'}
        >
          {todo.text}
        </span>
      )}

      <motion.button
        onClick={onDelete}
        title="Delete todo"
        className="invisible text-notion-text-tertiary hover:text-red-500 group-hover:visible"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <X size={14} />
      </motion.button>
    </motion.li>
  );
}

function TodoList({ project, onChange }: { project: ProjectItem; onChange: () => void }) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setAdding(true);
    await ipc.createTodo({ projectId: project.id, text: trimmed });
    setText('');
    setAdding(false);
    onChange();
  };

  const toggle = async (todo: ProjectTodo) => {
    await ipc.updateTodo(todo.id, { done: !todo.done });
    onChange();
  };

  const edit = async (id: string, text: string) => {
    await ipc.updateTodo(id, { text });
    onChange();
  };

  const remove = async (id: string) => {
    await ipc.deleteTodo(id);
    onChange();
  };

  const openCount = project.todos.filter((t) => !t.done).length;
  const doneCount = project.todos.filter((t) => t.done).length;

  return (
    <div className="space-y-3">
      {/* Add input */}
      <motion.div
        className="flex gap-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a todo..."
          className="flex-1 rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
        />
        <motion.button
          onClick={add}
          disabled={adding || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </motion.button>
      </motion.div>

      {/* Progress */}
      {project.todos.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1">
          <div className="flex justify-between text-xs text-notion-text-tertiary">
            <span>
              {openCount} open · {doneCount} done
            </span>
            <span>
              {project.todos.length > 0 ? Math.round((doneCount / project.todos.length) * 100) : 0}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-notion-sidebar-hover">
            <motion.div
              className="h-full rounded-full bg-notion-text"
              initial={{ width: 0 }}
              animate={{
                width: `${project.todos.length > 0 ? (doneCount / project.todos.length) * 100 : 0}%`,
              }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </motion.div>
      )}

      {/* Todo items */}
      {project.todos.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-8 text-center text-sm text-notion-text-tertiary"
        >
          No todos yet
        </motion.p>
      ) : (
        <ul className="space-y-1">
          <AnimatePresence mode="popLayout">
            {project.todos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={() => toggle(todo)}
                onDelete={() => remove(todo.id)}
                onEdit={(text) => edit(todo.id, text)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// ── RepoCard ─────────────────────────────────────────────────────────────────

function RepoCard({ repo, onDelete }: { repo: ProjectRepo; onDelete: () => void }) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const handleClone = async () => {
    setCloning(true);
    setCloneError(null);
    const result = await ipc.cloneRepo(repo.id, repo.repoUrl);
    setCloning(false);
    if (!result.success) {
      setCloneError(result.error ?? 'Clone failed');
    } else {
      // reload commits immediately
      loadCommits(result.localPath!);
    }
  };

  const loadCommits = useCallback(
    async (localPath?: string) => {
      const p = localPath ?? repo.localPath;
      if (!p) return;
      setLoadingCommits(true);
      const data = await ipc.getCommits(p);
      setCommits(data);
      setLoadingCommits(false);
    },
    [repo.localPath],
  );

  const toggleExpand = () => {
    if (!expanded && repo.localPath) {
      loadCommits();
    }
    setExpanded((v) => !v);
  };

  const repoName = repo.repoUrl
    .replace(/\.git$/, '')
    .split('/')
    .slice(-2)
    .join('/');

  return (
    <motion.div
      className="rounded-xl border border-notion-border"
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={{ borderColor: 'rgba(0, 0, 0, 0.15)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <motion.div whileHover={{ rotate: 10 }}>
          <GitBranch size={16} className="flex-shrink-0 text-notion-text-tertiary" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-notion-text">{repoName}</p>
          <p className="truncate text-xs text-notion-text-tertiary">{repo.repoUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          {!repo.localPath && (
            <motion.button
              onClick={handleClone}
              disabled={cloning}
              className="inline-flex items-center gap-1 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text hover:bg-notion-sidebar-hover disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {cloning ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
              Clone
            </motion.button>
          )}
          {repo.localPath && (
            <motion.button
              onClick={toggleExpand}
              className="inline-flex items-center gap-1 rounded-md border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text hover:bg-notion-sidebar-hover"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <motion.div animate={{ rotate: expanded ? 90 : 0 }}>
                <ChevronRight size={12} />
              </motion.div>
              Commits
            </motion.button>
          )}
          <motion.button
            onClick={() => {
              if (repo.localPath) {
                ipc.openInEditor(repo.localPath);
              } else {
                window.open(repo.repoUrl, '_blank');
              }
            }}
            title={repo.localPath ? 'Open in editor' : 'Open in browser'}
            className="text-notion-text-tertiary hover:text-notion-text"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ExternalLink size={14} />
          </motion.button>
          <motion.button
            onClick={onDelete}
            title="Delete repo"
            className="text-notion-text-tertiary hover:text-red-500"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Trash2 size={14} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {cloneError && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-notion-border px-4 py-2 text-xs text-red-500"
          >
            {cloneError}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expanded && (
          <motion.div
            variants={expandVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden border-t border-notion-border"
          >
            <div className="px-4 py-3">
              {loadingCommits ? (
                <div className="flex justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-notion-text-tertiary" />
                </div>
              ) : commits.length === 0 ? (
                <p className="text-xs text-notion-text-tertiary">No commits found</p>
              ) : (
                <ul className="space-y-1.5">
                  {commits.map((c) => (
                    <motion.li
                      key={c.hash}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-2 text-xs"
                    >
                      <span className="mt-0.5 font-mono text-notion-text-tertiary">
                        {c.shortHash}
                      </span>
                      <span className="flex-1 text-notion-text">{c.message}</span>
                      <span className="flex-shrink-0 text-notion-text-tertiary">
                        {timeAgo(c.date)}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── CodeTab ───────────────────────────────────────────────────────────────────

function CodeTab({ project, onChange }: { project: ProjectItem; onChange: () => void }) {
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  const addRepo = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setAdding(true);
    await ipc.addRepo({ projectId: project.id, repoUrl: trimmed });
    setUrl('');
    setAdding(false);
    onChange();
  };

  const deleteRepo = async (id: string) => {
    await ipc.deleteRepo(id);
    onChange();
  };

  return (
    <div className="space-y-4">
      <motion.div
        className="flex gap-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRepo()}
          placeholder="https://github.com/owner/repo.git"
          className="flex-1 rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
        />
        <motion.button
          onClick={addRepo}
          disabled={adding || !url.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </motion.button>
      </motion.div>

      {project.repos.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-8 text-center text-sm text-notion-text-tertiary"
        >
          No repositories yet — paste a Git URL above
        </motion.p>
      ) : (
        <motion.div
          className="space-y-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {project.repos.map((repo) => (
              <RepoCard key={repo.id} repo={repo} onDelete={() => deleteRepo(repo.id)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

// ── IdeasTab ──────────────────────────────────────────────────────────────────

function IdeasTab({ project, onChange }: { project: ProjectItem; onChange: () => void }) {
  const [papers, setPapers] = useState<{ id: string; shortId: string; title: string }[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showPaperPicker, setShowPaperPicker] = useState(false);
  const [paperSearch, setPaperSearch] = useState('');

  useEffect(() => {
    ipc.listPapers().then(setPapers);
  }, []);

  const togglePaper = (id: string) => {
    setSelectedPaperIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleRepo = (id: string) => {
    setSelectedRepoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const filteredPapers = paperSearch.trim()
    ? papers.filter((p) => p.title.toLowerCase().includes(paperSearch.toLowerCase()))
    : papers;

  const totalSelected = selectedPaperIds.length + selectedRepoIds.length;

  const generateIdea = async () => {
    if (totalSelected === 0) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      await ipc.generateProjectIdea({
        projectId: project.id,
        paperIds: selectedPaperIds,
        repoIds: selectedRepoIds,
      });
      setSelectedPaperIds([]);
      setSelectedRepoIds([]);
      setShowPaperPicker(false);
      onChange();
    } catch (err) {
      setGenerateError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const deleteIdea = async (id: string) => {
    await ipc.deleteProjectIdea(id);
    onChange();
  };

  const updateIdea = async (id: string, data: { title?: string; content?: string }) => {
    await ipc.updateProjectIdea(id, data);
    onChange();
  };

  const clonedRepos = project.repos.filter((r) => r.localPath);

  return (
    <div className="space-y-4">
      {/* Source selection row */}
      <motion.div
        className="space-y-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Repo chips (only cloned repos) */}
        {clonedRepos.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-notion-text-tertiary">Repositories</p>
            <div className="flex flex-wrap gap-2">
              {clonedRepos.map((repo) => {
                const repoName = repo.repoUrl
                  .replace(/\.git$/, '')
                  .split('/')
                  .slice(-2)
                  .join('/');
                const selected = selectedRepoIds.includes(repo.id);
                return (
                  <motion.button
                    key={repo.id}
                    onClick={() => toggleRepo(repo.id)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      selected
                        ? 'border-notion-text bg-notion-text text-white'
                        : 'border-notion-border text-notion-text hover:bg-notion-sidebar-hover',
                    )}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <GitBranch size={11} />
                    {repoName}
                    {selected && <Check size={10} strokeWidth={3} />}
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}

        {/* Paper picker trigger */}
        <div className="flex flex-wrap items-center gap-3">
          <motion.button
            onClick={() => setShowPaperPicker((v) => !v)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              showPaperPicker
                ? 'border-notion-text bg-notion-text text-white'
                : 'border-notion-border text-notion-text hover:bg-notion-sidebar-hover',
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Lightbulb size={14} />
            Papers
            {selectedPaperIds.length > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-2xs',
                  showPaperPicker ? 'bg-white/20 text-white' : 'bg-notion-text text-white',
                )}
              >
                {selectedPaperIds.length}
              </motion.span>
            )}
          </motion.button>

          <AnimatePresence>
            {totalSelected > 0 && (
              <motion.button
                onClick={generateIdea}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-3 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {generating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {generating
                  ? 'Generating…'
                  : `Generate from ${totalSelected} source${totalSelected > 1 ? 's' : ''}`}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {generateError && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
          >
            {generateError}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Paper picker panel */}
      <AnimatePresence>
        {showPaperPicker && (
          <motion.div
            className="rounded-xl border border-notion-border"
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center gap-2 border-b border-notion-border px-4 py-2.5">
              <input
                autoFocus
                value={paperSearch}
                onChange={(e) => setPaperSearch(e.target.value)}
                placeholder="Search papers…"
                className="flex-1 bg-transparent text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none"
              />
              <span className="text-xs text-notion-text-tertiary">
                {selectedPaperIds.length} selected
              </span>
              <motion.button
                onClick={() => {
                  setShowPaperPicker(false);
                  setPaperSearch('');
                }}
                title="Close"
                className="text-notion-text-tertiary hover:text-notion-text"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
              >
                <X size={14} />
              </motion.button>
            </div>
            <ul className="notion-scrollbar max-h-64 overflow-y-auto">
              {filteredPapers.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-notion-text-tertiary">
                  {papers.length === 0 ? 'No papers in library' : 'No matching papers'}
                </li>
              ) : (
                filteredPapers.map((p, index) => (
                  <motion.li
                    key={p.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.01 }}
                    onClick={() => togglePaper(p.id)}
                    className={clsx(
                      'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-notion-sidebar-hover',
                      selectedPaperIds.includes(p.id) && 'bg-notion-tag-blue/30',
                    )}
                  >
                    <div
                      className={clsx(
                        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                        selectedPaperIds.includes(p.id)
                          ? 'border-notion-text bg-notion-text text-white'
                          : 'border-notion-border',
                      )}
                    >
                      {selectedPaperIds.includes(p.id) && <Check size={10} strokeWidth={3} />}
                    </div>
                    <span className="line-clamp-1 text-notion-text">{p.title}</span>
                  </motion.li>
                ))
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Existing ideas */}
      {project.ideas.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-8 text-center text-sm text-notion-text-tertiary"
        >
          No ideas yet — select papers or repos above and let AI synthesize a research idea
        </motion.p>
      ) : (
        <motion.div
          className="space-y-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {project.ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onDelete={() => deleteIdea(idea.id)}
                onUpdate={(data) => updateIdea(idea.id, data)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  onDelete,
  onUpdate,
}: {
  idea: ProjectIdea;
  onDelete: () => void;
  onUpdate: (data: { title?: string; content?: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [titleDraft, setTitleDraft] = useState(idea.title);
  const [contentDraft, setContentDraft] = useState(idea.content);

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== idea.title) onUpdate({ title: t });
    else setTitleDraft(idea.title);
    setEditingTitle(false);
  };

  const commitContent = () => {
    const c = contentDraft.trim();
    if (c && c !== idea.content) onUpdate({ content: c });
    else setContentDraft(idea.content);
    setEditingContent(false);
  };

  return (
    <motion.div
      className="rounded-xl border border-notion-border p-4"
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={{ borderColor: 'rgba(0, 0, 0, 0.15)' }}
    >
      <div className="flex items-start gap-3">
        <motion.div
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-notion-tag-yellow"
          whileHover={{ rotate: 10, scale: 1.1 }}
        >
          <Lightbulb size={14} className="text-yellow-700" />
        </motion.div>
        <div className="min-w-0 flex-1">
          {/* Title */}
          <div className="flex items-center gap-2">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') {
                    setTitleDraft(idea.title);
                    setEditingTitle(false);
                  }
                }}
                className="flex-1 rounded border border-notion-border bg-transparent px-2 py-0.5 text-sm font-semibold text-notion-text focus:outline-none focus:ring-1 focus:ring-notion-text/20"
              />
            ) : (
              <h4
                className="cursor-default text-sm font-semibold text-notion-text"
                onDoubleClick={() => setEditingTitle(true)}
                title="Double-click to edit title"
              >
                {idea.title}
              </h4>
            )}
            <span className="flex-shrink-0 text-2xs text-notion-text-tertiary">
              {timeAgo(idea.createdAt)}
            </span>
          </div>

          {/* Content */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 overflow-hidden"
              >
                {editingContent ? (
                  <textarea
                    autoFocus
                    value={contentDraft}
                    onChange={(e) => setContentDraft(e.target.value)}
                    onBlur={commitContent}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setContentDraft(idea.content);
                        setEditingContent(false);
                      }
                    }}
                    rows={6}
                    className="w-full rounded border border-notion-border bg-transparent px-2 py-1.5 text-sm text-notion-text-secondary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                ) : (
                  <p
                    className="cursor-default whitespace-pre-wrap text-sm text-notion-text-secondary"
                    onDoubleClick={() => setEditingContent(true)}
                    title="Double-click to edit"
                  >
                    {idea.content}
                  </p>
                )}
                {!editingContent && (
                  <button
                    onClick={() => setEditingContent(true)}
                    className="mt-1 text-xs text-notion-text-tertiary hover:text-notion-text"
                  >
                    Edit
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 flex items-center gap-1 text-xs text-notion-text-tertiary hover:text-notion-text"
            whileHover={{ x: 2 }}
          >
            <motion.div animate={{ rotate: expanded ? 90 : 0 }}>
              <ChevronRight size={11} />
            </motion.div>
            {expanded ? 'Collapse' : 'Expand'}
          </motion.button>
        </div>
        <motion.button
          onClick={onDelete}
          title="Delete idea"
          className="text-notion-text-tertiary hover:text-red-500"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <Trash2 size={14} />
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── ProjectDetail (internal component) ────────────────────────────────────────

function ProjectDetail({ project, onRefresh }: { project: ProjectItem; onRefresh: () => void }) {
  const [tab, setTab] = useState<Tab>('todos');
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [descDraft, setDescDraft] = useState(project.description ?? '');

  const commitName = async () => {
    const t = nameDraft.trim();
    if (t && t !== project.name) {
      await ipc.updateProject(project.id, { name: t });
      onRefresh();
    } else {
      setNameDraft(project.name);
    }
    setEditingName(false);
  };

  const commitDesc = async () => {
    const d = descDraft.trim();
    if (d !== (project.description ?? '')) {
      await ipc.updateProject(project.id, { description: d || undefined });
      onRefresh();
    } else {
      setDescDraft(project.description ?? '');
    }
    setEditingDesc(false);
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'todos', label: 'Todos', count: project.todos.filter((t) => !t.done).length },
    { id: 'code', label: 'Code', count: project.repos.length },
    { id: 'ideas', label: 'Ideas', count: project.ideas.length },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/projects"
          className="mb-3 inline-flex items-center gap-1 text-xs text-notion-text-tertiary hover:text-notion-text"
        >
          <ChevronRight size={12} className="rotate-180" />
          All projects
        </Link>

        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setNameDraft(project.name);
                setEditingName(false);
              }
            }}
            className="w-full rounded-lg border border-notion-border bg-transparent px-2 py-1 text-2xl font-bold text-notion-text focus:outline-none focus:ring-1 focus:ring-notion-text/20"
          />
        ) : (
          <h2
            className="cursor-default text-2xl font-bold text-notion-text"
            onDoubleClick={() => setEditingName(true)}
            title="Double-click to rename"
          >
            {project.name}
          </h2>
        )}

        {editingDesc ? (
          <input
            autoFocus
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDesc();
              if (e.key === 'Escape') {
                setDescDraft(project.description ?? '');
                setEditingDesc(false);
              }
            }}
            placeholder="Add a description…"
            className="mt-1 w-full rounded border border-notion-border bg-transparent px-2 py-0.5 text-sm text-notion-text-secondary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
          />
        ) : (
          <p
            className={clsx(
              'mt-1 cursor-default text-sm',
              project.description ? 'text-notion-text-secondary' : 'text-notion-text-tertiary',
            )}
            onDoubleClick={() => setEditingDesc(true)}
            title="Double-click to edit description"
          >
            {project.description ?? 'Add a description…'}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-notion-border">
        {tabs.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'relative flex items-center gap-1.5 px-3 pb-2.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'text-notion-text'
                : 'text-notion-text-secondary hover:text-notion-text',
            )}
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
          >
            {t.label}
            {t.count > 0 && (
              <motion.span
                key={t.count}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-2xs',
                  tab === t.id
                    ? 'bg-notion-text text-white'
                    : 'bg-notion-sidebar-hover text-notion-text-secondary',
                )}
              >
                {t.count}
              </motion.span>
            )}
            {tab === t.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-notion-text"
                transition={{ type: 'spring' as const, stiffness: 500, damping: 30 }}
              />
            )}
          </motion.button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'todos' && <TodoList project={project} onChange={onRefresh} />}
          {tab === 'code' && <CodeTab project={project} onChange={onRefresh} />}
          {tab === 'ideas' && <IdeasTab project={project} onChange={onRefresh} />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ── ProjectDetailPage (route-based) ───────────────────────────────────────────

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectItem | null>(null);
  const [loading, setLoading] = useState(true);
  const { updateTabLabel } = useTabs();

  const fetchProject = useCallback(async () => {
    if (!id) return;
    try {
      const projects = await ipc.listProjects();
      const p = projects.find((proj) => proj.id === id);
      setProject(p ?? null);
      // Update tab label with project name
      if (p) {
        updateTabLabel(`/projects/${id}`, p.name);
        ipc.touchProject(p.id).catch(() => undefined);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [id, updateTabLabel]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
          <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
        </motion.div>
      </div>
    );
  }

  if (!project) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center py-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <FolderKanban size={48} strokeWidth={1.2} className="mb-4 text-notion-border" />
        <p className="text-base text-notion-text-tertiary">Project not found</p>
        <Link to="/projects" className="mt-3 text-sm text-blue-500 hover:underline">
          Back to projects
        </Link>
      </motion.div>
    );
  }

  return <ProjectDetail project={project} onRefresh={fetchProject} />;
}

// ── ProjectsPage (list view) ──────────────────────────────────────────────────

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();
  const { openTab } = useTabs();

  const fetchProjects = useCallback(async () => {
    try {
      const data = await ipc.listProjects();
      setProjects(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const p = await ipc.createProject({ name, description: newDesc.trim() || undefined });
    setNewName('');
    setNewDesc('');
    setShowForm(false);
    setCreating(false);
    await fetchProjects();
    // Open the new project in a tab
    openTab(`/projects/${p.id}`);
  };

  const deleteProject = async (id: string) => {
    await ipc.deleteProject(id);
    fetchProjects();
  };

  const handleProjectClick = (id: string) => {
    openTab(`/projects/${id}`);
  };

  return (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
            <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
          </motion.div>
        </div>
      ) : (
        <>
          {/* Header */}
          <motion.div
            className="mb-6 flex items-center gap-4"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex-1">
              <h1 className="text-3xl font-bold tracking-tight text-notion-text">Projects</h1>
              <p className="mt-1 text-sm text-notion-text-secondary">
                Manage your research projects, todos, code repos, and paper-linked ideas
              </p>
            </div>
            <motion.button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Plus size={16} />
              New project
            </motion.button>
          </motion.div>

          {/* Create form */}
          <AnimatePresence>
            {showForm && (
              <motion.div
                className="mb-6 rounded-xl border border-notion-border p-4"
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <h3 className="mb-3 text-sm font-semibold text-notion-text">New project</h3>
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createProject()}
                    placeholder="Project name"
                    className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                  <input
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                  <div className="flex gap-2 pt-1">
                    <motion.button
                      onClick={createProject}
                      disabled={creating || !newName.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-1.5 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {creating ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Plus size={13} />
                      )}
                      Create
                    </motion.button>
                    <motion.button
                      onClick={() => {
                        setShowForm(false);
                        setNewName('');
                        setNewDesc('');
                      }}
                      className="rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text-secondary hover:bg-notion-sidebar-hover"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Cancel
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Project list */}
          {projects.length === 0 ? (
            <motion.div
              className="rounded-xl border border-dashed border-notion-border py-20 text-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <FolderKanban
                size={48}
                strokeWidth={1.2}
                className="mx-auto mb-4 text-notion-border"
              />
              <p className="text-base text-notion-text-tertiary">No projects yet</p>
              <p className="mt-1 text-sm text-notion-text-tertiary">
                Create a project to track todos, repos, and paper-linked ideas
              </p>
            </motion.div>
          ) : (
            <motion.div
              className="space-y-2"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <AnimatePresence mode="popLayout">
                {projects.map((p) => (
                  <motion.div
                    key={p.id}
                    variants={itemVariants}
                    layout
                    onClick={() => handleProjectClick(p.id)}
                    className="group flex cursor-pointer items-center gap-4 rounded-xl border border-notion-border px-4 py-3.5"
                    {...cardHoverVariants}
                    whileHover="hover"
                  >
                    <motion.div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-notion-tag-blue"
                      whileHover={{ rotate: 5, scale: 1.05 }}
                    >
                      <FolderKanban size={18} className="text-blue-600" />
                    </motion.div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-notion-text">{p.name}</p>
                      {p.description && (
                        <p className="mt-0.5 truncate text-xs text-notion-text-tertiary">
                          {p.description}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-xs text-notion-text-tertiary">
                        <span>{p.todos.filter((t) => !t.done).length} open todos</span>
                        <span>{p.repos.length} repos</span>
                        <span>{p.ideas.length} ideas</span>
                      </div>
                    </div>
                    <motion.button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(p.id);
                      }}
                      title="Delete project"
                      className="invisible text-notion-text-tertiary hover:text-red-500 group-hover:visible"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Trash2 size={15} />
                    </motion.button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </>
      )}
    </>
  );
}
