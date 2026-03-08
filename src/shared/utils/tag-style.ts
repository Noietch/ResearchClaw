/**
 * Tag styling utilities
 * Provides consistent tag colors across the application using hash-based assignment.
 */

export interface TagStyle {
  bg: string;
  text: string;
}

const TAG_COLORS: TagStyle[] = [
  { bg: 'bg-blue-50', text: 'text-blue-700' },
  { bg: 'bg-green-50', text: 'text-green-700' },
  { bg: 'bg-orange-50', text: 'text-orange-700' },
  { bg: 'bg-purple-50', text: 'text-purple-700' },
  { bg: 'bg-pink-50', text: 'text-pink-700' },
  { bg: 'bg-yellow-50', text: 'text-yellow-700' },
  { bg: 'bg-cyan-50', text: 'text-cyan-700' },
  { bg: 'bg-red-50', text: 'text-red-700' },
];

/**
 * Get consistent styling for a tag based on its name.
 * Uses a hash function to ensure the same tag always gets the same color.
 */
export function getTagStyle(tagName: string): TagStyle {
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}
