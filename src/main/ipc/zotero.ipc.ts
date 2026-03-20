import { ipcMain } from 'electron';
import fs from 'fs/promises';
import {
  detectZotero,
  scanZoteroLibrary,
  importZoteroPapers,
  cancelZoteroImport,
  getZoteroImportStatus,
  type ZoteroScannedItem,
  type ZoteroDetectResult,
  type ZoteroScanResult,
  type ZoteroImportStatus,
} from '../services/zotero.service';
import {
  resolveByDoi,
  resolveByUrl,
  isDoi,
  extractDoiFromUrl,
} from '../services/doi-resolver.service';
import { parseBibtexString, parseRisString, type ParsedPaperEntry } from '@shared';
import { PapersService } from '../services/papers.service';
import { type IpcResult, ok, err } from '@shared';

export function setupZoteroIpc() {
  // ── Zotero detect ────────────────────────────────────────────────────
  ipcMain.handle('zotero:detect', (_, customDbPath?: string): IpcResult<ZoteroDetectResult> => {
    try {
      const result = detectZotero(customDbPath);
      return ok(result);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  });

  // ── Zotero scan ──────────────────────────────────────────────────────
  ipcMain.handle(
    'zotero:scan',
    async (
      _,
      opts?: { dbPath?: string; collection?: string },
    ): Promise<IpcResult<ZoteroScanResult>> => {
      try {
        const result = await scanZoteroLibrary(opts?.dbPath, opts?.collection);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[zotero:scan] Error:', msg);
        return err(msg);
      }
    },
  );

  // ── Zotero import (fire-and-forget) ──────────────────────────────────
  ipcMain.handle(
    'zotero:import',
    (_, items: ZoteroScannedItem[]): IpcResult<{ started: boolean }> => {
      importZoteroPapers(items).catch((e) => {
        console.error('[zotero:import] Error:', e instanceof Error ? e.message : String(e));
      });
      return ok({ started: true });
    },
  );

  // ── Zotero cancel ────────────────────────────────────────────────────
  ipcMain.handle('zotero:cancel', (): IpcResult<{ cancelled: boolean }> => {
    try {
      cancelZoteroImport();
      return ok({ cancelled: true });
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  });

  // ── Zotero status ────────────────────────────────────────────────────
  ipcMain.handle('zotero:status', (): IpcResult<ZoteroImportStatus> => {
    try {
      return ok(getZoteroImportStatus());
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  });

  // ── BibTeX/RIS parsing ───────────────────────────────────────────────
  ipcMain.handle(
    'zotero:parseBibtex',
    async (_, filePath: string): Promise<IpcResult<ParsedPaperEntry[]>> => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const entries = parseBibtexString(content);
        return ok(entries);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[zotero:parseBibtex] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'zotero:parseRis',
    async (_, filePath: string): Promise<IpcResult<ParsedPaperEntry[]>> => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const entries = parseRisString(content);
        return ok(entries);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[zotero:parseRis] Error:', msg);
        return err(msg);
      }
    },
  );

  // ── Import parsed BibTeX/RIS entries ─────────────────────────────────
  ipcMain.handle(
    'zotero:importParsed',
    async (
      _,
      entries: ParsedPaperEntry[],
    ): Promise<IpcResult<{ imported: number; skipped: number }>> => {
      try {
        const papersService = new PapersService();
        let imported = 0;
        let skipped = 0;

        for (const entry of entries) {
          try {
            const result = await papersService.upsertFromIngest({
              title: entry.title,
              source: 'bibtex',
              sourceUrl: entry.url,
              tags: [],
              authors: entry.authors,
              abstract: entry.abstract,
              submittedAt: entry.year ? new Date(`${entry.year}-01-01T00:00:00Z`) : undefined,
              doi: entry.doi,
            });
            if (result) imported++; // includes both new and existing (upsert)
          } catch {
            skipped++;
          }
        }

        return ok({ imported, skipped });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // ── DOI import ───────────────────────────────────────────────────────
  ipcMain.handle(
    'papers:importByDoi',
    async (_, input: string): Promise<IpcResult<{ paper: unknown; source: string }>> => {
      try {
        const trimmed = input.trim();
        let metadata;
        let source = 'doi';

        if (isDoi(trimmed)) {
          metadata = await resolveByDoi(trimmed);
        } else {
          // Try URL
          const doi = extractDoiFromUrl(trimmed);
          if (doi) {
            metadata = await resolveByDoi(doi);
          }
          if (!metadata) {
            metadata = await resolveByUrl(trimmed);
            source = 'url';
          }
        }

        if (!metadata) {
          return err('Could not resolve paper metadata. Please check the DOI or URL.');
        }

        const papersService = new PapersService();
        const paper = await papersService.upsertFromIngest({
          title: metadata.title,
          source: 'doi',
          sourceUrl: metadata.url ?? trimmed,
          tags: [],
          authors: metadata.authors,
          abstract: metadata.abstract,
          submittedAt: metadata.year ? new Date(`${metadata.year}-01-01T00:00:00Z`) : undefined,
          doi: metadata.doi,
        });

        return ok({ paper, source });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
