import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupPapersIpc } from './ipc/papers.ipc';
import { setupReadingIpc } from './ipc/reading.ipc';
import { setupIngestIpc } from './ipc/ingest.ipc';
import { setupProjectsIpc } from './ipc/projects.ipc';
import { setupProvidersIpc } from './ipc/providers.ipc';
import { setupCliToolsIpc } from './ipc/cli-tools.ipc';
import { setupModelsIpc } from './ipc/models.ipc';
import { setupTokenUsageIpc } from './ipc/token-usage.ipc';
import { setupTaggingIpc } from './ipc/tagging.ipc';
import { ensureStorageDir, getDbPath } from './store/storage-path';

// CJS-compatible __dirname (esbuild bundles to CJS, so __dirname is available globally)
// In CJS format, __dirname is automatically provided by Node.js

// Set DATABASE_URL before any DB imports (use ~/.vibe-research/)
ensureStorageDir();
const dbPath = getDbPath();
process.env.DATABASE_URL = `file:${dbPath}`;

// Point Prisma to its query engine (required when @prisma/client is bundled via esbuild)
// __dirname is dist/main/ in both dev and packaged app
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const engineCandidates = [
    // Packaged app — asarUnpack extracts dist/native/ to app.asar.unpacked/dist/native/
    path.join(__dirname, '../native/libquery_engine-darwin-arm64.dylib.node'),
    path.join(__dirname, '../native/libquery_engine-darwin-x64.dylib.node'),
    // Dev fallback — query engine is in node_modules/.prisma/client/
    path.join(
      __dirname,
      '../../node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
    ),
    path.join(
      __dirname,
      '../../../node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
    ),
    path.join(__dirname, '../../node_modules/.prisma/client/libquery_engine-darwin-x64.dylib.node'),
    path.join(
      __dirname,
      '../../../node_modules/.prisma/client/libquery_engine-darwin-x64.dylib.node',
    ),
  ];
  const enginePath = engineCandidates.find((p) => fs.existsSync(p));
  if (enginePath) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath;
  }
}

async function ensureDatabase() {
  // Push schema on first launch (creates all tables if missing)
  try {
    const { execSync } = await import('child_process');
    // Try monorepo root path first (dev), then relative paths, then packaged app path
    const candidatePrisma = [
      path.join(__dirname, '../../node_modules/.bin/prisma'), // dev: dist/main -> node_modules/
      path.join(process.resourcesPath ?? '', 'node_modules/.bin/prisma'), // packaged app
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
    if (!resolvedPath.startsWith(allowedBase)) {
      throw new Error('Access denied');
    }

    const data = await fs.promises.readFile(resolvedPath);
    return data.toString('base64');
  });
}

app.whenReady().then(async () => {
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

  // One-time tag category migration (after DB is ready)
  import('./services/tagging.service')
    .then(({ migrateExistingTagCategories }) => {
      migrateExistingTagCategories().catch((err) =>
        console.error('[startup] Tag migration failed:', err),
      );
    })
    .catch(() => undefined);

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
