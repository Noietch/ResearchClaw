import fs from 'fs/promises';
import path from 'path';
import { PapersRepository } from '../../db/repositories/papers.repository';
import { extractPdfText, extractFromArxiv, ExtractedPdf } from './pdf-extractor.service';
import { getPapersDir } from '../store/app-settings-store';

/**
 * Get the path to the text file for a paper
 */
function getTextFilePath(shortId: string): string {
  return path.join(getPapersDir(), shortId, 'text.txt');
}

/**
 * Get paper text with caching.
 * First checks if text is already stored in a local text.txt file.
 * If not, extracts it from PDF and stores it for future use.
 */
export async function getPaperText(
  paperId: string,
  shortId: string,
  pdfUrl?: string,
  pdfPath?: string,
  options: { maxChars?: number; forceRefresh?: boolean } = {},
): Promise<string> {
  const papersRepo = new PapersRepository();
  const textFilePath = getTextFilePath(shortId);

  // Check for cached text file unless force refresh
  if (!options.forceRefresh) {
    try {
      const cached = await fs.readFile(textFilePath, 'utf-8');
      if (cached) {
        return cached;
      }
    } catch {
      // File doesn't exist, proceed to extract
    }
  }

  // Determine source for extraction — fall back to DB if caller didn't provide paths
  let source: string | null = pdfPath || pdfUrl || null;

  if (!source) {
    try {
      const paper = await papersRepo.findById(paperId);
      if (paper?.pdfPath) {
        source = paper.pdfPath;
      } else if (paper?.pdfUrl) {
        source = paper.pdfUrl;
      } else if (paper?.sourceUrl) {
        source = paper.sourceUrl;
      }
    } catch {
      // ignore DB error
    }
  }

  if (!source) {
    return '';
  }

  // Extract text
  try {
    const extracted: ExtractedPdf = await (source.includes('arxiv')
      ? extractFromArxiv(source, { maxChars: options.maxChars || 8000 })
      : extractPdfText(source, { maxChars: options.maxChars || 8000 }));

    const text = extracted.text;

    // Save to local text file
    if (text) {
      // Ensure the paper folder exists
      const folder = path.dirname(textFilePath);
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(textFilePath, text, 'utf-8');

      // Update the textPath in database
      await papersRepo.updateTextPath(paperId, textFilePath);
    }

    return text;
  } catch (err) {
    console.error('[paper-text] Failed to extract text:', err);
    return '';
  }
}

/**
 * Get paper excerpt for LLM context (truncated).
 * Uses cached text file if available, otherwise extracts and saves.
 */
export async function getPaperExcerptCached(
  paperId: string,
  shortId: string,
  pdfUrl?: string,
  pdfPath?: string,
  maxChars = 8000,
): Promise<string> {
  const text = await getPaperText(paperId, shortId, pdfUrl, pdfPath, { maxChars });
  return text;
}
