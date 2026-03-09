import { createHashRouter, Navigate, Outlet, useMatches } from 'react-router-dom';
import { DashboardPage } from './pages/dashboard/page';
import { SearchPage } from './pages/search/page';
import { PapersPage } from './pages/papers/page';
import { OverviewPage } from './pages/papers/overview/page';
import { ReaderPage } from './pages/papers/reader/page';
import { NotesPage } from './pages/papers/notes/page';
import { ProjectsPage, ProjectDetailPage } from './pages/projects/page';
import { CollectionPage } from './pages/collections/page';
import { GraphPage } from './pages/graph/page';
import { RecommendationsPage } from './pages/recommendations/page';
import { SettingsPage } from './pages/settings/page';
import { ComparePage } from './pages/compare/page';
import { ProfilePage } from './pages/profile/page';
import { AgentTodosPage } from './pages/agent-todos/page';
import { AgentTodoDetailPage } from './pages/agent-todos/[id]/page';
import { TabsProvider } from './hooks/use-tabs';
import { ChatProvider } from './hooks/use-chat';
import { AnalysisProvider } from './hooks/use-analysis';
import { AppShell } from './components/app-shell';
import { ToastProvider } from './components/toast';

function RootLayout() {
  const matches = useMatches();
  const fullWidth = matches.some((m) => (m.handle as { fullWidth?: boolean })?.fullWidth);

  return (
    <ToastProvider>
      <ChatProvider>
        <AnalysisProvider>
          <TabsProvider>
            <AppShell fullWidth={fullWidth}>
              <Outlet />
            </AppShell>
          </TabsProvider>
        </AnalysisProvider>
      </ChatProvider>
    </ToastProvider>
  );
}

// Use hash router for Electron (file:// protocol)
export const router = createHashRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage />, handle: { fullWidth: true } },
      { path: 'search', element: <SearchPage />, handle: { fullWidth: true } },
      { path: 'papers', element: <PapersPage />, handle: { fullWidth: true } },
      {
        path: 'papers/:id',
        element: <OverviewPage />,
        handle: { fullWidth: true, hideBackButton: true },
      },
      {
        path: 'papers/:id/reader',
        element: <ReaderPage />,
        handle: { fullWidth: true, hideBackButton: true },
      },
      {
        path: 'papers/:id/notes',
        element: <NotesPage />,
        handle: { fullWidth: true, hideBackButton: true },
      },
      {
        path: 'collections/:id',
        element: <CollectionPage />,
        handle: { fullWidth: true, hideBackButton: true },
      },
      { path: 'graph', element: <GraphPage />, handle: { fullWidth: true } },
      { path: 'recommendations', element: <RecommendationsPage />, handle: { fullWidth: true } },
      {
        path: 'compare',
        element: <ComparePage />,
        handle: { fullWidth: true, hideBackButton: true },
      },
      { path: 'profile', element: <ProfilePage />, handle: { fullWidth: true } },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'agent-todos', element: <AgentTodosPage /> },
      {
        path: 'agent-todos/:id',
        element: <AgentTodoDetailPage />,
        handle: { fullWidth: true, hideBackButton: true },
      },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
