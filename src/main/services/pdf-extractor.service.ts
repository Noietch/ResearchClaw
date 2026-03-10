import fs from 'fs/promises';
import https from 'https';
import http from 'http';
import { arxivPdfUrl } from '@shared';

// pdf-parse v2 API result
interface TextResult {
  pages: Array<{ text: string }>;
  text: string;
  total: number;
}

interface InfoResult {
  numPages?: number;
  [key: string]: unknown;
}

interface PdfParseResult {
  text: string;
  numpages: number;
  info: Record<string, unknown>;
}

type PdfParseConstructor = new (options: { data: Buffer }) => {
  getText(): Promise<TextResult>;
  getInfo(): Promise<InfoResult>;
};

function isPdfParseConstructor(value: unknown): value is PdfParseConstructor {
  return typeof value === 'function';
}

export function resolvePdfParseConstructor(moduleValue: unknown): PdfParseConstructor {
  const candidates = [
    (moduleValue as { PDFParse?: unknown })?.PDFParse,
    (moduleValue as { default?: { PDFParse?: unknown } })?.default?.PDFParse,
    (moduleValue as { default?: unknown })?.default,
  ];

  for (const candidate of candidates) {
    if (isPdfParseConstructor(candidate)) {
      return candidate;
    }
  }

  const moduleRecord =
    moduleValue && typeof moduleValue === 'object' ? (moduleValue as Record<string, unknown>) : {};
  const defaultRecord =
    moduleRecord.default && typeof moduleRecord.default === 'object'
      ? (moduleRecord.default as Record<string, unknown>)
      : {};

  throw new Error(
    `Unable to resolve pdf-parse PDFParse constructor (keys: ${Object.keys(moduleRecord).join(
      ', ',
    )}, default keys: ${Object.keys(defaultRecord).join(', ')})`,
  );
}

// Dynamic import for pdf-parse (ESM compatibility)
async function parsePdf(buffer: Buffer, _options?: { max?: number }): Promise<PdfParseResult> {
  const pdfParseModule = await import('pdf-parse');
  const PDFParse = resolvePdfParseConstructor(pdfParseModule);
  const parser = new PDFParse({ data: buffer });

  const textResult: TextResult = await parser.getText();
  const info = (await parser.getInfo()) as unknown as InfoResult;

  return {
    text: textResult?.text || '',
    numpages: info?.numPages || textResult?.total || 0,
    info: info || {},
  };
}

export interface ExtractedPdf {
  text: string;
  pageCount: number;
  info?: Record<string, unknown>;
}

export interface ExtractionOptions {
  maxPages?: number;
  maxChars?: number;
}

/**
 * Extract text from a local PDF file
 */
export async function extractTextFromPdf(
  filePath: string,
  options: ExtractionOptions = {},
): Promise<ExtractedPdf> {
  const buffer = await fs.readFile(filePath);

  const data = await parsePdf(buffer);

  let text = data.text;

  if (options.maxChars && text.length > options.maxChars) {
    text = text.slice(0, options.maxChars) + '\n...[truncated]';
  }

  return {
    text,
    pageCount: data.numpages,
    info: data.info,
  };
}

/**
 * Download PDF from URL and extract text
 */
export async function extractTextFromPdfUrl(
  url: string,
  options: ExtractionOptions = {},
): Promise<ExtractedPdf> {
  const buffer = await downloadPdf(url);

  const data = await parsePdf(buffer);

  let text = data.text;

  if (options.maxChars && text.length > options.maxChars) {
    text = text.slice(0, options.maxChars) + '\n...[truncated]';
  }

  return {
    text,
    pageCount: data.numpages,
    info: data.info,
  };
}

/**
 * Download PDF from URL to buffer
 */
function downloadPdf(url: string, originalUrl?: string, timeout = 60000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    const chunks: Buffer[] = [];
    let finished = false;

    const request = client.get(url, (res) => {
      if (finished) return;

      if (res.statusCode === 301 || res.statusCode === 302) {
        let redirectUrl = res.headers.location;
        if (redirectUrl) {
          // Handle relative redirect URLs
          if (redirectUrl.startsWith('/')) {
            const baseUrl = new URL(originalUrl || url);
            redirectUrl = `${baseUrl.protocol}//${baseUrl.host}${redirectUrl}`;
          }
          downloadPdf(redirectUrl, originalUrl || url, timeout)
            .then(resolve)
            .catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        finished = true;
        reject(new Error(`Failed to download PDF: HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', (chunk) => {
        if (!finished) chunks.push(chunk);
      });
      res.on('end', () => {
        if (!finished) {
          finished = true;
          resolve(Buffer.concat(chunks));
        }
      });
      res.on('error', (err) => {
        if (!finished) {
          finished = true;
          reject(err);
        }
      });
    });

    request.on('error', (err) => {
      if (!finished) {
        finished = true;
        reject(err);
      }
    });

    // Set timeout
    request.setTimeout(timeout, () => {
      if (!finished) {
        finished = true;
        request.destroy();
        reject(new Error(`PDF download timed out after ${timeout}ms`));
      }
    });
  });
}

/**
 * Extract arXiv ID from URL or string
 */
export function extractArxivId(input: string): string | null {
  const patterns = [
    /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    /arxiv\.org\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    /(\d{4}\.\d{4,5}(?:v\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1].replace(/v\d+$/, '');
    }
  }

  return null;
}

/**
 * Get arXiv PDF URL from ID
 */
export function getArxivPdfUrl(arxivId: string): string {
  return arxivPdfUrl(arxivId);
}

/**
 * Extract text from arXiv paper (by ID or URL)
 */
export async function extractFromArxiv(
  input: string,
  options: ExtractionOptions = {},
): Promise<ExtractedPdf> {
  const arxivId = extractArxivId(input);
  if (!arxivId) {
    throw new Error(`Invalid arXiv ID or URL: ${input}`);
  }

  const pdfUrl = getArxivPdfUrl(arxivId);
  return extractTextFromPdfUrl(pdfUrl, options);
}

/**
 * Smart extraction: try local file first, then URL
 */
export async function extractPdfText(
  source: string,
  options: ExtractionOptions = {},
): Promise<ExtractedPdf> {
  try {
    await fs.access(source);
    return extractTextFromPdf(source, options);
  } catch {
    // Not a local file
  }

  const arxivId = extractArxivId(source);
  if (arxivId) {
    return extractFromArxiv(source, options);
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    return extractTextFromPdfUrl(source, options);
  }

  throw new Error(`Cannot extract PDF text from: ${source}`);
}

/**
 * Get paper text excerpt for LLM context
 */
export async function getPaperExcerpt(source: string, maxChars = 8000): Promise<string> {
  try {
    const result = await extractPdfText(source, { maxChars });
    return result.text;
  } catch (err) {
    console.error('[pdf-extractor] Failed to extract text:', err);
    return '';
  }
}
