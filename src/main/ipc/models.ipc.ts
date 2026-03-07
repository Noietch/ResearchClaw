import { ipcMain } from 'electron';
import { modelsService } from '../services/models.service';
import type { ModelKind } from '../store/model-config-store';

export function setupModelsIpc() {
  ipcMain.handle('models:list', async () => {
    return modelsService.listModels();
  });

  ipcMain.handle('models:getActiveIds', async () => {
    return modelsService.getActiveIds();
  });

  ipcMain.handle('models:getActive', async (_, kind: ModelKind) => {
    return modelsService.getActive(kind);
  });

  ipcMain.handle('models:save', async (_, config: Parameters<typeof modelsService.save>[0]) => {
    return modelsService.save(config);
  });

  ipcMain.handle('models:delete', async (_, id: string) => {
    return modelsService.delete(id);
  });

  ipcMain.handle('models:setActive', async (_, kind: ModelKind, id: string) => {
    return modelsService.setActive(kind, id);
  });

  ipcMain.handle('models:getApiKey', async (_, id: string) => {
    return modelsService.getApiKey(id);
  });

  ipcMain.handle(
    'models:testConnection',
    async (_, params: Parameters<typeof modelsService.testConnection>[0]) => {
      return modelsService.testConnection(params);
    },
  );

  ipcMain.handle('models:testSavedConnection', async (_, id: string) => {
    return modelsService.testSavedConnection(id);
  });
}
