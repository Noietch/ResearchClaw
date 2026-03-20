import { ipcMain } from 'electron';
import {
  tagPaper,
  organizePaperTags,
  tagUntaggedPapers,
  cancelTagging,
  getTaggingStatus,
  suggestConsolidation,
} from '../services/tagging.service';
import {
  extractMissingMetadata,
  extractAllMetadata,
  extractPaperMetadata,
  getMetadataExtractionStatus,
} from '../services/auto-paper-enrichment.service';
import { PapersRepository } from '@db';
import { IdSchema, TagNameSchema, validate } from './validate';
import { type IpcResult, ok, err } from '@shared';
import { z } from 'zod';

export function setupTaggingIpc() {
  // AI generate + categorize tags from paper content
  ipcMain.handle('tagging:tagPaper', async (_, paperId: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await tagPaper(paperId);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tagging:tagPaper] Error:', msg);
      return err(msg);
    }
  });

  // AI organize: re-categorize user-created flat tags into domain/method/topic
  ipcMain.handle(
    'tagging:organizePaper',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await organizePaperTags(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:organizePaper] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('tagging:tagUntagged', async (): Promise<IpcResult<{ started: boolean }>> => {
    try {
      tagUntaggedPapers().catch((e) => {
        console.error(
          '[tagging:tagUntagged] Background error:',
          e instanceof Error ? e.message : String(e),
        );
      });
      return ok({ started: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tagging:tagUntagged] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('tagging:cancel', (): IpcResult<{ cancelled: boolean }> => {
    try {
      cancelTagging();
      return ok({ cancelled: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tagging:cancel] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('tagging:status', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = getTaggingStatus();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tagging:status] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('tagging:suggestConsolidation', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await suggestConsolidation();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tagging:suggestConsolidation] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'tagging:merge',
    async (_, keep: unknown, remove: unknown): Promise<IpcResult<{ success: boolean }>> => {
      try {
        // Validate inputs
        const keepResult = validate(TagNameSchema, keep);
        if (!keepResult.success) {
          return err(`Invalid 'keep' tag: ${keepResult.error}`);
        }

        const removeResult = validate(z.array(TagNameSchema).min(1), remove);
        if (!removeResult.success) {
          return err(`Invalid 'remove' tags: ${removeResult.error}`);
        }

        const repo = new PapersRepository();
        await repo.mergeTag(keepResult.data, removeResult.data);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:merge] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'tagging:recategorize',
    async (_, name: string, newCategory: string): Promise<IpcResult<{ success: boolean }>> => {
      try {
        const repo = new PapersRepository();
        await repo.recategorizeTag(name, newCategory);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:recategorize] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'tagging:rename',
    async (_, oldName: string, newName: string): Promise<IpcResult<{ success: boolean }>> => {
      try {
        const repo = new PapersRepository();
        await repo.renameTag(oldName, newName);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:rename] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'tagging:deleteTag',
    async (_, name: string): Promise<IpcResult<{ success: boolean }>> => {
      try {
        const repo = new PapersRepository();
        await repo.deleteTag(name);
        return ok({ success: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:deleteTag] Error:', msg);
        return err(msg);
      }
    },
  );

  // Metadata extraction for papers missing abstract
  ipcMain.handle(
    'tagging:extractMissingMetadata',
    async (_, force?: boolean): Promise<IpcResult<{ extracted: number; failed: number }>> => {
      try {
        const result = force ? await extractAllMetadata() : await extractMissingMetadata();
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:extractMissingMetadata] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'tagging:metadataExtractionStatus',
    (): IpcResult<{ active: boolean; total: number; completed: number }> => {
      try {
        const result = getMetadataExtractionStatus();
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:metadataExtractionStatus] Error:', msg);
        return err(msg);
      }
    },
  );

  // Extract metadata for a single paper
  ipcMain.handle(
    'tagging:extractPaperMetadata',
    async (
      _,
      paperId: string,
    ): Promise<IpcResult<{ success: boolean; title?: string; abstract?: string }>> => {
      try {
        const result = await extractPaperMetadata(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[tagging:extractPaperMetadata] Error:', msg);
        return err(msg);
      }
    },
  );
}
