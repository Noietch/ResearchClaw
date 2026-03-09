import { ipcMain } from 'electron';
import { ok, err, type IpcResult, type UserProfile } from '@shared';
import { UserProfileService } from '../services/user-profile.service';

let userProfileService: UserProfileService | null = null;

function getUserProfileService() {
  if (!userProfileService) userProfileService = new UserProfileService();
  return userProfileService;
}

export function setupUserProfileIpc() {
  ipcMain.handle('userProfile:get', async (): Promise<IpcResult<unknown>> => {
    try {
      return ok(await getUserProfileService().getProfile());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[userProfile:get] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'userProfile:update',
    async (_, input: Partial<UserProfile>): Promise<IpcResult<unknown>> => {
      try {
        return ok(await getUserProfileService().updateProfile(input));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[userProfile:update] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('userProfile:generateSummary', async (): Promise<IpcResult<unknown>> => {
    try {
      return ok(await getUserProfileService().generateSummary());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[userProfile:generateSummary] Error:', msg);
      return err(msg);
    }
  });
}
