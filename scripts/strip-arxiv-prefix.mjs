#!/usr/bin/env node
/**
 * Strip [arxivId] prefix from all paper titles in the database.
 * Run with: node scripts/strip-arxiv-prefix.mjs
 */

import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const dbPath = join(homedir(), '.vibe-research', 'vibe-research.db');
console.log('Using database:', dbPath);

// Get all paper IDs and titles
const papersJson = execSync(
  `sqlite3 "${dbPath}" "SELECT id, title FROM Paper;"`,
  { encoding: 'utf-8' }
);

const lines = papersJson.trim().split('\n').filter(Boolean);
console.log(`Found ${lines.length} papers`);

let updated = 0;
const regex = /^\[\d{4}\.\d{4,5}(v\d+)?\]\s*/;

for (const line of lines) {
  // Split by first | (assuming no | in ID)
  const pipeIdx = line.indexOf('|');
  if (pipeIdx === -1) continue;

  const id = line.slice(0, pipeIdx);
  const title = line.slice(pipeIdx + 1);

  const bare = title.replace(regex, '');
  if (bare !== title) {
    // Escape single quotes for SQL
    const escapedTitle = bare.replace(/'/g, "''");
    try {
      execSync(
        `sqlite3 "${dbPath}" "UPDATE Paper SET title = '${escapedTitle}' WHERE id = '${id}';"`,
        { encoding: 'utf-8' }
      );
      console.log(`Updated: "${title.slice(0, 50)}..." -> "${bare.slice(0, 50)}..."`);
      updated++;
    } catch (e) {
      console.error(`Failed to update ${id}:`, e.message);
    }
  }
}

console.log(`\nDone! Updated ${updated} papers.`);
