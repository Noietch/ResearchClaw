import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search,
  FileText,
  FolderKanban,
  Settings,
  X,
  File,
  Folder,
  LayoutDashboard,
} from 'lucide-react';
import { useTabs } from '../hooks/use-tabs';
import { ipc, PaperItem, ProjectItem, CollectionItem } from '../hooks/use-ipc';
import { CollectionModal } from './collection-modal';
import { Plus } from 'lucide-react';

interface RecentItem {
  id: string;
  shortId?: string;
  type: 'paper' | 'project';
  title: string;
  accessedAt: Date;
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/papers', label: 'Library', icon: FileText },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
];

export function AppShell({
  children,
  fullWidth,
}: {
  children: React.ReactNode;
  breadcrumbs?: { label: string; to?: string }[]; // kept for compat, unused
  fullWidth?: boolean;
}) {
  const location = useLocation();
  const pathname = location.pathname;
  const { tabs, activeId, activateTab, closeTab } = useTabs();
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [showNewCollection, setShowNewCollection] = useState(false);

  useEffect(() => {
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
  }, [pathname]); // Reload when route changes (handles deletions + new reads)

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="notion-scrollbar flex w-60 flex-shrink-0 flex-col border-r border-notion-border bg-notion-sidebar overflow-y-auto">
        {/* macOS traffic light spacer */}
        <div
          className="h-10 flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
        {/* Workspace header */}
        <div
          className="flex items-center gap-2 px-3.5 py-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex h-7 w-7 items-center justify-center">
            <svg
              width="24"
              height="24"
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
          <span className="text-sm font-semibold text-notion-text">Vibe Research</span>
        </div>

        {/* Navigation */}
        <nav className="mt-2 flex flex-col gap-0.5 px-2">
          {navItems.map((item) => {
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
                  size={16}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={`relative z-10 ${
                    isActive
                      ? 'text-notion-text'
                      : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
                  }`}
                />
                <span
                  className={`relative z-10 ${
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
        </nav>

        {/* Collections */}
        {collections.length > 0 && (
          <div className="mt-4 px-2">
            <div className="mb-1.5 flex items-center justify-between px-2">
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
            <div className="flex flex-col gap-0.5">
              {collections.map((col) => {
                const to = `/collections/${col.id}`;
                const isActive = pathname === to;
                return (
                  <Link
                    key={col.id}
                    to={to}
                    className="group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
                    title={col.name}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="sidebarNavIndicator"
                        className="absolute inset-0 rounded-md bg-notion-sidebar-hover"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex-shrink-0 text-sm">{col.icon ?? '📁'}</span>
                    <span
                      className={`relative z-10 flex-1 truncate ${
                        isActive
                          ? 'font-medium text-notion-text'
                          : 'text-notion-text-secondary group-hover:text-notion-text'
                      }`}
                    >
                      {col.name}
                    </span>
                    <span className="relative z-10 text-xs text-notion-text-tertiary">
                      {col.paperCount}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Items */}
        {recentItems.length > 0 && (
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

        {/* Bottom section */}
        <div className="mt-auto border-t border-notion-border px-2 py-2">
          <Link
            to="/settings"
            className="group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-notion-sidebar-hover/50"
          >
            {pathname === '/settings' && (
              <motion.div
                layoutId="sidebarNavIndicator"
                className="absolute inset-0 rounded-md bg-notion-sidebar-hover"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <Settings
              size={15}
              strokeWidth={pathname === '/settings' ? 2.2 : 1.8}
              className={`relative z-10 ${
                pathname === '/settings'
                  ? 'text-notion-text'
                  : 'text-notion-text-tertiary group-hover:text-notion-text-secondary'
              }`}
            />
            <span
              className={`relative z-10 ${
                pathname === '/settings'
                  ? 'font-medium text-notion-text'
                  : 'text-notion-text-secondary group-hover:text-notion-text'
              }`}
            >
              Settings
            </span>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tab bar */}
        <header
          className="flex h-10 flex-shrink-0 items-stretch border-b border-notion-border bg-notion-sidebar overflow-x-auto"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
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
                  onClick={() => activateTab(tab.id)}
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
        </header>

        {/* Page content */}
        <main className="notion-scrollbar flex-1 overflow-y-auto h-full">
          {fullWidth ? (
            <div className="h-full">{children}</div>
          ) : (
            <div className="mx-auto w-full max-w-4xl px-16 py-10">{children}</div>
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
      />
    </div>
  );
}
