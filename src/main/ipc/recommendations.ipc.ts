import { ipcMain } from 'electron';
import { ok, err, type IpcResult } from '@shared';
import { RecommendationService } from '../services/recommendation.service';

let recommendationService: RecommendationService | null = null;

function getService() {
  if (!recommendationService) recommendationService = new RecommendationService();
  return recommendationService;
}

export function setupRecommendationsIpc() {
  ipcMain.handle(
    'recommendations:list',
    async (_, filter?: { status?: 'new' | 'ignored' | 'saved' }): Promise<IpcResult<unknown>> => {
      try {
        return ok(await getService().listRecommendations(filter));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[recommendations:list] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'recommendations:refresh',
    async (_, limit?: number): Promise<IpcResult<unknown>> => {
      try {
        return ok(await getService().generateRecommendations(limit));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[recommendations:refresh] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'recommendations:ignore',
    async (_, candidateId: string): Promise<IpcResult<unknown>> => {
      try {
        await getService().ignoreRecommendation(candidateId);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[recommendations:ignore] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'recommendations:save',
    async (_, candidateId: string): Promise<IpcResult<unknown>> => {
      try {
        return ok(await getService().saveRecommendation(candidateId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[recommendations:save] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'recommendations:opened',
    async (_, candidateId: string): Promise<IpcResult<unknown>> => {
      try {
        await getService().trackRecommendationOpen(candidateId);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[recommendations:opened] Error:', msg);
        return err(msg);
      }
    },
  );
}
