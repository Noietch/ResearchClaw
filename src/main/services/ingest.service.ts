import fs from 'fs/promises';
import { existsSync, copyFileSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import initSqlJs from 'sql.js';
import { BrowserWindow } from 'electron';

import { PapersService } from './papers.service';
import { DownloadService } from './download.service';
import { isInvalidTitle } from '@shared';

export type ImportPhase =
  | 'idle'
  | 'scanning'
  | 'parsing_history'
  | 'upserting_papers'
  | 'downloading_pdfs'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ImportStatus {
  active: boolean;
  total: number;
  completed: number;
  success: number;
  failed: number;
  skipped: number;
  phase: ImportPhase;
  message: string;
  lastImportAt: string | null;
  lastImportCount: number;
  previewPapers?: Array<{ arxivId: string; title: string }>;
}

export interface ScanResult {
  papers: Array<{ arxivId: string; title: string; url: string }>;
  newCount: number;
  existingCount: number;
}

let currentStatus: ImportStatus = {
  active: false,
  total: 0,
  completed: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  phase: 'idle',
  message: '',
  lastImportAt: null,
  lastImportCount: 0,
};

// Cancellation support
let cancelRequested = false;

export function cancelImport() {
  if (currentStatus.active) {
    cancelRequested = true;
  }
}

function broadcastStatus() {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    win.webContents.send('ingest:status', currentStatus);
  }
}

export function getImportStatus(): ImportStatus {
  return { ...currentStatus };
}

function getChromeHistoryPath(): string {
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin':
      return path.join(
        home,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'Default',
        'History',
      );
    case 'win32':
      return path.join(
        home,
        'AppData',
        'Local',
        'Google',
        'Chrome',
        'User Data',
        'Default',
        'History',
      );
    case 'linux':
      return path.join(home, '.config', 'google-chrome', 'Default', 'History');
    default:
      throw new Error(`Unsupported platform: ${os.platform()}`);
  }
}

/**
 * Scan Chrome history for arXiv papers without importing.
 * Returns list of papers with info about which are new vs existing.
 */
export async function scanChromeHistory(days: number | null = 1): Promise<ScanResult> {
  // SECURITY: Validate days parameter to prevent injection
  if (days !== null) {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0 || days > 3650) {
      throw new Error('Invalid days parameter: must be a positive number <= 3650');
    }
    days = Math.floor(days); // Ensure integer
  }

  const papersService = new PapersService();
  currentStatus = {
    active: true,
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    phase: 'scanning',
    message: 'Scanning Chrome history...',
    lastImportAt: null,
    lastImportCount: 0,
  };
  broadcastStatus();

  try {
    const historyPath = getChromeHistoryPath();
    if (!existsSync(historyPath)) {
      throw new Error(`Chrome History not found at: ${historyPath}`);
    }
    // Copy DB first (Chrome locks it while running)
    const tmpPath = path.join(os.tmpdir(), `chrome-history-${Date.now()}.db`);
    copyFileSync(historyPath, tmpPath);

    try {
      let whereClause = `url LIKE '%arxiv.org%'`;
      if (days !== null) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        whereClause += ` AND last_visit_time >= ${toChromeTime(since)}`;
      }
      const sql = `SELECT title, url FROM urls WHERE ${whereClause} ORDER BY last_visit_time DESC LIMIT 500;`;

      // Use sql.js (pure JS SQLite) instead of system sqlite3 CLI
      const SQL = await initSqlJs({
        // sql.js needs to locate its WASM file; in Node.js it finds it automatically
        locateFile: (file: string) => {
          // Try multiple locations for the WASM file
          const candidates = [
            path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
            path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
            require.resolve(`sql.js/dist/${file}`),
          ];
          for (const p of candidates) {
            if (existsSync(p)) return p;
          }
          // Fallback: let sql.js use its default behavior
          return file;
        },
      });
      const dbBuffer = readFileSync(tmpPath);
      const db = new SQL.Database(dbBuffer);
      const result = db.exec(sql);
      db.close();

      const entries: Array<{ title: string; url: string }> = [];
      if (result.length > 0 && result[0].values) {
        for (const row of result[0].values) {
          const title = String(row[0] || '');
          const url = String(row[1] || '');
          if (url.includes('arxiv.org')) {
            entries.push({ title: title.trim() || url.trim(), url: url.trim() });
          }
        }
      }

      // Check which arxiv IDs already exist
      const existingShortIds = await papersService.listAllShortIds();
      const papers: ScanResult['papers'] = [];
      let newCount = 0;
      let existingCount = 0;
      const seen = new Set<string>();

      for (const entry of entries) {
        const arxivMatch = entry.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
        const arxivId = arxivMatch ? arxivMatch[1].replace(/v\d+$/, '') : null;
        if (!arxivId || seen.has(arxivId)) continue;
        seen.add(arxivId);

        // Fetch title if needed
        let rawTitle = entry.title.trim();
        if (isInvalidTitle(rawTitle)) {
          try {
            const res = await fetch(`https://arxiv.org/abs/${arxivId}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const html = await res.text();
              const m = html.match(/<title>([^<]+)<\/title>/i);
              if (m) rawTitle = m[1].replace(/^\[[\w./-]+\]\s*/, '').trim();
            }
          } catch {
            rawTitle = arxivId;
          }
        }

        const exists = existingShortIds.has(arxivId);
        if (exists) {
          existingCount++;
        } else {
          newCount++;
        }
        papers.push({ arxivId, title: rawTitle, url: entry.url });
      }

      currentStatus = {
        ...currentStatus,
        active: false,
        phase: 'completed',
        message: `Found ${papers.length} papers (${newCount} new, ${existingCount} existing)`,
      };
      broadcastStatus();

      return { papers, newCount, existingCount };
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  } catch (err) {
    currentStatus = { ...currentStatus, active: false, phase: 'failed', message: String(err) };
    broadcastStatus();
    throw err;
  }
}

/**
 * Import papers from a pre-scanned list (from scanChromeHistory).
 */
export async function importScannedPapers(
  papers: Array<{ arxivId: string; title: string; url: string }>,
) {
  const papersService = new PapersService();
  cancelRequested = false;

  currentStatus = {
    active: true,
    total: papers.length,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    phase: 'upserting_papers',
    message: `Importing ${papers.length} papers…`,
    lastImportAt: null,
    lastImportCount: 0,
  };
  broadcastStatus();

  const entries = papers.map((p) => ({
    title: p.title,
    url: p.url,
  }));

  return runImport(entries, papersService);
}

export async function importChromeHistoryFromFile(filePath: string) {
  const papersService = new PapersService();
  currentStatus = {
    active: true,
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    phase: 'parsing_history',
    message: 'Parsing Chrome history export...',
    lastImportAt: null,
    lastImportCount: 0,
  };
  broadcastStatus();

  let entries: Array<{ title: string; url: string; abstract?: string }> = [];
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Array<{ title?: string; url?: string; abstract?: string }>;
    entries = parsed
      .filter((e) => e.url?.includes('arxiv.org'))
      .map((e) => ({
        title: e.title?.trim() || e.url || 'Untitled',
        url: e.url as string,
        abstract: e.abstract,
      }));
  } catch (err) {
    currentStatus = { ...currentStatus, active: false, phase: 'failed', message: String(err) };
    broadcastStatus();
    throw err;
  }

  return runImport(entries, papersService);
}

// Chrome stores time as microseconds since 1601-01-01 00:00:00 UTC
function toChromeTime(date: Date): number {
  const epochDiff = 11644473600000; // ms between 1601-01-01 and 1970-01-01
  return (date.getTime() + epochDiff) * 1000;
}

export async function importChromeHistoryAuto(days: number | null = 1) {
  // SECURITY: Validate days parameter to prevent injection
  if (days !== null) {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0 || days > 3650) {
      throw new Error('Invalid days parameter: must be a positive number <= 3650');
    }
    days = Math.floor(days); // Ensure integer
  }

  const papersService = new PapersService();
  currentStatus = {
    active: true,
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    phase: 'parsing_history',
    message: 'Reading Chrome history database...',
    lastImportAt: null,
    lastImportCount: 0,
  };
  broadcastStatus();

  let entries: Array<{ title: string; url: string; abstract?: string }> = [];
  try {
    const historyPath = getChromeHistoryPath();
    if (!existsSync(historyPath)) {
      throw new Error(`Chrome History not found at: ${historyPath}`);
    }
    // Copy DB first (Chrome locks it while running)
    const tmpPath = path.join(os.tmpdir(), `chrome-history-${Date.now()}.db`);
    copyFileSync(historyPath, tmpPath);

    try {
      let whereClause = `url LIKE '%arxiv.org%'`;
      if (days !== null) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        whereClause += ` AND last_visit_time >= ${toChromeTime(since)}`;
      }
      const sql = `SELECT title, url FROM urls WHERE ${whereClause} ORDER BY last_visit_time DESC LIMIT 500;`;

      // Use sql.js (pure JS SQLite) instead of system sqlite3 CLI
      const SQL = await initSqlJs({
        locateFile: (file: string) => {
          const candidates = [
            path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
            path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
            require.resolve(`sql.js/dist/${file}`),
          ];
          for (const p of candidates) {
            if (existsSync(p)) return p;
          }
          return file;
        },
      });
      const dbBuffer = readFileSync(tmpPath);
      const db = new SQL.Database(dbBuffer);
      const result = db.exec(sql);
      db.close();

      if (result.length > 0 && result[0].values) {
        for (const row of result[0].values) {
          const title = String(row[0] || '');
          const url = String(row[1] || '');
          if (url.includes('arxiv.org')) {
            entries.push({ title: title.trim() || url.trim(), url: url.trim() });
          }
        }
      }
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  } catch (err) {
    currentStatus = { ...currentStatus, active: false, phase: 'failed', message: String(err) };
    broadcastStatus();
    throw err;
  }

  return runImport(entries, papersService);
}

const CONCURRENCY = 6;

/** Run tasks with a fixed concurrency pool, supporting cancellation */
async function withConcurrencyCancellable<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = CONCURRENCY,
): Promise<{ cancelled: boolean }> {
  let idx = 0;
  let cancelled = false;
  async function worker() {
    while (idx < items.length && !cancelRequested) {
      const item = items[idx++];
      await fn(item);
    }
    if (cancelRequested) cancelled = true;
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { cancelled };
}

async function runImport(
  entries: Array<{ title: string; url: string; abstract?: string }>,
  papersService: PapersService,
) {
  const downloadService = new DownloadService();
  cancelRequested = false;

  // Batch check existing shortIds upfront (avoid concurrent per-entry queries)
  const existingShortIds = await papersService.listAllShortIds();

  currentStatus = {
    ...currentStatus,
    phase: 'upserting_papers',
    total: entries.length,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    message: `Importing ${entries.length} papers…`,
  };
  broadcastStatus();

  const previewTitles: string[] = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;

  const { cancelled } = await withConcurrencyCancellable(entries, async (entry) => {
    try {
      const arxivMatch = entry.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
      const arxivId = arxivMatch ? arxivMatch[1].replace(/v\d+$/, '') : null;

      // Skip if already exists locally (check via Set lookup)
      if (arxivId && existingShortIds.has(arxivId)) {
        skipped++;
        currentStatus.completed++;
        currentStatus.skipped = skipped;
        currentStatus.message = `Importing… ${currentStatus.completed}/${entries.length} (${success} new, ${skipped} skipped)`;
        broadcastStatus();
        return;
      }

      // Fetch metadata from arXiv (title, authors, abstract, year)
      let rawTitle = entry.title.trim();
      let authors: string[] = [];
      let abstract = '';
      let year: number | undefined;

      if (arxivId) {
        try {
          const res = await fetch(`https://arxiv.org/abs/${arxivId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const html = await res.text();
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) rawTitle = titleMatch[1].replace(/^\[[\w./-]+\]\s*/, '').trim();
            const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g);
            for (const m of authorMatches) authors.push(m[1]);
            const absMatch = html.match(/<meta name="citation_abstract" content="([^"]+)"/i);
            if (absMatch) abstract = absMatch[1].replace(/\n/g, ' ').trim();
            const yearMatch = html.match(/\[Submitted on (\d{1,2}) \w+\.? (\d{4})/i);
            if (yearMatch) year = parseInt(yearMatch[2], 10);
          }
        } catch {
          /* keep original */
        }
      }

      const title = rawTitle;

      // Tags are now assigned by background tagging service
      const tags: string[] = [];

      const paper = await papersService.upsertFromIngest({
        title,
        source: 'arxiv',
        sourceUrl: entry.url,
        tags,
        authors,
        abstract,
        year,
      });

      // Add to Set after successful import
      if (arxivId) existingShortIds.add(arxivId);

      previewTitles.push(title);

      // Download PDF immediately after import
      if (!paper.pdfPath && arxivId) {
        try {
          await downloadService.downloadPdfById(paper.id, `https://arxiv.org/pdf/${arxivId}.pdf`);
        } catch {
          /* non-fatal */
        }
      }

      success++;
    } catch (err) {
      console.error('[import] Failed to import:', entry.url, err);
      failed++;
    }
    currentStatus.completed++;
    currentStatus.success = success;
    currentStatus.failed = failed;
    currentStatus.skipped = skipped;
    currentStatus.message = `Importing… ${currentStatus.completed}/${entries.length} (${success} new, ${skipped} skipped)`;
    broadcastStatus();
  });

  if (cancelled) {
    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'cancelled',
      message: `Cancelled: ${success} imported, ${skipped} skipped`,
    };
  } else {
    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'completed',
      message: `Done: ${success} new, ${skipped} skipped`,
      lastImportAt: new Date().toISOString(),
      lastImportCount: success,
    };
  }
  broadcastStatus();

  // Auto-trigger background tagging for newly imported papers
  if (success > 0) {
    import('./tagging.service')
      .then(({ tagUntaggedPapers }) => {
        tagUntaggedPapers().catch((err) =>
          console.error('[ingest] Background tagging failed:', err),
        );
      })
      .catch(() => undefined);
  }

  return { imported: success, skipped, previewTitles: previewTitles.slice(0, 5) };
}

/**
 * Scan a local papers directory (e.g. ~/.vibe-research/papers).
 * Each subfolder named like an arXiv ID is imported; existing records are skipped.
 */
export async function scanLocalPapersDir(dir: string) {
  const papersService = new PapersService();

  currentStatus = {
    active: true,
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    phase: 'parsing_history',
    message: 'Scanning local papers folder…',
    lastImportAt: null,
    lastImportCount: 0,
  };
  broadcastStatus();

  let folders: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    folders = entries
      .filter((e) => e.isDirectory() && /^\d{4}\.\d{4,5}(v\d+)?$/.test(e.name))
      .map((e) => e.name);
  } catch (err) {
    currentStatus = { ...currentStatus, active: false, phase: 'failed', message: String(err) };
    broadcastStatus();
    throw err;
  }

  // Batch check existing shortIds upfront
  const existingShortIds = await papersService.listAllShortIds();

  currentStatus = {
    ...currentStatus,
    phase: 'upserting_papers',
    total: folders.length,
    message: `Found ${folders.length} papers, importing…`,
  };
  broadcastStatus();

  let success = 0;
  let failed = 0;
  let skipped = 0;

  const { cancelled } = await withConcurrencyCancellable(folders, async (arxivId) => {
    try {
      const displayId = arxivId.replace(/v\d+$/, '');

      // Skip if already in DB (check via Set lookup)
      if (existingShortIds.has(displayId)) {
        skipped++;
        currentStatus.completed++;
        currentStatus.skipped = skipped;
        currentStatus.message = `Importing… ${currentStatus.completed}/${folders.length} (${success} new, ${skipped} skipped)`;
        broadcastStatus();
        return;
      }

      // Fetch metadata from arXiv
      let rawTitle = '';
      let authors: string[] = [];
      let abstract = '';
      let year: number | undefined;

      try {
        const metaRes = await fetch(`https://arxiv.org/abs/${displayId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
          signal: AbortSignal.timeout(10000),
        });
        if (metaRes.ok) {
          const html = await metaRes.text();
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) rawTitle = titleMatch[1].replace(/^\[[\w./-]+\]\s*/, '').trim();
          const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g);
          for (const m of authorMatches) authors.push(m[1]);
          const absMatch = html.match(/<meta name="citation_abstract" content="([^"]+)"/i);
          if (absMatch) abstract = absMatch[1].replace(/\n/g, ' ').trim();
          const yearMatch = html.match(/\[Submitted on (\d{1,2}) \w+\.? (\d{4})/i);
          if (yearMatch) year = parseInt(yearMatch[2], 10);
        }
      } catch {
        /* fall back to arxivId */
      }

      const title = rawTitle || displayId;

      const localPdfPath = path.join(dir, arxivId, 'paper.pdf');
      const hasPdf = existsSync(localPdfPath);
      // Tags are now assigned by background tagging service
      const tags: string[] = [];

      await papersService.create({
        title,
        source: 'arxiv',
        sourceUrl: `https://arxiv.org/abs/${displayId}`,
        authors,
        abstract,
        year,
        tags,
        pdfUrl: `https://arxiv.org/pdf/${displayId}.pdf`,
        ...(hasPdf ? { pdfPath: localPdfPath } : {}),
      });

      // Add to Set after successful import
      existingShortIds.add(displayId);

      success++;
    } catch (err) {
      console.error(`[scanLocalPapersDir] Failed to import ${arxivId}:`, err);
      failed++;
    }

    currentStatus.completed++;
    currentStatus.success = success;
    currentStatus.failed = failed;
    currentStatus.skipped = skipped;
    currentStatus.message = `Importing… ${currentStatus.completed}/${folders.length} (${success} new, ${skipped} skipped)`;
    broadcastStatus();
  });

  if (cancelled) {
    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'cancelled',
      message: `Cancelled: ${success} imported, ${skipped} skipped`,
    };
  } else {
    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'completed',
      message: `Done: ${success} new, ${skipped} skipped${failed > 0 ? `, ${failed} failed` : ''}`,
      lastImportAt: new Date().toISOString(),
      lastImportCount: success,
    };
  }
  broadcastStatus();

  return { imported: success, skipped, failed };
}
