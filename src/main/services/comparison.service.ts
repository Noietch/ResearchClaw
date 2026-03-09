import { PapersRepository } from '@db';
import {
  COMPARISON_SYSTEM_PROMPT,
  buildComparisonUserPrompt,
  type ComparisonPaperInput,
  type ComparisonChatMessage,
} from '@shared';
import { getLanguageModelFromConfig, streamText } from './ai-provider.service';
import { getActiveModel, getModelWithKey } from '../store/model-config-store';
import { getPaperExcerptCached } from './paper-text.service';

export class ComparisonService {
  private papersRepository = new PapersRepository();

  async comparePapers(
    input: { paperIds: string[] },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<string> {
    if (input.paperIds.length < 2 || input.paperIds.length > 3) {
      throw new Error('Comparison requires 2 or 3 papers');
    }

    const modelConfig = getActiveModel('chat');
    if (!modelConfig) {
      throw new Error('No chat model configured. Please set up a chat model in Settings.');
    }

    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey?.apiKey) {
      throw new Error('No API key configured for the chat model.');
    }

    const model = getLanguageModelFromConfig(configWithKey);

    // Fetch all papers
    onProgress?.('Loading paper metadata…');
    const papers = await Promise.all(
      input.paperIds.map((id) => this.papersRepository.findById(id)),
    );

    // Build comparison input with optional PDF excerpts (sequentially for progress)
    const comparisonInputs: ComparisonPaperInput[] = [];
    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i];
      onProgress?.(`Reading paper ${i + 1}/${papers.length}: ${paper.title.slice(0, 60)}…`);
      let pdfExcerpt = '';
      if (paper.shortId && (paper.pdfUrl || paper.pdfPath)) {
        try {
          pdfExcerpt = await getPaperExcerptCached(
            paper.id,
            paper.shortId,
            paper.pdfUrl ?? undefined,
            paper.pdfPath ?? undefined,
            3000,
          );
        } catch {
          // PDF extraction failed, continue without it
        }
      }

      comparisonInputs.push({
        title: paper.title,
        authors: (paper.authors as string[]) ?? [],
        year: paper.submittedAt ? new Date(paper.submittedAt).getFullYear() : null,
        abstract: paper.abstract ?? undefined,
        pdfExcerpt: pdfExcerpt || undefined,
      });
    }

    onProgress?.('Sending to AI model…');

    const userPrompt = buildComparisonUserPrompt(comparisonInputs);

    const { textStream } = streamText({
      model,
      system: COMPARISON_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 4096,
      abortSignal: signal,
    });

    let fullText = '';
    for await (const chunk of textStream) {
      fullText += chunk;
      onChunk(chunk);
    }

    return fullText;
  }

  async chatAboutComparison(
    input: {
      comparisonContentMd: string;
      paperTitles: string[];
      messages: ComparisonChatMessage[];
    },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const modelConfig = getActiveModel('chat');
    if (!modelConfig) {
      throw new Error('No chat model configured. Please set up a chat model in Settings.');
    }

    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey?.apiKey) {
      throw new Error('No API key configured for the chat model.');
    }

    const model = getLanguageModelFromConfig(configWithKey);

    const systemPrompt =
      "You are a research assistant helping the user discuss a comparative analysis of academic papers. The full comparison and paper details are provided in the first message. Always base your answers on the provided comparison content. Respond in the user's language.";

    const contextMessage = `Here is a comparative analysis of the following papers:\n\n**Papers Compared:**\n${input.paperTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n---\n\n${input.comparisonContentMd}`;

    // Inject comparison context as the first user+assistant exchange so the model always sees it
    const messagesWithContext = [
      { role: 'user' as const, content: contextMessage },
      {
        role: 'assistant' as const,
        content:
          "I've read through the comparative analysis. Feel free to ask me anything about these papers — I can discuss insights, explore new ideas, identify gaps, or help you think through next steps.",
      },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const { textStream } = streamText({
      model,
      system: systemPrompt,
      messages: messagesWithContext,
      maxTokens: 4096,
      abortSignal: signal,
    });

    let fullText = '';
    for await (const chunk of textStream) {
      fullText += chunk;
      onChunk(chunk);
    }

    return fullText;
  }

  async translateComparison(
    contentMd: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const modelConfig = getActiveModel('lightweight');
    if (!modelConfig) {
      throw new Error(
        'No lightweight model configured. Please set up a lightweight model in Settings.',
      );
    }

    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey?.apiKey) {
      throw new Error('No API key configured for the lightweight model.');
    }

    const model = getLanguageModelFromConfig(configWithKey);

    const { textStream } = streamText({
      model,
      system:
        'Translate the following academic comparison into Chinese. Keep markdown formatting, headings, and structure. Translate naturally, not literally. Do not add any extra content or commentary.',
      prompt: contentMd,
      maxTokens: 8192,
      abortSignal: signal,
    });

    let fullText = '';
    for await (const chunk of textStream) {
      fullText += chunk;
      onChunk(chunk);
    }

    return fullText;
  }
}
