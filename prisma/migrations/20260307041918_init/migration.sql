-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shortId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authorsJson" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "year" INTEGER,
    "abstract" TEXT,
    "pdfUrl" TEXT,
    "pdfPath" TEXT,
    "textPath" TEXT,
    "rating" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastReadAt" DATETIME
);

-- CreateTable
CREATE TABLE "SourceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawTitle" TEXT,
    "rawUrl" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceEvent_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'topic',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PaperTag" (
    "paperId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("paperId", "tagId"),
    CONSTRAINT "PaperTag_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReadingNote" (
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
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastAccessedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ProjectTodo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectTodo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "localPath" TEXT,
    "clonedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "paperIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectIdea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperCodeLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "commitHash" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperCodeLink_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectStoragePath" TEXT NOT NULL,
    "projectNameZh" TEXT NOT NULL,
    "projectNameEn" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Paper_shortId_key" ON "Paper"("shortId");

-- CreateIndex
CREATE INDEX "Paper_shortId_idx" ON "Paper"("shortId");

-- CreateIndex
CREATE INDEX "Paper_title_idx" ON "Paper"("title");

-- CreateIndex
CREATE INDEX "Paper_year_idx" ON "Paper"("year");

-- CreateIndex
CREATE INDEX "Paper_source_idx" ON "Paper"("source");

-- CreateIndex
CREATE INDEX "SourceEvent_source_idx" ON "SourceEvent"("source");

-- CreateIndex
CREATE INDEX "SourceEvent_importedAt_idx" ON "SourceEvent"("importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Tag_name_idx" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Tag_category_idx" ON "Tag"("category");

-- CreateIndex
CREATE INDEX "PaperTag_tagId_idx" ON "PaperTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingNote_chatNoteId_key" ON "ReadingNote"("chatNoteId");

-- CreateIndex
CREATE INDEX "ReadingNote_type_idx" ON "ReadingNote"("type");

-- CreateIndex
CREATE INDEX "ReadingNote_paperId_idx" ON "ReadingNote"("paperId");

-- CreateIndex
CREATE INDEX "ReadingNote_chatNoteId_idx" ON "ReadingNote"("chatNoteId");

-- CreateIndex
CREATE INDEX "Project_name_idx" ON "Project"("name");

-- CreateIndex
CREATE INDEX "Project_lastAccessedAt_idx" ON "Project"("lastAccessedAt");

-- CreateIndex
CREATE INDEX "ProjectTodo_projectId_idx" ON "ProjectTodo"("projectId");

-- CreateIndex
CREATE INDEX "ProjectRepo_projectId_idx" ON "ProjectRepo"("projectId");

-- CreateIndex
CREATE INDEX "ProjectIdea_projectId_idx" ON "ProjectIdea"("projectId");

-- CreateIndex
CREATE INDEX "PaperCodeLink_paperId_idx" ON "PaperCodeLink"("paperId");

-- CreateIndex
CREATE INDEX "PaperCodeLink_repoUrl_idx" ON "PaperCodeLink"("repoUrl");
