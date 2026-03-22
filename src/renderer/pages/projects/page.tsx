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
  type ProjectPaperItem,
  type PaperItem,
} from '../../hooks/use-ipc';
import type { AgentConfigItem, AgentTodoItem, TagCategory } from '@shared';
import { CATEGORY_COLORS, cleanArxivTitle } from '@shared';
import { useTabs } from '../../hooks/use-tabs';
import { useTranslation } from 'react-i18next';
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
  Send,
  FileText,
  Code2,
  Server,
  FileSpreadsheet,
  BookOpen,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import { CwdPicker } from '../../components/agent-todo/CwdPicker';
import { TodoForm } from '../../components/agent-todo/TodoForm';
import { TodoCard } from '../../components/agent-todo/TodoCard';
import { AgentSelector } from '../../components/agent-todo/AgentSelector';
import { RemoteAgentSelector } from '../../components/projects/RemoteAgentSelector';
import { RemoteCwdPicker, type RemoteSshConfig } from '../../components/projects/RemoteCwdPicker';
import { ReportsTab } from '../../components/project/ReportsTab';

// ── Helper component for remote workdir picker ────────────────────────────────

function RemoteWorkdirField({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string;
  onChange: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [agentConfig, setAgentConfig] = useState<RemoteSshConfig | null>(null);

  useEffect(() => {
    ipc.listAgents().then((agents) => {
      const agent = agents.find((a) => a.id === agentId) as AgentConfigItem | undefined;
      if (agent && (agent as any).isRemote) {
        setAgentConfig({
          label: agent.name,
          host: (agent as any).sshHost ?? '',
          port: (agent as any).sshPort ?? 22,
          username: (agent as any).sshUsername ?? '',
          authMethod: (agent as any).sshAuthMethod ?? 'privateKey',
          privateKeyPath: (agent as any).sshPrivateKeyPath ?? undefined,
          defaultCwd: null,
        });
      }
    });
  }, [agentId]);

  if (!agentConfig) {
    return (
      <div className="flex items-center gap-2 text-xs text-notion-text-tertiary">
        <Loader2 size={12} className="animate-spin" />
        {t('projectsPage.loadingAgent')}
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-notion-text-tertiary">
        {t('projectsPage.remoteWorkingDir')}
      </label>
      <RemoteCwdPicker server={agentConfig} value={value} onChange={onChange} />
    </div>
  );
}

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

type Tab = 'tasks' | 'code' | 'ideas' | 'reports' | 'related-works';

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
        initialValues={{
          cwd: project.sshServerId ? (project.remoteWorkdir ?? '') : (project.workdir ?? ''),
        }}
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
  const [workdirHasGit, setWorkdirHasGit] = useState<boolean | null>(null);
  const [initingGit, setInitingGit] = useState(false);
  const [initGitError, setInitGitError] = useState<string | null>(null);

  const hasWorkdirRepo = project.repos.some((repo) => repo.isWorkdirRepo);

  // Check workdir git status and auto-add if .git detected
  useEffect(() => {
    let alive = true;
    if (project.workdir && !hasWorkdirRepo) {
      ipc.checkWorkdirGit(project.id).then((status) => {
        if (!alive) return;
        if (status?.hasGit) {
          setWorkdirHasGit(true);
          ipc.addWorkdirRepo(project.id).then(() => {
            if (alive) onChange();
          });
        } else {
          setWorkdirHasGit(false);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [project.id, project.workdir, hasWorkdirRepo, onChange]);

  const handleInitGit = async () => {
    setInitingGit(true);
    setInitGitError(null);
    const result = await ipc.initWorkdirGit(project.id);
    setInitingGit(false);
    if (!result.success) {
      setInitGitError(result.error ?? 'git init failed');
    } else {
      setWorkdirHasGit(true);
      // Auto-add the newly initialized repo
      await ipc.addWorkdirRepo(project.id);
      onChange();
    }
  };

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
      {initGitError && <p className="text-xs text-red-500">{initGitError}</p>}

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

      {/* git init card: shown when workdir exists but has no git */}
      <AnimatePresence>
        {project.workdir && !hasWorkdirRepo && workdirHasGit === false && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-notion-border py-10"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-notion-sidebar">
              <GitBranch size={20} className="text-notion-text-tertiary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-notion-text">No git repository found</p>
              <p className="mt-0.5 text-xs text-notion-text-tertiary">
                {project.workdir} is not a git repo
              </p>
            </div>
            <motion.button
              onClick={handleInitGit}
              disabled={initingGit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text shadow-sm hover:bg-notion-sidebar-hover disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {initingGit ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitBranch size={14} />
              )}
              git init
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {project.repos.length === 0 &&
      !(project.workdir && !hasWorkdirRepo && workdirHasGit === false) ? (
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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function IdeasTab({ project, onChange }: { project: ProjectItem; onChange: () => void }) {
  const { t } = useTranslation();
  const [papers, setPapers] = useState<{ id: string; shortId: string; title: string }[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);

  // Dropdown open states
  const [showPaperDropdown, setShowPaperDropdown] = useState(false);
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [paperSearch, setPaperSearch] = useState('');

  // Inline chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  const sessionId = useRef(`idea-chat-${Date.now()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paperDropdownRef = useRef<HTMLDivElement>(null);
  const repoDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipc.listPapers().then(setPapers);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // IPC streaming events
  useEffect(() => {
    const unsubOutput = onIpc('idea-chat:output', (...args) => {
      const chunk = args[1] as string;
      setStreamingContent((prev) => prev + chunk);
    });
    const unsubDone = onIpc('idea-chat:done', () => {
      setStreamingContent((prev) => {
        if (prev) setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
        return '';
      });
      setStreaming(false);
    });
    const unsubError = onIpc('idea-chat:error', () => {
      setStreamingContent((prev) => {
        if (prev) setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
        return '';
      });
      setStreaming(false);
    });
    return () => {
      unsubOutput();
      unsubDone();
      unsubError();
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (paperDropdownRef.current && !paperDropdownRef.current.contains(e.target as Node)) {
        setShowPaperDropdown(false);
        setPaperSearch('');
      }
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setShowRepoDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  const clonedRepos = project.repos.filter((r) => r.localPath);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setStreamingContent('');
    try {
      await ipc.startIdeaChat({
        sessionId: sessionId.current,
        projectId: project.id,
        paperIds: selectedPaperIds,
        repoIds: selectedRepoIds,
        messages: newMessages,
      });
    } catch (err) {
      setStreaming(false);
      setStreamingContent('');
      setMessages((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }, [input, streaming, messages, project.id, selectedPaperIds, selectedRepoIds]);

  const selectedPapers = papers.filter((p) => selectedPaperIds.includes(p.id));
  const selectedRepos = clonedRepos.filter((r) => selectedRepoIds.includes(r.id));

  return (
    <div className="flex flex-col gap-4">
      {/* ── Toolbar row: Papers | Repos | Generate Task ── */}
      <motion.div
        className="flex items-center gap-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Papers dropdown */}
        <div className="relative" ref={paperDropdownRef}>
          <button
            onClick={() => {
              setShowPaperDropdown((v) => !v);
              setShowRepoDropdown(false);
            }}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              showPaperDropdown
                ? 'border-notion-text bg-notion-text text-white'
                : 'border-notion-border text-notion-text hover:bg-notion-sidebar-hover',
            )}
          >
            <FileText size={14} />
            Related Papers
            {selectedPaperIds.length > 0 && (
              <span
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-2xs',
                  showPaperDropdown ? 'bg-white/20 text-white' : 'bg-notion-text text-white',
                )}
              >
                {selectedPaperIds.length}
              </span>
            )}
            <ChevronDown
              size={12}
              className={clsx('transition-transform', showPaperDropdown && 'rotate-180')}
            />
          </button>

          <AnimatePresence>
            {showPaperDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-notion-border bg-white shadow-lg"
              >
                <div className="flex items-center gap-2 border-b border-notion-border px-3 py-2">
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
                </div>
                <ul className="notion-scrollbar max-h-56 overflow-y-auto py-1">
                  {filteredPapers.length === 0 ? (
                    <li className="px-3 py-4 text-center text-sm text-notion-text-tertiary">
                      {papers.length === 0
                        ? t('projectsPage.noPapersInLibrary')
                        : t('projectsPage.noMatchingPapers')}
                    </li>
                  ) : (
                    filteredPapers.map((p) => (
                      <li
                        key={p.id}
                        onClick={() => togglePaper(p.id)}
                        className={clsx(
                          'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-notion-sidebar-hover',
                          selectedPaperIds.includes(p.id) && 'bg-notion-tag-blue/20',
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
                      </li>
                    ))
                  )}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Repos dropdown */}
        <div className="relative" ref={repoDropdownRef}>
          <button
            onClick={() => {
              setShowRepoDropdown((v) => !v);
              setShowPaperDropdown(false);
            }}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              showRepoDropdown
                ? 'border-notion-text bg-notion-text text-white'
                : 'border-notion-border text-notion-text hover:bg-notion-sidebar-hover',
              clonedRepos.length === 0 && 'opacity-40 cursor-not-allowed',
            )}
            disabled={clonedRepos.length === 0}
          >
            <Code2 size={14} />
            Repos
            {selectedRepoIds.length > 0 && (
              <span
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-2xs',
                  showRepoDropdown ? 'bg-white/20 text-white' : 'bg-notion-text text-white',
                )}
              >
                {selectedRepoIds.length}
              </span>
            )}
            <ChevronDown
              size={12}
              className={clsx('transition-transform', showRepoDropdown && 'rotate-180')}
            />
          </button>

          <AnimatePresence>
            {showRepoDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-notion-border bg-white shadow-lg"
              >
                <ul className="notion-scrollbar max-h-48 overflow-y-auto py-1">
                  {clonedRepos.map((repo) => {
                    const repoName = repo.repoUrl
                      .replace(/\.git$/, '')
                      .split('/')
                      .slice(-2)
                      .join('/');
                    return (
                      <li
                        key={repo.id}
                        onClick={() => toggleRepo(repo.id)}
                        className={clsx(
                          'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-notion-sidebar-hover',
                          selectedRepoIds.includes(repo.id) && 'bg-notion-tag-blue/20',
                        )}
                      >
                        <div
                          className={clsx(
                            'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                            selectedRepoIds.includes(repo.id)
                              ? 'border-notion-text bg-notion-text text-white'
                              : 'border-notion-border',
                          )}
                        >
                          {selectedRepoIds.includes(repo.id) && <Check size={10} strokeWidth={3} />}
                        </div>
                        <GitBranch size={12} className="flex-shrink-0 text-notion-text-tertiary" />
                        <span className="line-clamp-1 text-notion-text">{repoName}</span>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Selected chips */}
      <AnimatePresence>
        {(selectedPapers.length > 0 || selectedRepos.length > 0) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-1.5"
          >
            {selectedPapers.map((p) => (
              <motion.span
                key={p.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="inline-flex items-center gap-1 rounded-full bg-notion-tag-blue px-2.5 py-1 text-xs text-notion-text"
              >
                <FileText size={10} />
                <span className="max-w-[160px] truncate">{p.title}</span>
                <button
                  onClick={() => togglePaper(p.id)}
                  className="ml-0.5 rounded-full hover:bg-black/10"
                >
                  <X size={10} />
                </button>
              </motion.span>
            ))}
            {selectedRepos.map((r) => {
              const name = r.repoUrl
                .replace(/\.git$/, '')
                .split('/')
                .slice(-2)
                .join('/');
              return (
                <motion.span
                  key={r.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="inline-flex items-center gap-1 rounded-full bg-notion-tag-green px-2.5 py-1 text-xs text-notion-text"
                >
                  <GitBranch size={10} />
                  <span className="max-w-[140px] truncate">{name}</span>
                  <button
                    onClick={() => toggleRepo(r.id)}
                    className="ml-0.5 rounded-full hover:bg-black/10"
                  >
                    <X size={10} />
                  </button>
                </motion.span>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Inline Chat ── */}
      <motion.div
        className="flex flex-col rounded-xl border border-notion-border bg-white overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        style={{ minHeight: '320px' }}
      >
        {/* Messages area */}
        <div
          className="notion-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-3"
          style={{ minHeight: '220px', maxHeight: '480px' }}
        >
          {messages.length === 0 && !streaming ? (
            <div className="flex h-full min-h-[180px] items-center justify-center">
              <div className="text-center">
                <MessageSquare size={28} className="mx-auto mb-2 text-notion-text-tertiary/30" />
                <p className="text-sm text-notion-text-tertiary">Chat about your research ideas</p>
                {selectedPaperIds.length + selectedRepoIds.length > 0 && (
                  <p className="mt-1 text-xs text-notion-text-tertiary">
                    {selectedPaperIds.length + selectedRepoIds.length} source
                    {selectedPaperIds.length + selectedRepoIds.length > 1 ? 's' : ''} selected as
                    context
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={clsx(
                      'max-w-[82%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-notion-accent-light text-notion-text'
                        : 'bg-notion-sidebar text-notion-text',
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {streaming && (
                <div className="flex justify-start">
                  <div className="max-w-[82%] rounded-xl bg-notion-sidebar px-3.5 py-2.5 text-sm leading-relaxed text-notion-text">
                    {streamingContent ? (
                      <p className="whitespace-pre-wrap">{streamingContent}</p>
                    ) : (
                      <span className="flex items-center gap-2 text-notion-text-tertiary">
                        <Loader2 size={12} className="animate-spin" />
                        Thinking…
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-notion-border px-3 py-3">
          <div className="relative rounded-xl border border-notion-border bg-white focus-within:border-notion-text/30 focus-within:shadow-sm transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask about research ideas…"
              rows={1}
              disabled={streaming}
              className="w-full resize-none bg-transparent px-3.5 py-2.5 pr-11 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-50"
              style={{ minHeight: '42px', maxHeight: '160px' }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || streaming}
              className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-notion-text text-white transition-all hover:opacity-80 disabled:opacity-30 disabled:bg-gray-200 disabled:text-gray-400"
            >
              {streaming ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── RelatedWorksTab ───────────────────────────────────────────────────────────

function RelatedWorksTab({ project }: { project: ProjectItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [papers, setPapers] = useState<ProjectPaperItem[]>([]);
  const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadPapers = useCallback(async () => {
    try {
      const result = await ipc.listProjectPapers(project.id);
      setPapers(result);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadPapers();
  }, [loadPapers]);

  useEffect(() => {
    if (!showAddModal) return;
    ipc
      .listPapers()
      .then(setAllPapers)
      .catch(() => {});
  }, [showAddModal]);

  const addedPaperIds = new Set(papers.map((p) => p.id));

  const filteredPapers = searchQuery.trim()
    ? allPapers.filter(
        (p) =>
          !addedPaperIds.has(p.id) && p.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : allPapers.filter((p) => !addedPaperIds.has(p.id));

  const handleAdd = async (paperId: string) => {
    setAdding(paperId);
    try {
      await ipc.addPaperToProject(project.id, paperId);
      await loadPapers();
    } catch {
      // silent
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (paperId: string) => {
    setRemoving(paperId);
    try {
      await ipc.removePaperFromProject(project.id, paperId);
      setPapers((prev) => prev.filter((p) => p.id !== paperId));
    } catch {
      // silent
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-notion-text">Related Works</span>
          {papers.length > 0 && (
            <span className="rounded-full bg-notion-sidebar-hover px-2 py-0.5 text-xs text-notion-text-secondary">
              {papers.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs text-notion-text-tertiary opacity-40 cursor-not-allowed"
            title="Coming soon"
          >
            <Sparkles size={12} />
            Generate Related Works
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-1.5 text-xs font-medium text-white hover:opacity-80"
          >
            <Plus size={12} />
            Add Papers
          </button>
        </div>
      </div>

      {/* Paper list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-notion-text-tertiary" />
        </div>
      ) : papers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-notion-border py-12">
          <BookOpen size={32} strokeWidth={1.2} className="mb-3 text-notion-border" />
          <p className="text-sm text-notion-text-tertiary">No related works yet</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-3 text-xs text-notion-accent hover:underline"
          >
            Add papers from your library
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-notion-border bg-white overflow-hidden">
          {papers.map((paper) => {
            const visibleTags = (paper.categorizedTags ?? [])
              .filter((t) => !['arxiv', 'chrome', 'manual', 'pdf'].includes(t.name.toLowerCase()))
              .slice(0, 3);
            const authorsSnippet = paper.authors?.slice(0, 2).join(', ');
            const hasMoreAuthors = paper.authors && paper.authors.length > 2;
            return (
              <div
                key={paper.id}
                className="group flex items-center gap-4 border-b border-notion-border px-4 py-3.5 last:border-b-0 hover:bg-slate-50/60 transition-colors duration-150"
              >
                {/* Icon */}
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                  <FileText size={16} className="text-blue-500" />
                </div>

                {/* Clickable content area */}
                <button
                  onClick={() => navigate(`/papers/${paper.shortId}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold text-notion-text">
                    {cleanArxivTitle(paper.title)}
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {paper.submittedAt && (
                      <span className="text-xs text-notion-text-tertiary">
                        {new Date(paper.submittedAt).getUTCFullYear()}
                      </span>
                    )}
                    {authorsSnippet && (
                      <span className="text-xs text-notion-text-tertiary">
                        {authorsSnippet}
                        {hasMoreAuthors ? ' et al.' : ''}
                      </span>
                    )}
                  </div>
                  {visibleTags.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {visibleTags.map((tag) => {
                        const colors =
                          CATEGORY_COLORS[tag.category as TagCategory] || CATEGORY_COLORS.topic;
                        return (
                          <span
                            key={tag.name}
                            className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
                          >
                            {tag.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </button>

                {/* Remove button — visible on hover */}
                <button
                  onClick={() => void handleRemove(paper.id)}
                  disabled={removing === paper.id}
                  className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                  title="Remove from project"
                >
                  {removing === paper.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <X size={13} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Papers Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-lg rounded-xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-notion-border px-5 py-3.5">
                <h3 className="text-sm font-semibold text-notion-text">Add Papers</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-notion-text-tertiary hover:text-notion-text"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-5 pt-4 pb-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
                  />
                  <input
                    autoFocus
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search papers..."
                    className="w-full rounded-lg border border-notion-border bg-notion-sidebar pl-9 pr-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-accent/30"
                  />
                </div>
              </div>

              <div className="notion-scrollbar max-h-80 overflow-y-auto px-5 pb-5">
                {filteredPapers.length === 0 ? (
                  <p className="py-6 text-center text-sm text-notion-text-tertiary">
                    {searchQuery
                      ? t('projectsPage.noSearchMatch')
                      : t('projectsPage.allPapersAdded')}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredPapers.map((paper) => (
                      <div
                        key={paper.id}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-notion-sidebar"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-notion-text line-clamp-1">{paper.title}</p>
                          {paper.submittedAt && (
                            <p className="text-xs text-notion-text-tertiary">
                              {new Date(paper.submittedAt).getFullYear()}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => void handleAdd(paper.id)}
                          disabled={adding === paper.id}
                          className="flex-shrink-0 rounded-lg border border-notion-border px-2.5 py-1 text-xs text-notion-text-secondary hover:bg-notion-accent hover:text-white hover:border-notion-accent transition-colors disabled:opacity-40"
                        >
                          {adding === paper.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            'Add'
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── ProjectDetail (internal component) ────────────────────────────────────────

function ProjectDetail({ project, onRefresh }: { project: ProjectItem; onRefresh: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('related-works');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? '');
  const [editWorkdir, setEditWorkdir] = useState(project.workdir ?? '');
  // sshServerId is repurposed to store the remote agent ID
  const [editAgentId, setEditAgentId] = useState<string | undefined>(
    project.sshServerId ?? undefined,
  );
  const [editRemoteWorkdir, setEditRemoteWorkdir] = useState(project.remoteWorkdir ?? '');
  const [saving, setSaving] = useState(false);
  const [remoteAgent, setRemoteAgent] = useState<AgentConfigItem | null>(null);

  // Load remote agent info for display
  useEffect(() => {
    if (project.sshServerId) {
      ipc.listAgents().then((agents) => {
        const agent = agents.find((a) => a.id === project.sshServerId) ?? null;
        setRemoteAgent(agent);
      });
    } else {
      setRemoteAgent(null);
    }
  }, [project.sshServerId]);

  const openEditModal = () => {
    setEditName(project.name);
    setEditDesc(project.description ?? '');
    setEditWorkdir(project.workdir ?? '');
    setEditAgentId(project.sshServerId ?? undefined);
    setEditRemoteWorkdir(project.remoteWorkdir ?? '');
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
        sshServerId: editAgentId,
        remoteWorkdir: editRemoteWorkdir.trim() || undefined,
      });
      onRefresh();
      setShowEditModal(false);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: Tab; label: string; count: number; icon: React.ElementType }[] = [
    { id: 'related-works', label: 'Related Works', count: 0, icon: BookOpen },
    { id: 'ideas', label: 'Ideas', count: project.ideas.length, icon: Lightbulb },
    { id: 'tasks', label: 'Tasks', count: 0, icon: FolderKanban },
    { id: 'code', label: 'Code', count: project.repos.length, icon: GitBranch },
    { id: 'reports', label: 'Reports', count: 0, icon: FileSpreadsheet },
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

        {/* Workdir and SSH info */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {project.workdir && (
            <div className="flex items-center gap-1.5 text-notion-text-secondary">
              <FolderOpen size={12} />
              <span className="font-mono">{project.workdir}</span>
            </div>
          )}
          {remoteAgent && (
            <div className="flex items-center gap-1.5 rounded-full bg-purple-50 px-2 py-0.5 text-purple-700">
              <Server size={10} />
              <span>{remoteAgent.name}</span>
              {project.remoteWorkdir && (
                <span className="font-mono text-purple-600">:{project.remoteWorkdir}</span>
              )}
            </div>
          )}
        </div>
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
                    placeholder={t('projects.projectNamePlaceholder')}
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

                <div className="border-t border-notion-border pt-4">
                  <label className="mb-1 block text-sm font-medium text-notion-text">
                    Remote Agent
                  </label>
                  <RemoteAgentSelector
                    value={editAgentId}
                    onChange={(id) => {
                      setEditAgentId(id);
                      if (!id) setEditRemoteWorkdir('');
                    }}
                  />
                </div>

                {editAgentId && (
                  <RemoteWorkdirField
                    agentId={editAgentId}
                    value={editRemoteWorkdir}
                    onChange={setEditRemoteWorkdir}
                  />
                )}
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
          {tab === 'reports' && <ReportsTab project={project} />}
          {tab === 'related-works' && <RelatedWorksTab project={project} />}
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
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newWorkdir, setNewWorkdir] = useState('');
  const [newAgentId, setNewAgentId] = useState<string | undefined>(undefined);
  const [newRemoteWorkdir, setNewRemoteWorkdir] = useState('');
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
        sshServerId: newAgentId,
        remoteWorkdir: newRemoteWorkdir.trim() || undefined,
      });
      setNewName('');
      setNewDesc('');
      setNewWorkdir('');
      setNewAgentId(undefined);
      setNewRemoteWorkdir('');
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
              <h1 className="text-3xl font-bold tracking-tight text-notion-text">
                {t('projects.title')}
              </h1>
              <p className="mt-1 text-sm text-notion-text-secondary">{t('projects.description')}</p>
            </div>
            <motion.button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Plus size={16} />
              {t('projects.newProject')}
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
                <h3 className="mb-3 text-sm font-semibold text-notion-text">
                  {t('projects.createFormTitle')}
                </h3>
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && !e.nativeEvent.isComposing && createProject()
                    }
                    placeholder={t('projects.projectNamePlaceholder')}
                    className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                  <input
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder={t('projects.descriptionPlaceholder')}
                    className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                  />
                  <div>
                    <label className="mb-1 block text-xs text-notion-text-tertiary">
                      {t('projects.workingDirLabel')}
                    </label>
                    <CwdPicker value={newWorkdir} onChange={setNewWorkdir} />
                  </div>
                  <div className="border-t border-notion-border pt-2">
                    <label className="mb-1 block text-xs text-notion-text-tertiary">
                      {t('projects.remoteAgentLabel')}
                    </label>
                    <RemoteAgentSelector
                      value={newAgentId}
                      onChange={(id) => {
                        setNewAgentId(id);
                        if (!id) setNewRemoteWorkdir('');
                      }}
                    />
                  </div>
                  {newAgentId && (
                    <RemoteWorkdirField
                      agentId={newAgentId}
                      value={newRemoteWorkdir}
                      onChange={setNewRemoteWorkdir}
                    />
                  )}
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
                      {t('projects.create')}
                    </motion.button>
                    <motion.button
                      onClick={() => {
                        setShowForm(false);
                        setNewName('');
                        setNewDesc('');
                        setNewWorkdir('');
                        setNewAgentId(undefined);
                        setNewRemoteWorkdir('');
                      }}
                      className="rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text-secondary hover:bg-notion-sidebar-hover"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {t('common.cancel')}
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
              <p className="text-base text-notion-text-tertiary">{t('projects.noProjects')}</p>
              <p className="mt-1 text-sm text-notion-text-tertiary">
                {t('projects.noProjectsHint')}
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
