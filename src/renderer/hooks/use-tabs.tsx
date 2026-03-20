import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings, BookOpen, NotebookPen, FolderKanban, Globe } from 'lucide-react';

export interface Tab {
  id: string; // unique, same as path
  path: string;
  label: string;
  icon: React.ElementType;
  closeable: boolean;
}

function tabForPath(path: string): Tab | null {
  // Settings page
  if (path === '/settings')
    return {
      id: '/settings',
      path: '/settings',
      label: 'Settings',
      icon: Settings,
      closeable: true,
    };
  // Paper reader: /papers/:id/reader
  const readerMatch = path.match(/^\/papers\/([^/]+)\/reader$/);
  if (readerMatch) {
    return { id: path, path, label: readerMatch[1], icon: BookOpen, closeable: true };
  }
  // Paper notes: /papers/:id/notes
  const notesMatch = path.match(/^\/papers\/([^/]+)\/notes$/);
  if (notesMatch) {
    return { id: path, path, label: notesMatch[1], icon: NotebookPen, closeable: true };
  }
  // Project detail: /projects/:id
  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    return { id: path, path, label: projectMatch[1], icon: FolderKanban, closeable: true };
  }
  // In-app browser: /browser?url=...
  if (path.startsWith('/browser')) {
    try {
      const url = new URL(
        path.includes('?') ? `http://x${path.slice(path.indexOf('?'))}` : 'http://x',
      );
      const hostname = new URL(url.searchParams.get('url') ?? '').hostname;
      return { id: path, path, label: hostname, icon: Globe, closeable: true };
    } catch {
      return { id: path, path, label: 'Browser', icon: Globe, closeable: true };
    }
  }
  return null;
}

interface TabsCtx {
  tabs: Tab[];
  activeId: string;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  openTab: (path: string, state?: unknown) => void;
  updateTabLabel: (id: string, label: string) => void;
}

const TabsContext = createContext<TabsCtx | null>(null);

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Start with empty tabs - main pages are accessible via sidebar
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  // Sync with router location changes (e.g. Link navigation)
  useEffect(() => {
    const path = location.pathname;
    const tab = tabForPath(path);
    if (!tab) return;

    setTabs((prev) => {
      if (prev.find((t) => t.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveId(tab.id);
  }, [location.pathname]);

  const activateTab = useCallback(
    (id: string) => {
      setActiveId(id);
      navigate(id);
    },
    [navigate],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        // If closing active tab, switch to adjacent or go home
        if (id === activeId) {
          if (next.length > 0) {
            const newActive = next[Math.min(idx, next.length - 1)];
            setActiveId(newActive.id);
            navigate(newActive.path);
          } else {
            // No more tabs, go to dashboard
            setActiveId('');
            navigate('/dashboard');
          }
        }
        return next;
      });
    },
    [activeId, navigate],
  );

  const openTab = useCallback(
    (path: string, state?: unknown) => {
      const tab = tabForPath(path);
      if (!tab) {
        navigate(path, { state });
        return;
      }
      setTabs((prev) => {
        if (prev.find((t) => t.id === tab.id)) return prev;
        return [...prev, tab];
      });
      setActiveId(tab.id);
      navigate(path, { state });
    },
    [navigate],
  );

  const updateTabLabel = useCallback((id: string, label: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)));
  }, []);

  return (
    <TabsContext.Provider
      value={{ tabs, activeId, activateTab, closeTab, openTab, updateTabLabel }}
    >
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used inside TabsProvider');
  return ctx;
}
