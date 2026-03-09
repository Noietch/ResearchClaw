import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  Plus,
  ChevronDown,
  ChevronRight,
  Sparkles,
  GripVertical,
} from 'lucide-react';
import { useTabs } from '../hooks/use-tabs';
import { ipc, PaperItem, ProjectItem, CollectionItem } from '../hooks/use-ipc';
import { useAnalysis } from '../hooks/use-analysis';
import { useMainReady } from '../hooks/use-main-ready';
import { CollectionModal } from './collection-modal';

// Detect if running on Windows
const isWindows = navigator.userAgent.includes('Windows');

interface RecentItem {
  id: string;
  shortId?: string;
  type: 'paper' | 'project';
  title: string;
  accessedAt: Date;
}

const libraryNavItem = { to: '/papers', label: 'Library', icon: FileText };

const primaryNavItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/search', label: 'Search', icon: Search },
];

const workspaceNavItems = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/agent-todos', label: 'Tasks', icon: Bot },
];

const SIDEBAR_COLLAPSED_KEY = 'researchclaw-sidebar-collapsed';
const LIBRARY_EXPANDED_KEY = 'vibe-research-library-expanded';

// ── Collection tree helpers ──────────────────────────────────────────────

interface CollectionTreeNode extends CollectionItem {
  children: CollectionTreeNode[];
}

function buildTree(collections: CollectionItem[]): CollectionTreeNode[] {
  const map = new Map<string, CollectionTreeNode>();
  for (const c of collections) {
    map.set(c.id, { ...c, children: [] });
  }
  const roots: CollectionTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function CollectionTreeItem({
  node,
  level,
  pathname,
  onMove,
  dragId,
  setDragId,
  dropTargetId,
  setDropTargetId,
}: {
  node: CollectionTreeNode;
  level: number;
  pathname: string;
  onMove: (id: string, parentId: string | null) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTargetId: string | null;
  setDropTargetId: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const to = `/collections/${node.id}`;
  const isActive = pathname === to;
  const hasChildren = node.children.length > 0;
  const isDragging = dragId === node.id;
  const isDropTarget = dropTargetId === node.id && dragId !== node.id;

  return (
    <div>
      <div
        draggable={!node.isDefault}
        onDragStart={(e) => {
          if (node.isDefault) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', node.id);
          setDragId(node.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTargetId(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (dragId && dragId !== node.id) {
            setDropTargetId(node.id);
          }
        }}
        onDragLeave={() => {
          if (dropTargetId === node.id) setDropTargetId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const sourceId = e.dataTransfer.getData('text/plain');
          if (sourceId && sourceId !== node.id) {
            onMove(sourceId, node.id);
          }
          setDropTargetId(null);
          setDragId(null);
        }}
        className={`flex items-center ${isDragging ? 'opacity-40' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-notion-text-tertiary hover:bg-notion-sidebar-hover"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <div className="w-5 flex-shrink-0" />
        )}
        <Link
          to={to}
          className={`group relative flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50 ${
            isDropTarget ? 'ring-2 ring-notion-accent/50 bg-notion-accent-light' : ''
          }`}
          title={node.name}
        >
          {isActive && (
            <motion.div
              layoutId="sidebarNavIndicator"
              className="absolute inset-0 rounded-md bg-notion-sidebar-hover"
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative z-10 flex-shrink-0 text-sm">{node.icon ?? '📁'}</span>
          <span
            className={`relative z-10 flex-1 truncate ${
              isActive
                ? 'font-medium text-notion-text'
                : 'text-notion-text-secondary group-hover:text-notion-text'
            }`}
          >
            {node.name}
          </span>
          <span className="relative z-10 text-xs text-notion-text-tertiary">{node.paperCount}</span>
          {!node.isDefault && (
            <GripVertical
              size={12}
              className="relative z-10 flex-shrink-0 text-notion-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity cursor-grab"
            />
          )}
        </Link>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <CollectionTreeItem
              key={child.id}
              node={child}
              level={level + 1}
              pathname={pathname}
              onMove={onMove}
              dragId={dragId}
              setDragId={setDragId}
              dropTargetId={dropTargetId}
              setDropTargetId={setDropTargetId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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

export function AppShell({
  children,
  fullWidth,
}: {
  children: React.ReactNode;
  breadcrumbs?: { label: string; to?: string }[]; // kept for compat, unused
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
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(() => {
    const stored = localStorage.getItem(LIBRARY_EXPANDED_KEY);
    return stored !== 'false';
  });

  const sidebarRef = useRef<HTMLElement>(null);

  const toggleSidebar = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
  };

  const toggleLibraryExpanded = () => {
    const next = !isLibraryExpanded;
    setIsLibraryExpanded(next);
    localStorage.setItem(LIBRARY_EXPANDED_KEY, String(next));
  };

  const collectionTree = useMemo(() => buildTree(collections), [collections]);

  const handleMoveCollection = useCallback(async (id: string, parentId: string | null) => {
    try {
      await ipc.moveCollection(id, parentId);
      const updated = await ipc.listCollections();
      setCollections(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to move collection');
    }
  }, []);

  useEffect(() => {
    if (!isMainReady) return;

    async function loadRecentItems() {
      try {
        const [papers, projects] = await Promise.all([ipc.listPapers(), ipc.listProjects()]);

        const paperItems: RecentItem[] = papers
          .filter((p) => p.lastReadAt)
          .map((p) => ({
            id: p.id,
            shortId: p.shortId,
            type: 'paper' as const,
            title: p.title,
            accessedAt: new Date(p.lastReadAt!),
          }));

        const projectItems: RecentItem[] = projects
          .filter((p) => p.lastAccessedAt)
          .map((p) => ({
            id: p.id,
            type: 'project' as const,
            title: p.name,
            accessedAt: new Date(p.lastAccessedAt!),
          }));

        const allItems = [...paperItems, ...projectItems]
          .sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime())
          .slice(0, 6);

        setRecentItems(allItems);
      } catch (err) {
        console.error('Failed to load recent items:', err);
      }
    }

    loadRecentItems();
    ipc
      .listCollections()
      .then(setCollections)
      .catch(() => {});
  }, [pathname, isMainReady]); // Reload when route changes (handles deletions + new reads)

  const isLibraryRoute =
    pathname === '/papers' ||
    pathname.startsWith('/papers/') ||
    pathname.startsWith('/collections/');
  const collapsedNavItems = [libraryNavItem, ...workspaceNavItems];
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

  const activeAnalysisJobs = useMemo(
    () => analysisJobs.filter((job) => job.active),
    [analysisJobs],
  );
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
  const latestFinishedAnalysisJob = useMemo(
    () =>
      analysisJobs.find(
        (job) =>
          !job.active &&
          !dismissedJobIds.has(job.jobId) &&
          (job.stage === 'done' || job.stage === 'error' || job.stage === 'cancelled'),
      ) ?? null,
    [analysisJobs, dismissedJobIds],
  );

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
                  Vibe Research
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
          <nav className={`mt-2 flex flex-col gap-0.5 ${isCollapsed ? 'px-2' : 'px-2'}`}>
            {[...primaryNavItems, ...(isCollapsed ? collapsedNavItems : [])].map((item) => {
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

          {!isCollapsed && (
            <div className="mt-4 px-2">
              <div className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-notion-text-tertiary">
                Library
              </div>
              <div className="rounded-lg border border-notion-border bg-white/60 p-1">
                <div className="flex items-center gap-1">
                  <Link
                    to="/papers"
                    className="group relative flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
                  >
                    {isLibraryRoute && (
                      <motion.div
                        layoutId="sidebarNavIndicator"
                        className="absolute inset-0 rounded-md bg-notion-sidebar-hover"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                    <FileText
                      size={14}
                      strokeWidth={isLibraryRoute ? 2.2 : 1.8}
                      className={`relative z-10 flex-shrink-0 ${
                        isLibraryRoute
                          ? 'text-notion-text'
                          : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                      }`}
                    />
                    <span
                      className={`relative z-10 flex-1 truncate ${
                        isLibraryRoute
                          ? 'font-medium text-notion-text'
                          : 'text-notion-text-secondary group-hover:text-notion-text'
                      }`}
                    >
                      Library
                    </span>
                  </Link>
                  <button
                    onClick={toggleLibraryExpanded}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-notion-text-tertiary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text-secondary"
                    title={
                      isLibraryExpanded ? 'Collapse Library section' : 'Expand Library section'
                    }
                  >
                    {isLibraryExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>

                {isLibraryExpanded && (
                  <div className="mt-1 flex flex-col gap-0.5 border-t border-notion-border/70 pt-1">
                    <Link
                      to="/papers"
                      className="group relative ml-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
                    >
                      {pathname === '/papers' && (
                        <motion.div
                          layoutId="sidebarNavIndicator"
                          className="absolute inset-0 rounded-md bg-notion-sidebar-hover"
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      )}
                      <File
                        size={13}
                        className="relative z-10 flex-shrink-0 text-notion-text-tertiary"
                      />
                      <span
                        className={`relative z-10 flex-1 truncate ${
                          pathname === '/papers'
                            ? 'font-medium text-notion-text'
                            : 'text-notion-text-secondary group-hover:text-notion-text'
                        }`}
                      >
                        All Papers
                      </span>
                    </Link>
                    <div className="mt-1 flex items-center justify-between px-2 pl-4">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-notion-text-tertiary">
                        Collections
                      </span>
                      <button
                        onClick={() => setShowNewCollection(true)}
                        className="rounded p-0.5 text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text-secondary"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div
                      className="flex flex-col gap-0.5"
                      onDragOver={(e) => {
                        e.preventDefault();
                        // Allow drop on root area
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sourceId = e.dataTransfer.getData('text/plain');
                        if (sourceId) {
                          handleMoveCollection(sourceId, null);
                        }
                        setDropTargetId(null);
                        setDragId(null);
                      }}
                    >
                      {collectionTree.length > 0 ? (
                        collectionTree.map((node) => (
                          <CollectionTreeItem
                            key={node.id}
                            node={node}
                            level={0}
                            pathname={pathname}
                            onMove={handleMoveCollection}
                            dragId={dragId}
                            setDragId={setDragId}
                            dropTargetId={dropTargetId}
                            setDropTargetId={setDropTargetId}
                          />
                        ))
                      ) : (
                        <div className="ml-2 rounded-md px-2 py-1.5 text-sm text-notion-text-tertiary">
                          No collections yet
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isCollapsed && (
            <div className="mt-4 px-2">
              <div className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-notion-text-tertiary">
                Workspace
              </div>
              <div className="flex flex-col gap-0.5">
                {workspaceNavItems.map((item) => {
                  const isActive = pathname === item.to || pathname.startsWith(item.to + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
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
                        className={`relative z-10 flex-1 truncate ${
                          isActive
                            ? 'font-medium text-notion-text'
                            : 'text-notion-text-secondary group-hover:text-notion-text'
                        }`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
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
                  <Loader2 size={13} className="flex-shrink-0 animate-spin text-violet-600" />
                  <span className="truncate text-notion-text">
                    {activeAnalysisJobs.length === 1
                      ? `Analyzing: ${activeAnalysisJobs[0].paperTitle ?? 'paper'}`
                      : `${activeAnalysisJobs.length} analyses running`}
                  </span>
                  {activeAnalysisJobs[0]?.paperShortId && (
                    <Link
                      to={`/papers/${activeAnalysisJobs[0].paperShortId}`}
                      className="flex-shrink-0 text-violet-700 hover:text-violet-900"
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

        {/* Page content */}
        <main className="notion-scrollbar flex-1 overflow-y-auto h-full">
          {fullWidth ? (
            <div className="h-full">
              {canGoBack && (
                <div className="px-4 pt-4">
                  <button
                    onClick={handleGoBack}
                    title="返回上一页"
                    aria-label="返回上一页"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                  >
                    <ArrowLeft size={15} />
                  </button>
                </div>
              )}
              {children}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-4xl px-16 py-10">
              {canGoBack && (
                <div className="mb-4">
                  <button
                    onClick={handleGoBack}
                    title="返回上一页"
                    aria-label="返回上一页"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                  >
                    <ArrowLeft size={15} />
                  </button>
                </div>
              )}
              {children}
            </div>
          )}
        </main>
      </div>

      <CollectionModal
        isOpen={showNewCollection}
        onClose={() => setShowNewCollection(false)}
        onSave={async (data) => {
          try {
            await ipc.createCollection(data);
            setShowNewCollection(false);
            const updated = await ipc.listCollections();
            setCollections(updated);
          } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to create collection');
          }
        }}
        collections={collections}
      />
    </div>
  );
}
