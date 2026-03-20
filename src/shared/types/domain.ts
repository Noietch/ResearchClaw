import { z } from 'zod';

export const SourceTypeSchema = z.enum([
  'chrome',
  'manual',
  'arxiv',
  'zotero',
  'doi',
  'bibtex',
  'overleaf',
]);

export const PaperInputSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  source: SourceTypeSchema,
  sourceUrl: z.string().url().optional(),
  submittedAt: z.string().datetime().nullable().optional(),
  abstract: z.string().optional(),
  pdfUrl: z.string().url().optional(),
  pdfPath: z.string().optional(),
  doi: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const ReadingNoteTypeSchema = z.enum(['paper', 'code']);

export const ReadingNoteInputSchema = z.object({
  paperId: z.string().optional(),
  type: ReadingNoteTypeSchema,
  title: z.string().min(1),
  content: z.record(z.any()),
  version: z.number().int().positive().default(1),
  repoUrl: z.string().url().optional(),
  commitHash: z.string().optional(),
  chatNoteId: z.string().optional(),
});

export const IdeaInputSchema = z.object({
  title: z.string().min(1),
  direction: z.string().min(1),
  hypothesis: z.string().min(1),
  validationPath: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']),
  novelty: z.number().min(0).max(1),
  risks: z.array(z.string()).default([]),
  basedOnPaperIds: z.array(z.string()).default([]),
});

export type SourceType = z.infer<typeof SourceTypeSchema>;
export type PaperInput = z.infer<typeof PaperInputSchema>;
export type ReadingNoteInput = z.infer<typeof ReadingNoteInputSchema>;
export type IdeaInput = z.infer<typeof IdeaInputSchema>;

// Tag categories for multi-layer tag system
export type TagCategory = 'domain' | 'method' | 'topic';
export const TAG_CATEGORIES: TagCategory[] = ['domain', 'method', 'topic'];

export interface CategorizedTag {
  name: string;
  category: TagCategory;
}

export const CATEGORY_LABELS: Record<TagCategory, string> = {
  domain: 'Domain',
  method: 'Method',
  topic: 'Topic',
};

export const CATEGORY_COLORS: Record<
  TagCategory,
  { bg: string; text: string; border: string; selectedBg: string }
> = {
  domain: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    selectedBg: 'bg-blue-600',
  },
  method: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    selectedBg: 'bg-purple-600',
  },
  topic: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    selectedBg: 'bg-green-600',
  },
};

export interface ResearchProfile {
  tagDistribution: Array<{ name: string; category: TagCategory; count: number }>;
  yearDistribution: Array<{ year: number; count: number }>;
  topAuthors: Array<{ name: string; count: number }>;
  totalPapers: number;
}

export interface UserProfile {
  name: string;
  title?: string;
  organization?: string;
  bio?: string;
  researchInterests?: string;
  goals?: string;
  aiSummary?: string | null;
  aiSummaryUpdatedAt?: string | null;
}

export interface UserProfileLibrarySnapshot {
  totalPapers: number;
  topTags: Array<{ name: string; count: number }>;
  topAuthors: Array<{ name: string; count: number }>;
  years: Array<{ year: number; count: number }>;
}

export interface UserProfileState {
  profile: UserProfile;
  librarySnapshot: UserProfileLibrarySnapshot;
}

// ── Graph types ──────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  shortId: string;
  title: string;
  authors: string[];
  year?: number;
  tags: string[];
  citationCount: number;
  referenceCount: number;
  pageRank?: number;
  isInLibrary: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  confidence: number;
  context?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    connectedComponents: number;
  };
}

// IPC result types for error handling
export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

export function err(error: string): IpcResult<never> {
  return { success: false, error };
}

export interface TaskResultItem {
  id: string;
  projectId: string;
  todoId: string | null;
  fileName: string;
  fileType: string;
  filePath: string;
  createdAt: string;
}

export interface ExperimentReportItem {
  id: string;
  projectId: string;
  title: string;
  content: string;
  summary: string | null;
  modelUsed: string | null;
  version: number;
  generatedAt: string;
}

export function isOk<T>(result: IpcResult<T>): result is { success: true; data: T } {
  return result.success;
}

export function isErr<T>(result: IpcResult<T>): result is { success: false; error: string } {
  return !result.success;
}
