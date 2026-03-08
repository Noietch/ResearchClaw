import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { setupPapersIpc } from './ipc/papers.ipc';
import { setupReadingIpc } from './ipc/reading.ipc';
import { setupIngestIpc } from './ipc/ingest.ipc';
import { setupProjectsIpc } from './ipc/projects.ipc';
import { appendLog, getLogFilePath } from './services/app-log.service';
import { setupProvidersIpc } from './ipc/providers.ipc';
import { setupCliToolsIpc } from './ipc/cli-tools.ipc';
import { setupModelsIpc } from './ipc/models.ipc';
import { startAgentLocalService, stopAgentLocalService } from './services/agent-local.service';
import { setupTokenUsageIpc } from './ipc/token-usage.ipc';
import { setupTaggingIpc } from './ipc/tagging.ipc';
import { setupAgentTodoIpc, getAgentTodoService } from './ipc/agent-todo.ipc';
import { setupSshIpc } from './ipc/ssh.ipc';
import { stopAllRunners } from './services/agent-runner-registry';
import { setupCollectionsIpc, ensureDefaultCollections } from './ipc/collections.ipc';
import { setupCitationsIpc } from './ipc/citations.ipc';
import { setupRecommendationsIpc } from './ipc/recommendations.ipc';
import { ensureStorageDir, getDbPath } from './store/storage-path';
import { PapersRepository } from '@db';
import { resumeAutomaticPaperProcessing } from './services/paper-processing.service';
import { resumeAutomaticCitationExtraction } from './services/citation-processing.service';
import { stopOllamaService, warmupOllamaService } from './services/ollama.service';
import { closeVecDb, getVecDb } from '../db/vec-client';
import * as vecIndex from './services/vec-index.service';

// CJS-compatible __dirname (esbuild bundles to CJS, so __dirname is available globally)
// In CJS format, __dirname is automatically provided by Node.js

// Global error handlers for uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  console.error('[main] Uncaught exception:', error);
  // In production, we might want to show a dialog before quitting
  if (app.isReady()) {
    dialog.showErrorBox('Unexpected Error', `An unexpected error occurred:\n${error.message}`);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[main] Unhandled rejection at:', promise, 'reason:', reason);
});

// Set DATABASE_URL before any DB imports (use ~/.vibe-research/)
ensureStorageDir();
const dbPath = getDbPath();
process.env.DATABASE_URL = `file:${dbPath}`;

// Point Prisma to its query engine (required when @prisma/client is bundled via esbuild)
// __dirname is dist/main/ in both dev and packaged app
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const platform = process.platform;
  const arch = process.arch;

  // Build platform-specific candidates (native platform first)
  const nativeCandidates: string[] = [];

  if (platform === 'darwin') {
    // macOS
    nativeCandidates.push(
      // Packaged app
      path.join(__dirname, '../native/libquery_engine-darwin-arm64.dylib.node'),
      path.join(__dirname, '../native/libquery_engine-darwin-x64.dylib.node'),
      // Dev fallback
      path.join(
        __dirname,
        '../../node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
      ),
      path.join(
        __dirname,
        '../../../node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
      ),
      path.join(
        __dirname,
        '../../node_modules/.prisma/client/libquery_engine-darwin-x64.dylib.node',
      ),
      path.join(
        __dirname,
        '../../../node_modules/.prisma/client/libquery_engine-darwin-x64.dylib.node',
      ),
    );
  } else if (platform === 'win32') {
    // Windows (x64 only)
    nativeCandidates.push(
      // Packaged app
      path.join(__dirname, '../native/query_engine-windows.dll.node'),
      // Dev fallback
      path.join(__dirname, '../../node_modules/.prisma/client/query_engine-windows.dll.node'),
      path.join(__dirname, '../../../node_modules/.prisma/client/query_engine-windows.dll.node'),
    );
  } else if (platform === 'linux') {
    // Linux
    nativeCandidates.push(
      // Packaged app
      path.join(__dirname, '../native/libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node'),
      path.join(__dirname, '../native/libquery_engine-linux-musl-openssl-3.0.x.so.node'),
      path.join(__dirname, '../native/libquery_engine-debian-openssl-3.0.x.so.node'),
      // Dev fallback
      path.join(
        __dirname,
        '../../node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node',
      ),
      path.join(
        __dirname,
        '../../../node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node',
      ),
      path.join(
        __dirname,
        '../../node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node',
      ),
      path.join(
        __dirname,
        '../../../node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node',
      ),
      path.join(
        __dirname,
        '../../node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node',
      ),
      path.join(
        __dirname,
        '../../../node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node',
      ),
    );
  }

  console.log(`[Prisma] Platform: ${platform}, Arch: ${arch}`);
  const enginePath = nativeCandidates.find((p) => fs.existsSync(p));
  if (enginePath) {
    console.log(`[Prisma] Found engine: ${enginePath}`);
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath;
  } else {
    console.error('[Prisma] No query engine found for platform:', platform, arch);
    console.error('[Prisma] Searched paths:', nativeCandidates);
  }
}

async function dropDerivedIndexTablesForPrisma(dbPath: string): Promise<void> {
  if (!fs.existsSync(dbPath)) return;

  closeVecDb();
  const db = getVecDb();
  const tables = [
    'vec_chunks',
    'vec_chunks_chunks',
    'vec_chunks_info',
    'vec_chunks_rowids',
    'vec_chunks_vector_chunks00',
    'vec_search_units',
    'vec_search_units_chunks',
    'vec_search_units_info',
    'vec_search_units_rowids',
    'vec_search_units_vector_chunks00',
    'paper_search_units_fts',
    'paper_search_units_fts_config',
    'paper_search_units_fts_content',
    'paper_search_units_fts_data',
    'paper_search_units_fts_docsize',
    'paper_search_units_fts_idx',
  ];

  for (const table of tables) {
    db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }

  closeVecDb();
}

function getSchemaHash(schemaPath: string): string {
  const content = fs.readFileSync(schemaPath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getSavedSchemaHash(): string | null {
  try {
    const db = getVecDb();
    const row = db.prepare("SELECT value FROM vec_meta WHERE key = 'schema_hash'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function saveSchemaHash(hash: string): void {
  const db = getVecDb();
  db.prepare("INSERT OR REPLACE INTO vec_meta (key, value) VALUES ('schema_hash', ?)").run(hash);
}

async function ensureDatabase() {
  try {
    const { execSync } = await import('child_process');
    const prismaBin = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
    const candidatePrisma = [
      path.join(__dirname, `../../node_modules/.bin/${prismaBin}`),
      path.join(process.resourcesPath ?? '', `node_modules/.bin/${prismaBin}`),
    ];
    const candidateSchema = [
      path.join(__dirname, '../../prisma/schema.prisma'),
      path.join(process.resourcesPath ?? '', 'prisma/schema.prisma'),
    ];
    const prismaPath = candidatePrisma.find((p) => fs.existsSync(p));
    const schemaPath = candidateSchema.find((p) => fs.existsSync(p));
    if (!prismaPath || !schemaPath) {
      console.error('[ensureDatabase] Prisma or schema not found:', { prismaPath, schemaPath });
      return;
    }

    const currentHash = getSchemaHash(schemaPath);
    const savedHash = getSavedSchemaHash();

    if (currentHash === savedHash) {
      console.log('[ensureDatabase] Schema unchanged, skipping db push');
      return;
    }

    console.log('[ensureDatabase] Schema changed or first run, running db push...');

    // Proactively drop derived search/vector tables before db push to avoid Prisma introspect errors
    await dropDerivedIndexTablesForPrisma(dbPath);

    execSync(
      `"${prismaPath}" db push --schema="${schemaPath}" --skip-generate --accept-data-loss`,
      {
        env: { ...process.env },
        stdio: 'pipe',
      },
    );

    saveSchemaHash(currentHash);
    console.log('[ensureDatabase] db push completed successfully');
  } catch (err) {
    console.error('[ensureDatabase] Failed to initialize database:', err);
  }
}

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === '1';

  // __dirname is dist/main/ — go up to assets/
  const iconPath = path.join(__dirname, '../../assets/icon.icns');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Vibe Research',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 13, y: 16 },
    backgroundColor: '#ffffff',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for preload to use Node.js APIs
    },
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Intercept navigation from PDF viewer iframes - open external links in browser
  const isInternalUrl = (url: string) =>
    url.startsWith('http://localhost') || url.startsWith('file://') || url.startsWith('blob:');

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Also intercept sub-frame (iframe) navigations, e.g. Ctrl+click inside PDF viewer
  win.webContents.on('will-frame-navigate', (event) => {
    const url = event.url;
    if (isInternalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // Handle new window requests (e.g., Ctrl+click on links)
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open external URLs in default browser
    if (!url.startsWith('http://localhost') && !url.startsWith('blob:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

function setupWindowControls(win: BrowserWindow) {
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle('window:isMaximized', () => win.isMaximized());
}

function setupFileIpc() {
  // Read local file and return as base64
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    // Security: only allow files within user's vibe-research directory
    const allowedBase = path.dirname(dbPath);
    const resolvedPath = path.resolve(filePath);

    // SECURITY: Resolve symlinks to prevent path traversal via symlink attacks
    let realPath: string;
    try {
      realPath = await fs.promises.realpath(resolvedPath);
    } catch {
      // File is missing — clear any stale pdfPath in DB so UI shows download button
      const papersRepo = new PapersRepository();
      await papersRepo.clearPdfPathByFilePath(resolvedPath).catch(() => {});
      throw new Error('File not found');
    }

    // Check the real path is still within allowed directory
    if (!realPath.startsWith(allowedBase)) {
      throw new Error('Access denied');
    }

    const data = await fs.promises.readFile(realPath);
    return data.toString('base64');
  });
}

app.whenReady().then(async () => {
  appendLog('app', 'startup', { logFile: getLogFilePath('agent.log') }, 'agent.log');
  // Set macOS Dock icon explicitly (BrowserWindow icon param doesn't work on macOS)
  try {
    if (process.platform === 'darwin' && app.dock) {
      const dockIconPath = path.join(__dirname, '../../assets/icon.icns');
      if (fs.existsSync(dockIconPath)) {
        app.dock.setIcon(dockIconPath);
      }
    }
  } catch {
    // icon load failure should not crash the app
  }

  await ensureDatabase();
  await startAgentLocalService();
  void warmupOllamaService('app-ready');

  // One-time tag category migration (after DB is ready)
  import('./services/tagging.service')
    .then(({ migrateExistingTagCategories }) => {
      migrateExistingTagCategories().catch((err) =>
        console.error('[startup] Tag migration failed:', err),
      );
    })
    .catch((err) => {
      console.error('[startup] Failed to load tagging service:', err);
    });

  // Ensure default collections exist
  ensureDefaultCollections();

  // Register all IPC handlers
  setupPapersIpc();
  setupReadingIpc();
  setupIngestIpc();
  setupProjectsIpc();
  setupProvidersIpc();
  setupCliToolsIpc();
  setupModelsIpc();
  setupTokenUsageIpc();
  setupTaggingIpc();
  setupAgentTodoIpc();
  setupSshIpc();
  getAgentTodoService()
    .initialize()
    .catch((err) => console.error('[AgentTodo] Failed to initialize scheduler:', err));
  setupCollectionsIpc();
  setupCitationsIpc();
  setupRecommendationsIpc();
  setupFileIpc();

  // Initialize vec index (background, non-blocking)
  void (async () => {
    try {
      const { getVecDb } = await import('../db/vec-client');
      getVecDb(); // ensure connection is open
      const status = vecIndex.getStatus();
      const repo = new PapersRepository();
      if (!status.initialized) {
        const chunkCount = (await repo.listChunksForSemanticSearch()).length;
        if (chunkCount > 0) {
          console.log(`[startup] Rebuilding vec index from ${chunkCount} existing chunks...`);
          const inserted = await vecIndex.rebuildFromPrisma();
          console.log(`[startup] Vec index rebuilt: ${inserted} chunks indexed`);
        }
      }

      const searchUnitRows = await repo.listSearchUnitsForSemanticSearch();
      if (searchUnitRows.length > 0) {
        const searchUnitIndex = await import('./services/search-unit-index.service');
        const inserted = await searchUnitIndex.rebuildFromPrisma();
        console.log(`[startup] Search-unit index rebuilt: ${inserted} units indexed`);
      }
    } catch (err) {
      console.error('[startup] Vec index initialization failed:', err);
    }
  })();

  resumeAutomaticPaperProcessing().catch((err) =>
    console.error('[startup] Failed to resume paper processing:', err),
  );

  // Start automatic citation extraction (background, after paper processing)
  resumeAutomaticCitationExtraction().catch((err) =>
    console.error('[startup] Failed to resume citation extraction:', err),
  );

  const win = createWindow();
  setupWindowControls(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopAgentLocalService();
  stopOllamaService();
  closeVecDb();
  try {
    getAgentTodoService().getScheduler().stopAll();
  } catch {}
  stopAllRunners();
});
