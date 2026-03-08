import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { getDbPath } from '../main/store/storage-path';

let db: Database.Database | undefined;

export function getVecDb(): Database.Database {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    sqliteVec.load(db);

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
