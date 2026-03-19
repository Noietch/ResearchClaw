import fs from 'fs/promises';
import { existsSync, copyFileSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { BrowserWindow } from 'electron';

// sql.js is a CommonJS module - use require for proper initialization
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js');

import { PapersService } from './papers.service';
import { extractArxivId } from '@shared';

// ── Types ────────────────────────────────────────────────────────────────

export interface ZoteroDetectResult {
  found: boolean;
  dbPath: string;
  storageDir: string;
}

export interface ZoteroScannedItem {
  zoteroKey: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  abstract?: string;
  pdfPath?: string;
  collections: string[];
  itemType: string;
}

export interface ZoteroScanResult {
  items: ZoteroScannedItem[];
  newCount: number;
  existingCount: number;
  collections: string[];
}

export interface ZoteroImportStatus {
  active: boolean;
  total: number;
  completed: number;
  success: number;
  failed: number;
  skipped: number;
  phase: 'idle' | 'importing' | 'completed' | 'cancelled' | 'failed';
  message: string;
}

// ── State ────────────────────────────────────────────────────────────────

let zoteroStatus: ZoteroImportStatus = {
  active: false,
  total: 0,
  completed: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  phase: 'idle',
  message: '',
};

let zoteroCancelRequested = false;

function broadcastZoteroStatus() {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    win.webContents.send('zotero:status', zoteroStatus);
  }
}

export function getZoteroImportStatus(): ZoteroImportStatus {
  return { ...zoteroStatus };
}

export function cancelZoteroImport() {
  if (zoteroStatus.active) {
    zoteroCancelRequested = true;
  }
}

// ── Detection ────────────────────────────────────────────────────────────

function getDefaultZoteroDir(): string {
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin':
      return path.join(home, 'Zotero');
    case 'win32':
      return path.join(home, 'Zotero');
    case 'linux':
      return path.join(home, 'Zotero');
    default:
      return path.join(home, 'Zotero');
  }
}

export function detectZotero(customDbPath?: string): ZoteroDetectResult {
  if (customDbPath && existsSync(customDbPath)) {
    return {
      found: true,
      dbPath: customDbPath,
      storageDir: path.join(path.dirname(customDbPath), 'storage'),
    };
  }

  const zoteroDir = getDefaultZoteroDir();
  const dbPath = path.join(zoteroDir, 'zotero.sqlite');

  if (existsSync(dbPath)) {
    return {
      found: true,
      dbPath,
      storageDir: path.join(zoteroDir, 'storage'),
    };
  }

  return {
    found: false,
    dbPath,
    storageDir: path.join(zoteroDir, 'storage'),
  };
}

// ── Scanning ─────────────────────────────────────────────────────────────

export async function scanZoteroLibrary(
  dbPath?: string,
  collectionFilter?: string,
): Promise<ZoteroScanResult> {
  const detection = detectZotero(dbPath);
  if (!detection.found) {
    throw new Error(`Zotero database not found at: ${detection.dbPath}`);
  }

  // Copy DB to temp file (Zotero locks its DB while running)
  // Also copy WAL/SHM files if they exist (Zotero uses WAL mode)
  const tmpPath = path.join(os.tmpdir(), `zotero-${Date.now()}.sqlite`);
  copyFileSync(detection.dbPath, tmpPath);
  const walPath = detection.dbPath + '-wal';
  const shmPath = detection.dbPath + '-shm';
  if (existsSync(walPath)) copyFileSync(walPath, tmpPath + '-wal');
  if (existsSync(shmPath)) copyFileSync(shmPath, tmpPath + '-shm');

  try {
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbBuffer = readFileSync(tmpPath);
    const db = new SQL.Database(dbBuffer);

    // Query items (academic item types only, exclude deleted)
    const itemsResult = db.exec(`
      SELECT i.itemID, i.key, it.typeName
      FROM items i
      JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
      WHERE it.typeName IN (
        'journalArticle', 'conferencePaper', 'preprint', 'book',
        'bookSection', 'thesis', 'report', 'manuscript', 'webpage'
      )
      AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
    `);

    if (!itemsResult.length || !itemsResult[0].values.length) {
      db.close();
      return { items: [], newCount: 0, existingCount: 0, collections: [] };
    }

    const itemMap = new Map<
      number,
      { key: string; typeName: string; fields: Map<string, string> }
    >();
    for (const row of itemsResult[0].values) {
      const itemID = Number(row[0]);
      itemMap.set(itemID, {
        key: String(row[1]),
        typeName: String(row[2]),
        fields: new Map(),
      });
    }

    const itemIds = Array.from(itemMap.keys());

    // Query item data fields (title, DOI, abstract, url, date)
    const fieldsResult = db.exec(`
      SELECT id.itemID, f.fieldName, idv.value
      FROM itemData id
      JOIN itemDataValues idv ON id.valueID = idv.valueID
      JOIN fields f ON id.fieldID = f.fieldID
      WHERE id.itemID IN (${itemIds.join(',')})
      AND f.fieldName IN ('title', 'DOI', 'abstractNote', 'url', 'date')
    `);

    if (fieldsResult.length > 0) {
      for (const row of fieldsResult[0].values) {
        const itemID = Number(row[0]);
        const fieldName = String(row[1]);
        const value = String(row[2] ?? '');
        const item = itemMap.get(itemID);
        if (item) item.fields.set(fieldName, value);
      }
    }

    // Query authors
    const authorsMap = new Map<number, string[]>();
    const authorsResult = db.exec(`
      SELECT ic.itemID, c.firstName, c.lastName
      FROM itemCreators ic
      JOIN creators c ON ic.creatorID = c.creatorID
      JOIN creatorTypes ct ON ic.creatorTypeID = ct.creatorTypeID
      WHERE ic.itemID IN (${itemIds.join(',')})
      AND ct.creatorType IN ('author', 'contributor', 'editor')
      ORDER BY ic.itemID, ic.orderIndex
    `);

    if (authorsResult.length > 0) {
      for (const row of authorsResult[0].values) {
        const itemID = Number(row[0]);
        const firstName = String(row[1] ?? '').trim();
        const lastName = String(row[2] ?? '').trim();
        const name = [firstName, lastName].filter(Boolean).join(' ');
        if (!name) continue;
        const existing = authorsMap.get(itemID) ?? [];
        existing.push(name);
        authorsMap.set(itemID, existing);
      }
    }

    // Query PDF attachments
    const pdfMap = new Map<number, string>();
    const pdfResult = db.exec(`
      SELECT ia.parentItemID, ia.path
      FROM itemAttachments ia
      WHERE ia.contentType = 'application/pdf'
      AND ia.parentItemID IS NOT NULL
      AND ia.parentItemID IN (${itemIds.join(',')})
    `);

    if (pdfResult.length > 0) {
      for (const row of pdfResult[0].values) {
        const parentID = Number(row[0]);
        const rawPath = String(row[1] ?? '');
        if (!rawPath) continue;

        // Zotero stores paths as "storage:XXXXXXXX/filename.pdf"
        let resolvedPath: string;
        if (rawPath.startsWith('storage:')) {
          resolvedPath = path.join(detection.storageDir, rawPath.replace('storage:', ''));
        } else {
          resolvedPath = rawPath;
        }

        // Only set if file exists (first PDF attachment wins)
        if (!pdfMap.has(parentID) && existsSync(resolvedPath)) {
          pdfMap.set(parentID, resolvedPath);
        }
      }
    }

    // Query collections
    const collectionsMap = new Map<number, string[]>();
    const allCollections = new Set<string>();
    const collectionsResult = db.exec(`
      SELECT ci.itemID, c.collectionName
      FROM collectionItems ci
      JOIN collections c ON ci.collectionID = c.collectionID
      WHERE ci.itemID IN (${itemIds.join(',')})
    `);

    if (collectionsResult.length > 0) {
      for (const row of collectionsResult[0].values) {
        const itemID = Number(row[0]);
        const collectionName = String(row[1] ?? '');
        if (!collectionName) continue;
        allCollections.add(collectionName);
        const existing = collectionsMap.get(itemID) ?? [];
        existing.push(collectionName);
        collectionsMap.set(itemID, existing);
      }
    }

    db.close();

    // Build scanned items
    const papersService = new PapersService();
    const existingShortIds = await papersService.listAllShortIds();

    let newCount = 0;
    let existingCount = 0;
    const items: ZoteroScannedItem[] = [];

    for (const [itemID, item] of itemMap) {
      const title = item.fields.get('title');
      if (!title) continue;

      const collections = collectionsMap.get(itemID) ?? [];
      if (collectionFilter && !collections.includes(collectionFilter)) continue;

      const doi = item.fields.get('DOI') || undefined;
      const url = item.fields.get('url') || undefined;
      const abstract = item.fields.get('abstractNote') || undefined;
      const dateStr = item.fields.get('date') || '';
      const yearMatch = dateStr.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      // Check if already exists
      const shortId = getShortIdForZoteroItem(item.key, doi, url);
      const exists = existingShortIds.has(shortId);
      if (exists) {
        existingCount++;
      } else {
        newCount++;
      }

      items.push({
        zoteroKey: item.key,
        title,
        authors: authorsMap.get(itemID) ?? [],
        year,
        doi,
        url,
        abstract,
        pdfPath: pdfMap.get(itemID),
        collections,
        itemType: item.typeName,
      });
    }

    return {
      items,
      newCount,
      existingCount,
      collections: Array.from(allCollections).sort(),
    };
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
    await fs.unlink(tmpPath + '-wal').catch(() => undefined);
    await fs.unlink(tmpPath + '-shm').catch(() => undefined);
  }
}

function getShortIdForZoteroItem(zoteroKey: string, doi?: string, url?: string): string {
  // If URL contains arXiv, use arXiv ID
  if (url) {
    const arxivId = extractArxivId(url);
    if (arxivId) return arxivId;
  }
  // If DOI exists, use DOI-based shortId
  if (doi) {
    const sanitized = doi.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 80);
    return `doi-${sanitized}`;
  }
  // Fallback to zotero key
  return `zotero-${zoteroKey}`;
}

// ── Import ───────────────────────────────────────────────────────────────

const CONCURRENCY = 8;

export async function importZoteroPapers(
  items: ZoteroScannedItem[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  if (zoteroStatus.active) {
    throw new Error('A Zotero import is already in progress');
  }

  const papersService = new PapersService();
  zoteroCancelRequested = false;

  const existingShortIds = await papersService.listAllShortIds();

  zoteroStatus = {
    active: true,
    total: items.length,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    phase: 'importing',
    message: `Importing ${items.length} papers from Zotero…`,
  };
  broadcastZoteroStatus();

  let success = 0;
  let failed = 0;
  let skipped = 0;

  let idx = 0;
  async function worker() {
    while (!zoteroCancelRequested) {
      const i = idx++;
      if (i >= items.length) break;
      const item = items[i];
      try {
        const shortId = getShortIdForZoteroItem(item.zoteroKey, item.doi, item.url);
        if (existingShortIds.has(shortId)) {
          skipped++;
          zoteroStatus.completed++;
          zoteroStatus.skipped = skipped;
          zoteroStatus.message = `Importing… ${zoteroStatus.completed}/${items.length}`;
          broadcastZoteroStatus();
          continue;
        }

        // Determine source type
        let source: 'zotero' | 'arxiv' = 'zotero';
        let sourceUrl = item.url;
        const arxivId = item.url ? extractArxivId(item.url) : null;
        if (arxivId) {
          source = 'arxiv';
          sourceUrl = `https://arxiv.org/abs/${arxivId}`;
        }

        // Copy PDF to papers dir if available
        let localPdfPath: string | undefined;
        if (item.pdfPath && existsSync(item.pdfPath)) {
          const targetShortId = shortId;
          const papersDir = (await import('../store/app-settings-store')).getPapersDir();
          const paperFolder = path.join(papersDir, targetShortId);
          await fs.mkdir(paperFolder, { recursive: true });
          await fs.mkdir(path.join(paperFolder, 'notes'), { recursive: true });
          localPdfPath = path.join(paperFolder, 'paper.pdf');
          await fs.copyFile(item.pdfPath, localPdfPath);
        }

        await papersService.upsertFromIngest({
          title: item.title,
          source,
          sourceUrl,
          tags: [],
          authors: item.authors,
          abstract: item.abstract,
          submittedAt: item.year ? new Date(`${item.year}-01-01T00:00:00Z`) : undefined,
          doi: item.doi,
          pdfPath: localPdfPath,
        });

        existingShortIds.add(shortId);
        success++;
      } catch (err) {
        console.error('[zotero] Failed to import:', item.title, err);
        failed++;
      }

      zoteroStatus.completed++;
      zoteroStatus.success = success;
      zoteroStatus.failed = failed;
      zoteroStatus.skipped = skipped;
      zoteroStatus.message = `Importing… ${zoteroStatus.completed}/${items.length} (${success} new, ${skipped} skipped)`;
      broadcastZoteroStatus();
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  if (zoteroCancelRequested) {
    zoteroStatus = {
      ...zoteroStatus,
      active: false,
      phase: 'cancelled',
      message: `Cancelled: ${success} imported, ${skipped} skipped`,
    };
  } else {
    zoteroStatus = {
      ...zoteroStatus,
      active: false,
      phase: 'completed',
      message: `Done: ${success} new, ${skipped} skipped${failed > 0 ? `, ${failed} failed` : ''}`,
    };
  }
  broadcastZoteroStatus();

  // Auto-trigger background tagging
  if (success > 0) {
    import('./tagging.service')
      .then(({ tagUntaggedPapers }) => {
        tagUntaggedPapers().catch((err) =>
          console.error('[zotero] Background tagging failed:', err),
        );
      })
      .catch(() => undefined);
  }

  return { imported: success, skipped, failed };
}
