import { z } from 'zod';

export const SourceTypeSchema = z.enum(['chrome', 'manual', 'arxiv']);

export const PaperInputSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  source: SourceTypeSchema,
  sourceUrl: z.string().url().optional(),
  submittedAt: z.string().datetime().nullable().optional(),
  abstract: z.string().optional(),
  pdfUrl: z.string().url().optional(),
  pdfPath: z.string().optional(),
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

// ── Collection types ──────────────────────────────────────────────────────────

export const CollectionInputSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(4).optional(),
  color: z.string().max(20).optional(),
  description: z.string().max(500).optional(),
});

export type CollectionInput = z.infer<typeof CollectionInputSchema>;

export const COLLECTION_COLORS = [
  'blue',
  'green',
  'yellow',
  'red',
  'purple',
  'pink',
  'orange',
  'gray',
] as const;

export type CollectionColor = (typeof COLLECTION_COLORS)[number];

export const COLLECTION_COLOR_CLASSES: Record<
  CollectionColor,
  { bg: string; text: string; border: string }
> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  yellow: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  gray: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
};

export interface ResearchProfile {
  tagDistribution: Array<{ name: string; category: TagCategory; count: number }>;
  yearDistribution: Array<{ year: number; count: number }>;
  topAuthors: Array<{ name: string; count: number }>;
  totalPapers: number;
}

export type RecommendationSource = 'semantic_scholar' | 'arxiv';
export type RecommendationStatus = 'new' | 'ignored' | 'saved';
export type RecommendationFeedbackAction = 'opened' | 'ignored' | 'saved';

export interface RecommendationItem {
  candidateId: string;
  title: string;
  authors: string[];
  abstract?: string | null;
  source: RecommendationSource;
  sourceUrl?: string | null;
  pdfUrl?: string | null;
  publishedAt?: string | null;
  venue?: string | null;
  citationCount?: number | null;
  score: number;
  relevanceScore: number;
  freshnessScore: number;
  noveltyScore: number;
  qualityScore: number;
  semanticScore?: number | null;
  explorationNote?: string | null;
  reason: string;
  triggerPaperTitle?: string | null;
  triggerPaperId?: string | null;
  status: RecommendationStatus;
  generatedAt: string;
  isInLibrary: boolean;
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

export function isOk<T>(result: IpcResult<T>): result is { success: true; data: T } {
  return result.success;
}

export function isErr<T>(result: IpcResult<T>): result is { success: false; error: string } {
  return !result.success;
}
