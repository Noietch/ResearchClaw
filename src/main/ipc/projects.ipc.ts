import { ipcMain } from 'electron';
import { ProjectsService } from '../services/projects.service';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let svc: ProjectsService | null = null;

function getProjectsService() {
  if (!svc) svc = new ProjectsService();
  return svc;
}

export function setupProjectsIpc() {
  // Projects
  ipcMain.handle('projects:list', () => getProjectsService().listProjects());
  ipcMain.handle('projects:create', (_, input) => getProjectsService().createProject(input));
  ipcMain.handle('projects:update', (_, id: string, data) =>
    getProjectsService().updateProject(id, data),
  );
  ipcMain.handle('projects:delete', (_, id: string) => getProjectsService().deleteProject(id));
  ipcMain.handle('projects:touch', (_, id: string) => getProjectsService().touchProject(id));

  // Todos
  ipcMain.handle('projects:todo:create', (_, input) => getProjectsService().createTodo(input));
  ipcMain.handle('projects:todo:update', (_, id: string, data) =>
    getProjectsService().updateTodo(id, data),
  );
  ipcMain.handle('projects:todo:delete', (_, id: string) => getProjectsService().deleteTodo(id));

  // Repos
  ipcMain.handle('projects:repo:add', (_, input) => getProjectsService().addRepo(input));
  ipcMain.handle('projects:repo:clone', (_, repoId: string, repoUrl: string) =>
    getProjectsService().cloneRepo(repoId, repoUrl),
  );
  ipcMain.handle('projects:repo:commits', (_, localPath: string, limit?: number) =>
    getProjectsService().getCommits(localPath, limit),
  );
  ipcMain.handle('projects:repo:delete', (_, id: string) => getProjectsService().deleteRepo(id));

  // Ideas
  ipcMain.handle('projects:idea:create', (_, input) => getProjectsService().createIdea(input));
  ipcMain.handle('projects:idea:generate', (_, input) => getProjectsService().generateIdea(input));
  ipcMain.handle('projects:idea:update', (_, id: string, data) =>
    getProjectsService().updateIdea(id, data),
  );
  ipcMain.handle('projects:idea:delete', (_, id: string) => getProjectsService().deleteIdea(id));
}
