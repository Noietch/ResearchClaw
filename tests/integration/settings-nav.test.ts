import { describe, it, expect } from 'vitest';
import {
  NAV_GROUPS,
  SECTION_META,
  ALL_SECTION_IDS,
  filterNavGroups,
  getFilteredSectionIds,
  resolveActiveSection,
  toggleCollapsed,
  isGroupExpanded,
  type SectionId,
} from '../../src/renderer/pages/settings/settings-nav';

// ─── NAV_GROUPS structure ─────────────────────────────────────────────────────

describe('NAV_GROUPS structure', () => {
  it('has exactly 4 top-level groups', () => {
    expect(NAV_GROUPS).toHaveLength(4);
  });

  it('group ids are general / models / agents / storage', () => {
    const ids = NAV_GROUPS.map((g) => g.id);
    expect(ids).toEqual(['general', 'models', 'agents', 'storage']);
  });

  it('general group has 3 items', () => {
    const general = NAV_GROUPS.find((g) => g.id === 'general')!;
    expect(general.items).toHaveLength(3);
  });

  it('all items have non-empty keywords arrays', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(item.keywords.length).toBeGreaterThan(0);
      }
    }
  });

  it('every item id is a valid SectionId', () => {
    const validIds: SectionId[] = [
      'general.proxy',
      'general.editor',
      'general.semantic',
      'models',
      'agents',
      'storage',
    ];
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(validIds).toContain(item.id);
      }
    }
  });
});

// ─── ALL_SECTION_IDS ──────────────────────────────────────────────────────────

describe('ALL_SECTION_IDS', () => {
  it('contains 6 unique section ids', () => {
    expect(ALL_SECTION_IDS).toHaveLength(6);
    expect(new Set(ALL_SECTION_IDS).size).toBe(6);
  });

  it('starts with general.proxy (default active section)', () => {
    expect(ALL_SECTION_IDS[0]).toBe('general.proxy');
  });
});

// ─── SECTION_META ─────────────────────────────────────────────────────────────

describe('SECTION_META', () => {
  it('has an entry for every section id', () => {
    for (const id of ALL_SECTION_IDS) {
      expect(SECTION_META[id]).toBeDefined();
      expect(SECTION_META[id].title).toBeTruthy();
      expect(SECTION_META[id].description).toBeTruthy();
    }
  });

  it('proxy section has correct title', () => {
    expect(SECTION_META['general.proxy'].title).toBe('Proxy');
  });

  it('storage section description mentions data', () => {
    expect(SECTION_META['storage'].description.toLowerCase()).toContain('data');
  });
});

// ─── filterNavGroups ──────────────────────────────────────────────────────────

describe('filterNavGroups', () => {
  it('returns all groups for empty query', () => {
    expect(filterNavGroups('')).toHaveLength(4);
    expect(filterNavGroups('  ')).toHaveLength(4);
  });

  it('filters by item label (case-insensitive)', () => {
    const result = filterNavGroups('proxy');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('general');
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].id).toBe('general.proxy');
  });

  it('filters by keyword match', () => {
    // 'agent' is a keyword for agents section
    const result = filterNavGroups('agent');
    expect(result).toHaveLength(1);
    expect(result[0].items[0].id).toBe('agents');
  });

  it('filters by partial keyword match', () => {
    // 'embed' matches keyword 'embedding' in both general.semantic and models
    const result = filterNavGroups('embed');
    const allItemIds = result.flatMap((g) => g.items.map((i) => i.id));
    expect(allItemIds).toContain('general.semantic');
    expect(allItemIds).toContain('models');
  });

  it('returns empty array when nothing matches', () => {
    const result = filterNavGroups('zzznomatch999');
    expect(result).toHaveLength(0);
  });

  it('removes groups that have no matching items', () => {
    // 'storage' keyword only matches the storage group
    const result = filterNavGroups('migrate');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('storage');
  });

  it('matches are case-insensitive for labels', () => {
    const lower = filterNavGroups('editor');
    const upper = filterNavGroups('EDITOR');
    expect(lower).toHaveLength(upper.length);
    expect(lower[0].items[0].id).toBe(upper[0].items[0].id);
  });

  it('original NAV_GROUPS is not mutated', () => {
    const originalLength = NAV_GROUPS[0].items.length;
    filterNavGroups('proxy');
    expect(NAV_GROUPS[0].items).toHaveLength(originalLength);
  });

  it('searching for agent returns only agents group', () => {
    const result = filterNavGroups('agent');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('agents');
  });

  it('searching for model returns models group', () => {
    const result = filterNavGroups('llm');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('models');
  });
});

// ─── getFilteredSectionIds ────────────────────────────────────────────────────

describe('getFilteredSectionIds', () => {
  it('returns all section ids when no filter applied', () => {
    const ids = getFilteredSectionIds(filterNavGroups(''));
    expect(ids).toEqual(ALL_SECTION_IDS);
  });

  it('returns only matched ids for a query', () => {
    const groups = filterNavGroups('proxy');
    const ids = getFilteredSectionIds(groups);
    expect(ids).toEqual(['general.proxy']);
  });

  it('returns empty array for no matches', () => {
    const ids = getFilteredSectionIds(filterNavGroups('zzznomatch'));
    expect(ids).toHaveLength(0);
  });

  it('preserves nav order', () => {
    // searching 'search' matches general.semantic (via label and keyword)
    const groups = filterNavGroups('search');
    const ids = getFilteredSectionIds(groups);
    expect(ids[0]).toBe('general.semantic');
  });
});

// ─── resolveActiveSection ─────────────────────────────────────────────────────

describe('resolveActiveSection', () => {
  it('keeps current section when search is not active', () => {
    const result = resolveActiveSection(
      'general.editor',
      ['general.proxy', 'general.editor'],
      false,
    );
    expect(result).toBe('general.editor');
  });

  it('keeps current section when it is still in filtered ids', () => {
    const result = resolveActiveSection(
      'general.editor',
      ['general.proxy', 'general.editor'],
      true,
    );
    expect(result).toBe('general.editor');
  });

  it('falls back to first filtered id when current is not visible', () => {
    const result = resolveActiveSection('storage', ['general.proxy', 'general.editor'], true);
    expect(result).toBe('general.proxy');
  });

  it('keeps current section when filteredIds is empty', () => {
    const result = resolveActiveSection('agents', [], true);
    expect(result).toBe('agents');
  });

  it('keeps current section when search is inactive even if not in filteredIds', () => {
    // search inactive: collapse state may hide items, but section doesn't change
    const result = resolveActiveSection('storage', ['general.proxy'], false);
    expect(result).toBe('storage');
  });
});

// ─── toggleCollapsed ──────────────────────────────────────────────────────────

describe('toggleCollapsed', () => {
  it('adds a group id to an empty set', () => {
    const result = toggleCollapsed(new Set(), 'general');
    expect(result.has('general')).toBe(true);
  });

  it('removes a group id that is already in the set', () => {
    const result = toggleCollapsed(new Set(['general']), 'general');
    expect(result.has('general')).toBe(false);
  });

  it('does not mutate the original set', () => {
    const original = new Set(['general']);
    toggleCollapsed(original, 'general');
    expect(original.has('general')).toBe(true);
  });

  it('preserves other group ids when toggling one', () => {
    const original = new Set(['models', 'storage']);
    const result = toggleCollapsed(original, 'models');
    expect(result.has('storage')).toBe(true);
    expect(result.has('models')).toBe(false);
  });

  it('can toggle multiple groups independently', () => {
    let state = new Set<string>();
    state = toggleCollapsed(state, 'general');
    state = toggleCollapsed(state, 'models');
    expect(state.has('general')).toBe(true);
    expect(state.has('models')).toBe(true);

    state = toggleCollapsed(state, 'general');
    expect(state.has('general')).toBe(false);
    expect(state.has('models')).toBe(true);
  });
});

// ─── isGroupExpanded ──────────────────────────────────────────────────────────

describe('isGroupExpanded', () => {
  it('returns true when group is not collapsed', () => {
    expect(isGroupExpanded('general', new Set(), false)).toBe(true);
  });

  it('returns false when group is in collapsed set', () => {
    expect(isGroupExpanded('general', new Set(['general']), false)).toBe(false);
  });

  it('returns true when search is active regardless of collapsed state', () => {
    // search overrides collapse — all groups expand during search
    expect(isGroupExpanded('general', new Set(['general']), true)).toBe(true);
  });

  it('returns true for non-collapsed group even without search', () => {
    expect(isGroupExpanded('models', new Set(['general']), false)).toBe(true);
  });
});
