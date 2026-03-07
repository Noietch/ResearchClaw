import { ipcMain } from 'electron';
import { modelsService } from '../services/models.service';
import type { ModelKind } from '../store/model-config-store';
import { type IpcResult, ok, err } from '@shared';

export function setupModelsIpc() {
  ipcMain.handle('models:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = modelsService.listModels();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[models:list] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('models:getActiveIds', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = modelsService.getActiveIds();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[models:getActiveIds] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('models:getActive', async (_, kind: ModelKind): Promise<IpcResult<unknown>> => {
    try {
      const result = modelsService.getActive(kind);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[models:getActive] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'models:save',
    async (_, config: Parameters<typeof modelsService.save>[0]): Promise<IpcResult<unknown>> => {
      try {
        const result = modelsService.save(config);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[models:save] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('models:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = modelsService.delete(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[models:delete] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'models:setActive',
    async (_, kind: ModelKind, id: string): Promise<IpcResult<unknown>> => {
      try {
        const result = modelsService.setActive(kind, id);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[models:setActive] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('models:getApiKey', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = modelsService.getApiKey(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[models:getApiKey] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'models:testConnection',
    async (
      _,
      params: Parameters<typeof modelsService.testConnection>[0],
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await modelsService.testConnection(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[models:testConnection] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'models:testSavedConnection',
    async (_, id: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await modelsService.testSavedConnection(id);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[models:testSavedConnection] Error:', msg);
        return err(msg);
      }
    },
  );
}
