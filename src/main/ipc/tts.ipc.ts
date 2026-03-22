import { ipcMain } from 'electron';
import { type IpcResult, ok, err } from '@shared';
import {
  synthesizeText,
  stopSynthesis,
  getVoiceList,
  getDefaultVoice,
  cleanTtsCache,
  type TtsVoice,
  type TtsSynthesizeResult,
} from '../services/tts.service';

export function setupTtsIpc() {
  ipcMain.handle(
    'tts:synthesize',
    async (
      _,
      params: {
        text: string;
        voice?: string;
        rate?: string;
        volume?: string;
        pitch?: string;
      },
    ): Promise<IpcResult<TtsSynthesizeResult>> => {
      try {
        const result = await synthesizeText(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tts:synthesize] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('tts:stop', async (): Promise<IpcResult<{ success: boolean }>> => {
    try {
      stopSynthesis();
      return ok({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(msg);
    }
  });

  ipcMain.handle('tts:voices', async (): Promise<IpcResult<TtsVoice[]>> => {
    try {
      const voices = getVoiceList();
      return ok(voices);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(msg);
    }
  });

  ipcMain.handle(
    'tts:defaultVoice',
    async (_, language: string): Promise<IpcResult<{ voice: string }>> => {
      try {
        const voice = getDefaultVoice(language);
        return ok({ voice });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg);
      }
    },
  );

  ipcMain.handle('tts:cleanCache', async (): Promise<IpcResult<{ success: boolean }>> => {
    try {
      await cleanTtsCache();
      return ok({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(msg);
    }
  });
}
