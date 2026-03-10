import { ipcMain, BrowserWindow } from 'electron';
import { ProjectsService } from '../services/projects.service';
import { type IpcResult, ok, err } from '@shared';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let svc: ProjectsService | null = null;

function getProjectsService() {
  if (!svc) svc = new ProjectsService();
  return svc;
}

const activeIdeaChats = new Map<string, AbortController>();

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

  // Workdir repo
  ipcMain.handle(
    'projects:workdir:check',
    async (_, projectId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().checkWorkdirGit(projectId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:workdir:check] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'projects:workdir:init',
    async (_, projectId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().initWorkdirGit(projectId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:workdir:init] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'projects:workdir:addRepo',
    async (_, projectId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().addWorkdirRepo(projectId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:workdir:addRepo] Error:', msg);
        return err(msg);
      }
    },
  );

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

  // Idea Chat (streaming)
  ipcMain.handle(
    'projects:idea:chat',
    async (
      event,
      input: {
        sessionId: string;
        projectId: string;
        paperIds: string[];
        repoIds?: string[];
        messages: { role: 'user' | 'assistant'; content: string }[];
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { error: 'No window found' };

      const existing = activeIdeaChats.get(input.sessionId);
      if (existing) existing.abort();

      const controller = new AbortController();
      activeIdeaChats.set(input.sessionId, controller);

      try {
        await getProjectsService().ideaChat(
          {
            projectId: input.projectId,
            paperIds: input.paperIds,
            repoIds: input.repoIds,
            messages: input.messages,
          },
          (chunk) => {
            win.webContents.send('idea-chat:output', chunk);
          },
          controller.signal,
        );
        win.webContents.send('idea-chat:done');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:idea:chat] Error:', msg);
        win.webContents.send('idea-chat:error', msg);
      } finally {
        activeIdeaChats.delete(input.sessionId);
      }

      return { sessionId: input.sessionId, started: true };
    },
  );

  ipcMain.handle('projects:idea:chatKill', async (_, sessionId: string) => {
    const controller = activeIdeaChats.get(sessionId);
    if (controller) {
      controller.abort();
      activeIdeaChats.delete(sessionId);
      return { killed: true };
    }
    return { killed: false };
  });

  ipcMain.handle('projects:idea:extract-task', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getProjectsService().extractTaskFromChat(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[projects:idea:extract-task] Error:', msg);
      return err(msg);
    }
  });

  // Project Papers
  ipcMain.handle(
    'projects:papers:add',
    async (_, projectId: string, paperId: string, note?: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().addPaperToProject(projectId, paperId, note);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:papers:add] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'projects:papers:remove',
    async (_, projectId: string, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().removePaperFromProject(projectId, paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:papers:remove] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'projects:papers:list',
    async (_, projectId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().listProjectPapers(projectId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:papers:list] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'projects:papers:get-by-paper',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getProjectsService().getProjectsForPaper(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[projects:papers:get-by-paper] Error:', msg);
        return err(msg);
      }
    },
  );
}
