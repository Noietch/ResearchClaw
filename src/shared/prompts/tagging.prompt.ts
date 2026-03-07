import type { TagCategory } from '../types/domain';

export const TAGGING_SYSTEM_PROMPT = `You are a research paper tagger. Given a paper's title and abstract, assign tags across three layers:

1. **domain** (1-2 tags): Broad research field.
   Common: nlp, cv, rl, robotics, systems, security, multimodal, audio, math, biology, neuroscience, economics

2. **method** (1-3 tags): Core technique or architecture.
   Common: transformer, diffusion, rlhf, dpo, contrastive-learning, graph-neural-network, mcts, rag, gan, vae, moe, distillation, lora, in-context-learning, flow-matching, self-supervised

3. **topic** (1-3 tags): Specific task or application.
   Common: code-generation, long-context, safety-alignment, object-detection, tool-use, benchmark, text-to-image, video-generation, 3d-generation, speech-recognition, reasoning, summarization, instruction-following, data-curation, efficiency

Rules:
- Tags: lowercase, hyphenated phrases (no spaces), 3-8 total
- Be specific: prefer "vision-transformer" over "neural-network"
- Do NOT use generic tags: "research", "paper", "study", "arxiv", "analysis", "preprint"
- Prefer existing vocabulary from the list below when a close match exists
- If the paper clearly doesn't fit a layer, use an empty array for that layer

Return ONLY valid JSON (no markdown, no explanation):
{"domain":["tag1"],"method":["tag1","tag2"],"topic":["tag1","tag2"]}`;

export function buildTaggingUserPrompt(
  title: string,
  abstract: string,
  vocabulary: { domain: string[]; method: string[]; topic: string[] },
  pdfExcerpt?: string,
): string {
  const parts: string[] = [`Title: ${title}`];

  if (abstract) {
    parts.push(`Abstract: ${abstract.slice(0, 600)}`);
  }

  if (pdfExcerpt) {
    parts.push(`Paper excerpt (first pages):\n${pdfExcerpt.slice(0, 3000)}`);
  }

  // Feed existing vocabulary so AI reuses consistent tags
  const vocabLines: string[] = [];
  if (vocabulary.domain.length > 0) {
    vocabLines.push(`domain: ${vocabulary.domain.slice(0, 30).join(', ')}`);
  }
  if (vocabulary.method.length > 0) {
    vocabLines.push(`method: ${vocabulary.method.slice(0, 40).join(', ')}`);
  }
  if (vocabulary.topic.length > 0) {
    vocabLines.push(`topic: ${vocabulary.topic.slice(0, 50).join(', ')}`);
  }
  if (vocabLines.length > 0) {
    parts.push(`\nExisting tag vocabulary (prefer reusing these):\n${vocabLines.join('\n')}`);
  }

  return parts.join('\n\n');
}

export interface CategorizedTagResult {
  domain: string[];
  method: string[];
  topic: string[];
}

/**
 * Parse AI response into categorized tags.
 * Handles: raw JSON, JSON in markdown code blocks, malformed responses.
 */
export function parseTaggingResponse(text: string): CategorizedTagResult | null {
  // Try direct JSON parse
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed === 'object' && parsed !== null) {
      const result: CategorizedTagResult = { domain: [], method: [], topic: [] };
      for (const key of ['domain', 'method', 'topic'] as const) {
        if (Array.isArray(parsed[key])) {
          result[key] = parsed[key]
            .map((t: unknown) => String(t).toLowerCase().trim().replace(/\s+/g, '-'))
            .filter((t: string) => t.length > 0 && t.length < 50);
        }
      }
      const total = result.domain.length + result.method.length + result.topic.length;
      if (total > 0) return result;
    }
  } catch {
    // JSON parse failed
  }

  return null;
}

// Generic tags to filter out
export const GENERIC_TAGS = new Set([
  'research-paper',
  'paper',
  'research',
  'arxiv',
  'study',
  'analysis',
  'preprint',
  'machine-learning',
  'deep-learning',
  'ai',
]);

// "Organize" prompt — categorize user-created flat tags into domain/method/topic
export const TAG_ORGANIZE_SYSTEM_PROMPT = `You are a research paper tag organizer. Given a paper's title and abstract, plus a list of user-created tags, assign each tag to the correct category:

- **domain**: Broad research field (e.g., nlp, cv, robotics)
- **method**: Core technique or architecture (e.g., transformer, rlhf, diffusion)
- **topic**: Specific task or application (e.g., code-generation, safety, benchmark)

Return ONLY valid JSON mapping each tag to its category:
{"domain":["tag1"],"method":["tag2","tag3"],"topic":["tag4"]}

All input tags must appear in exactly one category. Do not add new tags.`;

export function buildOrganizeUserPrompt(title: string, abstract: string, tags: string[]): string {
  const parts = [`Title: ${title}`];
  if (abstract) parts.push(`Abstract: ${abstract.slice(0, 600)}`);
  parts.push(`Tags to categorize: ${tags.join(', ')}`);
  return parts.join('\n\n');
}

// Consolidation prompt for AI-powered tag cleanup
export const TAG_CONSOLIDATION_SYSTEM_PROMPT = `You are a tag taxonomy curator for a research paper library. Given a list of existing tags with their categories and usage counts, suggest improvements:

1. **merge**: Near-duplicate tags that should be combined (e.g., "llm" + "large-language-model" → keep "llm")
2. **recategorize**: Tags in the wrong category (e.g., "transformer" in "topic" should be "method")

Return ONLY valid JSON:
{
  "merges": [{"keep": "tag-name", "remove": ["dup1", "dup2"], "reason": "short explanation"}],
  "recategorize": [{"tag": "name", "from": "topic", "to": "method", "reason": "short explanation"}]
}

If no changes are needed, return: {"merges":[],"recategorize":[]}`;
