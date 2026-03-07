import { BrowserWindow } from 'electron';
import { PapersRepository } from '@db';
import {
  TAGGING_SYSTEM_PROMPT,
  buildTaggingUserPrompt,
  parseTaggingResponse,
  GENERIC_TAGS,
  TAG_CONSOLIDATION_SYSTEM_PROMPT,
  TAG_ORGANIZE_SYSTEM_PROMPT,
  buildOrganizeUserPrompt,
  type CategorizedTagResult,
} from '@shared';
import type { TagCategory, CategorizedTag } from '@shared';
import { generateWithModelKind } from './ai-provider.service';
import {
  getAppSettings,
  setTagMigrationDone,
  isTagMigrationDone,
} from '../store/app-settings-store';

// ── Status management (singleton) ─────────────────────────────────────────

export interface TaggingStatus {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  currentPaperId: string | null;
  message: string;
}

let currentStatus: TaggingStatus = {
  active: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentPaperId: null,
  message: '',
};
let cancelRequested = false;

function broadcastTaggingStatus() {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    win.webContents.send('tagging:status', currentStatus);
  }
}

export function getTaggingStatus(): TaggingStatus {
  return { ...currentStatus };
}

export function cancelTagging() {
  if (currentStatus.active) cancelRequested = true;
}

// ── Keyword fallback (categorized) ────────────────────────────────────────

const CATEGORIZED_KEYWORDS: Array<{ keywords: string[]; tags: CategorizedTag[] }> = [
  {
    keywords: ['language model', 'llm', 'gpt', 'claude', 'llama', 'chatbot'],
    tags: [
      { name: 'nlp', category: 'domain' as TagCategory },
      { name: 'language-model', category: 'method' as TagCategory },
    ],
  },
  {
    keywords: ['transformer', 'attention mechanism', 'self-attention'],
    tags: [{ name: 'transformer', category: 'method' as TagCategory }],
  },
  {
    keywords: ['diffusion', 'stable diffusion', 'ddpm', 'score-based'],
    tags: [{ name: 'diffusion', category: 'method' as TagCategory }],
  },
  {
    keywords: ['vision', 'image classification', 'visual', 'image recognition'],
    tags: [{ name: 'cv', category: 'domain' as TagCategory }],
  },
  {
    keywords: ['multimodal', 'vision-language', 'vlm'],
    tags: [{ name: 'multimodal', category: 'domain' as TagCategory }],
  },
  {
    keywords: ['reinforcement learning', ' rl ', 'reward model', 'policy gradient'],
    tags: [{ name: 'rl', category: 'domain' as TagCategory }],
  },
  {
    keywords: ['robot', 'embodied', 'manipulation', 'locomotion'],
    tags: [{ name: 'robotics', category: 'domain' as TagCategory }],
  },
  {
    keywords: ['retrieval', 'rag', 'retrieval-augmented'],
    tags: [{ name: 'rag', category: 'method' as TagCategory }],
  },
  {
    keywords: ['rlhf', 'dpo', 'alignment', 'harmless', 'safety'],
    tags: [{ name: 'safety-alignment', category: 'topic' as TagCategory }],
  },
  {
    keywords: ['code generation', 'programming', 'code completion'],
    tags: [{ name: 'code-generation', category: 'topic' as TagCategory }],
  },
  {
    keywords: ['benchmark', 'evaluation', 'leaderboard'],
    tags: [{ name: 'benchmark', category: 'topic' as TagCategory }],
  },
  {
    keywords: ['agent', 'tool use', 'planning', 'agentic'],
    tags: [{ name: 'agent', category: 'topic' as TagCategory }],
  },
  {
    keywords: ['speech', 'audio', 'tts', 'asr'],
    tags: [{ name: 'audio', category: 'domain' as TagCategory }],
  },
  {
    keywords: ['graph neural', 'gnn', 'knowledge graph'],
    tags: [{ name: 'graph-neural-network', category: 'method' as TagCategory }],
  },
  {
    keywords: ['gan', 'generative adversarial'],
    tags: [{ name: 'gan', category: 'method' as TagCategory }],
  },
  {
    keywords: ['distillation', 'knowledge distillation'],
    tags: [{ name: 'distillation', category: 'method' as TagCategory }],
  },
  {
    keywords: ['mixture of experts', 'moe'],
    tags: [{ name: 'moe', category: 'method' as TagCategory }],
  },
];

function keywordFallbackTag(title: string, abstract: string): CategorizedTag[] {
  const text = `${title} ${abstract}`.toLowerCase();
  const matched = new Map<string, CategorizedTag>(); // dedup by name

  for (const entry of CATEGORIZED_KEYWORDS) {
    if (entry.keywords.some((kw) => text.includes(kw))) {
      for (const tag of entry.tags) {
        matched.set(tag.name, tag);
      }
    }
  }

  if (matched.size === 0) {
    return [{ name: 'uncategorized', category: 'topic' as TagCategory }];
  }
  return Array.from(matched.values());
}

// ── Vocabulary cache ──────────────────────────────────────────────────────

let vocabCache: { domain: string[]; method: string[]; topic: string[] } | null = null;
let vocabCacheTime = 0;
const VOCAB_CACHE_TTL = 30_000; // 30 seconds

async function getVocabulary(repo: PapersRepository) {
  if (vocabCache && Date.now() - vocabCacheTime < VOCAB_CACHE_TTL) {
    return vocabCache;
  }
  vocabCache = await repo.listTagVocabulary();
  vocabCacheTime = Date.now();
  return vocabCache;
}

// ── Core: tag a single paper ──────────────────────────────────────────────

export async function tagPaper(paperId: string): Promise<CategorizedTag[]> {
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) throw new Error('Paper not found');

  const vocabulary = await getVocabulary(repo);

  const title = paper.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, ''); // strip arxiv prefix
  const abstract = paper.abstract ?? '';

  // Attempt 1: AI tagging
  try {
    const userPrompt = buildTaggingUserPrompt(title, abstract, vocabulary);
    const response = await generateWithModelKind('lightweight', TAGGING_SYSTEM_PROMPT, userPrompt);
    const parsed = parseTaggingResponse(response);

    if (parsed) {
      // Filter out generic tags
      const clean: CategorizedTagResult = {
        domain: parsed.domain.filter((t) => !GENERIC_TAGS.has(t)).slice(0, 2),
        method: parsed.method.filter((t) => !GENERIC_TAGS.has(t)).slice(0, 3),
        topic: parsed.topic.filter((t) => !GENERIC_TAGS.has(t)).slice(0, 3),
      };

      const total = clean.domain.length + clean.method.length + clean.topic.length;
      if (total > 0) {
        const allTags: CategorizedTag[] = [
          ...clean.domain.map((name) => ({ name, category: 'domain' as TagCategory })),
          ...clean.method.map((name) => ({ name, category: 'method' as TagCategory })),
          ...clean.topic.map((name) => ({ name, category: 'topic' as TagCategory })),
        ];
        await repo.updateTagsWithCategories(paperId, allTags);
        vocabCache = null; // invalidate
        return allTags;
      }
    }
  } catch {
    // AI failed, fall through to keyword
  }

  // Attempt 2: Keyword fallback
  const fallbackTags = keywordFallbackTag(title, abstract);
  await repo.updateTagsWithCategories(paperId, fallbackTags);
  vocabCache = null;
  return fallbackTags;
}

// ── Batch: tag all untagged papers ────────────────────────────────────────

const BATCH_CONCURRENCY = 3;

export async function tagUntaggedPapers(): Promise<{ tagged: number; failed: number }> {
  const repo = new PapersRepository();
  const untaggedIds = await repo.listUntaggedPaperIds();

  if (untaggedIds.length === 0) {
    return { tagged: 0, failed: 0 };
  }

  cancelRequested = false;
  currentStatus = {
    active: true,
    total: untaggedIds.length,
    completed: 0,
    failed: 0,
    currentPaperId: null,
    message: `Tagging ${untaggedIds.length} papers...`,
  };
  broadcastTaggingStatus();

  let tagged = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    while (idx < untaggedIds.length && !cancelRequested) {
      const paperId = untaggedIds[idx++];
      currentStatus.currentPaperId = paperId;
      try {
        await tagPaper(paperId);
        tagged++;
      } catch (err) {
        console.error('[tagging] Failed:', paperId, err);
        failed++;
      }
      currentStatus.completed++;
      currentStatus.failed = failed;
      currentStatus.message = `Tagging... ${currentStatus.completed}/${untaggedIds.length}`;
      broadcastTaggingStatus();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, untaggedIds.length) }, worker),
  );

  currentStatus = {
    active: false,
    total: untaggedIds.length,
    completed: untaggedIds.length,
    failed,
    currentPaperId: null,
    message: cancelRequested
      ? `Cancelled: ${tagged} tagged, ${failed} failed`
      : `Done: ${tagged} tagged, ${failed} failed`,
  };
  broadcastTaggingStatus();

  return { tagged, failed };
}

// ── "Organize" — re-categorize existing flat tags via AI ──────────────────

export async function organizePaperTags(paperId: string): Promise<CategorizedTag[]> {
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) throw new Error('Paper not found');

  const existingTags = paper.tagNames || [];
  if (existingTags.length === 0) throw new Error('No tags to organize');

  // Filter out system tags
  const EXCLUDED = new Set(['arxiv', 'chrome', 'manual', 'pdf']);
  const tagsToOrganize = existingTags.filter((t) => !EXCLUDED.has(t));
  if (tagsToOrganize.length === 0) return [];

  const title = paper.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, '');
  const abstract = paper.abstract ?? '';

  try {
    const userPrompt = buildOrganizeUserPrompt(title, abstract, tagsToOrganize);
    const response = await generateWithModelKind(
      'lightweight',
      TAG_ORGANIZE_SYSTEM_PROMPT,
      userPrompt,
    );
    const parsed = parseTaggingResponse(response);

    if (parsed) {
      const allTags: CategorizedTag[] = [
        ...parsed.domain.map((n) => ({ name: n, category: 'domain' as TagCategory })),
        ...parsed.method.map((n) => ({ name: n, category: 'method' as TagCategory })),
        ...parsed.topic.map((n) => ({ name: n, category: 'topic' as TagCategory })),
      ];

      // Also re-add any system tags that were excluded
      const systemTags = existingTags
        .filter((t) => EXCLUDED.has(t))
        .map((name) => ({ name, category: 'topic' as TagCategory }));

      await repo.updateTagsWithCategories(paperId, [...allTags, ...systemTags]);
      return allTags;
    }
  } catch {
    // AI failed — apply best-effort keyword categorization
  }

  // Fallback: categorize using known dictionaries
  const result: CategorizedTag[] = tagsToOrganize.map((name) => {
    if (KNOWN_DOMAINS.has(name)) return { name, category: 'domain' as TagCategory };
    if (KNOWN_METHODS.has(name)) return { name, category: 'method' as TagCategory };
    return { name, category: 'topic' as TagCategory };
  });
  await repo.updateTagsWithCategories(paperId, result);
  return result;
}

// ── AI consolidation suggestions ──────────────────────────────────────────

export interface ConsolidationSuggestion {
  merges: Array<{ keep: string; remove: string[]; reason: string }>;
  recategorize: Array<{ tag: string; from: string; to: string; reason: string }>;
}

export async function suggestConsolidation(): Promise<ConsolidationSuggestion> {
  const repo = new PapersRepository();
  const allTags = await repo.listAllTagsWithCategory();

  if (allTags.length === 0) {
    return { merges: [], recategorize: [] };
  }

  const tagList = allTags.map((t) => `${t.name} (${t.category}, ${t.count} papers)`).join('\n');

  const response = await generateWithModelKind(
    'lightweight',
    TAG_CONSOLIDATION_SYSTEM_PROMPT,
    `Current tags:\n${tagList}`,
  );

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { merges: [], recategorize: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ConsolidationSuggestion;
    return {
      merges: Array.isArray(parsed.merges) ? parsed.merges : [],
      recategorize: Array.isArray(parsed.recategorize) ? parsed.recategorize : [],
    };
  } catch {
    return { merges: [], recategorize: [] };
  }
}

// ── Known tag dictionaries for fallback ───────────────────────────────────

const KNOWN_DOMAINS = new Set([
  'nlp',
  'cv',
  'rl',
  'robotics',
  'systems',
  'security',
  'multimodal',
  'audio',
  'math',
  'biology',
  'neuroscience',
  'economics',
  'physics',
  'chemistry',
  'medicine',
  'vision',
]);

const KNOWN_METHODS = new Set([
  'transformer',
  'diffusion',
  'rlhf',
  'contrastive-learning',
  'cnn',
  'rnn',
  'attention',
  'graph-neural-network',
  'mcts',
  'bayesian',
  'gan',
  'vae',
  'rag',
  'moe',
  'distillation',
  'ppo',
  'dpo',
  'sft',
  'lora',
  'adapter',
  'self-supervised',
  'meta-learning',
  'few-shot',
  'in-context-learning',
  'flow-matching',
  'llm',
]);

// ── One-time migration for existing tags ──────────────────────────────────

export async function migrateExistingTagCategories(): Promise<void> {
  if (isTagMigrationDone()) return;

  const repo = new PapersRepository();
  const allTags = await repo.listAllTagsWithCategory();

  for (const tag of allTags) {
    if (tag.category !== 'topic') continue; // already categorized
    let newCategory: TagCategory = 'topic';
    if (KNOWN_DOMAINS.has(tag.name)) newCategory = 'domain';
    else if (KNOWN_METHODS.has(tag.name)) newCategory = 'method';

    if (newCategory !== 'topic') {
      await repo.recategorizeTag(tag.name, newCategory);
    }
  }

  setTagMigrationDone();
}
