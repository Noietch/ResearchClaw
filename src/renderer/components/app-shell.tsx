import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate, useMatches } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  ArrowLeft,
  FileText,
  FolderKanban,
  Settings,
  X,
  File,
  Folder,
  LayoutDashboard,
  Minus,
  Square,
  Bot,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from 'lucide-react';
import { useTabs } from '../hooks/use-tabs';
import {
  ipc,
  onIpc,
  type PaperItem,
  type ProjectItem,
  type ProviderConfig,
  type BuiltinModelDownloadProgress,
} from '../hooks/use-ipc';
import { useAnalysis } from '../hooks/use-analysis';
import { useMainReady } from '../hooks/use-main-ready';
import { SetupWizardModal, isSetupDismissed } from './setup-wizard-modal';

// Detect if running on Windows
const isWindows = navigator.userAgent.includes('Windows');

interface RecentItem {
  id: string;
  shortId?: string;
  type: 'paper' | 'project';
  title: string;
  accessedAt: Date;
}

const primaryNavItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/search', label: 'Search', icon: Search },
];

const SIDEBAR_COLLAPSED_KEY = 'researchclaw-sidebar-collapsed';

// Windows window controls component
function WindowsWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const isMainReady = useMainReady();

  useEffect(() => {
    if (!isMainReady) return;
    ipc
      .windowIsMaximized()
      .then(setIsMaximized)
      .catch(() => {});
  }, [isMainReady]);

  const handleMaximize = async () => {
    await ipc.windowMaximize();
    const maximized = await ipc.windowIsMaximized();
    setIsMaximized(maximized);
  };

  return (
    <div
      className="flex items-center"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => ipc.windowMinimize()}
        className="flex h-10 w-12 items-center justify-center text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text transition-colors"
        title="Minimize"
      >
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button
        onClick={handleMaximize}
        className="flex h-10 w-12 items-center justify-center text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text transition-colors"
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        <Square size={14} strokeWidth={1.5} />
      </button>
      <button
        onClick={() => ipc.windowClose()}
        className="flex h-10 w-12 items-center justify-center text-notion-text-tertiary hover:bg-red-500 hover:text-white transition-colors"
        title="Close"
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BuiltinModelDownloadToast() {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<BuiltinModelDownloadProgress | null>(null);

  useEffect(() => {
    // Check if the IPC method exists (may not be available in all versions)
    if (typeof ipc.getBuiltinModelDownloadStatus !== 'function') return;
    ipc
      .getBuiltinModelDownloadStatus()
      .then((res) => {
        if (res.downloading && res.progress) {
          setDownloading(true);
          setProgress(res.progress);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = onIpc('settings:builtinModelDownloadProgress', (...args) => {
      const p = args[1] as BuiltinModelDownloadProgress;
      setProgress(p);
      if (p.phase === 'downloading') {
        setDownloading(true);
      } else {
        setDownloading(false);
      }
    });
    return unsub;
  }, []);

  const overallPercent =
    downloading && progress?.fileIndex && progress.totalFiles
      ? Math.round(
          ((progress.fileIndex - 1 + (progress.percent ?? 0) / 100) / progress.totalFiles) * 100,
        )
      : 0;

  return (
    <AnimatePresence>
      {downloading && progress && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.15 }}
          className="fixed bottom-4 left-4 z-50 flex max-w-xs items-center gap-2.5 rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-xs shadow-lg"
        >
          <Loader2 size={13} className="flex-shrink-0 animate-spin text-notion-accent" />
          <div className="flex flex-col gap-1">
            <span className="text-notion-text font-medium">
              Downloading built-in model
              {progress.fileIndex && progress.totalFiles
                ? ` (${progress.fileIndex}/${progress.totalFiles})`
                : ''}
            </span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 rounded-full bg-notion-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-notion-accent transition-all duration-200"
                  style={{ width: `${overallPercent}%` }}
                />
              </div>
              <span className="tabular-nums text-[11px] text-notion-text-tertiary">
                {progress.downloadedBytes != null && progress.totalBytes
                  ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                  : overallPercent > 0
                    ? `${overallPercent}%`
                    : ''}
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppShell({
  children,
  fullWidth,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const { tabs, activeId, activateTab, closeTab } = useTabs();
  const { jobs: analysisJobs } = useAnalysis();
  const isMainReady = useMainReady();
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === 'true';
  });

  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupProviders, setSetupProviders] = useState<ProviderConfig[]>([]);

  useEffect(() => {
    if (!isMainReady || isSetupDismissed()) return;
    ipc
      .listProviders()
      .then((providers) => {
        const hasConfigured = providers.some((p) => p.hasApiKey);
        if (!hasConfigured) {
          setSetupProviders(providers);
          setShowSetupWizard(true);
        }
      })
      .catch(() => {});
  }, [isMainReady]);

  const sidebarRef = useRef<HTMLElement>(null);

  const toggleSidebar = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
  };

  const recentLoadedRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const [papers, projectList] = await Promise.all([ipc.listPapers(), ipc.listProjects()]);

      const paperIdSet = new Set(papers.map((p: PaperItem) => p.id));
      const projectIdSet = new Set(projectList.map((p: ProjectItem) => p.id));

      if (!recentLoadedRef.current) {
        // First load: build the initial recent items list
        const paperItems: RecentItem[] = papers
          .filter((p: PaperItem) => p.lastReadAt)
          .map((p: PaperItem) => ({
            id: p.id,
            shortId: p.shortId,
            type: 'paper' as const,
            title: p.title,
            accessedAt: new Date(p.lastReadAt!),
          }));

        const projectItems: RecentItem[] = projectList
          .filter((p: ProjectItem) => p.lastAccessedAt)
          .map((p: ProjectItem) => ({
            id: p.id,
            type: 'project' as const,
            title: p.name,
            accessedAt: new Date(p.lastAccessedAt!),
          }));

        const allItems = [...paperItems, ...projectItems]
          .sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime())
          .slice(0, 6);

        setRecentItems(allItems);
        recentLoadedRef.current = true;
      } else {
        // Subsequent loads: remove deleted items from the existing list
        setRecentItems((prev) =>
          prev.filter((item) =>
            item.type === 'paper' ? paperIdSet.has(item.id) : projectIdSet.has(item.id),
          ),
        );
      }
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    }
  }, []);

  useEffect(() => {
    if (!isMainReady) return;
    loadData();
  }, [pathname, isMainReady, loadData]);

  const isLibraryRoute = pathname === '/papers' || pathname.startsWith('/papers/');
  const isProjectsRoute = pathname === '/projects' || pathname.startsWith('/projects/');

  const matches = useMatches();
  const hideBackButton = matches.some(
    (m) => (m.handle as { hideBackButton?: boolean })?.hideBackButton,
  );
  const canGoBack = pathname !== '/dashboard' && !hideBackButton;

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/dashboard');
  };

  const activeAnalysisJobs = analysisJobs.filter((job) => job.active);
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
  const latestFinishedAnalysisJob =
    analysisJobs.find(
      (job) =>
        !job.active &&
        !dismissedJobIds.has(job.jobId) &&
        (job.stage === 'done' || job.stage === 'error' || job.stage === 'cancelled'),
    ) ?? null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Top title bar - spans full width */}
      <header
        className="flex flex-shrink-0 items-stretch border-b border-notion-border bg-notion-sidebar"
        style={{ WebkitAppRegion: 'drag', height: '52px' } as React.CSSProperties}
      >
        {/* macOS traffic light spacer */}
        {!isWindows && <div className="w-[72px] flex-shrink-0" />}

        {/* Tabs */}
        <div
          className="flex items-stretch"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            const Icon = tab.icon;
            return (
              <div
                key={tab.id}
                className={`group relative flex items-center gap-1.5 border-r border-notion-border px-3 cursor-pointer select-none min-w-0 ${
                  isActive
                    ? 'bg-white text-notion-text'
                    : 'text-notion-text-secondary hover:bg-notion-sidebar-hover hover:text-notion-text'
                }`}
                style={{ minWidth: 80, maxWidth: 180 }}
                onClick={(e) => {
                  e.stopPropagation();
                  activateTab(tab.id);
                }}
              >
                {/* active indicator */}
                {isActive && <div className="absolute bottom-0 left-0 right-0 h-px bg-white" />}
                <Icon size={13} strokeWidth={isActive ? 2.2 : 1.8} className="flex-shrink-0" />
                <span className="truncate text-xs font-medium">{tab.label}</span>
                {tab.closeable && (
                  <button
                    className={`ml-0.5 flex-shrink-0 rounded p-0.5 transition-colors ${
                      isActive
                        ? 'text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text'
                        : 'text-transparent group-hover:text-notion-text-tertiary hover:!text-notion-text'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* remaining space is drag region */}
        <div className="flex-1" />

        {/* Windows window controls - right side */}
        {isWindows && <WindowsWindowControls />}
      </header>

      {/* Main content area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          ref={sidebarRef}
          className={`flex flex-shrink-0 flex-col border-r border-notion-border bg-notion-sidebar transition-[width] duration-150 ease-out ${
            isCollapsed ? 'w-[72px] overflow-hidden' : 'w-60 notion-scrollbar overflow-y-auto'
          }`}
        >
          {/* Workspace header with toggle button */}
          <div
            className={`flex items-center py-3 ${isCollapsed ? 'justify-center px-2' : 'justify-between px-3'}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center flex-shrink-0">
                  <svg
                    width={24}
                    height={24}
                    viewBox="0 0 200 200"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <linearGradient
                        id="appIconGrad"
                        x1="20"
                        y1="20"
                        x2="180"
                        y2="180"
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop stopColor="#3B82F6" />
                        <stop offset="1" stopColor="#06B6D4" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M40 50C40 44.4772 44.4772 40 50 40H60L100 140L140 40H150C155.523 40 160 44.4772 160 50V60L100 160L40 60V50Z"
                      fill="url(#appIconGrad)"
                    />
                    <path
                      d="M60 70C60 64.4772 64.4772 60 70 60H80L100 110L120 60H130C135.523 60 140 64.4772 140 70V80L100 130L60 80V70Z"
                      fill="white"
                      fillOpacity="0.2"
                    />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-notion-text whitespace-nowrap">
                  ResearchClaw
                </span>
              </div>
            )}
            <button
              onClick={toggleSidebar}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text-secondary transition-colors"
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? (
                <PanelLeftOpen size={18} strokeWidth={1.8} />
              ) : (
                <PanelLeftClose size={18} strokeWidth={1.8} />
              )}
            </button>
          </div>

          {/* Primary navigation */}
          <nav className="mt-2 flex flex-col gap-0.5 px-2">
            {[
              ...primaryNavItems,
              ...(isCollapsed
                ? [
                    { to: '/papers', label: 'Library', icon: FileText },
                    { to: '/projects', label: 'Projects', icon: FolderKanban },
                    { to: '/agent-todos', label: 'Tasks', icon: Bot },
                  ]
                : []),
            ].map((item) => {
              const isActive = pathname === item.to || pathname.startsWith(item.to + '/');
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`group relative flex items-center rounded-md text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50 ${
                    isCollapsed ? 'justify-center h-9' : 'gap-2 px-2 py-1.5'
                  }`}
                  title={isCollapsed ? item.label : undefined}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebarNavIndicator"
                      className="rounded-md bg-notion-sidebar-hover absolute inset-0"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <Icon
                    size={isCollapsed ? 20 : 16}
                    strokeWidth={isActive ? 2.2 : 1.8}
                    className={`relative z-10 flex-shrink-0 ${
                      isActive
                        ? 'text-notion-text'
                        : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                    }`}
                  />
                  {!isCollapsed && (
                    <span
                      className={`relative z-10 whitespace-nowrap ${
                        isActive
                          ? 'font-medium text-notion-text'
                          : 'text-notion-text-secondary group-hover:text-notion-text'
                      }`}
                    >
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Library + Projects sections (expanded sidebar only) */}
          {!isCollapsed && (
            <div className="mt-3 flex flex-col gap-0.5 px-2">
              {/* Library - flat link */}
              <Link
                to="/papers"
                className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
              >
                {isLibraryRoute && (
                  <motion.div
                    layoutId="sidebarNavIndicator"
                    className="rounded-md bg-notion-sidebar-hover absolute inset-0"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
                <FileText
                  size={16}
                  strokeWidth={isLibraryRoute ? 2.2 : 1.8}
                  className={`relative z-10 flex-shrink-0 ${
                    isLibraryRoute
                      ? 'text-notion-text'
                      : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                  }`}
                />
                <span
                  className={`relative z-10 whitespace-nowrap ${
                    isLibraryRoute
                      ? 'font-medium text-notion-text'
                      : 'text-notion-text-secondary group-hover:text-notion-text'
                  }`}
                >
                  Library
                </span>
              </Link>

              {/* Projects - flat link */}
              <Link
                to="/projects"
                className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
              >
                {isProjectsRoute && (
                  <motion.div
                    layoutId="sidebarNavIndicator"
                    className="rounded-md bg-notion-sidebar-hover absolute inset-0"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
                <FolderKanban
                  size={16}
                  strokeWidth={isProjectsRoute ? 2.2 : 1.8}
                  className={`relative z-10 flex-shrink-0 ${
                    isProjectsRoute
                      ? 'text-notion-text'
                      : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                  }`}
                />
                <span
                  className={`relative z-10 whitespace-nowrap ${
                    isProjectsRoute
                      ? 'font-medium text-notion-text'
                      : 'text-notion-text-secondary group-hover:text-notion-text'
                  }`}
                >
                  Projects
                </span>
              </Link>

              {/* Tasks */}
              <Link
                to="/agent-todos"
                className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
              >
                {(pathname === '/agent-todos' || pathname.startsWith('/agent-todos/')) && (
                  <motion.div
                    layoutId="sidebarNavIndicator"
                    className="rounded-md bg-notion-sidebar-hover absolute inset-0"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
                <Bot
                  size={16}
                  strokeWidth={
                    pathname === '/agent-todos' || pathname.startsWith('/agent-todos/') ? 2.2 : 1.8
                  }
                  className={`relative z-10 flex-shrink-0 ${
                    pathname === '/agent-todos' || pathname.startsWith('/agent-todos/')
                      ? 'text-notion-text'
                      : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                  }`}
                />
                <span
                  className={`relative z-10 whitespace-nowrap ${
                    pathname === '/agent-todos' || pathname.startsWith('/agent-todos/')
                      ? 'font-medium text-notion-text'
                      : 'text-notion-text-secondary group-hover:text-notion-text'
                  }`}
                >
                  Tasks
                </span>
              </Link>
            </div>
          )}

          {/* Recent Items - hidden when collapsed */}
          {!isCollapsed && recentItems.length > 0 && (
            <div className="mt-4 px-2">
              <div className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-notion-text-tertiary">
                Recent
              </div>
              <div className="flex flex-col gap-0.5">
                {recentItems.map((item) => {
                  const to =
                    item.type === 'paper' ? `/papers/${item.shortId}` : `/projects/${item.id}`;
                  const Icon = item.type === 'paper' ? File : Folder;
                  const isActive = pathname === to;
                  return (
                    <Link
                      key={`${item.type}-${item.id}`}
                      to={to}
                      className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
                      title={item.title}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="sidebarNavIndicator"
                          className="absolute inset-0 rounded-md bg-notion-sidebar-hover"
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      )}
                      <Icon
                        size={14}
                        strokeWidth={isActive ? 2.2 : 1.8}
                        className={`relative z-10 flex-shrink-0 ${
                          isActive
                            ? 'text-notion-text'
                            : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                        }`}
                      />
                      <span
                        className={`relative z-10 truncate ${
                          isActive
                            ? 'font-medium text-notion-text'
                            : 'text-notion-text-secondary group-hover:text-notion-text'
                        }`}
                      >
                        {item.title}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom section - Settings */}
          <div className="mt-auto py-1 px-2">
            <Link
              to="/settings"
              className={`group relative flex w-full items-center rounded-md text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50 ${
                isCollapsed ? 'justify-center h-9' : 'gap-2 px-2 py-1.5'
              }`}
              title={isCollapsed ? 'Settings' : undefined}
            >
              {pathname === '/settings' && (
                <motion.div
                  layoutId="sidebarNavIndicator"
                  className="rounded-md bg-notion-sidebar-hover absolute inset-0"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <Settings
                size={isCollapsed ? 20 : 15}
                strokeWidth={pathname === '/settings' ? 2.2 : 1.8}
                className={`relative z-10 flex-shrink-0 ${
                  pathname === '/settings'
                    ? 'text-notion-text'
                    : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                }`}
              />
              {!isCollapsed && (
                <span
                  className={`relative z-10 whitespace-nowrap ${
                    pathname === '/settings'
                      ? 'font-medium text-notion-text'
                      : 'text-notion-text-secondary group-hover:text-notion-text'
                  }`}
                >
                  Settings
                </span>
              )}
            </Link>
          </div>
        </aside>

        {/* Floating analysis toast — bottom-right corner */}
        <AnimatePresence>
          {(activeAnalysisJobs.length > 0 || latestFinishedAnalysisJob) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.15 }}
              className="fixed bottom-4 right-4 z-50 flex max-w-xs items-center gap-2 rounded-lg border border-notion-border bg-white px-3 py-2 text-xs shadow-lg"
            >
              {activeAnalysisJobs.length > 0 ? (
                <>
                  <Loader2 size={13} className="flex-shrink-0 animate-spin text-blue-600" />
                  <span className="truncate text-notion-text">
                    {activeAnalysisJobs.length === 1
                      ? `Analyzing: ${activeAnalysisJobs[0].paperTitle ?? 'paper'}`
                      : `${activeAnalysisJobs.length} analyses running`}
                  </span>
                  {activeAnalysisJobs[0]?.paperShortId && (
                    <Link
                      to={`/papers/${activeAnalysisJobs[0].paperShortId}`}
                      className="flex-shrink-0 text-blue-700 hover:text-blue-900"
                    >
                      <Sparkles size={12} />
                    </Link>
                  )}
                </>
              ) : latestFinishedAnalysisJob ? (
                <>
                  {latestFinishedAnalysisJob.stage === 'done' ? (
                    <CheckCircle2 size={13} className="flex-shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle size={13} className="flex-shrink-0 text-red-500" />
                  )}
                  {latestFinishedAnalysisJob.paperShortId ? (
                    <Link
                      to={`/papers/${latestFinishedAnalysisJob.paperShortId}`}
                      className={`truncate hover:underline ${
                        latestFinishedAnalysisJob.stage === 'done'
                          ? 'text-notion-text'
                          : 'text-red-700'
                      }`}
                    >
                      {latestFinishedAnalysisJob.stage === 'done'
                        ? `Analysis ready: ${latestFinishedAnalysisJob.paperTitle ?? 'paper'}`
                        : latestFinishedAnalysisJob.message}
                    </Link>
                  ) : (
                    <span
                      className={`truncate ${
                        latestFinishedAnalysisJob.stage === 'done'
                          ? 'text-notion-text'
                          : 'text-red-700'
                      }`}
                    >
                      {latestFinishedAnalysisJob.stage === 'done'
                        ? `Analysis ready: ${latestFinishedAnalysisJob.paperTitle ?? 'paper'}`
                        : latestFinishedAnalysisJob.message}
                    </span>
                  )}
                  <button
                    onClick={() =>
                      setDismissedJobIds((prev) =>
                        new Set(prev).add(latestFinishedAnalysisJob.jobId),
                      )
                    }
                    className="flex-shrink-0 rounded p-0.5 text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text"
                  >
                    <X size={12} />
                  </button>
                </>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global builtin model download toast */}
        <BuiltinModelDownloadToast />

        {/* Setup wizard modal */}
        <AnimatePresence>
          {showSetupWizard && (
            <SetupWizardModal
              providers={setupProviders}
              onComplete={() => setShowSetupWizard(false)}
              onSkip={() => setShowSetupWizard(false)}
            />
          )}
        </AnimatePresence>

        {/* Page content */}
        <main className="notion-scrollbar flex-1 overflow-y-auto h-full">
          {fullWidth ? (
            <div className="relative h-full">
              {canGoBack && (
                <button
                  onClick={handleGoBack}
                  title="返回上一页"
                  aria-label="返回上一页"
                  className="absolute left-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              {children}
            </div>
          ) : (
            <div className="relative mx-auto w-full max-w-4xl px-16 py-10">
              {canGoBack && (
                <button
                  onClick={handleGoBack}
                  title="返回上一页"
                  aria-label="返回上一页"
                  className="absolute left-4 top-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              {children}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
