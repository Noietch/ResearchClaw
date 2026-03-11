import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getDbPath } from '../main/store/storage-path';

let db: Database.Database | undefined;

function loadSqliteVec(db: Database.Database): void {
  // In a packaged Electron app, native .dylib/.so files are unpacked from asar
  // into app.asar.unpacked/. sqlite-vec's getLoadablePath() uses __dirname which
  // resolves inside the asar and fails with dlopen (errno=20).
  // process.resourcesPath points to the Resources/ dir which contains both
  // app.asar and app.asar.unpacked/ — use it to build the real fs path.
  // The package name uses process.platform (darwin/win32/linux) and process.arch (arm64/x64) directly.
  try {
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      const ext =
        process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
      const candidate = join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        `sqlite-vec-${process.platform}-${process.arch}`,
        `vec0.${ext}`,
      );
      if (existsSync(candidate)) {
        db.loadExtension(candidate);
        return;
      }
    }
  } catch {
    // fall through to default loader in dev mode
  }
  sqliteVec.load(db);
}

export function getVecDb(): Database.Database {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    loadSqliteVec(db);

    // Metadata table to track current vec index dimension and model
    db.exec(`
      CREATE TABLE IF NOT EXISTS vec_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }
  return db;
}

export function closeVecDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore close errors during shutdown
    }
    db = undefined;
  }
}
