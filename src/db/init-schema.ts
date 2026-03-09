/**
 * Raw SQL schema initialization for packaged Electron app.
 * When prisma CLI is not available (packaged app), we create tables directly.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent execution.
 *
 * IMPORTANT: Keep this in sync with prisma/schema.prisma!
 */
import { getPrismaClient } from './client';

const SCHEMA_STATEMENTS = [
  // ─── Tables ──────────────────────────────────────────────────────────────────

  `CREATE TABLE IF NOT EXISTS "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shortId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authorsJson" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "submittedAt" DATETIME,
    "abstract" TEXT,
    "pdfUrl" TEXT,
    "pdfPath" TEXT,
    "textPath" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'idle',
    "processingError" TEXT,
    "processedAt" DATETIME,
    "indexedAt" DATETIME,
    "metadataSource" TEXT,
    "rating" INTEGER,
    "citationsExtractedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastReadAt" DATETIME
  )`,

  `CREATE TABLE IF NOT EXISTS "PaperChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentPreview" TEXT NOT NULL,
    "embeddingJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperChunk_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "PaperSearchUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "sourceChunkIndex" INTEGER,
    "unitIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentPreview" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "embeddingJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperSearchUnit_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "SourceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawTitle" TEXT,
    "rawUrl" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceEvent_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'topic',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "PaperTag" (
    "paperId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    PRIMARY KEY ("paperId", "tagId"),
    CONSTRAINT "PaperTag_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "ReadingNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "repoUrl" TEXT,
    "commitHash" TEXT,
    "chatNoteId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReadingNote_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReadingNote_chatNoteId_fkey" FOREIGN KEY ("chatNoteId") REFERENCES "ReadingNote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workdir" TEXT,
    "sshServerId" TEXT,
    "remoteWorkdir" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastAccessedAt" DATETIME
  )`,

  `CREATE TABLE IF NOT EXISTS "ProjectRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "localPath" TEXT,
    "clonedAt" DATETIME,
    "isWorkdirRepo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "ProjectIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "paperIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectIdea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "PaperCodeLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "commitHash" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperCodeLink_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "PaperCollection" (
    "paperId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("paperId", "collectionId"),
    CONSTRAINT "PaperCollection_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "AgentConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "cliPath" TEXT,
    "acpArgs" TEXT NOT NULL DEFAULT '[]',
    "agentTool" TEXT,
    "configContent" TEXT,
    "authContent" TEXT,
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "isDetected" BOOLEAN NOT NULL DEFAULT false,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "extraEnv" TEXT NOT NULL DEFAULT '{}',
    "defaultModel" TEXT,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "AgentTodo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "cwd" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "cronExpr" TEXT,
    "cronEnabled" BOOLEAN NOT NULL DEFAULT false,
    "yoloMode" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "sessionId" TEXT,
    "lastRunId" TEXT,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentTodo_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTodo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "AgentTodoRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "todoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "sessionId" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "exitCode" INTEGER,
    "errorMessage" TEXT,
    "summary" TEXT,
    "tokenUsage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTodoRun_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "AgentTodo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "AgentTodoMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "msgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'assistant',
    "content" TEXT NOT NULL,
    "status" TEXT,
    "toolCallId" TEXT,
    "toolName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTodoMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentTodoRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "RecommendationCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "arxivId" TEXT,
    "doi" TEXT,
    "title" TEXT NOT NULL,
    "titleNormalized" TEXT NOT NULL,
    "authorsJson" TEXT NOT NULL DEFAULT '[]',
    "abstract" TEXT,
    "sourceUrl" TEXT,
    "pdfUrl" TEXT,
    "publishedAt" DATETIME,
    "venue" TEXT,
    "citationCount" INTEGER,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "RecommendationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "relevanceScore" REAL NOT NULL,
    "freshnessScore" REAL NOT NULL,
    "noveltyScore" REAL NOT NULL,
    "qualityScore" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "triggerPaperTitle" TEXT,
    "triggerPaperId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecommendationResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecommendationCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "RecommendationFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationFeedback_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecommendationCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "PaperCitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePaperId" TEXT NOT NULL,
    "targetPaperId" TEXT,
    "externalTitle" TEXT,
    "externalId" TEXT,
    "citationType" TEXT NOT NULL DEFAULT 'reference',
    "context" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperCitation_sourcePaperId_fkey" FOREIGN KEY ("sourcePaperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperCitation_targetPaperId_fkey" FOREIGN KEY ("targetPaperId") REFERENCES "Paper" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,

  // ─── Unique indexes ────────────────────────────────────────────────────────

  `CREATE UNIQUE INDEX IF NOT EXISTS "Paper_shortId_key" ON "Paper"("shortId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key" ON "Tag"("name")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReadingNote_chatNoteId_key" ON "ReadingNote"("chatNoteId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PaperChunk_paperId_chunkIndex_key" ON "PaperChunk"("paperId", "chunkIndex")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PaperSearchUnit_paperId_unitType_sourceChunkIndex_unitIndex_key" ON "PaperSearchUnit"("paperId", "unitType", "sourceChunkIndex", "unitIndex")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Collection_name_key" ON "Collection"("name")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationCandidate_source_externalId_key" ON "RecommendationCandidate"("source", "externalId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationResult_candidateId_key" ON "RecommendationResult"("candidateId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PaperCitation_sourcePaperId_externalId_key" ON "PaperCitation"("sourcePaperId", "externalId")`,

  // ─── Regular indexes ───────────────────────────────────────────────────────

  `CREATE INDEX IF NOT EXISTS "Paper_shortId_idx" ON "Paper"("shortId")`,
  `CREATE INDEX IF NOT EXISTS "Paper_title_idx" ON "Paper"("title")`,
  `CREATE INDEX IF NOT EXISTS "Paper_submittedAt_idx" ON "Paper"("submittedAt")`,
  `CREATE INDEX IF NOT EXISTS "Paper_source_idx" ON "Paper"("source")`,
  `CREATE INDEX IF NOT EXISTS "Paper_processingStatus_idx" ON "Paper"("processingStatus")`,
  `CREATE INDEX IF NOT EXISTS "PaperChunk_paperId_idx" ON "PaperChunk"("paperId")`,
  `CREATE INDEX IF NOT EXISTS "PaperSearchUnit_paperId_idx" ON "PaperSearchUnit"("paperId")`,
  `CREATE INDEX IF NOT EXISTS "PaperSearchUnit_unitType_idx" ON "PaperSearchUnit"("unitType")`,
  `CREATE INDEX IF NOT EXISTS "SourceEvent_source_idx" ON "SourceEvent"("source")`,
  `CREATE INDEX IF NOT EXISTS "SourceEvent_importedAt_idx" ON "SourceEvent"("importedAt")`,
  `CREATE INDEX IF NOT EXISTS "Tag_name_idx" ON "Tag"("name")`,
  `CREATE INDEX IF NOT EXISTS "Tag_category_idx" ON "Tag"("category")`,
  `CREATE INDEX IF NOT EXISTS "PaperTag_tagId_idx" ON "PaperTag"("tagId")`,
  `CREATE INDEX IF NOT EXISTS "ReadingNote_type_idx" ON "ReadingNote"("type")`,
  `CREATE INDEX IF NOT EXISTS "ReadingNote_paperId_idx" ON "ReadingNote"("paperId")`,
  `CREATE INDEX IF NOT EXISTS "ReadingNote_chatNoteId_idx" ON "ReadingNote"("chatNoteId")`,
  `CREATE INDEX IF NOT EXISTS "Project_name_idx" ON "Project"("name")`,
  `CREATE INDEX IF NOT EXISTS "Project_lastAccessedAt_idx" ON "Project"("lastAccessedAt")`,
  `CREATE INDEX IF NOT EXISTS "ProjectRepo_projectId_idx" ON "ProjectRepo"("projectId")`,
  `CREATE INDEX IF NOT EXISTS "ProjectIdea_projectId_idx" ON "ProjectIdea"("projectId")`,
  `CREATE INDEX IF NOT EXISTS "PaperCodeLink_paperId_idx" ON "PaperCodeLink"("paperId")`,
  `CREATE INDEX IF NOT EXISTS "PaperCodeLink_repoUrl_idx" ON "PaperCodeLink"("repoUrl")`,
  `CREATE INDEX IF NOT EXISTS "Collection_sortOrder_idx" ON "Collection"("sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "PaperCollection_collectionId_idx" ON "PaperCollection"("collectionId")`,
  `CREATE INDEX IF NOT EXISTS "AgentTodoMessage_runId_idx" ON "AgentTodoMessage"("runId")`,
  `CREATE INDEX IF NOT EXISTS "AgentTodoMessage_msgId_idx" ON "AgentTodoMessage"("msgId")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationCandidate_arxivId_idx" ON "RecommendationCandidate"("arxivId")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationCandidate_doi_idx" ON "RecommendationCandidate"("doi")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationCandidate_titleNormalized_idx" ON "RecommendationCandidate"("titleNormalized")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationResult_status_idx" ON "RecommendationResult"("status")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationResult_generatedAt_idx" ON "RecommendationResult"("generatedAt")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationFeedback_candidateId_idx" ON "RecommendationFeedback"("candidateId")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationFeedback_action_idx" ON "RecommendationFeedback"("action")`,
  `CREATE INDEX IF NOT EXISTS "RecommendationFeedback_createdAt_idx" ON "RecommendationFeedback"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "PaperCitation_sourcePaperId_idx" ON "PaperCitation"("sourcePaperId")`,
  `CREATE INDEX IF NOT EXISTS "PaperCitation_targetPaperId_idx" ON "PaperCitation"("targetPaperId")`,
];

export async function initSchemaWithRawSql(): Promise<void> {
  const prisma = getPrismaClient();
  for (const sql of SCHEMA_STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
}
