import { ReadingRepository, PaperCodeLinksRepository, PapersRepository } from '@db';
import {
  getLanguageModelFromConfig,
  streamText,
  generateWithModelKind,
} from './ai-provider.service';
import { getActiveModel, getModelWithKey } from '../store/model-config-store';
import { getPaperExcerptCached } from './paper-text.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
}

export interface CreateReadingInput {
  paperId?: string;
  type: 'paper' | 'code';
  title: string;
  content: Record<string, unknown>;
  repoUrl?: string;
  commitHash?: string;
  chatNoteId?: string;
}

export class ReadingService {
  private readingRepository = new ReadingRepository();
  private codeLinksRepository = new PaperCodeLinksRepository();
  private papersRepository = new PapersRepository();

  /**
   * Parse markdown into sections (each # heading becomes a key)
   */
  private parseMarkdownToSections(md: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const parts = md.split(/^# /m).filter(Boolean);
    for (const part of parts) {
      const nl = part.indexOf('\n');
      const heading = (nl >= 0 ? part.slice(0, nl) : part).trim();
      const body = nl >= 0 ? part.slice(nl + 1).trim() : '';
      if (heading) sections[heading] = body;
    }
    return sections;
  }

  /**
   * Refine user question using lightweight model for better structure
   */
  private async refineQuestion(question: string, paperTitle: string): Promise<string> {
    const systemPrompt =
      'Refine the user question to be more structured and clear for an AI assistant. Keep it concise. Output only the refined question.';

    const userPrompt = `Paper: ${paperTitle}\nUser question: ${question}\n\nRefined question:`;

    try {
      const refined = await generateWithModelKind('lightweight', systemPrompt, userPrompt);
      return refined.trim() || question;
    } catch {
      return question;
    }
  }

  async create(input: CreateReadingInput) {
    const created = await this.readingRepository.create({
      ...input,
      version: 1,
    });

    if (input.type === 'code' && input.paperId && input.repoUrl) {
      await this.codeLinksRepository.create({
        paperId: input.paperId,
        repoUrl: input.repoUrl,
        commitHash: input.commitHash,
        confidence: 0.7,
        source: 'reading-note',
      });
    }

    return {
      ...created,
      content: JSON.parse(created.contentJson) as Record<string, unknown>,
    };
  }

  async update(id: string, content: Record<string, unknown>) {
    const updated = await this.readingRepository.update(id, content);
    return {
      ...updated,
      content: JSON.parse(updated.contentJson) as Record<string, unknown>,
    };
  }

  async getById(id: string) {
    return this.readingRepository.getById(id);
  }

  async listByPaper(paperId: string) {
    return this.readingRepository.listByPaper(paperId);
  }

  async delete(id: string) {
    return this.readingRepository.delete(id);
  }

  async saveChat(input: { paperId: string; noteId: string | null; messages: unknown[] }) {
    const contentJson = JSON.stringify(input.messages);
    if (input.noteId) {
      return this.readingRepository.updateRaw(input.noteId, contentJson);
    }
    const paper = await this.papersRepository.findById(input.paperId).catch(() => null);
    const title = paper ? `Chat: ${paper.title}` : 'Chat';
    const created = await this.readingRepository.create({
      paperId: input.paperId,
      type: 'paper',
      title,
      content: input.messages as unknown as Record<string, unknown>,
      version: 1,
    });
    return { ...created, id: created.id };
  }

  async aiEditNotes(input: {
    paperId: string;
    instruction: string;
    currentNotes: Record<string, string>;
    pdfUrl?: string;
  }): Promise<Record<string, string>> {
    // Fetch paper metadata to enrich the prompt
    const paper = await this.papersRepository.findById(input.paperId).catch(() => null);

    const systemPrompt = [
      'You are a research assistant helping to fill in reading notes for academic papers.',
      'Given the paper metadata and current notes structure, generate comprehensive reading notes.',
      'Return ONLY a valid JSON object with the same keys as the current notes, with filled-in values.',
      'Each value should be a concise but informative paragraph in the same language as the section prompt.',
      'Do not include markdown code fences or any text outside the JSON object.',
    ].join(' ');

    const paperContext: string[] = [];
    if (paper) {
      paperContext.push(`Title: ${paper.title}`);
      if (paper.authors && (paper.authors as string[]).length > 0) {
        paperContext.push(`Authors: ${(paper.authors as string[]).join(', ')}`);
      }
      if (paper.year) paperContext.push(`Year: ${paper.year}`);
      if (paper.abstract) paperContext.push(`Abstract:\n${paper.abstract}`);
    }

    // Try to get PDF excerpt with caching
    let pdfContext = '';
    if (input.paperId && paper?.shortId && (input.pdfUrl || paper?.pdfPath)) {
      try {
        pdfContext = await getPaperExcerptCached(
          input.paperId,
          paper.shortId,
          input.pdfUrl,
          paper?.pdfPath ?? undefined,
          8000,
        );
      } catch {
        // PDF extraction failed, continue without it
      }
    }

    const userPrompt = [
      ...(paperContext.length > 0 ? ['Paper Information:', ...paperContext, ''] : []),
      ...(pdfContext ? ['Paper excerpt:', pdfContext, ''] : []),
      `Instruction: ${input.instruction}`,
      '',
      'Current notes structure (fill in each section):',
      JSON.stringify(input.currentNotes, null, 2),
    ].join('\n');

    const text = await generateWithModelKind('chat', systemPrompt, userPrompt);

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Record<string, string>;
      }
    } catch {
      // fallback to returning original
    }

    return input.currentNotes;
  }

  async chat(
    input: {
      paperId: string;
      messages: ChatMessage[];
      pdfUrl?: string;
    },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const paper = await this.papersRepository.findById(input.paperId).catch(() => null);
    if (!paper) {
      throw new Error('Paper not found');
    }

    const modelConfig = getActiveModel('chat');
    if (!modelConfig) {
      throw new Error('No chat model configured. Please set up a chat model in Settings.');
    }

    // Get the model with API key
    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey?.apiKey) {
      throw new Error('No API key configured for the chat model.');
    }

    const model = getLanguageModelFromConfig(configWithKey);

    // Build system prompt with paper context
    const systemPrompt = [
      'You are a research assistant helping to discuss academic papers.',
      'You have access to the paper metadata and content.',
      'Be helpful, accurate, and concise in your responses.',
      'Respond in the same language the user is using.',
    ].join(' ');

    // Build context
    const contextParts: string[] = [];
    contextParts.push(`Paper Title: ${paper.title}`);
    if (paper.authors && (paper.authors as string[]).length > 0) {
      contextParts.push(`Authors: ${(paper.authors as string[]).join(', ')}`);
    }
    if (paper.year) contextParts.push(`Year: ${paper.year}`);
    if (paper.abstract) contextParts.push(`Abstract:\n${paper.abstract}`);

    // Get PDF excerpt if available
    if (paper?.shortId && (input.pdfUrl || paper?.pdfPath)) {
      try {
        const pdfExcerpt = await getPaperExcerptCached(
          input.paperId,
          paper.shortId,
          input.pdfUrl,
          paper?.pdfPath ?? undefined,
          8000,
        );
        if (pdfExcerpt) {
          contextParts.push(`Paper Content Excerpt:\n${pdfExcerpt}`);
        }
      } catch {
        // PDF extraction failed, continue without it
      }
    }

    const contextStr = `[Paper Context]\n${contextParts.join('\n\n')}\n\n---`;

    // Build messages array - refine the last user question with lightweight model
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: `${contextStr}\n\nI will ask you questions about this paper. Please be ready.`,
      },
      { role: 'assistant', content: 'I understand the paper context. How can I help you?' },
    ];

    for (const msg of input.messages) {
      formattedMessages.push({ role: msg.role, content: msg.content });
    }

    // Use streaming - all messages go in the messages array
    const { textStream } = streamText({
      model,
      system: systemPrompt,
      messages: formattedMessages,
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

  /**
   * Extract PDF URL from a paper's source URL or other metadata using lightweight model
   */
  async extractPdfUrl(paperId: string): Promise<string | null> {
    const paper = await this.papersRepository.findById(paperId).catch(() => null);
    if (!paper) {
      throw new Error('Paper not found');
    }

    // If paper already has a PDF URL, return it
    if (paper.pdfUrl) {
      return paper.pdfUrl;
    }

    // If source URL is arXiv, extract directly
    if (paper.sourceUrl) {
      const m = paper.sourceUrl.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/i);
      if (m) {
        return `https://arxiv.org/pdf/${m[1]}`;
      }
    }

    // If shortId looks like arXiv ID, extract directly
    if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.shortId)) {
      return `https://arxiv.org/pdf/${paper.shortId}`;
    }

    // Otherwise, use lightweight model to extract from title/abstract/sourceUrl
    const systemPrompt = [
      'You are a URL extraction assistant.',
      'Given a paper title, abstract, and/or source URL, identify the direct PDF download URL.',
      'Common patterns:',
      '- arXiv: https://arxiv.org/pdf/{id}',
      '- ACL Anthology: https://aclanthology.org/{id}.pdf',
      '- OpenReview: https://openreview.net/pdf?id={id}',
      '- NeurIPS: https://proceedings.neurips.cc/paper_files/paper/{year}/file/{hash}.pdf',
      '- If you cannot determine a valid PDF URL, respond with "NONE".',
      'Respond with ONLY the URL or "NONE", nothing else.',
    ].join(' ');

    const userParts: string[] = [];
    userParts.push(`Title: ${paper.title}`);
    if (paper.abstract) userParts.push(`Abstract: ${paper.abstract}`);
    if (paper.sourceUrl) userParts.push(`Source URL: ${paper.sourceUrl}`);

    const userPrompt = userParts.join('\n\n');

    const response = await generateWithModelKind('lightweight', systemPrompt, userPrompt);
    const url = response.trim();

    if (url === 'NONE' || !url.startsWith('http')) {
      return null;
    }

    return url;
  }

  /**
   * Generate notes from a chat session (structured reading notes)
   */
  async generateNotesFromChat(
    chatNoteId: string,
  ): Promise<{ id: string; title: string; contentJson: string }> {
    // Get the chat session
    const chatNote = await this.readingRepository.getById(chatNoteId);
    if (!chatNote) {
      throw new Error('Chat session not found');
    }

    // Check if notes already generated for this chat
    const existingNote = await this.readingRepository.getGeneratedNote(chatNoteId);
    if (existingNote) {
      return existingNote;
    }

    // Parse chat messages
    const messages = chatNote.content as unknown as ChatMessage[];
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('No messages in chat session');
    }

    // Format chat history for the prompt
    const chatHistory = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    // Get paper context
    const paper = chatNote.paperId
      ? await this.papersRepository.findById(chatNote.paperId).catch(() => null)
      : null;

    const systemPrompt =
      'Summarize this conversation into concise Markdown notes. Use appropriate headings and formatting. Be informative but brief. Same language as the chat.';

    const userPrompt = [
      ...(paper ? [`Paper: ${paper.title}`, ''] : []),
      'Chat:',
      chatHistory,
      '',
      'Summary:',
    ].join('\n');

    const response = await generateWithModelKind('chat', systemPrompt, userPrompt);

    // Parse markdown into sections (each # heading becomes a key)
    const content = this.parseMarkdownToSections(response.trim());

    // Create the note with reference to the chat
    const title = paper ? `Notes: ${paper.title}` : 'Chat Notes';

    const created = await this.readingRepository.create({
      paperId: chatNote.paperId ?? undefined,
      type: 'paper',
      title,
      content,
      version: 1,
      chatNoteId,
    });

    return {
      id: created.id,
      title: created.title,
      contentJson: created.contentJson,
    };
  }
}
