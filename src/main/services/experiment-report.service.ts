import fs from 'fs';
import path from 'path';
import {
  ExperimentReportRepository,
  ProjectsRepository,
  TaskResultRepository,
  AgentTodoRepository,
} from '@db';
import { streamText, getLanguageModelFromConfig } from './ai-provider.service';
import { getActiveModel, getModelWithKey } from '../store/model-config-store';
import { recordTokenUsage } from '../store/token-usage-store';

export interface GenerateReportInput {
  projectId: string;
  title: string;
  todoIds: string[];
  resultIds?: string[];
}

export interface ReportItem {
  id: string;
  projectId: string;
  title: string;
  content: string;
  summary?: string;
  todoIds: string[];
  resultIds: string[];
  generatedAt: Date;
  modelUsed?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ExperimentReportService {
  private repo = new ExperimentReportRepository();
  private projectsRepo = new ProjectsRepository();
  private resultsRepo = new TaskResultRepository();
  private todosRepo = new AgentTodoRepository();

  /**
   * Generate a report from selected tasks and results (streaming)
   */
  async generateReport(
    input: GenerateReportInput,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<ReportItem> {
    const project = await this.projectsRepo.getProject(input.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Fetch todos and their results
    const todos = await Promise.all(input.todoIds.map((id) => this.todosRepo.findTodoById(id)));
    const validTodos = todos.filter(Boolean);

    // Fetch specified results
    const results = input.resultIds
      ? await Promise.all(input.resultIds.map((id) => this.resultsRepo.findById(id)))
      : [];

    // Collect all result contents
    const resultContents: Array<{
      fileName: string;
      content: string;
      mimeType?: string;
    }> = [];

    for (const result of results.filter(Boolean)) {
      try {
        const content = await this.getResultContent(result!.id, project.workdir);
        resultContents.push(content);
      } catch {
        // Skip files that can't be read
      }
    }

    // Build context for AI
    const context = this.buildReportContext(validTodos, resultContents);

    // Get lightweight model
    const modelConfig = getActiveModel('lightweight');
    if (!modelConfig) {
      throw new Error('No lightweight model configured. Please set up a model in Settings.');
    }
    const configWithKey = getModelWithKey(modelConfig.id);
    if (!configWithKey) throw new Error('Model config not found');
    const model = getLanguageModelFromConfig(configWithKey);

    const systemPrompt = [
      'You are a research report generator.',
      'Given task descriptions and their results, generate a comprehensive research report in Markdown.',
      'The report should:',
      '1. Start with a brief introduction summarizing the overall research goal',
      '2. Have sections for each task explaining what was done and what was found',
      '3. Include key findings from the result files (data summaries, figure descriptions, etc.)',
      '4. End with a conclusions section summarizing the overall outcomes',
      'Use proper Markdown formatting with headers, lists, and emphasis.',
      'Be thorough but concise. Focus on the actual results and findings.',
      'Respond in the same language as the task prompts.',
    ].join(' ');

    const userPrompt = [
      `Project: ${project.name}`,
      project.description ? `Description: ${project.description}` : '',
      '',
      context,
      '',
      'Generate a comprehensive research report in Markdown format.',
    ]
      .filter(Boolean)
      .join('\n');

    // Stream the response
    const { textStream, usage } = streamText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 8192,
      abortSignal: signal,
    });

    let content = '';
    for await (const chunk of textStream) {
      content += chunk;
      onChunk(chunk);
    }

    // Record token usage
    const usageResult = await usage;
    if (usageResult && configWithKey.provider && configWithKey.model) {
      recordTokenUsage({
        timestamp: new Date().toISOString(),
        provider: configWithKey.provider,
        model: configWithKey.model,
        promptTokens: usageResult.inputTokens ?? 0,
        completionTokens: usageResult.outputTokens ?? 0,
        totalTokens: (usageResult.inputTokens ?? 0) + (usageResult.outputTokens ?? 0),
        kind: 'lightweight',
      });
    }

    // Extract summary from first paragraph
    const summary = this.extractSummary(content);

    // Save to database
    const report = await this.repo.create({
      projectId: input.projectId,
      title: input.title,
      content,
      summary,
      todoIds: input.todoIds,
      resultIds: input.resultIds ?? [],
      modelUsed: configWithKey.model,
    });

    // Also save to file system
    await this.saveReportFile(report.id, project.workdir, content);

    return this.toItem(report);
  }

  /**
   * List reports for a project
   */
  async listReports(projectId: string): Promise<ReportItem[]> {
    const reports = await this.repo.findByProjectId(projectId);
    return reports.map((r) => this.toItem(r));
  }

  /**
   * Get a report by ID
   */
  async getReport(reportId: string): Promise<ReportItem | null> {
    const report = await this.repo.findById(reportId);
    if (!report) return null;
    return this.toItem(report);
  }

  /**
   * Update a report
   */
  async updateReport(
    reportId: string,
    data: { title?: string; content?: string; summary?: string },
  ): Promise<ReportItem> {
    const report = await this.repo.findById(reportId);
    if (!report) {
      throw new Error('Report not found');
    }

    const updated = await this.repo.update(reportId, {
      ...data,
      version: report.version + 1,
    });

    // Update file
    const project = await this.projectsRepo.getProject(report.projectId);
    if (project?.workdir && data.content) {
      await this.saveReportFile(reportId, project.workdir, data.content);
    }

    return this.toItem(updated);
  }

  /**
   * Delete a report
   */
  async deleteReport(reportId: string): Promise<void> {
    const report = await this.repo.findById(reportId);
    if (!report) return;

    // Delete file
    try {
      const project = await this.projectsRepo.getProject(report.projectId);
      if (project?.workdir) {
        const reportsDir = path.join(project.workdir, 'reports');
        const filePath = path.join(reportsDir, `${reportId}.md`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Ignore file deletion errors
    }

    await this.repo.delete(reportId);
  }

  private buildReportContext(
    todos: Array<NonNullable<Awaited<ReturnType<AgentTodoRepository['findTodoById']>>>>,
    results: Array<{ fileName: string; content: string; mimeType?: string }>,
  ): string {
    const sections: string[] = [];

    // Task descriptions
    sections.push('## Tasks');
    for (const todo of todos) {
      sections.push(`### ${todo.title}`);
      sections.push(`Status: ${todo.status}`);
      sections.push(`Prompt:\n${todo.prompt}`);

      // Add run summaries if available
      if (todo.runs && todo.runs.length > 0) {
        const lastRun = todo.runs[0];
        if (lastRun.summary) {
          sections.push(`Summary: ${lastRun.summary}`);
        }
      }
      sections.push('');
    }

    // Results
    if (results.length > 0) {
      sections.push('## Result Files');
      for (const result of results) {
        sections.push(`### ${result.fileName}`);
        // Truncate large files
        const truncated =
          result.content.length > 10000
            ? result.content.slice(0, 10000) + '\n... (truncated)'
            : result.content;
        sections.push('```');
        sections.push(truncated);
        sections.push('```');
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  private async getResultContent(
    resultId: string,
    workdir?: string | null,
  ): Promise<{ fileName: string; content: string; mimeType?: string }> {
    const result = await this.resultsRepo.findById(resultId);
    if (!result) {
      throw new Error('Result not found');
    }

    if (!workdir) {
      throw new Error('Project has no working directory');
    }

    const todo = await this.todosRepo.findTodoById(result.todoId);
    const outputDir = todo?.outputDir
      ? path.resolve(workdir, todo.outputDir)
      : path.join(workdir, 'results', result.todoId);
    const filePath = path.join(outputDir, result.relativePath);

    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      fileName: result.fileName,
      content,
      mimeType: result.mimeType ?? undefined,
    };
  }

  private extractSummary(content: string): string {
    // Get the first paragraph after the title
    const lines = content.split('\n');
    let foundTitle = false;
    const summaryLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('# ') && !foundTitle) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && line.trim() && !line.startsWith('#')) {
        summaryLines.push(line);
        if (summaryLines.length >= 3) break;
      }
      if (foundTitle && line.startsWith('#')) {
        break;
      }
    }

    return summaryLines.join(' ').trim().slice(0, 500);
  }

  private async saveReportFile(
    reportId: string,
    workdir: string | null | undefined,
    content: string,
  ): Promise<void> {
    if (!workdir) return;

    const reportsDir = path.join(workdir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const filePath = path.join(reportsDir, `${reportId}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private toItem(r: {
    id: string;
    projectId: string;
    title: string;
    content: string;
    summary: string | null;
    todoIdsJson: string;
    resultIdsJson: string;
    generatedAt: Date;
    modelUsed: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): ReportItem {
    return {
      id: r.id,
      projectId: r.projectId,
      title: r.title,
      content: r.content,
      summary: r.summary ?? undefined,
      todoIds: JSON.parse(r.todoIdsJson) as string[],
      resultIds: JSON.parse(r.resultIdsJson) as string[],
      generatedAt: r.generatedAt,
      modelUsed: r.modelUsed ?? undefined,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
