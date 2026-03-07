import { ipcMain } from 'electron';
import {
  tagPaper,
  organizePaperTags,
  tagUntaggedPapers,
  cancelTagging,
  getTaggingStatus,
  suggestConsolidation,
} from '../services/tagging.service';
import { PapersRepository } from '@db';

export function setupTaggingIpc() {
  // AI generate + categorize tags from paper content
  ipcMain.handle('tagging:tagPaper', async (_, paperId: string) => {
    return tagPaper(paperId);
  });

  // AI organize: re-categorize user-created flat tags into domain/method/topic
  ipcMain.handle('tagging:organizePaper', async (_, paperId: string) => {
    return organizePaperTags(paperId);
  });

  ipcMain.handle('tagging:tagUntagged', async () => {
    tagUntaggedPapers().catch(() => undefined);
    return { started: true };
  });

  ipcMain.handle('tagging:cancel', () => {
    cancelTagging();
    return { cancelled: true };
  });

  ipcMain.handle('tagging:status', async () => {
    return getTaggingStatus();
  });

  ipcMain.handle('tagging:suggestConsolidation', async () => {
    return suggestConsolidation();
  });

  ipcMain.handle('tagging:merge', async (_, keep: string, remove: string[]) => {
    const repo = new PapersRepository();
    await repo.mergeTag(keep, remove);
    return { success: true };
  });

  ipcMain.handle('tagging:recategorize', async (_, name: string, newCategory: string) => {
    const repo = new PapersRepository();
    await repo.recategorizeTag(name, newCategory);
    return { success: true };
  });

  ipcMain.handle('tagging:rename', async (_, oldName: string, newName: string) => {
    const repo = new PapersRepository();
    await repo.renameTag(oldName, newName);
    return { success: true };
  });

  ipcMain.handle('tagging:deleteTag', async (_, name: string) => {
    const repo = new PapersRepository();
    await repo.deleteTag(name);
    return { success: true };
  });
}
