import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ipc,
  onIpc,
  type ProjectItem,
  type ProjectRepo,
  type ProjectIdea,
  type CommitInfo,
  type WorkdirRepoStatus,
} from '../../hooks/use-ipc';
import type { AgentTodoItem } from '@shared';
import { useTabs } from '../../hooks/use-tabs';
import {
  FolderKanban,
  Plus,
  Trash2,
  GitCommit,
  GitBranch,
  Lightbulb,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Check,
  X,
  FolderOpen,
  Pencil,
} from 'lucide-react';
import clsx from 'clsx';
import { CwdPicker } from '../../components/agent-todo/CwdPicker';
import { TodoForm } from '../../components/agent-todo/TodoForm';
import { TodoCard } from '../../components/agent-todo/TodoCard';
import { IdeaChatModal } from '../../components/ideas/IdeaChatModal';

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

type Tab = 'tasks' | 'code' | 'ideas';

// ── TaskList ─────────────────────────────────────────────────────────────────

function TaskList({ project }: { project: ProjectItem }) {
  const [showForm, setShowForm] = useState(false);
  const [tasks, setTasks] = useState<AgentTodoItem[]>([]);

  const loadTasks = useCallback(async () => {
    try {
      const data = await ipc.listAgentTodos({ projectId: project.id });
      setTasks(data);
    } catch {
      // silent
    }
  }, [project.id]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const off = onIpc('agent-todo:status', () => {
      loadTasks();
    });
    return off;
  }, [loadTasks]);

  return (
    <div className="space-y-3">
      {/* Add Task button */}
      <motion.div
        className="flex gap-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <motion.button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-2 text-sm font-medium text-white hover:opacity-80"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus size={14} />
          Add Task
        </motion.button>
      </motion.div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-4 text-center text-sm text-notion-text-tertiary"
        >
          No tasks yet. Click "Add Task" to create one.
        </motion.p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TodoCard
              key={task.id}
              todo={task}
              onRefresh={loadTasks}
              from={`/projects/${project.id}`}
            />
          ))}
        </div>
      )}

      {/* Task Form Modal */}
      <TodoForm
        key={showForm ? 'open' : 'closed'}
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={loadTasks}
        projectId={project.id}
        initialValues={{ cwd: project.workdir ?? '' }}
      />
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

  const isWorkdir = repo.isWorkdirRepo;

  const handleClone = async () => {
    if (isWorkdir) return; // Should not happen, but safety check
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

  // For workdir repos, use the repo name from URL or folder name from local path
  const displayName = isWorkdir
    ? repo.repoUrl.startsWith('local://')
      ? repo.localPath?.split('/').pop() || 'local'
      : repo.repoUrl
          .replace(/\.git$/, '')
          .split('/')
          .slice(-2)
          .join('/')
    : repo.repoUrl
        .replace(/\.git$/, '')
        .split('/')
        .slice(-2)
        .join('/');

  // For workdir repos without remote, show local path
  const displayUrl = isWorkdir
    ? repo.repoUrl.startsWith('local://')
      ? repo.localPath
      : repo.repoUrl
    : repo.repoUrl;

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
          {isWorkdir ? (
            <FolderOpen size={16} className="flex-shrink-0 text-notion-accent" />
          ) : (
            <GitBranch size={16} className="flex-shrink-0 text-notion-text-tertiary" />
          )}
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-notion-text">{displayName}</p>
            {isWorkdir && (
              <span className="inline-flex items-center rounded bg-notion-accent-light px-1.5 py-0.5 text-[10px] font-medium text-notion-accent">
                local
              </span>
            )}
          </div>
          <p className="truncate text-xs text-notion-text-tertiary">{displayUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only show Clone button for non-workdir repos without localPath */}
          {!isWorkdir && !repo.localPath && (
            <motion.button
              onClick={handleClone}
              disabled={cloning}
              className="inline-flex items-center gap-1 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text hover:bg-notion-sidebar-hover disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {cloning ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
              Clone
            </motion.button>
          )}
          {/* Show Commits button for all repos with localPath (including workdir) */}
          {repo.localPath && (
            <motion.button
              onClick={toggleExpand}
              className="inline-flex items-center gap-1 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text hover:bg-notion-sidebar-hover"
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

  const hasWorkdirRepo = project.repos.some((repo) => repo.isWorkdirRepo);

  // Auto-add workdir as repo if .git detected
  useEffect(() => {
    let alive = true;
    if (project.workdir && !hasWorkdirRepo) {
      ipc.checkWorkdirGit(project.id).then((status) => {
        if (alive && status?.hasGit) {
          ipc.addWorkdirRepo(project.id).then(() => {
            if (alive) onChange();
          });
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [project.id, project.workdir, hasWorkdirRepo, onChange]);

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
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addRepo()}
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
  const [showChatModal, setShowChatModal] = useState(false);

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

          <motion.button
            onClick={() => setShowChatModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-notion-border px-3 py-2 text-sm font-medium text-notion-text hover:bg-notion-sidebar-hover transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <MessageSquare size={14} />
            Discuss &amp; Generate
          </motion.button>
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

      <IdeaChatModal
        isOpen={showChatModal}
        onClose={() => setShowChatModal(false)}
        projectId={project.id}
        projectWorkdir={project.workdir}
        paperIds={selectedPaperIds}
        repoIds={selectedRepoIds}
        onTaskCreated={() => {
          /* task created */
        }}
      />
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
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitTitle();
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
  const [tab, setTab] = useState<Tab>('tasks');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? '');
  const [editWorkdir, setEditWorkdir] = useState(project.workdir ?? '');
  const [saving, setSaving] = useState(false);

  const openEditModal = () => {
    setEditName(project.name);
    setEditDesc(project.description ?? '');
    setEditWorkdir(project.workdir ?? '');
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await ipc.updateProject(project.id, {
        name,
        description: editDesc.trim() || undefined,
        workdir: editWorkdir.trim() || undefined,
      });
      onRefresh();
      setShowEditModal(false);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: Tab; label: string; count: number; icon: React.ElementType }[] = [
    { id: 'tasks', label: 'Tasks', count: 0, icon: FolderKanban },
    { id: 'code', label: 'Code', count: project.repos.length, icon: GitBranch },
    { id: 'ideas', label: 'Ideas', count: project.ideas.length, icon: Lightbulb },
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

        <div className="flex items-start gap-2">
          <h2 className="text-2xl font-bold text-notion-text">{project.name}</h2>
          <button
            onClick={openEditModal}
            className="mt-1 rounded p-1 text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text"
            title="Edit project"
          >
            <Pencil size={14} />
          </button>
        </div>

        <p
          className={clsx(
            'mt-1 text-sm',
            project.description ? 'text-notion-text-secondary' : 'text-notion-text-tertiary',
          )}
        >
          {project.description ?? 'No description'}
        </p>

        {project.workdir && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-notion-text-secondary">
            <FolderOpen size={12} />
            <span className="font-mono">{project.workdir}</span>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            >
              <h3 className="mb-4 text-lg font-semibold text-notion-text">Edit Project</h3>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-notion-text">
                    Name <span className="text-notion-red">*</span>
                  </label>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Project name"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-notion-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-notion-text">
                    Description
                  </label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Optional description"
                    rows={2}
                    className="w-full resize-none rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-notion-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-notion-text">
                    Working Directory
                  </label>
                  <CwdPicker value={editWorkdir} onChange={setEditWorkdir} />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editName.trim() || saving}
                  className="flex items-center gap-1.5 rounded-lg bg-notion-accent px-4 py-2 text-sm font-medium text-white hover:bg-notion-accent/90 disabled:opacity-50"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-notion-border">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          return (
            <motion.button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'relative flex items-center gap-2 px-4 pb-2.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'text-notion-text'
                  : 'text-notion-text-secondary hover:text-notion-text',
              )}
              whileHover={{ y: -1 }}
              whileTap={{ y: 0 }}
            >
              <TabIcon size={15} />
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
          );
        })}
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
          {tab === 'tasks' && <TaskList project={project} />}
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
  const [newWorkdir, setNewWorkdir] = useState('');
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
    try {
      const p = await ipc.createProject({
        name,
        description: newDesc.trim() || undefined,
        workdir: newWorkdir.trim() || undefined,
      });
      setNewName('');
      setNewDesc('');
      setNewWorkdir('');
      setShowForm(false);
      await fetchProjects();
      // Open the new project in a tab
      openTab(`/projects/${p.id}`);
    } catch (e) {
      console.error('[createProject] failed:', e);
    } finally {
      setCreating(false);
    }
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
                Manage your research projects, tasks, code repos, and paper-linked ideas
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
                    onKeyDown={(e) =>
                      e.key === 'Enter' && !e.nativeEvent.isComposing && createProject()
                    }
                    placeholder="Project name"
                    className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                  <input
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                  <div>
                    <label className="mb-1 block text-xs text-notion-text-tertiary">
                      Working Directory (optional — default cwd for Agent Tasks)
                    </label>
                    <CwdPicker value={newWorkdir} onChange={setNewWorkdir} />
                  </div>
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
                        setNewWorkdir('');
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
