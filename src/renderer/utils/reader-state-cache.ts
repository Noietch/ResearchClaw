/**
 * Module-level cache for reader page state.
 * Survives component unmounts but not page refreshes.
 * Keyed by paper shortId.
 */

export interface ReaderState {
  layoutMode: 'split' | 'chat-only' | 'pdf-only';
  leftWidth: number;
  showCitationSidebar: boolean;
  chatInput: string;
  // Search modal
  previewModalOpen: boolean;
  searchResults: unknown[];
  searchQuery: string;
  previewNoPdfUrl: string | null;
}

const cache = new Map<string, ReaderState>();

export function saveReaderState(paperId: string, state: ReaderState) {
  cache.set(paperId, state);
}

export function loadReaderState(paperId: string): ReaderState | null {
  return cache.get(paperId) ?? null;
}
