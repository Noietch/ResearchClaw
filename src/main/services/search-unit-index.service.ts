import { getVecStore, VecEntry } from '../../db/vec-store';
import { getPrismaClient } from '../../db/client';

export interface SearchUnitVecSearchHit {
  unitId: string;
  distance: number;
}

const STORE_PREFIX = 'su_'; // Prefix to distinguish search units from chunks
let currentDimension: number | null = null;
let currentModel: string | null = null;
let initialized = false;

function getStore() {
  return getVecStore();
}

function makeKey(unitId: string): string {
  return STORE_PREFIX + unitId;
}

export function initialize(dimension: number, model: string): void {
  const store = getStore();

  const storedDim = store.getDimension();
  const storedModel = store.getModel();

  if (storedDim && storedDim !== dimension) {
    console.log(`[search-unit-index] Dimension changed ${storedDim} → ${dimension}, clearing data`);
    // Note: This clears ALL vectors in the store, including chunks
    // In the future, we might want separate stores
  }

  if (storedModel && storedModel !== model) {
    console.log(`[search-unit-index] Model changed ${storedModel} → ${model}, clearing data`);
  }

  store.initialize(dimension, model);
  currentDimension = dimension;
  currentModel = model;
  initialized = true;
  console.log(`[search-unit-index] Initialized (dimension=${dimension}, model=${model})`);
}

export function isInitialized(): boolean {
  const store = getStore();
  return initialized && store.isInitialized();
}

export async function syncUnitsForPaper(
  paperId: string,
  units: Array<{
    id: string;
    unitType: string;
    content: string;
    normalizedText: string;
    embedding: number[];
  }>,
): Promise<void> {
  const store = getStore();

  // Auto-detect dimension from first embedding if not yet set
  if (!currentDimension && units.length > 0) {
    const dim = units[0].embedding.length;
    if (dim > 0) {
      const model = store.getModel() || 'unknown';
      initialize(dim, model);
    }
  }

  if (!initialized) return;

  // Delete existing units for this paper
  const prisma = getPrismaClient();
  const existingUnits = await prisma.paperSearchUnit.findMany({
    where: { paperId },
    select: { id: true },
  });
  for (const unit of existingUnits) {
    store.delete(makeKey(unit.id));
  }

  // Insert new units
  const entries: VecEntry[] = units.map((unit) => ({
    chunkId: makeKey(unit.id),
    embedding: new Float32Array(unit.embedding),
  }));

  store.batchInsert(entries);
  store.save();
}

export async function deleteUnitsByPaperId(paperId: string): Promise<void> {
  const prisma = getPrismaClient();
  const units = await prisma.paperSearchUnit.findMany({
    where: { paperId },
    select: { id: true },
  });

  const store = getStore();
  for (const unit of units) {
    store.delete(makeKey(unit.id));
  }
  store.save();
}

export function deleteUnitsByIds(ids: string[]): void {
  if (ids.length === 0) return;
  const store = getStore();
  for (const id of ids) {
    store.delete(makeKey(id));
  }
  store.save();
}

export function searchKNN(queryEmbedding: number[], k: number): SearchUnitVecSearchHit[] {
  if (!initialized) return [];

  const store = getStore();
  const query = new Float32Array(queryEmbedding);
  const hits = store.searchKNN(query, k);

  // Filter to only search unit results and strip prefix
  return hits
    .filter((hit) => hit.chunkId.startsWith(STORE_PREFIX))
    .map((hit) => ({
      unitId: hit.chunkId.slice(STORE_PREFIX.length),
      distance: hit.distance,
    }));
}

export async function searchLexical(
  query: string,
  limit: number,
): Promise<Array<{ unitId: string; rank: number }>> {
  // FTS5 search is no longer available without better-sqlite3
  // Use Prisma's contains search as a fallback
  const prisma = getPrismaClient();
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const compact = trimmed.replace(/\s+/g, '');
    const units = await prisma.paperSearchUnit.findMany({
      where: {
        OR: [
          { content: { contains: trimmed } },
          { normalizedText: { contains: trimmed } },
          ...(compact !== trimmed
            ? [{ content: { contains: compact } }, { normalizedText: { contains: compact } }]
            : []),
        ],
      },
      take: limit,
      select: { id: true },
    });

    // Return with a neutral rank since we can't do BM25
    return units.map((unit, index) => ({
      unitId: unit.id,
      rank: index, // Use position as a simple rank
    }));
  } catch {
    return [];
  }
}

export async function rebuildFromPrisma(): Promise<number> {
  const store = getStore();

  const prisma = getPrismaClient();
  const units = await prisma.paperSearchUnit.findMany({
    select: { id: true, embeddingJson: true },
    orderBy: [{ paperId: 'asc' }, { unitType: 'asc' }, { unitIndex: 'asc' }],
  });

  if (units.length === 0) return 0;

  // Detect dimension from first non-empty embedding
  let dimension = 0;
  for (const unit of units) {
    try {
      const emb = JSON.parse(unit.embeddingJson) as number[];
      if (emb.length > 0) {
        dimension = emb.length;
        break;
      }
    } catch {
      /* skip */
    }
  }
  if (dimension === 0) return 0;

  const model = store.getModel() || 'unknown';

  // Rebuild: clear existing search unit vectors
  // Note: We don't clear the whole store as it would also clear chunk vectors
  // Instead, we delete only the search unit prefixed entries
  const allEntries = store.getAllEntries();
  for (const entry of allEntries) {
    if (entry.chunkId.startsWith(STORE_PREFIX)) {
      store.delete(entry.chunkId);
    }
  }

  store.initialize(dimension, model);

  const entries: VecEntry[] = [];
  for (const unit of units) {
    try {
      const embedding = JSON.parse(unit.embeddingJson) as number[];
      if (embedding.length !== dimension) continue;
      entries.push({
        chunkId: makeKey(unit.id),
        embedding: new Float32Array(embedding),
      });
    } catch {
      // Skip malformed embeddings
    }
  }

  // Batch insert
  store.batchInsert(entries);
  store.save();
  currentDimension = dimension;
  currentModel = model;
  initialized = true;

  console.log(
    `[search-unit-index] Rebuilt index: ${entries.length}/${units.length} units (dimension=${dimension}, model=${model})`,
  );
  return entries.length;
}

export function resetIndex(): void {
  const store = getStore();

  // Delete only search unit prefixed entries
  const allEntries = store.getAllEntries();
  for (const entry of allEntries) {
    if (entry.chunkId.startsWith(STORE_PREFIX)) {
      store.delete(entry.chunkId);
    }
  }
  store.save();

  currentDimension = null;
  currentModel = null;
  initialized = false;
  console.log('[search-unit-index] Index reset');
}

// Initialize on module load
const store = getStore();
if (store.isInitialized()) {
  currentDimension = store.getDimension();
  currentModel = store.getModel();
  initialized = true;
  console.log(
    `[search-unit-index] Restored from disk (dim=${currentDimension}, model=${currentModel})`,
  );
}
