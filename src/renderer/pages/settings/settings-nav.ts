// ─── Settings Navigation Logic ────────────────────────────────────────────────
// Pure data and functions extracted from settings/page.tsx for testability.
// No React, no Electron, no IPC — safe to import in unit/integration tests.

export type SectionId =
  | 'general.language'
  | 'general.proxy'
  | 'general.editor'
  | 'general.semantic'
  | 'general.overleaf'
  | 'general.dev'
  | 'models'
  | 'agents'
  | 'storage';

export type NavItem = { id: SectionId; label: string; keywords: string[] };
export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      {
        id: 'general.language',
        label: 'Language',
        keywords: ['language', 'locale', 'chinese', 'english', '语言', '中文'],
      },
      { id: 'general.proxy', label: 'Proxy', keywords: ['proxy', 'http', 'network', 'socks'] },
      {
        id: 'general.editor',
        label: 'Editor',
        keywords: ['editor', 'vscode', 'cursor', 'neovim', 'zed'],
      },
      {
        id: 'general.semantic',
        label: 'Semantic Search',
        keywords: ['semantic', 'search', 'embedding', 'recommendation'],
      },
      {
        id: 'general.overleaf',
        label: 'Overleaf',
        keywords: ['overleaf', 'latex', 'cloud', 'import', 'sync'],
      },
      {
        id: 'general.dev',
        label: 'Developer Mode',
        keywords: ['developer', 'dev', 'debug', 'welcome'],
      },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    items: [
      {
        id: 'models',
        label: 'Models & Usage',
        keywords: ['model', 'api', 'llm', 'token', 'usage', 'lightweight', 'embedding'],
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      {
        id: 'agents',
        label: 'CLI Agents',
        keywords: ['agent', 'cli', 'tool', 'claude', 'command'],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    items: [
      {
        id: 'storage',
        label: 'Data Directory',
        keywords: ['storage', 'data', 'directory', 'folder', 'migrate'],
      },
    ],
  },
];

export const SECTION_META: Record<SectionId, { title: string; description: string }> = {
  'general.language': {
    title: 'Language / 语言',
    description: 'Choose the display language for the application.',
  },
  'general.proxy': {
    title: 'Proxy',
    description: 'Configure HTTP/HTTPS/SOCKS proxy for network requests.',
  },
  'general.editor': {
    title: 'Editor',
    description: 'Choose your preferred code editor for opening paper folders.',
  },
  'general.semantic': {
    title: 'Semantic Search',
    description: 'Configure embedding-based search and paper recommendations.',
  },
  'general.overleaf': {
    title: 'Overleaf',
    description: 'Connect to Overleaf to import your LaTeX projects as PDFs.',
  },
  'general.dev': {
    title: 'Developer Mode',
    description: 'Enable developer mode to show welcome modal on every startup.',
  },
  models: {
    title: 'Models & Usage',
    description: 'Configure AI models for lightweight tasks and embeddings.',
  },
  agents: {
    title: 'CLI Agents',
    description: 'Manage CLI-based agent tools for research automation.',
  },
  storage: {
    title: 'Data Directory',
    description: 'Configure where all app data (database, papers, config) is stored.',
  },
};

/** All section IDs in nav order */
export const ALL_SECTION_IDS: SectionId[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

/**
 * Filter NAV_GROUPS by a search query.
 * Returns groups with only matching items; empty-item groups are removed.
 * Empty query returns all groups unchanged.
 */
export function filterNavGroups(query: string): NavGroup[] {
  const q = query.toLowerCase().trim();
  if (!q) return NAV_GROUPS;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * Given filtered groups, return all visible section IDs in order.
 */
export function getFilteredSectionIds(groups: NavGroup[]): SectionId[] {
  return groups.flatMap((g) => g.items.map((i) => i.id));
}

/**
 * Determine the active section after a search query changes.
 * If the current section is still visible, keep it.
 * Otherwise fall back to the first visible section (or keep current if nothing matches).
 */
export function resolveActiveSection(
  currentSection: SectionId,
  filteredIds: SectionId[],
  searchActive: boolean,
): SectionId {
  if (!searchActive || filteredIds.length === 0) return currentSection;
  if (filteredIds.includes(currentSection)) return currentSection;
  return filteredIds[0];
}

/**
 * Toggle a group's collapsed state.
 * Returns a new Set (immutable update).
 */
export function toggleCollapsed(collapsed: Set<string>, groupId: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  return next;
}

/**
 * Whether a group's items should be visible.
 * Items are always shown when search is active (search overrides collapse).
 */
export function isGroupExpanded(
  groupId: string,
  collapsed: Set<string>,
  searchActive: boolean,
): boolean {
  if (searchActive) return true;
  return !collapsed.has(groupId);
}
