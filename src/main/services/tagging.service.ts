import { BrowserWindow } from 'electron';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { PapersRepository } from '@db';
import {
  TAGGING_SYSTEM_PROMPT,
  buildTaggingUserPrompt,
  GENERIC_TAGS,
  TAG_CONSOLIDATION_SYSTEM_PROMPT,
  TAG_ORGANIZE_SYSTEM_PROMPT,
  buildOrganizeUserPrompt,
  parseTaggingResponse,
} from '@shared';
import type { TagCategory, CategorizedTag } from '@shared';
import {
  generateWithModelKind,
  getLanguageModelFromConfig,
  getSelectedModelInfo,
} from './ai-provider.service';
import { appendLog } from './app-log.service';
import {
  getAppSettings,
  setTagMigrationDone,
  isTagMigrationDone,
} from '../store/app-settings-store';
import { getPaperExcerptCached } from './paper-text.service';
import { getActiveModel, getModelWithKey } from '../store/model-config-store';

// ── Status management (singleton) ─────────────────────────────────────────

export interface TaggingStatus {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  currentPaperId: string | null;
  currentPaperTitle?: string | null;
  stage:
    | 'idle'
    | 'building_prompt'
    | 'requesting_model'
    | 'streaming'
    | 'parsing'
    | 'saving'
    | 'done'
    | 'error';
  partialText?: string;
  message: string;
}

let currentStatus: TaggingStatus = {
  active: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentPaperId: null,
  currentPaperTitle: null,
  stage: 'idle',
  partialText: '',
  message: '',
};
let cancelRequested = false;
let currentAbortController: AbortController | null = null;

function broadcastTaggingStatus() {
  const wins = BrowserWindow ? BrowserWindow.getAllWindows() : [];
  for (const win of wins) {
    win.webContents.send('tagging:status', currentStatus);
  }
}

export function getTaggingStatus(): TaggingStatus {
  return { ...currentStatus };
}

export function cancelTagging() {
  if (currentStatus.active) {
    cancelRequested = true;
    // Abort any ongoing API request
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  }
}

function updateSinglePaperStatus(
  patch: Partial<TaggingStatus>,
  options: { broadcast?: boolean } = {},
) {
  currentStatus = {
    ...currentStatus,
    active: true,
    total: currentStatus.total || 1,
    ...patch,
  };
  if (options.broadcast !== false) {
    broadcastTaggingStatus();
  }
}

function normalizeTextLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isNoiseLine(line: string): boolean {
  if (!line) return true;
  if (/^\d+$/.test(line)) return true;
  if (/^page\s+\d+$/i.test(line)) return true;
  if (/^[ivxlcdm]+$/i.test(line) && line.length <= 8) return true;
  if (/^https?:\/\//i.test(line)) return true;
  if (/^doi\s*[:/]/i.test(line)) return true;
  return false;
}

function looksLikeSectionHeading(line: string): boolean {
  return /^(abstract|introduction|keywords?|index terms|background|related work|preliminaries|methods?|approach|evaluation|experiments?|results|discussion|conclusion|references|acknowledg)/i.test(
    line,
  );
}

function looksLikeAuthorLine(line: string): boolean {
  return /\b(author|university|institute|school|laboratory|lab|department|anonymous|@)\b/i.test(
    line,
  );
}

function stripLeadingAbstractNoise(lines: string[]): string[] {
  const cleaned = [...lines];

  while (cleaned.length > 0 && looksLikeAuthorLine(cleaned[0])) {
    cleaned.shift();
  }

  while (
    cleaned.length > 0 &&
    (/^(additional key words|keywords?|ccs concepts?|acm reference format)\b/i.test(cleaned[0]) ||
      isNoiseLine(cleaned[0]))
  ) {
    cleaned.shift();
  }

  if (cleaned.length > 0 && looksLikeTitleLine(cleaned[0]) && cleaned[0].split(' ').length <= 6) {
    cleaned.shift();
  }

  while (cleaned.length > 0 && looksLikeAuthorLine(cleaned[0])) {
    cleaned.shift();
  }

  return cleaned;
}

function looksLikeTitleLine(line: string): boolean {
  if (line.length < 12 || line.length > 180) return false;
  if (isNoiseLine(line) || looksLikeSectionHeading(line) || looksLikeAuthorLine(line)) return false;
  if (/^(acm|arxiv|proceedings|copyright|ccs concepts?)\b/i.test(line)) return false;
  const letterCount = (line.match(/[A-Za-z]/g) || []).length;
  if (letterCount < 8) return false;
  const alphaRatio = letterCount / line.length;
  return alphaRatio > 0.55;
}

function cleanExcerptLines(excerpt: string): string[] {
  return excerpt
    .split(/\r?\n/)
    .map(normalizeTextLine)
    .filter((line) => line && !isNoiseLine(line))
    .slice(0, 160);
}

function inferTitleFromLines(lines: string[]): string | undefined {
  const candidates = lines.slice(0, 24);
  const startIndex = candidates.findIndex(looksLikeTitleLine);
  if (startIndex < 0) return undefined;

  const titleLines: string[] = [];
  for (const line of candidates.slice(startIndex)) {
    if (looksLikeAuthorLine(line) || looksLikeSectionHeading(line)) break;
    if (!looksLikeTitleLine(line) && titleLines.length > 0) break;
    if (looksLikeTitleLine(line)) titleLines.push(line);
    if (titleLines.join(' ').length >= 220) break;
  }

  const title = titleLines.join(' ').trim();
  return title.length >= 12 ? title.slice(0, 220) : undefined;
}

function inferAbstractFromLines(lines: string[]): string | undefined {
  const explicitAbstractIndex = lines.findIndex((line) => /^abstract\b[:\s-]*$/i.test(line));
  const collectFollowingParagraph = (startIndex: number): string | undefined => {
    const abstractLines: string[] = [];
    const candidateLines = stripLeadingAbstractNoise(lines.slice(startIndex));
    for (const line of candidateLines) {
      if (looksLikeSectionHeading(line) && abstractLines.length > 0) break;
      if (/^(acm reference format|additional key words|ccs concepts?)\b/i.test(line)) {
        if (abstractLines.length > 0) break;
        continue;
      }
      if (looksLikeAuthorLine(line)) {
        if (abstractLines.length === 0) continue;
        break;
      }
      if (isNoiseLine(line)) continue;
      abstractLines.push(line);
      if (abstractLines.join(' ').length >= 1400) break;
    }
    const joined = abstractLines.join(' ').trim();
    return joined.length >= 80 ? joined.slice(0, 1400) : undefined;
  };

  if (explicitAbstractIndex >= 0) {
    const explicit = collectFollowingParagraph(explicitAbstractIndex + 1);
    if (explicit) return explicit;
  }

  const title = inferTitleFromLines(lines);
  const titleIndex = title
    ? lines.findIndex((line) => title.includes(line) || line.includes(title))
    : -1;
  const fallbackStart = Math.max(titleIndex + 1, 0);
  const window = lines.slice(fallbackStart, fallbackStart + 36);

  let paragraphStart = 0;
  while (paragraphStart < window.length && looksLikeAuthorLine(window[paragraphStart])) {
    paragraphStart++;
  }
  while (
    paragraphStart < window.length &&
    (/^(acm reference format|additional key words|keywords?|ccs concepts?)\b/i.test(
      window[paragraphStart],
    ) ||
      isNoiseLine(window[paragraphStart]))
  ) {
    paragraphStart++;
  }

  const inferred = collectFollowingParagraph(fallbackStart + paragraphStart);
  if (inferred) return inferred;

  const joinedWindow = window.join(' ').trim();
  return joinedWindow.length >= 120 ? joinedWindow.slice(0, 1400) : undefined;
}

function inferTitleAndAbstractFromExcerpt(excerpt: string): { title?: string; abstract?: string } {
  if (!excerpt.trim()) return {};

  const lines = cleanExcerptLines(excerpt);

  if (lines.length === 0) return {};

  return {
    title: inferTitleFromLines(lines),
    abstract: inferAbstractFromLines(lines),
  };
}

function dedupeCategorizedTags(tags: CategorizedTag[]): CategorizedTag[] {
  const seen = new Map<string, CategorizedTag>();
  for (const tag of tags) {
    const name = tag.name.trim();
    if (!name) continue;
    seen.set(`${tag.category}:${name.toLowerCase()}`, { ...tag, name });
  }
  return Array.from(seen.values());
}

const structuredTaggingSchema = z.object({
  domain: z.array(z.string().trim().min(1).max(32)).max(2),
  method: z.array(z.string().trim().min(1).max(32)).max(3),
  topic: z.array(z.string().trim().min(1).max(32)).max(3),
});

function supportsStructuredTagging(config: { provider?: string; baseURL?: string }): boolean {
  // All providers (including custom/OpenAI-compatible) support structured output via tool calling
  return true;
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

export async function tagPaper(
  paperId: string,
  options: { managedStatus?: boolean } = {},
): Promise<CategorizedTag[]> {
  const managedStatus = options.managedStatus ?? true;
  const repo = new PapersRepository();
  const paper = await repo.findById(paperId);
  if (!paper) throw new Error('Paper not found');

  if (managedStatus) {
    currentStatus = {
      active: true,
      total: 1,
      completed: 0,
      failed: 0,
      currentPaperId: paperId,
      currentPaperTitle: paper.title,
      stage: 'building_prompt',
      partialText: '',
      message: 'Preparing auto-tagging prompt…',
    };
    broadcastTaggingStatus();
  } else {
    updateSinglePaperStatus({
      currentPaperId: paperId,
      currentPaperTitle: paper.title,
      stage: 'building_prompt',
      partialText: '',
      message: `Preparing tags for ${paper.title}…`,
    });
  }

  const vocabulary = await getVocabulary(repo);

  const metadataTitle = paper.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, ''); // strip arxiv prefix
  const metadataAbstract = paper.abstract ?? '';
  let pdfExcerpt = '';

  if (paper.shortId && (paper.pdfUrl || paper.pdfPath)) {
    try {
      pdfExcerpt = await getPaperExcerptCached(
        paper.id,
        paper.shortId,
        paper.pdfUrl ?? undefined,
        paper.pdfPath ?? undefined,
        6000,
      );
    } catch {
      pdfExcerpt = '';
    }
  }

  const inferred = inferTitleAndAbstractFromExcerpt(pdfExcerpt);
  const title =
    inferred.title && inferred.title.length > metadataTitle.length + 10
      ? inferred.title
      : metadataTitle;
  const abstract = metadataAbstract.trim() || inferred.abstract || '';

  appendLog(
    'tagging',
    'tagPaper:start',
    {
      paperId,
      metadataTitle,
      inferredTitle: inferred.title,
      title,
      abstractPreview: abstract.slice(0, 300),
      metadataAbstractPreview: metadataAbstract.slice(0, 300),
      inferredAbstractPreview: inferred.abstract?.slice(0, 300),
      excerptPreview: pdfExcerpt.slice(0, 500),
      managedStatus,
      vocabulary,
      selectedModel: getSelectedModelInfo('lightweight'),
    },
    'tagging.log',
  );

  // Attempt 1: AI tagging
  try {
    const userPrompt = buildTaggingUserPrompt(title, abstract, vocabulary, pdfExcerpt);
    appendLog(
      'tagging',
      'tagPaper:model_prompt',
      {
        paperId,
        title,
        abstractPreview: abstract.slice(0, 600),
        excerptPreview: pdfExcerpt.slice(0, 1200),
        vocabulary,
        systemPrompt: TAGGING_SYSTEM_PROMPT,
        userPrompt,
      },
      'tagging.log',
    );
    updateSinglePaperStatus({
      currentPaperId: paperId,
      currentPaperTitle: paper.title,
      stage: 'requesting_model',
      message: 'Auto tagging…',
    });

    const modelConfig = getActiveModel('lightweight');
    if (!modelConfig || modelConfig.backend !== 'api') {
      throw new Error('No usable lightweight API model selected. Please check Settings > Models.');
    }

    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey?.apiKey) {
      throw new Error(
        'No API key configured for the selected lightweight model. Please check Settings > Models.',
      );
    }

    let parsed: { domain: string[]; method: string[]; topic: string[] } | null = null;

    // Create AbortController for this request (can be cancelled via cancelTagging)
    const abortController = new AbortController();
    currentAbortController = abortController;

    // Try structured output first (works for most providers via tool calling)
    try {
      const model = getLanguageModelFromConfig(configWithKey);
      // Combine abort signal with timeout
      const timeoutSignal = AbortSignal.timeout(120_000);
      const signal = AbortSignal.any([abortController.signal, timeoutSignal]);

      const result = await generateText({
        model,
        system: TAGGING_SYSTEM_PROMPT,
        prompt: userPrompt,
        output: Output.object({ schema: structuredTaggingSchema }),
        maxOutputTokens: 1024,
        abortSignal: signal,
      });

      appendLog(
        'tagging',
        'tagPaper:model_response',
        {
          paperId,
          mode: 'structured',
          output: result.output,
        },
        'tagging.log',
      );

      parsed = {
        domain: result.output.domain,
        method: result.output.method,
        topic: result.output.topic,
      };

      updateSinglePaperStatus({
        currentPaperId: paperId,
        currentPaperTitle: paper.title,
        stage: 'parsing',
        partialText: JSON.stringify(result.output),
        message: 'Parsing model response…',
      });
    } catch (structuredErr) {
      // Structured output failed, fallback to text-based JSON parsing
      appendLog(
        'tagging',
        'tagPaper:structured_fallback',
        {
          paperId,
          error: structuredErr instanceof Error ? structuredErr.message : String(structuredErr),
        },
        'tagging.log',
      );

      // Create a fresh signal for the fallback — the structured-output attempt may
      // have caused the original signal to abort internally (Vercel AI SDK behaviour
      // when tool-calling is unsupported), which would silently cancel this request.
      const fallbackAbortController = new AbortController();
      currentAbortController = fallbackAbortController;
      const response = await generateWithModelKind(
        'lightweight',
        TAGGING_SYSTEM_PROMPT,
        userPrompt,
        { strictSelection: true, signal: fallbackAbortController.signal },
      );

      appendLog(
        'tagging',
        'tagPaper:model_response',
        {
          paperId,
          mode: 'text_json_fallback',
          response,
        },
        'tagging.log',
      );

      // Check for empty response
      if (!response || !response.trim()) {
        throw new Error(
          'Model returned empty response. Please check if the model name is correct and the API key is valid.',
        );
      }

      updateSinglePaperStatus({
        currentPaperId: paperId,
        currentPaperTitle: paper.title,
        stage: 'parsing',
        partialText: response,
        message: 'Parsing model response…',
      });

      parsed = parseTaggingResponse(response);
      if (!parsed) {
        throw new Error('Model returned invalid JSON for tagging.');
      }
    }

    appendLog('tagging', 'tagPaper:parsed_response', { paperId, parsed }, 'tagging.log');

    if (parsed) {
      const clean = {
        domain: parsed.domain.filter((t) => !GENERIC_TAGS.has(t)).slice(0, 2),
        method: parsed.method.filter((t) => !GENERIC_TAGS.has(t)).slice(0, 3),
        topic: parsed.topic.filter((t) => !GENERIC_TAGS.has(t)).slice(0, 3),
      };

      const total = clean.domain.length + clean.method.length + clean.topic.length;
      appendLog('tagging', 'tagPaper:filtered_tags', { paperId, clean, total }, 'tagging.log');
      if (total > 0) {
        const allTags = dedupeCategorizedTags([
          ...clean.domain.map((name) => ({ name, category: 'domain' as TagCategory })),
          ...clean.method.map((name) => ({ name, category: 'method' as TagCategory })),
          ...clean.topic.map((name) => ({ name, category: 'topic' as TagCategory })),
        ]);
        updateSinglePaperStatus({
          currentPaperId: paperId,
          currentPaperTitle: paper.title,
          stage: 'saving',
          message: `Saving ${allTags.length} tags…`,
        });
        await repo.updateTagsWithCategories(paperId, allTags);
        appendLog('tagging', 'tagPaper:saved_ai_tags', { paperId, allTags }, 'tagging.log');
        vocabCache = null; // invalidate
        if (managedStatus) {
          currentStatus = {
            ...currentStatus,
            active: false,
            completed: 1,
            currentPaperId: null,
            currentPaperTitle: null,
            stage: 'done',
            message: `Done: ${allTags.length} tags added`,
          };
          broadcastTaggingStatus();
        }
        return allTags;
      }
    }
    throw new Error('Model returned no usable tags.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog('tagging', 'tagPaper:model_error', { paperId, error: message }, 'tagging.log');
    const isNoModelConfigured =
      message.includes('No usable lightweight API model') ||
      message.includes('No API key configured for the selected lightweight model');
    currentStatus = {
      ...currentStatus,
      active: false,
      currentPaperId: paperId,
      currentPaperTitle: paper.title,
      stage: 'error',
      partialText: '',
      message: isNoModelConfigured
        ? 'No lightweight model configured. Please check Settings > Models.'
        : `Auto-tag failed: ${message}`,
    };
    broadcastTaggingStatus();
    throw err instanceof Error ? err : new Error(message);
  }
}

// ── Batch: tag all untagged papers ────────────────────────────────────────

const BATCH_CONCURRENCY = 8;

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
    currentPaperTitle: null,
    stage: 'building_prompt',
    partialText: '',
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
      currentStatus.currentPaperTitle = null;
      try {
        await tagPaper(paperId, { managedStatus: false });
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
    currentPaperTitle: null,
    stage: cancelRequested ? 'done' : 'done',
    partialText: '',
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
