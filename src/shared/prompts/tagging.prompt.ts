import type { TagCategory } from '../types/domain';

export const TAGGING_SYSTEM_PROMPT = `You are a research paper tagger. Your task is to output tags only, not a chat response.

Given a paper's title and abstract/excerpt, assign tags across three layers:

1. **domain** (exactly 2 tags unless the paper truly supports only 1): Broad research field.
   Common: nlp, cv, rl, robotics, systems, security, multimodal, audio, math, biology, neuroscience, economics

2. **method** (2-3 tags unless the paper truly supports only 1): Core technique or architecture.
   Common: transformer, diffusion, rlhf, dpo, contrastive-learning, graph-neural-network, mcts, rag, gan, vae, moe, distillation, lora, in-context-learning, flow-matching, self-supervised

3. **topic** (exactly 3 tags unless the paper truly supports only 2): Specific task or application.
   Common: code-generation, long-context, safety-alignment, object-detection, tool-use, benchmark, text-to-image, video-generation, 3d-generation, speech-recognition, reasoning, summarization, instruction-following, data-curation, efficiency

Rules:
- Tags: lowercase, hyphenated phrases (no spaces), and target 6-8 total tags whenever the paper supports it
- Each tag must be a short tag phrase, not a sentence or clause
- Each tag should usually be 1-3 words before hyphenation
- Never output a tag longer than 32 characters
- Be specific: prefer "vision-transformer" over "neural-network"
- Do NOT use generic tags: "research", "paper", "study", "arxiv", "analysis", "preprint"
- Do NOT use vague meta tags such as "empirical-study", "case-study", "experiment", "evaluation", "comparison", "performance-analysis"
- Use the paper content as the primary source of truth
- Existing vocabulary is only a weak reference for naming consistency; ignore it if it does not fit well
- Prefer richer coverage over minimal coverage when the paper clearly contains multiple distinct signals
- Do not stop at one tag per category if the paper clearly supports more
- Strongly prefer 2 domain tags, 2 method tags, and 3 topic tags for well-described papers
- Return at least 5 tags total for normal papers; return 6-7 tags total for rich papers like systems, software engineering, multimodal, benchmark, and agent papers
- If a paper combines a task, a technical method, and an evaluation setting, capture all of them as separate tags
- If the paper mentions a benchmark, dataset, or execution setting that is central to the contribution, include it as a topic tag
- Prefer multiple short concrete tags over one long catch-all tag
- Output arrays for every field, even if there is only one tag in that field
- For systems / software papers, consider both the research area and the concrete task or benchmark
- If the paper clearly doesn't fit a layer, use an empty array for that layer
- Never ask clarifying questions
- Never explain your reasoning
- Never output markdown, code fences, prose, or bullets
- If information is limited, still return the best possible JSON using the title/excerpt
- If uncertain, prefer short specific tags over broad generic ones

Return ONLY valid JSON (no markdown, no explanation):
{"domain":["tag1"],"method":["tag1","tag2"],"topic":["tag1","tag2"]}

Valid example:
{"domain":["systems","software-engineering"],"method":["program-repair","llm-agent"],"topic":["bug-fixing","execution-efficiency","swe-bench"]}

Another valid example:
{"domain":["multimodal","cv"],"method":["contrastive-learning","representation-learning"],"topic":["image-text-retrieval","benchmark","zero-shot-learning"]}

Invalid example:
{"domain":"software engineering","method":"empirical study","topic":"LLM-based agent program repair and the cost-effectiveness of iterative test execution"}

Another invalid example:
{"domain":["systems"],"method":["evaluation"],"topic":["large-language-model-based-automated-program-repair-under-different-execution-budgets"]}

Another invalid example:
{"domain":["systems"],"method":["program-repair"],"topic":["bug-fixing"]}

Here are some possible tags: ...`;

export function buildTaggingUserPrompt(
  title: string,
  abstract: string,
  _vocabulary: { domain: string[]; method: string[]; topic: string[] },
  pdfExcerpt?: string,
): string {
  const parts: string[] = [`Title: ${title}`];

  if (abstract) {
    parts.push(`Abstract: ${abstract.slice(0, 600)}`);
  }

  if (pdfExcerpt) {
    parts.push(`Paper excerpt (first pages):\n${pdfExcerpt.slice(0, 3000)}`);
  }

  parts.push(
    'Respond with exactly one JSON object with keys domain, method, topic. No extra text before or after JSON.',
  );

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

      const MAX_TAG_LENGTH = 120;

      const canonicalizeTag = (value: string): string => {
        let normalized = value.toLowerCase().trim();
        normalized = normalized.replace(/[“”"'`]/g, '');
        normalized = normalized.replace(/\b(llms|llm)\b/g, 'llm');
        normalized = normalized.replace(
          /\s+with\s+static analysis and retrieval-augmented llm[s]?\b/g,
          '',
        );
        normalized = normalized.replace(/\s+with\s+retrieval-augmented llm[s]?\b/g, '');
        normalized = normalized.replace(/\s+for\s+low-resource programming languages\b/g, '');
        normalized = normalized.replace(/[^a-z0-9+/\s-]/g, ' ');
        normalized = normalized.replace(/\s+/g, '-');
        normalized = normalized.replace(/-+/g, '-');
        normalized = normalized.replace(/^-|-$/g, '');
        return normalized;
      };

      const normalizeTags = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value
            .map((t: unknown) => canonicalizeTag(String(t)))
            .filter((t: string) => t.length > 0 && t.length <= MAX_TAG_LENGTH);
        }

        if (typeof value === 'string') {
          const normalized = canonicalizeTag(value);
          return normalized && normalized.length <= MAX_TAG_LENGTH ? [normalized] : [];
        }

        return [];
      };

      for (const key of ['domain', 'method', 'topic'] as const) {
        result[key] = normalizeTags(parsed[key]);
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
