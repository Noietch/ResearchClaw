import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  parseReferencesFromText,
  findReferenceSection as sharedFindReferenceSection,
  type Reference,
} from '@shared';

// Re-export Reference type from shared
export type { Reference };

export interface CitationMarker {
  id: string;
  text: string; // e.g., "[1]", "[2]", "[3-5]"
  numbers: number[]; // e.g., [1], [2], [3,4,5]
  pageNumber: number;
}

export interface CitationData {
  markers: CitationMarker[];
  references: Reference[];
  referenceMap: Map<number, Reference>;
}

/**
 * Parse citation numbers from text like "[1]", "[2,3]", "[1-3]", "[1, 3-5]"
 */
export function parseCitationNumbers(text: string): number[] {
  const numbers: number[] = [];
  const cleanText = text.replace(/[\[\]]/g, '').trim();

  if (!cleanText) return numbers;

  // Handle comma-separated parts, each can be a single number or a range
  for (const part of cleanText.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if this part is a range (e.g., "3-5" or "3–5")
    if (trimmed.includes('-') || trimmed.includes('–')) {
      const rangeParts = trimmed.split(/[-–]/);
      if (rangeParts.length === 2) {
        const start = parseInt(rangeParts[0].trim(), 10);
        const end = parseInt(rangeParts[1].trim(), 10);
        if (!isNaN(start) && !isNaN(end) && end >= start && end - start < 20) {
          for (let i = start; i <= end; i++) {
            numbers.push(i);
          }
          continue;
        }
      }
    }

    // Single number
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num > 0 && num <= 500) {
      numbers.push(num);
    }
  }

  return numbers;
}

/**
 * Extract citation markers from text
 */
export function extractCitationMarkersFromText(text: string, pageNumber: number): CitationMarker[] {
  const markers: CitationMarker[] = [];
  const seen = new Set<string>();

  // Use the first pattern for [1] style citations
  const pattern = /\[(\d+(?:\s*[-–,]\s*\d+)*)+\]/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const citationText = match[0];
    if (seen.has(citationText)) continue;
    seen.add(citationText);

    const numbers = parseCitationNumbers(citationText);
    if (numbers.length === 0) continue;

    // Filter out likely false positives
    if (numbers.some((n) => n > 200)) continue;

    markers.push({
      id: `cite-p${pageNumber}-${citationText}`,
      text: citationText,
      numbers,
      pageNumber,
    });
  }

  return markers;
}

/**
 * Find reference section start in text (delegates to shared module with logging)
 */
export function findReferenceSection(text: string): number {
  console.log('[citation-detector] Searching for reference section...');
  const result = sharedFindReferenceSection(text);
  if (result === -1) {
    console.log('[citation-detector] Could not find reference section');
  } else {
    console.log('[citation-detector] Reference section found at position', result);
  }
  return result;
}

/**
 * Parse reference list from text (delegates to shared module with logging)
 */
export function parseReferences(text: string): Reference[] {
  const refStart = findReferenceSection(text);
  if (refStart === -1) return [];

  const refSection = text.slice(refStart);
  console.log('[citation-detector] Reference section preview:', refSection.slice(0, 500));

  const references = parseReferencesFromText(text);
  console.log(`[citation-detector] Total references parsed: ${references.length}`);
  return references;
}

/**
 * Main function to extract citations from PDF document
 */
export async function extractCitationsFromPdf(
  document: PDFDocumentProxy,
  onProgress?: (progress: number) => void,
): Promise<CitationData> {
  const allMarkers: CitationMarker[] = [];
  const allText: string[] = [];

  // Extract text from all pages
  console.log(`[citation-detector] Document has ${document.numPages} pages`);
  for (let pageNum = 1; pageNum <= document.numPages; pageNum++) {
    const page = await document.getPage(pageNum);
    const textContent = await page.getTextContent();
    // Use y-position and hasEOL to detect line breaks in PDF text
    const items = textContent.items as any[];
    let text = '';
    let lastY: number | null = null;
    for (const item of items) {
      if (!item.str && !item.hasEOL) continue;
      if (item.hasEOL) {
        text += '\n';
        lastY = null;
        if (!item.str) continue;
      }
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        text += '\n';
      } else if (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
        text += ' ';
      }
      text += item.str;
      if (y !== null) lastY = y;
    }

    allText.push(text);

    // Extract citation markers from this page
    const markers = extractCitationMarkersFromText(text, pageNum);
    allMarkers.push(...markers);

    onProgress?.(pageNum / document.numPages / 2);
  }

  // Combine all text for reference parsing
  const fullText = allText.join('\n\n');

  // Debug: log text extraction stats
  console.log(
    `[citation-detector] Extracted text from ${allText.length} pages, total length: ${fullText.length} chars`,
  );
  console.log('[citation-detector] First 500 chars of text:');
  console.log(fullText.slice(0, 500));
  console.log('[citation-detector] Last 500 chars of text:');
  console.log(fullText.slice(-500));

  // Parse references using shared module
  const references = parseReferencesFromText(fullText);
  const referenceMap = new Map<number, Reference>();
  for (const ref of references) {
    referenceMap.set(ref.number, ref);
  }

  // Debug: log last 3 references for troubleshooting
  if (references.length > 0) {
    const lastRefs = references.slice(-3);
    for (const ref of lastRefs) {
      console.log(
        `[citation-detector] Ref [${ref.number}]: title="${ref.title}" authors="${ref.authors}" venue="${ref.venue}" year=${ref.year}`,
      );
      console.log(`[citation-detector] Ref [${ref.number}] raw text: ${ref.text.slice(0, 200)}`);
    }
  }

  console.log(`[citation-detector] Total references parsed: ${references.length}`);

  onProgress?.(1);

  return {
    markers: allMarkers,
    references,
    referenceMap,
  };
}
