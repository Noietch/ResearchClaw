import { ipcMain } from 'electron';
import { type IpcResult, ok, err } from '@shared';
import {
  inlineAI,
  generatePaperOutline,
  generateReadingSummary,
  getPageText,
} from '../services/reader-ai.service';
import { translateText } from '../services/translate.service';

export function setupReaderAiIpc() {
  ipcMain.handle(
    'reader:inlineAI',
    async (
      _,
      params: {
        paperId: string;
        action: string;
        selectedText: string;
        pageNumber?: number;
        language: string;
      },
    ): Promise<IpcResult<{ result: string }>> => {
      try {
        const result = await inlineAI(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reader:inlineAI] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reader:paperOutline',
    async (
      _,
      params: {
        paperId: string;
        shortId: string;
        language: string;
      },
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await generatePaperOutline(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reader:paperOutline] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reader:readingSummary',
    async (
      _,
      params: {
        paperId: string;
        highlights: Array<{ text: string; note?: string; color: string; page: number }>;
        language: string;
      },
    ): Promise<IpcResult<{ summary: string }>> => {
      try {
        const result = await generateReadingSummary(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reader:readingSummary] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reader:translate',
    async (
      _,
      params: {
        text: string;
        targetLanguage: string;
      },
    ): Promise<IpcResult<{ translatedText: string; detectedLanguage: string }>> => {
      try {
        const result = await translateText(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reader:translate] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'reader:getPageText',
    async (
      _,
      params: {
        pdfPath: string;
        pageNumber: number;
      },
    ): Promise<IpcResult<{ text: string }>> => {
      try {
        const result = await getPageText(params);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reader:getPageText] Error:', msg);
        return err(msg);
      }
    },
  );
}
