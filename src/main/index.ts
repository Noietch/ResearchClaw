import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
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
import { stopAllRunners } from './services/agent-runner-registry';
import { ensureStorageDir, getDbPath } from './store/storage-path';
import { PapersRepository } from '@db';

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

async function ensureDatabase() {
  // Push schema on first launch (creates all tables if missing)
  try {
    const { execSync } = await import('child_process');
    // On Windows, the prisma binary is prisma.cmd; on Unix it has no extension
    const prismaBin = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
    const candidatePrisma = [
      path.join(__dirname, `../../node_modules/.bin/${prismaBin}`), // dev: dist/main -> node_modules/
      path.join(process.resourcesPath ?? '', `node_modules/.bin/${prismaBin}`), // packaged app
    ];
    const candidateSchema = [
      path.join(__dirname, '../../prisma/schema.prisma'), // dev: dist/main -> prisma/
      path.join(process.resourcesPath ?? '', 'prisma/schema.prisma'), // packaged app
    ];
    const prismaPath = candidatePrisma.find((p) => fs.existsSync(p));
    const schemaPath = candidateSchema.find((p) => fs.existsSync(p));
    if (prismaPath && schemaPath) {
      execSync(
        `"${prismaPath}" db push --schema="${schemaPath}" --skip-generate --accept-data-loss`,
        {
          env: { ...process.env },
          stdio: 'pipe',
        },
      );
    } else {
      console.error('[ensureDatabase] Prisma or schema not found:', { prismaPath, schemaPath });
    }
  } catch (err) {
    // DB setup may fail in some environments — app will show errors per-query
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
    trafficLightPosition: { x: 16, y: 16 },
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
  getAgentTodoService()
    .initialize()
    .catch((err) => console.error('[AgentTodo] Failed to initialize scheduler:', err));
  setupFileIpc();

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
  try {
    getAgentTodoService().getScheduler().stopAll();
  } catch {}
  stopAllRunners();
});
