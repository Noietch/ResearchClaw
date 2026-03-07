import { PapersRepository } from '@db';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { getLanguageModelFromConfig } from './ai-provider.service';
import { getActiveModel } from '../store/model-config-store';
import { getModelWithKey } from '../store/model-config-store';
import { recordTokenUsage } from '../store/token-usage-store';

export interface AgenticSearchStep {
  type: 'thinking' | 'searching' | 'found' | 'reasoning' | 'done';
  message: string;
  keywords?: string[];
  foundCount?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface AgenticSearchResult {
  steps: AgenticSearchStep[];
  papers: Array<{
    id: string;
    shortId: string;
    title: string;
    authors?: string[];
    year?: number;
    tagNames?: string[];
    abstract?: string;
    relevanceReason?: string;
  }>;
  reasoning?: string;
}

const SYSTEM_PROMPT = `You are an intelligent research paper search assistant with access to search tools.

Your task is to find the most relevant papers for the user's query by:
1. Understanding the user's intent and context
2. Strategically using available search tools
3. Iteratively refining your search based on results
4. Explaining your reasoning and results

Available tools:
- searchByTitle: Search papers by title keywords (most precise)
- searchByTag: Search papers by tag/topic
- searchByText: Search across title, tags, and abstract (broadest)
- listAllTags: Get all available tags to discover topics

Guidelines:
- Start with specific searches, broaden if needed
- Use multiple tools to ensure comprehensive coverage
- If initial results are too few, try related keywords
- Consider synonyms and related concepts
- Explain what you're doing and why

After searching, provide a brief summary of your findings and reasoning.`;

export class AgenticSearchService {
  private papersRepository = new PapersRepository();
  private collectedPapers: Map<
    string,
    {
      id: string;
      shortId: string;
      title: string;
      authors: string[];
      year?: number;
      tagNames: string[];
      abstract?: string;
      matchReasons: string[];
    }
  > = new Map();
  private stepCallback?: (step: AgenticSearchStep) => void;

  async search(
    query: string,
    onStep?: (step: AgenticSearchStep) => void,
  ): Promise<AgenticSearchResult> {
    this.stepCallback = onStep;
    this.collectedPapers.clear();
    const steps: AgenticSearchStep[] = [];

    // Get model for agentic search
    const modelConfig = getActiveModel('lightweight');
    if (!modelConfig) {
      throw new Error('No lightweight model configured for agentic search');
    }

    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey?.apiKey) {
      throw new Error('Model API key not configured');
    }

    const model = getLanguageModelFromConfig(configWithKey);

    // Define tools that the agent can use
    const searchTools = {
      searchByTitle: tool({
        description: 'Search papers by title keywords. Use for precise title matching.',
        parameters: z.object({
          keywords: z.array(z.string()).describe('Keywords to search in paper titles'),
        }),
        execute: async ({ keywords }: { keywords: string[] }) => {
          this.emitStep(steps, {
            type: 'searching',
            message: `Searching titles for: ${keywords.join(', ')}`,
            keywords,
            toolName: 'searchByTitle',
            toolArgs: { keywords },
          });

          const results = await this.searchByField('title', keywords);
          this.addPapers(results, `title match: ${keywords.join(', ')}`);

          this.emitStep(steps, {
            type: 'found',
            message: `Found ${results.length} papers by title`,
            foundCount: results.length,
          });

          return {
            success: true,
            foundCount: results.length,
            message: `Found ${results.length} papers matching title keywords`,
          };
        },
      }),

      searchByTag: tool({
        description: 'Search papers by tag/topic. Use when looking for papers on a specific topic.',
        parameters: z.object({
          tags: z.array(z.string()).describe('Tags to search for'),
        }),
        execute: async ({ tags }: { tags: string[] }) => {
          this.emitStep(steps, {
            type: 'searching',
            message: `Searching by tags: ${tags.join(', ')}`,
            keywords: tags,
            toolName: 'searchByTag',
            toolArgs: { tags },
          });

          const results = await this.searchByField('tag', tags);
          this.addPapers(results, `tag: ${tags.join(', ')}`);

          this.emitStep(steps, {
            type: 'found',
            message: `Found ${results.length} papers by tag`,
            foundCount: results.length,
          });

          return {
            success: true,
            foundCount: results.length,
            message: `Found ${results.length} papers with matching tags`,
          };
        },
      }),

      searchByText: tool({
        description:
          'Broad search across title, tags, and abstract. Use for comprehensive search when other methods yield few results.',
        parameters: z.object({
          query: z.string().describe('Search query to match against title, tags, or abstract'),
        }),
        execute: async ({ query }: { query: string }) => {
          this.emitStep(steps, {
            type: 'searching',
            message: `Broad search for: "${query}"`,
            keywords: [query],
            toolName: 'searchByText',
            toolArgs: { query },
          });

          const papers = await this.papersRepository.list({ q: query });
          const results = papers.map((p) => ({
            id: p.id,
            shortId: p.shortId,
            title: p.title,
            authors: p.authors,
            year: p.year ?? undefined,
            tagNames: p.tagNames,
            abstract: p.abstract ?? undefined,
          }));

          this.addPapers(results, `text match: ${query}`);

          this.emitStep(steps, {
            type: 'found',
            message: `Found ${results.length} papers by text search`,
            foundCount: results.length,
          });

          return {
            success: true,
            foundCount: results.length,
            message: `Found ${results.length} papers matching query`,
          };
        },
      }),

      listAllTags: tool({
        description: 'List all available tags in the database. Use to discover what topics exist.',
        parameters: z.object({}),
        execute: async () => {
          const tags = await this.papersRepository.listAllTags();
          return {
            success: true,
            tags,
            message: `Found ${tags.length} tags in database`,
          };
        },
      }),
    };

    // Run the agent loop
    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: query,
        tools: searchTools,
        maxSteps: 5, // Allow up to 5 tool calls
        onStepFinish: ({ stepType, toolCalls, toolResults, text }) => {
          // Emit reasoning step when agent is thinking
          if (text) {
            this.emitStep(steps, {
              type: 'reasoning',
              message: text.slice(0, 200),
            });
          }
        },
      });

      // Record token usage
      if (result.usage) {
        recordTokenUsage({
          timestamp: new Date().toISOString(),
          provider: configWithKey.provider ?? 'unknown',
          model: configWithKey.model ?? 'unknown',
          promptTokens: result.usage.promptTokens ?? 0,
          completionTokens: result.usage.completionTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
          kind: 'lightweight',
        });
      }

      // Get final reasoning from the result
      const finalText = result.text;

      // Convert collected papers to result format
      const papers = Array.from(this.collectedPapers.values())
        .map((p) => ({
          id: p.id,
          shortId: p.shortId,
          title: p.title,
          authors: p.authors,
          year: p.year,
          tagNames: p.tagNames,
          abstract: p.abstract,
          relevanceReason: p.matchReasons.join('; '),
        }))
        .slice(0, 20); // Limit to top 20 results

      steps.push({
        type: 'done',
        message: 'Search complete',
      });
      onStep?.({
        type: 'done',
        message: 'Search complete',
      });

      return {
        steps,
        papers,
        reasoning: finalText,
      };
    } catch (error) {
      // Fallback to simple search if agent fails
      console.error('Agentic search failed, falling back:', error);
      return this.fallbackSearch(query, steps);
    }
  }

  private emitStep(steps: AgenticSearchStep[], step: AgenticSearchStep) {
    steps.push(step);
    this.stepCallback?.(step);
  }

  private async searchByField(
    field: 'title' | 'tag' | 'abstract',
    keywords: string[],
  ): Promise<
    Array<{
      id: string;
      shortId: string;
      title: string;
      authors: string[];
      year?: number;
      tagNames: string[];
      abstract?: string;
    }>
  > {
    const results: Array<{
      id: string;
      shortId: string;
      title: string;
      authors: string[];
      year?: number;
      tagNames: string[];
      abstract?: string;
    }> = [];

    for (const keyword of keywords.slice(0, 3)) {
      try {
        let papers;
        if (field === 'tag') {
          papers = await this.papersRepository.list({ tag: keyword });
        } else {
          papers = await this.papersRepository.list({ q: keyword });
        }

        for (const paper of papers) {
          results.push({
            id: paper.id,
            shortId: paper.shortId,
            title: paper.title,
            authors: paper.authors,
            year: paper.year ?? undefined,
            tagNames: paper.tagNames,
            abstract: paper.abstract ?? undefined,
          });
        }
      } catch {
        // Continue with next keyword
      }
    }

    return results;
  }

  private addPapers(
    papers: Array<{
      id: string;
      shortId: string;
      title: string;
      authors: string[];
      year?: number;
      tagNames: string[];
      abstract?: string;
    }>,
    matchReason: string,
  ) {
    for (const paper of papers) {
      const existing = this.collectedPapers.get(paper.id);
      if (existing) {
        existing.matchReasons.push(matchReason);
      } else {
        this.collectedPapers.set(paper.id, {
          ...paper,
          matchReasons: [matchReason],
        });
      }
    }
  }

  private async fallbackSearch(
    query: string,
    steps: AgenticSearchStep[],
  ): Promise<AgenticSearchResult> {
    this.emitStep(steps, {
      type: 'thinking',
      message: 'Using fallback search...',
    });

    const papers = await this.papersRepository.list({ q: query });

    this.emitStep(steps, {
      type: 'found',
      message: `Found ${papers.length} papers`,
      foundCount: papers.length,
    });

    steps.push({
      type: 'done',
      message: 'Search complete (fallback mode)',
    });
    this.stepCallback?.({
      type: 'done',
      message: 'Search complete (fallback mode)',
    });

    return {
      steps,
      papers: papers.slice(0, 20).map((p) => ({
        id: p.id,
        shortId: p.shortId,
        title: p.title,
        authors: p.authors,
        year: p.year ?? undefined,
        tagNames: p.tagNames,
        abstract: p.abstract ?? undefined,
        relevanceReason: 'Text match',
      })),
    };
  }
}
