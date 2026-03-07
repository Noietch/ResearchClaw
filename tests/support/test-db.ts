import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrismaClient } from '@db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const prismaBin = path.join(repoRoot, 'node_modules', '.bin', 'prisma');
const testDbPath = path.join(repoRoot, 'tests', 'tmp', 'integration.sqlite');

let initialized = false;

const ensureDatabaseUrl = () => {
  process.env.DATABASE_URL = `file:${testDbPath}`;
};

export const ensureTestDatabaseSchema = () => {
  if (initialized) {
    return;
  }

  ensureDatabaseUrl();
  rmSync(testDbPath, { force: true });

  rmSync(`${testDbPath}-wal`, { force: true });
  rmSync(`${testDbPath}-journal`, { force: true });

  execFileSync(
    prismaBin,
    ['db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'],
    {
      cwd: repoRoot,
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: `file:${testDbPath}`,
      },
    },
  );

  initialized = true;
};

export const resetTestDatabase = async () => {
  ensureDatabaseUrl();
  const prisma = getPrismaClient();

  // Delete in correct order (children before parents)
  await prisma.projectIdea.deleteMany();
  await prisma.projectRepo.deleteMany();
  await prisma.projectTodo.deleteMany();
  await prisma.project.deleteMany();
  await prisma.paperCodeLink.deleteMany();
  await prisma.readingNote.deleteMany();
  await prisma.paperTag.deleteMany();
  await prisma.sourceEvent.deleteMany();
  await prisma.paper.deleteMany();
  await prisma.tag.deleteMany();
};

export const closeTestDatabase = async () => {
  const prisma = getPrismaClient();
  await prisma.$disconnect();
};
