/**
 * Test the Zotero scan logic by creating a mock Zotero SQLite database in-memory.
 * This tests the SQL queries and data extraction without needing an actual Zotero install.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js');

describe('Zotero DB scan logic', () => {
  let mockDbPath: string;

  beforeAll(async () => {
    // Create a mock Zotero database with the correct schema
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const db = new SQL.Database();

    // Create Zotero schema tables
    db.run(`
      CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
      INSERT INTO itemTypes VALUES (1, 'journalArticle');
      INSERT INTO itemTypes VALUES (2, 'conferencePaper');
      INSERT INTO itemTypes VALUES (3, 'preprint');
      INSERT INTO itemTypes VALUES (4, 'note');
      INSERT INTO itemTypes VALUES (5, 'attachment');
    `);

    db.run(`
      CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER, key TEXT);
      INSERT INTO items VALUES (1, 1, 'ABC12345');
      INSERT INTO items VALUES (2, 2, 'DEF67890');
      INSERT INTO items VALUES (3, 3, 'GHI11111');
      INSERT INTO items VALUES (4, 4, 'NOTEPAPER');
      INSERT INTO items VALUES (5, 1, 'DELETED01');
    `);

    db.run(`
      CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
      INSERT INTO deletedItems VALUES (5);
    `);

    db.run(`
      CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
      INSERT INTO fields VALUES (1, 'title');
      INSERT INTO fields VALUES (2, 'DOI');
      INSERT INTO fields VALUES (3, 'abstractNote');
      INSERT INTO fields VALUES (4, 'url');
      INSERT INTO fields VALUES (5, 'date');
    `);

    db.run(`CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT)`);
    db.run(`
      INSERT INTO itemDataValues VALUES (1, 'Transformers in NLP');
      INSERT INTO itemDataValues VALUES (2, '10.1038/nature-test');
      INSERT INTO itemDataValues VALUES (3, 'Abstract for paper 1');
      INSERT INTO itemDataValues VALUES (4, 'https://example.com/paper1');
      INSERT INTO itemDataValues VALUES (5, '2023-05-15');
      INSERT INTO itemDataValues VALUES (6, 'Deep Learning for CV');
      INSERT INTO itemDataValues VALUES (7, '10.1145/conf-test');
      INSERT INTO itemDataValues VALUES (8, '2022');
      INSERT INTO itemDataValues VALUES (9, 'arXiv Preprint Title');
      INSERT INTO itemDataValues VALUES (10, 'https://arxiv.org/abs/2301.12345');
    `);

    db.run(`CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER)`);
    // Paper 1: journal article with DOI
    db.run(`INSERT INTO itemData VALUES (1, 1, 1)`); // title
    db.run(`INSERT INTO itemData VALUES (1, 2, 2)`); // DOI
    db.run(`INSERT INTO itemData VALUES (1, 3, 3)`); // abstract
    db.run(`INSERT INTO itemData VALUES (1, 4, 4)`); // url
    db.run(`INSERT INTO itemData VALUES (1, 5, 5)`); // date
    // Paper 2: conference paper with DOI
    db.run(`INSERT INTO itemData VALUES (2, 1, 6)`); // title
    db.run(`INSERT INTO itemData VALUES (2, 2, 7)`); // DOI
    db.run(`INSERT INTO itemData VALUES (2, 5, 8)`); // date
    // Paper 3: preprint with arXiv URL
    db.run(`INSERT INTO itemData VALUES (3, 1, 9)`); // title
    db.run(`INSERT INTO itemData VALUES (3, 4, 10)`); // url (arxiv)

    // Creators
    db.run(`
      CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
      INSERT INTO creators VALUES (1, 'John', 'Smith');
      INSERT INTO creators VALUES (2, 'Jane', 'Doe');
      INSERT INTO creators VALUES (3, 'Alice', 'Johnson');
    `);

    db.run(`
      CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorTypeName TEXT);
      INSERT INTO creatorTypes VALUES (1, 'author');
      INSERT INTO creatorTypes VALUES (2, 'editor');
    `);

    db.run(`
      CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, creatorTypeID INTEGER, orderIndex INTEGER);
      INSERT INTO itemCreators VALUES (1, 1, 1, 0);
      INSERT INTO itemCreators VALUES (1, 2, 1, 1);
      INSERT INTO itemCreators VALUES (2, 3, 1, 0);
    `);

    // Attachments (no actual files, just metadata)
    db.run(`
      CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, path TEXT, contentType TEXT);
      INSERT INTO itemAttachments VALUES (100, 1, 'storage:ABC12345/paper.pdf', 'application/pdf');
      INSERT INTO itemAttachments VALUES (101, 2, NULL, 'application/pdf');
    `);

    // Collections
    db.run(`
      CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT);
      INSERT INTO collections VALUES (1, 'My Research');
      INSERT INTO collections VALUES (2, 'NLP Papers');
    `);

    db.run(`
      CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
      INSERT INTO collectionItems VALUES (1, 1);
      INSERT INTO collectionItems VALUES (2, 1);
      INSERT INTO collectionItems VALUES (2, 3);
    `);

    // Write to temp file
    const data = db.export();
    const buffer = Buffer.from(data);
    mockDbPath = path.join(os.tmpdir(), `mock-zotero-test-${Date.now()}.sqlite`);
    fs.writeFileSync(mockDbPath, buffer);
    db.close();
  });

  it('reads items from mock Zotero DB correctly', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbBuffer = fs.readFileSync(mockDbPath);
    const db = new SQL.Database(dbBuffer);

    // Test the same query used in zotero.service.ts
    const itemsResult = db.exec(`
      SELECT i.itemID, i.key, it.typeName
      FROM items i
      JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
      WHERE it.typeName IN (
        'journalArticle', 'conferencePaper', 'preprint', 'book',
        'bookSection', 'thesis', 'report', 'manuscript', 'webpage'
      )
      AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
    `);

    expect(itemsResult).toHaveLength(1);
    const rows = itemsResult[0].values;
    // Should have 3 items (IDs 1, 2, 3) — item 4 is 'note', item 5 is deleted
    expect(rows).toHaveLength(3);

    const ids = rows.map((r: unknown[]) => Number(r[0]));
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    expect(ids).not.toContain(4); // note type excluded
    expect(ids).not.toContain(5); // deleted

    db.close();
  });

  it('reads fields (title, DOI, etc.) correctly', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbBuffer = fs.readFileSync(mockDbPath);
    const db = new SQL.Database(dbBuffer);

    const fieldsResult = db.exec(`
      SELECT id.itemID, f.fieldName, idv.value
      FROM itemData id
      JOIN itemDataValues idv ON id.valueID = idv.valueID
      JOIN fields f ON id.fieldID = f.fieldID
      WHERE id.itemID IN (1, 2, 3)
      AND f.fieldName IN ('title', 'DOI', 'abstractNote', 'url', 'date')
    `);

    expect(fieldsResult).toHaveLength(1);
    const rows = fieldsResult[0].values;

    // Paper 1 should have title, DOI, abstract, url, date = 5 fields
    const paper1Fields = rows.filter((r: unknown[]) => Number(r[0]) === 1);
    expect(paper1Fields).toHaveLength(5);

    const fieldMap = new Map<string, string>();
    for (const row of paper1Fields) {
      fieldMap.set(String(row[1]), String(row[2]));
    }
    expect(fieldMap.get('title')).toBe('Transformers in NLP');
    expect(fieldMap.get('DOI')).toBe('10.1038/nature-test');
    expect(fieldMap.get('abstractNote')).toBe('Abstract for paper 1');

    db.close();
  });

  it('reads authors correctly with order', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbBuffer = fs.readFileSync(mockDbPath);
    const db = new SQL.Database(dbBuffer);

    const authorsResult = db.exec(`
      SELECT ic.itemID, c.firstName, c.lastName
      FROM itemCreators ic
      JOIN creators c ON ic.creatorID = c.creatorID
      JOIN creatorTypes ct ON ic.creatorTypeID = ct.creatorTypeID
      WHERE ic.itemID IN (1, 2, 3)
      AND ct.creatorTypeName IN ('author', 'contributor', 'editor')
      ORDER BY ic.itemID, ic.orderIndex
    `);

    expect(authorsResult).toHaveLength(1);
    const rows = authorsResult[0].values;

    // Paper 1 has 2 authors
    const paper1Authors = rows.filter((r: unknown[]) => Number(r[0]) === 1);
    expect(paper1Authors).toHaveLength(2);
    expect(String(paper1Authors[0][2])).toBe('Smith'); // lastName first author
    expect(String(paper1Authors[1][2])).toBe('Doe'); // lastName second author

    db.close();
  });

  it('reads collections correctly', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbBuffer = fs.readFileSync(mockDbPath);
    const db = new SQL.Database(dbBuffer);

    const collectionsResult = db.exec(`
      SELECT ci.itemID, c.collectionName
      FROM collectionItems ci
      JOIN collections c ON ci.collectionID = c.collectionID
      WHERE ci.itemID IN (1, 2, 3)
    `);

    expect(collectionsResult).toHaveLength(1);
    const rows = collectionsResult[0].values;

    // Paper 1 is in "My Research" and "NLP Papers"
    const paper1Collections = rows
      .filter((r: unknown[]) => Number(r[0]) === 1)
      .map((r: unknown[]) => String(r[1]));
    expect(paper1Collections).toContain('My Research');
    expect(paper1Collections).toContain('NLP Papers');

    db.close();
  });

  it('reads PDF attachments correctly', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbBuffer = fs.readFileSync(mockDbPath);
    const db = new SQL.Database(dbBuffer);

    const pdfResult = db.exec(`
      SELECT ia.parentItemID, ia.path
      FROM itemAttachments ia
      WHERE ia.contentType = 'application/pdf'
      AND ia.parentItemID IS NOT NULL
      AND ia.parentItemID IN (1, 2, 3)
    `);

    expect(pdfResult).toHaveLength(1);
    const rows = pdfResult[0].values;

    // Paper 1 has a PDF, Paper 2 has null path
    expect(rows).toHaveLength(2); // both entries exist
    const paper1Pdf = rows.find((r: unknown[]) => Number(r[0]) === 1);
    expect(paper1Pdf).toBeTruthy();
    expect(String(paper1Pdf![1])).toBe('storage:ABC12345/paper.pdf');

    db.close();
  });

  it('resolves storage: prefix to absolute path', () => {
    const rawPath = 'storage:ABC12345/paper.pdf';
    const storageDir = '/Users/test/Zotero/storage';
    const resolved = path.join(storageDir, rawPath.replace('storage:', ''));
    expect(resolved).toBe('/Users/test/Zotero/storage/ABC12345/paper.pdf');
  });
});
