import fs from 'fs/promises';
import { existsSync, copyFileSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { BrowserWindow } from 'electron';

// sql.js is a CommonJS module - use require for proper initialization
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js');

import { PapersService } from './papers.service';
import { DownloadService } from './download.service';
import { isInvalidTitle, arxivPdfUrl } from '@shared';

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
  pdfFailed: number;
  phase: ImportPhase;
  message: string;
  lastImportAt: string | null;
  lastImportCount: number;
  previewPapers?: Array<{ arxivId: string; title: string }>;
}

export interface ScanResult {
  papers: Array<{ arxivId: string; title: string; url: string; existing?: boolean }>;
  newCount: number;
  existingCount: number;
}

export interface DownloadedPdf {
  filePath: string;
  fileName: string;
  browser: string;
  downloadTime: string; // ISO string
  fileSize: number; // bytes
}

let currentStatus: ImportStatus = {
  active: false,
  total: 0,
  completed: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  pdfFailed: 0,
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

interface BrowserInfo {
  name: string;
  path: string;
}

function getAvailableBrowsers(): BrowserInfo[] {
  const home = os.homedir();
  const platform = os.platform();
  const browsers: BrowserInfo[] = [];

  const candidates: Array<{ name: string; darwin: string; win32: string; linux: string }> = [
    {
      name: 'Chrome',
      darwin: path.join(
        home,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'Default',
        'History',
      ),
      win32: path.join(
        home,
        'AppData',
        'Local',
        'Google',
        'Chrome',
        'User Data',
        'Default',
        'History',
      ),
      linux: path.join(home, '.config', 'google-chrome', 'Default', 'History'),
    },
    {
      name: 'Edge',
      darwin: path.join(
        home,
        'Library',
        'Application Support',
        'Microsoft Edge',
        'Default',
        'History',
      ),
      win32: path.join(
        home,
        'AppData',
        'Local',
        'Microsoft',
        'Edge',
        'User Data',
        'Default',
        'History',
      ),
      linux: path.join(home, '.config', 'microsoft-edge', 'Default', 'History'),
    },
    {
      name: 'Brave',
      darwin: path.join(
        home,
        'Library',
        'Application Support',
        'BraveSoftware',
        'Brave-Browser',
        'Default',
        'History',
      ),
      win32: path.join(
        home,
        'AppData',
        'Local',
        'BraveSoftware',
        'Brave-Browser',
        'User Data',
        'Default',
        'History',
      ),
      linux: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'Default', 'History'),
    },
    {
      name: 'Vivaldi',
      darwin: path.join(home, 'Library', 'Application Support', 'Vivaldi', 'Default', 'History'),
      win32: path.join(home, 'AppData', 'Local', 'Vivaldi', 'User Data', 'Default', 'History'),
      linux: path.join(home, '.config', 'vivaldi', 'Default', 'History'),
    },
    {
      name: 'Arc',
      darwin: path.join(
        home,
        'Library',
        'Application Support',
        'Arc',
        'User Data',
        'Default',
        'History',
      ),
      win32: '',
      linux: '',
    },
  ];

  for (const c of candidates) {
    const p = c[platform as 'darwin' | 'win32' | 'linux'];
    if (p && existsSync(p)) {
      browsers.push({ name: c.name, path: p });
    }
  }

  return browsers;
}

function getChromeHistoryPath(): string {
  const browsers = getAvailableBrowsers();
  if (browsers.length === 0) {
    throw new Error('No supported browser found (Chrome, Edge, Brave, Vivaldi, Arc)');
  }
  return browsers[0].path;
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
    pdfFailed: 0,
    phase: 'scanning',
    message: 'Scanning browser history...',
    lastImportAt: null,
    lastImportCount: 0,
  };
  broadcastStatus();

  try {
    const browsers = getAvailableBrowsers();
    if (browsers.length === 0) {
      throw new Error('No supported browser found (Chrome, Edge, Brave, Vivaldi, Arc)');
    }

    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });

    const entries: Array<{ title: string; url: string }> = [];
    const seenUrls = new Set<string>();

    for (const browser of browsers) {
      try {
        console.log(`[ingest] Scanning ${browser.name} history...`);
        const tmpPath = path.join(os.tmpdir(), `browser-history-${Date.now()}.db`);
        copyFileSync(browser.path, tmpPath);

        try {
          let whereClause = `url LIKE '%arxiv.org%'`;
          if (days !== null) {
            const since = daysToSince(days);
            whereClause += ` AND last_visit_time >= ${toChromeTime(since)}`;
          }
          const sql = `SELECT title, url FROM urls WHERE ${whereClause} ORDER BY last_visit_time DESC LIMIT 500;`;

          const dbBuffer = readFileSync(tmpPath);
          const db = new SQL.Database(dbBuffer);
          const result = db.exec(sql);
          db.close();

          if (result.length > 0 && result[0].values) {
            for (const row of result[0].values) {
              const title = String(row[0] || '');
              const url = String(row[1] || '');
              if (url.includes('arxiv.org') && !seenUrls.has(url)) {
                seenUrls.add(url);
                entries.push({ title: title.trim() || url.trim(), url: url.trim() });
              }
            }
          }
        } finally {
          try {
            unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
        }
      } catch (browserErr) {
        console.warn(
          `[ingest] Failed to scan ${browser.name}:`,
          browserErr instanceof Error ? browserErr.message : String(browserErr),
        );
      }
    }

    console.log(
      `[ingest] Found ${entries.length} arXiv entries from ${browsers.map((b) => b.name).join(', ')}`,
    );

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

      let rawTitle = entry.title.trim();
      if (isInvalidTitle(rawTitle)) {
        try {
          const res = await fetch(`https://arxiv.org/abs/${arxivId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchClaw/1.0)' },
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
      if (exists) existingCount++;
      else newCount++;
      papers.push({ arxivId, title: rawTitle, url: entry.url, existing: exists });
    }

    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'completed',
      message: `Found ${papers.length} papers (${newCount} new, ${existingCount} existing)`,
    };
    broadcastStatus();

    return { papers, newCount, existingCount };
  } catch (err) {
    currentStatus = { ...currentStatus, active: false, phase: 'failed', message: String(err) };
    broadcastStatus();
    throw err;
  }
}

// Chrome timestamp epoch: 1601-01-01 in microseconds
const CHROME_EPOCH_OFFSET = 11644473600000000n;

/**
 * Scan browser download history for recently downloaded PDF files.
 * Searches all available Chromium browsers (Chrome, Edge, Brave, etc.)
 */
export async function scanBrowserDownloads(days: number = 7): Promise<DownloadedPdf[]> {
  const browsers = getAvailableBrowsers();
  if (browsers.length === 0) return [];

  const SQL = await initSqlJs({
    locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
  });

  const results: DownloadedPdf[] = [];
  const seenPaths = new Set<string>();

  // Calculate cutoff time in Chrome timestamp format (microseconds since 1601-01-01)
  const cutoffMs = Date.now() - days * 86_400_000;
  const cutoffChrome = (BigInt(cutoffMs) * 1000n + CHROME_EPOCH_OFFSET).toString();

  for (const browser of browsers) {
    try {
      const tmpPath = path.join(os.tmpdir(), `browser-downloads-${Date.now()}.db`);
      copyFileSync(browser.path, tmpPath);

      try {
        const sql = `SELECT target_path, start_time, total_bytes FROM downloads
          WHERE state = 1
            AND target_path LIKE '%.pdf'
            AND start_time >= ${cutoffChrome}
          ORDER BY start_time DESC
          LIMIT 50;`;

        const dbBuffer = readFileSync(tmpPath);
        const db = new SQL.Database(dbBuffer);
        const result = db.exec(sql);
        db.close();

        if (result.length > 0 && result[0].values) {
          for (const row of result[0].values) {
            const filePath = String(row[0] || '');
            const startTime = BigInt(String(row[1] || '0'));
            const totalBytes = Number(row[2] || 0);

            if (!filePath || seenPaths.has(filePath)) continue;
            // Check file still exists
            if (!existsSync(filePath)) continue;

            seenPaths.add(filePath);

            // Convert Chrome timestamp to JS Date
            const jsMs = Number((startTime - CHROME_EPOCH_OFFSET) / 1000n);

            results.push({
              filePath,
              fileName: path.basename(filePath),
              browser: browser.name,
              downloadTime: new Date(jsMs).toISOString(),
              fileSize: totalBytes,
            });
          }
        }
      } finally {
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn(
        `[ingest] Failed to scan ${browser.name} downloads:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Sort by download time descending
  results.sort((a, b) => new Date(b.downloadTime).getTime() - new Date(a.downloadTime).getTime());
  console.log(
    `[ingest] Found ${results.length} PDF downloads from ${browsers.map((b) => b.name).join(', ')}`,
  );
  return results;
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
    pdfFailed: 0,
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
    pdfFailed: 0,
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

/// Chrome stores time as microseconds since 1601-01-01 00:00:00 UTC
function toChromeTime(date: Date): number {
  const epochDiff = 11644473600000; // ms between 1601-01-01 and 1970-01-01
  return (date.getTime() + epochDiff) * 1000;
}

/**
 * Convert a "days" filter to a start Date.
 * days=1 → start of today (local midnight), so only today's visits are included.
 * days=N → N-1 days ago at local midnight (e.g. days=7 → 7 days ago midnight).
 */
function daysToSince(days: number): Date {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight today
  since.setDate(since.getDate() - (days - 1));
  return since;
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
    pdfFailed: 0,
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
        const since = daysToSince(days);
        whereClause += ` AND last_visit_time >= ${toChromeTime(since)}`;
      }
      const sql = `SELECT title, url FROM urls WHERE ${whereClause} ORDER BY last_visit_time DESC LIMIT 500;`;

      // Use sql.js (pure JS SQLite) instead of system sqlite3 CLI
      const SQL = await initSqlJs({
        locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
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

const CONCURRENCY = 8;

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
  let pdfFailed = 0;

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

      // Fetch metadata from arXiv (title, authors, abstract, submittedAt)
      let rawTitle = entry.title.trim();
      let authors: string[] = [];
      let abstract = '';
      let submittedAt: Date | undefined;

      if (arxivId) {
        try {
          const res = await fetch(`https://arxiv.org/abs/${arxivId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchClaw/1.0)' },
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
            const dateMatch = html.match(/\[Submitted on (\d{1,2}) (\w+\.?) (\d{4})/i);
            if (dateMatch) {
              const parsed = new Date(`${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]} UTC`);
              if (!isNaN(parsed.getTime())) submittedAt = parsed;
            }
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
        submittedAt,
      });

      // Add to Set after successful import
      if (arxivId) existingShortIds.add(arxivId);

      previewTitles.push(title);

      // Download PDF immediately after import (with retry)
      if (!paper.pdfPath && arxivId) {
        const maxRetries = 3;
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await downloadService.downloadPdfById(paper.id, arxivPdfUrl(arxivId));
            if (result.success) break;
            lastError = result.error || 'Unknown download error';
            if (attempt < maxRetries) {
              console.warn(
                `[import] PDF download attempt ${attempt} failed for ${arxivId}: ${lastError}, retrying...`,
              );
              await new Promise((r) => setTimeout(r, 1000 * attempt)); // Exponential backoff
            }
          } catch (err) {
            lastError = String(err);
            if (attempt < maxRetries) {
              console.warn(
                `[import] PDF download attempt ${attempt} threw for ${arxivId}: ${err}, retrying...`,
              );
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
        }
        if (lastError) {
          console.error(
            `[import] PDF download failed after ${maxRetries} attempts for ${arxivId}: ${lastError}`,
          );
          pdfFailed++;
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
    currentStatus.pdfFailed = pdfFailed;
    currentStatus.message = `Importing… ${currentStatus.completed}/${entries.length} (${success} new, ${skipped} skipped)`;
    broadcastStatus();
  });

  if (cancelled) {
    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'cancelled',
      message: `Cancelled: ${success} imported, ${skipped} skipped`,
      pdfFailed,
    };
  } else {
    const pdfFailedSuffix = pdfFailed > 0 ? `, ${pdfFailed} PDF failed` : '';
    currentStatus = {
      ...currentStatus,
      active: false,
      phase: 'completed',
      message: `Done: ${success} new, ${skipped} skipped${pdfFailedSuffix}`,
      lastImportAt: new Date().toISOString(),
      lastImportCount: success,
      pdfFailed,
    };
  }
  broadcastStatus();

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
    pdfFailed: 0,
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
      let submittedAt: Date | undefined;

      try {
        const metaRes = await fetch(`https://arxiv.org/abs/${displayId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchClaw/1.0)' },
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
          const dateMatch = html.match(/\[Submitted on (\d{1,2}) (\w+\.?) (\d{4})/i);
          if (dateMatch) {
            const parsed = new Date(`${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]} UTC`);
            if (!isNaN(parsed.getTime())) submittedAt = parsed;
          }
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
        submittedAt,
        tags,
        pdfUrl: arxivPdfUrl(displayId),
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
