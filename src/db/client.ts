// @prisma/client is a CommonJS module; use default import for ESM compatibility
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
type PrismaClientType = InstanceType<typeof PrismaClient>;

import { getDbPath } from '../main/store/storage-path';

let prisma: PrismaClientType | undefined;

export const getPrismaClient = (): PrismaClientType => {
  if (!prisma) {
    // Set DATABASE_URL before PrismaClient initializes
    // This must happen before the first PrismaClient instantiation
    // Respect existing DATABASE_URL (e.g., set by tests)
    if (!process.env.DATABASE_URL) {
      const dbPath = getDbPath();
      process.env.DATABASE_URL = `file:${dbPath}`;
    }

    prisma = new PrismaClient();
  }
  return prisma;
};
