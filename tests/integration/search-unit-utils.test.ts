import { describe, expect, it } from 'vitest';
import { buildSearchUnits } from '../../src/main/services/search-unit-utils';

describe('search-unit utils', () => {
  it('builds title, abstract, and deduplicated sentence units', () => {
    const units = buildSearchUnits({
      title: 'Transformer Alignment',
      abstract:
        'This paper studies transformer alignment with retrieval-augmented generation and evaluation reliability.',
      chunks: [
        {
          chunkIndex: 0,
          content:
            'Transformer models often need careful alignment during training. Transformer models often need careful alignment during training. Retrieval augmented generation improves grounding for factual tasks.',
        },
      ],
    });

    expect(units.some((unit) => unit.unitType === 'title')).toBe(true);
    expect(units.some((unit) => unit.unitType === 'abstract')).toBe(true);
    const sentenceUnits = units.filter((unit) => unit.unitType === 'sentence');
    expect(sentenceUnits.length).toBeGreaterThan(0);
    expect(new Set(sentenceUnits.map((unit) => unit.normalizedText)).size).toBe(
      sentenceUnits.length,
    );
  });
});
