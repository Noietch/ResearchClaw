import { getVecDb } from '../../db/vec-client';
import { getPrismaClient } from '../../db/client';

export interface SearchUnitVecSearchHit {
  unitId: string;
  distance: number;
}

const TABLE_NAME = 'vec_search_units';
const META_KEY_DIMENSION = 'search_unit_dimension';
const META_KEY_MODEL = 'search_unit_model';
let initialized = false;
let currentDimension: number | null = null;

function getMeta(key: string): string | null {
  const db = getVecDb();
  try {
    const row = db.prepare('SELECT value FROM vec_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function setMeta(key: string, value: string): void {
  getVecDb().prepare('INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?, ?)').run(key, value);
}

function dropVecTable(): void {
  const db = getVecDb();
  db.exec(`DROP TABLE IF EXISTS ${TABLE_NAME}`);
}

function createVecTable(dimension: number): void {
  const db = getVecDb();
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLE_NAME} USING vec0(
      unit_id TEXT PRIMARY KEY,
      embedding float[${dimension}] distance_metric=cosine
    )
  `);
}

function ensureFtsTable(): void {
  getVecDb().exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS paper_search_units_fts USING fts5(
      unit_id UNINDEXED,
      paper_id UNINDEXED,
      unit_type UNINDEXED,
      content,
      normalized_text
    )
  `);
}

export function initialize(dimension: number, model: string): void {
  const storedDim = Number.parseInt(getMeta(META_KEY_DIMENSION) ?? '', 10) || null;
  const storedModel = getMeta(META_KEY_MODEL);

  if (storedDim && storedDim !== dimension) {
    dropVecTable();
  }
  if (storedModel && storedModel !== model) {
    dropVecTable();
  }

  createVecTable(dimension);
  ensureFtsTable();
  setMeta(META_KEY_DIMENSION, String(dimension));
  setMeta(META_KEY_MODEL, model);
  currentDimension = dimension;
  initialized = true;
}

export function isInitialized(): boolean {
  ensureFtsTable();
  return initialized;
}

export function syncUnitsForPaper(
  paperId: string,
  units: Array<{
    id: string;
    unitType: string;
    content: string;
    normalizedText: string;
    embedding: number[];
  }>,
): void {
  const db = getVecDb();
  ensureFtsTable();

  if (!currentDimension && units.length > 0) {
    initialize(units[0].embedding.length, getMeta(META_KEY_MODEL) ?? 'unknown');
  }
  if (!initialized) return;

  const deleteVecStmt = db.prepare(
    `DELETE FROM ${TABLE_NAME} WHERE unit_id IN (SELECT id FROM "PaperSearchUnit" WHERE paperId = ?)`,
  );
  const deleteFtsStmt = db.prepare('DELETE FROM paper_search_units_fts WHERE paper_id = ?');
  const insertVecStmt = db.prepare(`INSERT INTO ${TABLE_NAME} (unit_id, embedding) VALUES (?, ?)`);
  const insertFtsStmt = db.prepare(
    'INSERT INTO paper_search_units_fts (unit_id, paper_id, unit_type, content, normalized_text) VALUES (?, ?, ?, ?, ?)',
  );

  const sync = db.transaction(() => {
    deleteVecStmt.run(paperId);
    deleteFtsStmt.run(paperId);
    for (const unit of units) {
      const buf = new Float32Array(unit.embedding);
      insertVecStmt.run(unit.id, Buffer.from(buf.buffer));
      insertFtsStmt.run(unit.id, paperId, unit.unitType, unit.content, unit.normalizedText);
    }
  });

  sync();
}

export function deleteUnitsByPaperId(paperId: string): void {
  const db = getVecDb();
  ensureFtsTable();
  try {
    db.prepare(
      `DELETE FROM ${TABLE_NAME} WHERE unit_id IN (SELECT id FROM "PaperSearchUnit" WHERE paperId = ?)`,
    ).run(paperId);
  } catch {
    // ignore missing table
  }
  db.prepare('DELETE FROM paper_search_units_fts WHERE paper_id = ?').run(paperId);
}

export function deleteUnitsByIds(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getVecDb();
  ensureFtsTable();
  const placeholders = ids.map(() => '?').join(',');
  try {
    db.prepare(`DELETE FROM ${TABLE_NAME} WHERE unit_id IN (${placeholders})`).run(...ids);
  } catch {
    // ignore missing table
  }
  db.prepare(`DELETE FROM paper_search_units_fts WHERE unit_id IN (${placeholders})`).run(...ids);
}

export function searchKNN(queryEmbedding: number[], k: number): SearchUnitVecSearchHit[] {
  if (!initialized) return [];
  const db = getVecDb();
  const buf = new Float32Array(queryEmbedding);
  const rows = db
    .prepare(
      `SELECT unit_id, distance FROM ${TABLE_NAME} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
    )
    .all(Buffer.from(buf.buffer), k) as Array<{ unit_id: string; distance: number }>;

  return rows.map((row) => ({ unitId: row.unit_id, distance: row.distance }));
}

export function searchLexical(
  query: string,
  limit: number,
): Array<{ unitId: string; rank: number }> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  ensureFtsTable();
  const db = getVecDb();
  const rows = db
    .prepare(
      `SELECT unit_id, bm25(paper_search_units_fts) AS rank
       FROM paper_search_units_fts
       WHERE paper_search_units_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(trimmed, limit) as Array<{ unit_id: string; rank: number }>;

  return rows.map((row) => ({ unitId: row.unit_id, rank: row.rank }));
}

export async function rebuildFromPrisma(): Promise<number> {
  const prisma = getPrismaClient();
  ensureFtsTable();

  const units = await prisma.paperSearchUnit.findMany({
    select: {
      id: true,
      paperId: true,
      unitType: true,
      content: true,
      normalizedText: true,
      embeddingJson: true,
    },
    orderBy: [{ paperId: 'asc' }, { unitType: 'asc' }, { unitIndex: 'asc' }],
  });

  if (units.length === 0) return 0;

  const firstEmbedding = JSON.parse(units[0].embeddingJson) as number[];
  if (firstEmbedding.length === 0) return 0;

  dropVecTable();
  createVecTable(firstEmbedding.length);
  setMeta(META_KEY_DIMENSION, String(firstEmbedding.length));
  currentDimension = firstEmbedding.length;
  initialized = true;

  const db = getVecDb();
  db.prepare('DELETE FROM paper_search_units_fts').run();
  const insertVecStmt = db.prepare(`INSERT INTO ${TABLE_NAME} (unit_id, embedding) VALUES (?, ?)`);
  const insertFtsStmt = db.prepare(
    'INSERT INTO paper_search_units_fts (unit_id, paper_id, unit_type, content, normalized_text) VALUES (?, ?, ?, ?, ?)',
  );

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const unit of units) {
      try {
        const embedding = JSON.parse(unit.embeddingJson) as number[];
        if (embedding.length !== firstEmbedding.length) continue;
        insertVecStmt.run(unit.id, Buffer.from(new Float32Array(embedding).buffer));
        insertFtsStmt.run(unit.id, unit.paperId, unit.unitType, unit.content, unit.normalizedText);
        inserted++;
      } catch {
        // skip malformed rows
      }
    }
  });
  tx();
  return inserted;
}

export function resetIndex(): void {
  dropVecTable();
  const db = getVecDb();
  db.exec('DROP TABLE IF EXISTS paper_search_units_fts');
  db.prepare('DELETE FROM vec_meta WHERE key IN (?, ?)').run(META_KEY_DIMENSION, META_KEY_MODEL);
  currentDimension = null;
  initialized = false;
}
