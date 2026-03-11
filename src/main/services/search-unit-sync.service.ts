import { PapersRepository } from '@db';
import { localSemanticService } from './local-semantic.service';
import { buildSearchUnits } from './search-unit-utils';
import * as searchUnitIndex from './search-unit-index.service';

export async function rebuildSearchUnitsForPaper(paperId: string): Promise<void> {
  const repo = new PapersRepository();
  const paper = await repo.getSearchSourcePaper(paperId);
  if (!paper) return;

  const chunks = paper.chunks.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
  }));
  const units = buildSearchUnits({
    title: paper.title,
    abstract: paper.abstract,
    chunks,
  });
  const embeddings = await localSemanticService.embedTexts(units.map((unit) => unit.content));
  if (embeddings.length !== units.length) {
    throw new Error('Search unit embedding count did not match unit count.');
  }

  await repo.replaceSearchUnits(
    paperId,
    units.map((unit, index) => ({
      ...unit,
      embedding: embeddings[index],
    })),
  );

  const unitRows = await repo.listSearchUnitsForPaper(paperId);
  if (unitRows.length === 0) {
    await searchUnitIndex.deleteUnitsByPaperId(paperId);
    return;
  }

  const embeddingByKey = new Map(
    units.map((unit, index) => [
      `${unit.unitType}:${unit.sourceChunkIndex ?? 'root'}:${unit.unitIndex}`,
      embeddings[index],
    ]),
  );

  await searchUnitIndex.syncUnitsForPaper(
    paperId,
    unitRows.map((unit) => ({
      id: unit.id,
      unitType: unit.unitType,
      content: unit.content,
      normalizedText: unit.normalizedText,
      embedding:
        embeddingByKey.get(
          `${unit.unitType}:${unit.sourceChunkIndex ?? 'root'}:${unit.unitIndex}`,
        ) ?? [],
    })),
  );
}
