import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { setupPapersIpc } from './ipc/papers.ipc';
import { setupReadingIpc } from './ipc/reading.ipc';
import { setupIngestIpc } from './ipc/ingest.ipc';
import { setupProjectsIpc } from './ipc/projects.ipc';
import { setupHighlightsIpc } from './ipc/highlights.ipc';
import { appendLog, getLogFilePath } from './services/app-log.service';
import { setupProvidersIpc } from './ipc/providers.ipc';
import { setupCliToolsIpc } from './ipc/cli-tools.ipc';
import { setupModelsIpc } from './ipc/models.ipc';
import { startAgentLocalService, stopAgentLocalService } from './services/agent-local.service';
import { setupTokenUsageIpc } from './ipc/token-usage.ipc';
import { setupTaggingIpc } from './ipc/tagging.ipc';
import { setupAgentTodoIpc, getAgentTodoService } from './ipc/agent-todo.ipc';
import { setupSshIpc } from './ipc/ssh.ipc';
import { setupTaskResultsIpc } from './ipc/task-results.ipc';
import { setupExperimentReportIpc } from './ipc/experiment-report.ipc';
import { stopAllRunners } from './services/agent-runner-registry';
import { setupCitationsIpc } from './ipc/citations.ipc';
import { setupUserProfileIpc } from './ipc/user-profile.ipc';
import { setupAcpChatIpc } from './ipc/acp-chat.ipc';
import { setupZoteroIpc } from './ipc/zotero.ipc';
import { setupDiscoveryIpc } from './ipc/discovery.ipc';
import { setupBackupIpc } from './ipc/backup.ipc';
import { setupReaderAiIpc } from './ipc/reader-ai.ipc';
import { setupTtsIpc } from './ipc/tts.ipc';
import { ensureStorageDir, getDbPath, getStorageDir } from './store/storage-path';
import {
  hasLanguagePreference,
  setLanguage,
  getActiveEmbeddingConfig,
  setSemanticSearchSettings,
} from './store/app-settings-store';
import { PapersRepository } from '@db';
import { resumeAutomaticPaperProcessing } from './services/paper-processing.service';
import { resumeAutomaticCitationExtraction } from './services/citation-processing.service';
import { resumeAutomaticReferenceExtraction } from './services/reference-extraction-bg.service';
import { stopOllamaService, warmupOllamaService } from './services/ollama.service';
import { closeVecStore } from '../db/vec-store';
import * as vecIndex from './services/vec-index.service';
import * as paperEmbeddingService from './services/paper-embedding.service';
import { getPrismaClient } from '../db/client';

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

// Set DATABASE_URL before any DB imports (use ~/.researchclaw/)
ensureStorageDir();

// Auto-detect OS language on first launch (only if user has never set a preference)
try {
  if (!hasLanguagePreference()) {
    const locale = app.getLocale(); // e.g. 'zh-CN', 'zh-TW', 'en-US'
    setLanguage(locale.startsWith('zh') ? 'zh' : 'en');
  }
} catch {
  // Non-critical — ignore if settings file isn't accessible yet
}
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

async function dropDerivedIndexTablesForPrisma(): Promise<void> {
  const prisma = getPrismaClient();
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
    'vec_meta',
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
    } catch {
      // Ignore errors if table doesn't exist
    }
  }
}

function getSchemaHash(schemaPath: string): string {
  const content = fs.readFileSync(schemaPath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getSchemaHashPath(): string {
  return path.join(getStorageDir(), 'schema-hash.json');
}

function getSavedSchemaHash(): string | null {
  try {
    const hashPath = getSchemaHashPath();
    if (fs.existsSync(hashPath)) {
      const data = JSON.parse(fs.readFileSync(hashPath, 'utf-8'));
      return data.hash ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveSchemaHash(hash: string): void {
  const hashPath = getSchemaHashPath();
  fs.writeFileSync(hashPath, JSON.stringify({ hash }), 'utf-8');
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
      // Packaged app: prisma CLI not available, use raw SQL to create tables
      console.log('[ensureDatabase] Prisma CLI not found, falling back to raw SQL initialization');
      const { initSchemaWithRawSql } = await import('../db/init-schema');
      await initSchemaWithRawSql();
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
    await dropDerivedIndexTablesForPrisma();

    try {
      execSync(
        `"${prismaPath}" db push --schema="${schemaPath}" --skip-generate --accept-data-loss`,
        {
          env: { ...process.env },
          stdio: 'pipe',
        },
      );
      saveSchemaHash(currentHash);
      console.log('[ensureDatabase] db push completed successfully');
    } catch (dbPushError) {
      console.error('[ensureDatabase] db push failed, attempting recovery:', dbPushError);

      // Try to recover by cleaning WAL files and retrying
      const walPath = dbPath + '-wal';
      const journalPath = dbPath + '-journal';
      try {
        if (fs.existsSync(walPath)) {
          fs.unlinkSync(walPath);
          console.log('[ensureDatabase] Removed stale WAL file');
        }
        if (fs.existsSync(journalPath)) {
          fs.unlinkSync(journalPath);
          console.log('[ensureDatabase] Removed stale journal file');
        }

        // Retry db push
        execSync(
          `"${prismaPath}" db push --schema="${schemaPath}" --skip-generate --accept-data-loss`,
          {
            env: { ...process.env },
            stdio: 'pipe',
          },
        );
        saveSchemaHash(currentHash);
        console.log('[ensureDatabase] db push completed after recovery');
      } catch (retryError) {
        console.error('[ensureDatabase] Recovery failed, falling back to raw SQL initialization');
        // Fall back to raw SQL schema initialization
        const { initSchemaWithRawSql } = await import('../db/init-schema');
        await initSchemaWithRawSql();
        saveSchemaHash(currentHash);
      }
    }
  } catch (err) {
    console.error('[ensureDatabase] Failed to initialize database:', err);
    // Final fallback: try raw SQL
    try {
      const { initSchemaWithRawSql } = await import('../db/init-schema');
      await initSchemaWithRawSql();
      console.log('[ensureDatabase] Raw SQL initialization completed as fallback');
    } catch (fallbackError) {
      console.error('[ensureDatabase] All database initialization attempts failed:', fallbackError);
    }
  }
}

function createWindow() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  // Only use ELECTRON_DEV to determine dev mode (not NODE_ENV, which may be set in .env)
  const isDev = !!devServerUrl || process.env.ELECTRON_DEV === '1';

  // __dirname is dist/main/ — go up to assets/
  const iconPath = path.join(__dirname, '../../assets/icon.icns');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ResearchClaw',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 13, y: 16 },
    backgroundColor: '#ffffff',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for preload to use Node.js APIs
      webviewTag: true, // needed for in-app browser (publisher websites)
    },
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools in development mode (disabled by default)
  // if (isDev) {
  //   win.webContents.openDevTools();
  // }

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

  // Open URL in system default browser
  ipcMain.handle('browser:open', (_event, url: string, _title?: string) => {
    shell.openExternal(url);
    return true;
  });
}

function setupFileIpc() {
  // Read local file and return as base64
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    // Security: only allow files within user's researchclaw directory
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

  // Clean up expired temporary papers from Discovery
  import('./services/temporary-papers.service')
    .then(({ cleanupTemporaryPapers }) => {
      cleanupTemporaryPapers().catch((err) =>
        console.error('[startup] Temporary papers cleanup failed:', err),
      );
    })
    .catch((err) => {
      console.error('[startup] Failed to load temporary papers service:', err);
    });

  try {
    await startAgentLocalService();
  } catch (err) {
    console.error('[startup] Failed to start agent local service:', err);
  }
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

  // Simple ping handler for renderer to check if main is ready
  ipcMain.handle('ping', () => 'pong');

  // Register all IPC handlers
  setupPapersIpc();
  setupReadingIpc();
  setupIngestIpc();
  setupProjectsIpc();
  setupHighlightsIpc();
  setupProvidersIpc();
  setupCliToolsIpc();
  setupModelsIpc();
  setupTokenUsageIpc();
  setupTaggingIpc();
  setupAgentTodoIpc();
  setupSshIpc();
  setupTaskResultsIpc();
  setupExperimentReportIpc();
  getAgentTodoService()
    .initialize()
    .catch((err) => console.error('[AgentTodo] Failed to initialize scheduler:', err));
  setupCitationsIpc();
  setupBackupIpc();
  setupUserProfileIpc();
  setupAcpChatIpc();
  setupFileIpc();
  setupZoteroIpc();
  setupDiscoveryIpc();
  setupReaderAiIpc();
  setupTtsIpc();

  // Initialize vec index (background, non-blocking)
  void (async () => {
    try {
      // Initialize vector index
      await vecIndex.initialize();

      // Load paper embeddings into vector store
      await paperEmbeddingService.initializeVecStore();

      // Check for papers without embeddings
      const stats = await paperEmbeddingService.getEmbeddingStats();
      if (stats.papersWithoutEmbeddings > 0) {
        console.log(
          `[startup] Found ${stats.papersWithoutEmbeddings} papers without embeddings, processing in background...`,
        );

        // Process pending papers in background (non-blocking)
        void (async () => {
          let processed = 0;
          while (processed < stats.papersWithoutEmbeddings) {
            const count = await paperEmbeddingService.processPendingPapers(10);
            if (count === 0) break;
            processed += count;
            console.log(`[startup] Processed ${processed}/${stats.papersWithoutEmbeddings} papers`);
          }
          console.log('[startup] All papers processed');
        })();
      } else {
        console.log('[startup] All papers have embeddings');
      }
    } catch (err) {
      console.error('[startup] Vec index initialization failed:', err);
    }
  })();

  // Sync active embedding config into semanticSearch settings on startup
  // (fixes stale baseUrl/apiKey if user switched configs in a previous session)
  const activeEmbedConfig = getActiveEmbeddingConfig();
  if (activeEmbedConfig) {
    setSemanticSearchSettings({
      embeddingProvider: activeEmbedConfig.provider,
      embeddingModel: activeEmbedConfig.embeddingModel,
      embeddingApiBase: activeEmbedConfig.embeddingApiBase,
      embeddingApiKey: activeEmbedConfig.embeddingApiKey,
    });
    // Fix stale model name in VecStore (e.g. "test-model" from old data)
    const vecStatus = vecIndex.getStatus();
    if (vecStatus.model && vecStatus.model !== activeEmbedConfig.embeddingModel) {
      console.log(
        `[startup] VecStore model mismatch: "${vecStatus.model}" → "${activeEmbedConfig.embeddingModel}", resetting index and clearing old embeddings`,
      );
      // Clear and reinitialize VecStore with the new model's dimension
      vecIndex.clearAndReinitialize(activeEmbedConfig.embeddingModel);
      // Clear old embeddings from DB so they get re-generated with the new model
      const repo = new PapersRepository();
      await repo.clearAllIndexedAt();
      await paperEmbeddingService.rebuildAllEmbeddings();
    }

    console.log(
      `[startup] Synced active embedding config "${activeEmbedConfig.name}" → baseUrl=${activeEmbedConfig.embeddingApiBase ?? '<default>'}`,
    );
  }

  resumeAutomaticPaperProcessing().catch((err) =>
    console.error('[startup] Failed to resume paper processing:', err),
  );

  // Start automatic citation extraction (background, after paper processing)
  // TODO: Re-enable when needed
  // resumeAutomaticCitationExtraction().catch((err) =>
  //   console.error('[startup] Failed to resume citation extraction:', err),
  // );

  // Start automatic PDF reference extraction (background)
  resumeAutomaticReferenceExtraction().catch((err) =>
    console.error('[startup] Failed to resume reference extraction:', err),
  );

  const win = createWindow();
  setupWindowControls(win);

  // Notify renderer that main process is ready
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('main:ready');
  });

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
  closeVecStore();
  try {
    getAgentTodoService().getScheduler().stopAll();
  } catch {}
  stopAllRunners();
});
