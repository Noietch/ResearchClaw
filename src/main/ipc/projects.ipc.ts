import { ipcMain } from 'electron';
import { ProjectsService } from '../services/projects.service';
import { type IpcResult, ok, err } from '@shared';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let svc: ProjectsService | null = null;

function getProjectsService() {
  if (!svc) svc = new ProjectsService();
  return svc;
}

export function setupProjectsIpc() {
  // Projects
  ipcMain.handle('projects:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().listProjects();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:list] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle('projects:create', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().createProject(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:create] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle('projects:update', async (_, id: string, data): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().updateProject(id, data);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:update] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle('projects:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().deleteProject(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:delete] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle('projects:touch', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().touchProject(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:touch] Error:', msg);
      return err(msg);
    }
  });

  // Todos
  ipcMain.handle('projects:todo:create', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().createTodo(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:todo:create] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle(
    'projects:todo:update',
    async (_, id: string, data): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().updateTodo(id, data);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:todo:update] Error:', msg);
        return err(msg);
      }
    },
  );
  ipcMain.handle('projects:todo:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().deleteTodo(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:todo:delete] Error:', msg);
      return err(msg);
    }
  });

  // Repos
  ipcMain.handle('projects:repo:add', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().addRepo(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:repo:add] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle(
    'projects:repo:clone',
    async (_, repoId: string, repoUrl: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().cloneRepo(repoId, repoUrl);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:repo:clone] Error:', msg);
        return err(msg);
      }
    },
  );
  ipcMain.handle(
    'projects:repo:commits',
    async (_, localPath: string, limit?: number): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().getCommits(localPath, limit);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:repo:commits] Error:', msg);
        return err(msg);
      }
    },
  );
  ipcMain.handle('projects:repo:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().deleteRepo(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:repo:delete] Error:', msg);
      return err(msg);
    }
  });

  // Ideas
  ipcMain.handle('projects:idea:create', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().createIdea(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:idea:create] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle('projects:idea:generate', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().generateIdea(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:idea:generate] Error:', msg);
      return err(msg);
    }
  });
  ipcMain.handle(
    'projects:idea:update',
    async (_, id: string, data): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().updateIdea(id, data);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:idea:update] Error:', msg);
        return err(msg);
      }
    },
  );
  ipcMain.handle('projects:idea:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().deleteIdea(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:idea:delete] Error:', msg);
      return err(msg);
    }
  });
}
