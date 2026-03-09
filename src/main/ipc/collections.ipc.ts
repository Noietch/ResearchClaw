import { ipcMain } from 'electron';
import { CollectionsService } from '../services/collections.service';
import { type IpcResult, ok, err } from '@shared';

let collectionsService: CollectionsService | null = null;

function getService() {
  if (!collectionsService) collectionsService = new CollectionsService();
  return collectionsService;
}

export function setupCollectionsIpc() {
  ipcMain.handle('collections:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getService().list();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[collections:list] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'collections:create',
    async (
      _,
      data: {
        name: string;
        icon?: string;
        color?: string;
        description?: string;
        parentId?: string | null;
      },
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().create(data);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:create] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:move',
    async (
      _,
      input: { id: string; parentId: string | null; sortOrder?: number },
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().move(input.id, input.parentId, input.sortOrder);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:move] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:update',
    async (
      _,
      id: string,
      data: { name?: string; icon?: string; color?: string; description?: string },
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().update(id, data);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:update] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('collections:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getService().delete(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[collections:delete] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'collections:addPaper',
    async (_, collectionId: string, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().addPaper(collectionId, paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:addPaper] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:removePaper',
    async (_, collectionId: string, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().removePaper(collectionId, paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:removePaper] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:addPapers',
    async (_, collectionId: string, paperIds: string[]): Promise<IpcResult<unknown>> => {
      try {
        await getService().addPapers(collectionId, paperIds);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:addPapers] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:listPapers',
    async (_, collectionId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().listPapers(collectionId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:listPapers] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:getForPaper',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().getCollectionsForPaper(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:getForPaper] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'collections:researchProfile',
    async (_, collectionId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getService().getResearchProfile(collectionId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[collections:researchProfile] Error:', msg);
        return err(msg);
      }
    },
  );
}

export async function ensureDefaultCollections() {
  try {
    await getService().ensureDefaults();
  } catch (e) {
    console.error('[collections] Failed to ensure defaults:', e);
  }
}
