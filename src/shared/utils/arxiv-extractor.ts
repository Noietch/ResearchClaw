/**
 * Extract arXiv ID from various URL formats
 * Supports: /abs/ID, /pdf/ID, /pdf/ID.pdf, /pdf/IDvN
 */
export function extractArxivId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    // Match /abs/ID or /pdf/ID or /pdf/ID.pdf
    const absMatch = pathname.match(/\/abs\/([^/?]+)$/);
    if (absMatch) return absMatch[1].replace(/v\d+$/, '');

    const pdfMatch = pathname.match(/\/pdf\/([^/?]+?)(?:\.pdf)?$/);
    if (pdfMatch) {
      // Remove version suffix if present (e.g., v1, v2)
      return pdfMatch[1].replace(/v\d+$/, '');
    }

    // Handle old format with archive prefix: /pdf/cs.AI/0701001
    const oldPdfMatch = pathname.match(/\/pdf\/([^/]+\/[^/?]+)/);
    if (oldPdfMatch) return oldPdfMatch[1].replace('/', '');

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract arXiv ID from title (e.g., "arxiv.org/pdf/2504.16054" -> "2504.16054")
 */
export function extractArxivIdFromTitle(title: string): string | null {
  const match = title.match(/arxiv\.org\/(?:abs|pdf)\/([^/\s]+)/i);
  if (match) {
    // Remove version suffix if present
    return match[1].replace(/v\d+$/, '').replace(/\.pdf$/i, '');
  }
  return null;
}

/**
 * Build the canonical arXiv PDF URL for a given arXiv ID.
 * Uses the no-.pdf-suffix form which avoids a 301 redirect.
 */
export function arxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}`;
}

/**
 * Clean arXiv title by removing the [arXiv ID] prefix
 */
export function cleanArxivTitle(title: string): string {
  // Remove patterns like "[2505.02833]" or "[cs.CL/0701001]" from the beginning
  const cleaned = title.replace(/^\[[\w./-]+\]\s*/i, '').trim();
  return cleaned || title;
}

/**
 * Check if title is invalid (URL, arxiv path, or arxiv ID format)
 */
export function isInvalidTitle(title: string): boolean {
  if (!title || !title.trim()) return true;
  const trimmed = title.trim();
  // URL format
  if (trimmed.startsWith('http')) return true;
  // arxiv path format (e.g., "arxiv.org/pdf/2504.16054")
  if (/arxiv\.org\/(abs|pdf)\//i.test(trimmed)) return true;
  // arxiv ID only (e.g., "2504.16054" or "2504.16054v1")
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) return true;
  return false;
}
