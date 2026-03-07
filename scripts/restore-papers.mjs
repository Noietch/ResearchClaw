#!/usr/bin/env node
/**
 * Restore papers from local papers folder to database.
 * Usage: node scripts/restore-papers.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// Resolve platform-appropriate data directory (mirrors storage-path.ts logic)
function getBaseDir() {
  if (process.env.VIBE_RESEARCH_STORAGE_DIR) return process.env.VIBE_RESEARCH_STORAGE_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'VibeResearch');
  }
  if (process.platform === 'linux') {
    return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'vibe-research');
  }
  return path.join(os.homedir(), '.vibe-research'); // macOS
}

// Set DATABASE_URL before importing Prisma
const DB_PATH = path.join(getBaseDir(), 'vibe-research.db');
process.env.DATABASE_URL = `file:${DB_PATH}`;

// Dynamic import for Prisma (ESM)
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const PAPERS_DIR = path.join(getBaseDir(), 'papers');

// Keywords for tagging
const KEYWORDS = {
  llm: ['llm', 'language model', 'gpt', 'claude', 'transformer'],
  agent: ['agent', 'tool use', 'planning', 'agentic'],
  vision: ['vision', 'image', 'multimodal', 'visual'],
  robotics: ['robot', 'policy', 'control', 'embodied'],
  rl: ['reinforcement', 'rl', 'reward'],
  benchmark: ['benchmark', 'leaderboard', 'evaluation'],
  diffusion: ['diffusion', 'stable diffusion', 'ddpm'],
  rag: ['retrieval', 'rag', 'retrieval-augmented'],
  alignment: ['alignment', 'rlhf', 'safety', 'harmless'],
  code: ['code generation', 'programming', 'coding'],
};

function keywordTag(title, url) {
  const text = `${title} ${url}`.toLowerCase();
  const tags = new Set();
  for (const [tag, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => text.includes(w))) tags.add(tag);
  }
  if (url.includes('arxiv.org')) tags.add('arxiv');
  if (tags.size === 0) tags.add('uncategorized');
  return Array.from(tags);
}

async function fetchArxivMetadata(arxivId) {
  try {
    const res = await fetch(`https://arxiv.org/abs/${arxivId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/^\[[\w./-]+\]\s*/, '').trim() : arxivId;

    const authors = [];
    const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g);
    for (const m of authorMatches) authors.push(m[1]);

    const absMatch = html.match(/<meta name="citation_abstract" content="([^"]+)"/i);
    const abstract = absMatch ? absMatch[1].replace(/\n/g, ' ').trim() : '';

    const yearMatch = html.match(/\[Submitted on (\d{1,2}) \w+\.? (\d{4})/i);
    const year = yearMatch ? parseInt(yearMatch[2], 10) : undefined;

    return { title, authors, abstract, year };
  } catch (err) {
    console.error(`  Failed to fetch metadata for ${arxivId}:`, err.message);
    return null;
  }
}

async function main() {
  console.log('Scanning papers folder:', PAPERS_DIR);

  // Get existing papers
  const existing = await prisma.paper.findMany({ select: { shortId: true } });
  const existingIds = new Set(existing.map((p) => p.shortId));
  console.log(`Found ${existingIds.size} existing papers in database`);

  // Scan folder
  const entries = fs.readdirSync(PAPERS_DIR, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && /^\d{4}\.\d{4,5}(v\d+)?$/.test(e.name))
    .map((e) => e.name);

  console.log(`Found ${folders.length} arXiv paper folders`);

  // Filter out existing
  const toImport = folders.filter((id) => {
    const normalized = id.replace(/v\d+$/, '');
    return !existingIds.has(normalized);
  });

  console.log(
    `${toImport.length} papers to import (${folders.length - toImport.length} already exist)`,
  );

  if (toImport.length === 0) {
    console.log('Nothing to import.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toImport.length; i++) {
    const arxivId = toImport[i].replace(/v\d+$/, '');
    console.log(`[${i + 1}/${toImport.length}] Importing ${arxivId}...`);

    const meta = await fetchArxivMetadata(arxivId);
    if (!meta) {
      failed++;
      continue;
    }

    const title = `[${arxivId}] ${meta.title}`;
    const tags = keywordTag(meta.title, `https://arxiv.org/abs/${arxivId}`);

    const pdfPath = path.join(PAPERS_DIR, arxivId, 'paper.pdf');
    const hasPdf = fs.existsSync(pdfPath);

    try {
      // Create tags first
      const tagRecords = await Promise.all(
        tags.map((name) =>
          prisma.tag.upsert({
            where: { name },
            create: { name },
            update: {},
          }),
        ),
      );

      // Create paper
      const paper = await prisma.paper.create({
        data: {
          shortId: arxivId,
          title,
          authorsJson: JSON.stringify(meta.authors),
          source: 'arxiv',
          sourceUrl: `https://arxiv.org/abs/${arxivId}`,
          year: meta.year,
          abstract: meta.abstract,
          pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
          pdfPath: hasPdf ? pdfPath : null,
          tags: {
            create: tagRecords.map((tag) => ({
              tagId: tag.id,
            })),
          },
        },
      });

      console.log(`  Created: ${paper.title.slice(0, 60)}...`);
      success++;
    } catch (err) {
      console.error(`  Failed to create paper:`, err.message);
      failed++;
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone: ${success} imported, ${failed} failed`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
