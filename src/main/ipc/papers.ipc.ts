import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { PapersRepository } from '@db';
import { PapersService } from '../services/papers.service';
import { DownloadService } from '../services/download.service';
import { AgenticSearchService, type AgenticSearchStep } from '../services/agentic-search.service';
import { SemanticSearchService } from '../services/semantic-search.service';
import {
  getPaperProcessingStatus,
  retryPaperProcessing,
} from '../services/paper-processing.service';
import { type IpcResult, ok, err } from '@shared';
import { getBibtexBatch } from '../services/bibtex.service';
import { searchPapers } from '../services/paper-search.service';
import { generateWithActiveProvider } from '../services/ai-provider.service';
import { getPaperOverview, getBestSummary } from '../services/alphaxiv.service';
import {
  getCachedAiSummary,
  generateAiSummary,
  deleteCachedAiSummary,
} from '../services/paper-summary.service';

// Lazy instantiation to ensure DATABASE_URL is set before Prisma initializes
let papersService: PapersService | null = null;
let downloadService: DownloadService | null = null;
let agenticSearchService: AgenticSearchService | null = null;
let semanticSearchService: SemanticSearchService | null = null;

function getPapersService() {
  if (!papersService) papersService = new PapersService();
  return papersService;
}

function getDownloadService() {
  if (!downloadService) downloadService = new DownloadService();
  return downloadService;
}

function getAgenticSearchService() {
  if (!agenticSearchService) agenticSearchService = new AgenticSearchService();
  return agenticSearchService;
}

function getSemanticSearchService() {
  if (!semanticSearchService) semanticSearchService = new SemanticSearchService();
  return semanticSearchService;
}

export function setupPapersIpc() {
  ipcMain.handle(
    'papers:download',
    async (
      _,
      input: string,
      tags?: string[],
      isTemporary?: boolean,
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getDownloadService().downloadFromInput(input, tags ?? [], isTemporary);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:download] Error:', msg);
        return err(msg);
      }
    },
  );

  // Make a temporary paper permanent
  ipcMain.handle(
    'papers:makePermanent',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const { makePaperPermanent } = await import('../services/temporary-papers.service');
        const success = await makePaperPermanent(paperId);
        return ok({ success });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:makePermanent] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:list',
    async (
      _,
      query: {
        q?: string;
        year?: number;
        tag?: string;
        importedWithin?: 'today' | 'week' | 'month' | 'all';
        temporary?: boolean;
      } = {},
    ): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().list(query);
        console.log('[papers:list] query:', query, 'result count:', result.length);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:list] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:listToday', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().listToday();
      console.log('[papers:listToday] result count:', result.length);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:listToday] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:create', async (_, input): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().create(input);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:create] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:importLocalPdf',
    async (_, filePath: string, isTemporary?: boolean): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().importLocalPdf(filePath, { isTemporary });
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:importLocalPdf] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:importLocalPdfs',
    async (_, filePaths: string[]): Promise<IpcResult<unknown>> => {
      try {
        const total = filePaths.length;
        const results: Array<{ file: string; success: boolean; error?: string }> = [];

        const broadcast = (completed: number, message: string) => {
          const wins = BrowserWindow.getAllWindows();
          for (const win of wins) {
            win.webContents.send('papers:importLocalPdfs:progress', {
              total,
              completed,
              success: results.filter((r) => r.success).length,
              failed: results.filter((r) => !r.success).length,
              message,
            });
          }
        };

        for (let i = 0; i < filePaths.length; i++) {
          const filePath = filePaths[i];
          const fileName = path.basename(filePath);
          broadcast(i, `Importing ${fileName} (${i + 1}/${total})...`);
          try {
            await getPapersService().importLocalPdf(filePath);
            results.push({ file: filePath, success: true });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[papers:importLocalPdfs] Error importing ${filePath}:`, msg);
            results.push({ file: filePath, success: false, error: msg });
          }
        }

        const successCount = results.filter((r) => r.success).length;
        const failedCount = results.filter((r) => !r.success).length;
        broadcast(
          total,
          `Import complete: ${successCount} succeeded, ${failedCount} failed out of ${total}`,
        );

        return ok({ total, success: successCount, failed: failedCount, results });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:importLocalPdfs] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:getById', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().getById(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:getById] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:getByShortId', async (_, shortId: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().getByShortId(shortId);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:getByShortId] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:downloadPdf',
    async (_, paperId: string, pdfUrl: string): Promise<IpcResult<unknown>> => {
      try {
        const win = BrowserWindow.getAllWindows()[0];
        const result = await getDownloadService().downloadPdfById(
          paperId,
          pdfUrl,
          (downloaded, total) => {
            win?.webContents.send('papers:downloadProgress', { paperId, downloaded, total });
          },
        );
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:downloadPdf] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('papers:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().deleteById(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:delete] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:deleteMany', async (_, ids: string[]): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().deleteMany(ids);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:deleteMany] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('papers:touch', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().touchLastRead(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:touch] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:updateTags',
    async (_, id: string, tags: string[]): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().updateTags(id, tags);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:updateTags] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:updateRating',
    async (_, id: string, rating: number | null): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().updateRating(id, rating);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:updateRating] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:updateReadingProgress',
    async (
      _,
      id: string,
      lastReadPage: number,
      totalPages: number,
    ): Promise<IpcResult<unknown>> => {
      try {
        await new PapersRepository().updateReadingProgress(id, lastReadPage, totalPages);
        return ok(null);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // Convert temporary paper to permanent (import to library)
  ipcMain.handle(
    'papers:importTemporary',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        await new PapersRepository().updateTemporaryStatus(paperId, false);
        return ok({ success: true });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  ipcMain.handle('papers:listTags', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = await getPapersService().listAllTags();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[papers:listTags] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'papers:getSourceEvents',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPapersService().getSourceEvents(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:getSourceEvents] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:getProcessingStatus',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await getPaperProcessingStatus(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:getProcessingStatus] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:retryProcessing',
    async (_, paperId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await retryPaperProcessing(paperId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:retryProcessing] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:semanticSearch',
    async (_, query: string, limit?: number): Promise<IpcResult<unknown>> => {
      try {
        const result = await getSemanticSearchService().search(query, limit);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:semanticSearch] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:exportBibtex',
    async (_, paperIds: string[]): Promise<IpcResult<string>> => {
      try {
        const service = getPapersService();
        const papers = await Promise.all(paperIds.map((id) => service.getById(id)));
        const validPapers = papers.filter(
          (p): p is NonNullable<typeof p> => p !== null && p !== undefined,
        );
        const bibtex = await getBibtexBatch(
          validPapers.map((p) => ({
            title: p.title,
            authors: p.authors,
            submittedAt: p.submittedAt ? String(p.submittedAt) : undefined,
            sourceUrl: p.sourceUrl ?? undefined,
            shortId: p.shortId,
          })),
        );
        return ok(bibtex);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:exportBibtex] Error:', msg);
        return err(msg);
      }
    },
  );

  // Agentic Search with streaming steps
  ipcMain.handle(
    'papers:agenticSearch',
    async (
      event,
      query: string,
    ): Promise<IpcResult<{ steps: AgenticSearchStep[]; papers: unknown }>> => {
      try {
        const steps: AgenticSearchStep[] = [];

        const result = await getAgenticSearchService().search(query, (step) => {
          steps.push(step);
          // Send step updates to renderer via IPC event
          event.sender.send('papers:agenticSearch:step', step);
        });

        return ok({ steps: result.steps, papers: result.papers });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:agenticSearch] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:search',
    async (_, query: string, limit?: number): Promise<IpcResult<unknown>> => {
      try {
        const result = await searchPapers(query, limit);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:search] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:extractGithubUrl',
    async (_, input: { title: string; abstract?: string }): Promise<IpcResult<string | null>> => {
      try {
        const { title, abstract } = input;
        const text = abstract ? `Title: ${title}\n\nAbstract: ${abstract}` : `Title: ${title}`;

        const systemPrompt = `You are a research assistant. Given a paper title and abstract, identify the official GitHub repository URL that belongs to this paper (i.e. the code released by the paper's authors).

Rules:
- Only return a URL if you are confident it is the paper's own repository (not just a cited or related repo).
- Return ONLY the raw GitHub URL in the format: https://github.com/owner/repo
- Do not include trailing slashes, sub-paths, or extra text.
- If no official repository URL is found, return exactly: null`;

        const userPrompt = `Find the official GitHub repository URL for this paper:\n\n${text}`;

        const response = await generateWithActiveProvider(systemPrompt, userPrompt);
        const trimmed = response.trim();

        if (trimmed === 'null' || trimmed === '' || trimmed.toLowerCase() === 'none') {
          return ok(null);
        }

        // Validate it looks like a GitHub URL
        const match = trimmed.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/);
        if (!match) {
          return ok(null);
        }

        return ok(match[0]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:extractGithubUrl] Error:', msg);
        return err(msg);
      }
    },
  );

  // Fetch AlphaXiv summary for a paper and update its abstract
  ipcMain.handle(
    'papers:fetchAlphaXiv',
    async (_, paperId: string, shortId: string): Promise<IpcResult<string | null>> => {
      try {
        // Check if shortId looks like an arXiv ID
        const arxivIdMatch = shortId.match(/^(\d{4}\.\d{4,5})/);
        if (!arxivIdMatch) {
          return ok(null); // Not an arXiv paper
        }

        const arxivId = arxivIdMatch[1];
        const alphaxivData = await getPaperOverview(arxivId);

        if (!alphaxivData?.overview) {
          return ok(null); // No AlphaXiv data available
        }

        const aiSummary = getBestSummary(alphaxivData.overview);
        if (!aiSummary) {
          return ok(null);
        }

        // Get current paper to preserve original abstract
        const paper = await getPapersService().getById(paperId);
        if (!paper) {
          return err('Paper not found');
        }

        // Extract original abstract if already has AlphaXiv marker
        let originalAbstract = paper.abstract;
        const marker = '**AI-Generated Summary (AlphaXiv):**';
        const divider = '\n\n---\n\n**Original Abstract:**';
        if (paper.abstract.includes(marker)) {
          const dividerIndex = paper.abstract.indexOf(divider);
          if (dividerIndex !== -1) {
            originalAbstract = paper.abstract.slice(dividerIndex + divider.length).trim();
          }
        }

        // Build new abstract with AlphaXiv summary
        const newAbstract = `**AI-Generated Summary (AlphaXiv):**\n\n${aiSummary}\n\n---\n\n**Original Abstract:**\n${originalAbstract}`;

        // Update paper in database
        await getPapersService().updateAbstract(paperId, newAbstract);

        return ok(newAbstract);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:fetchAlphaXiv] Error:', msg);
        return err(msg);
      }
    },
  );

  // Bulk refresh AlphaXiv summaries for all arXiv papers
  ipcMain.handle(
    'papers:refreshAllAlphaXiv',
    async (): Promise<IpcResult<{ updated: number; total: number }>> => {
      try {
        const all = await getPapersService().list({});
        const arxivPapers = all.filter((p) => /^\d{4}\.\d{4,5}/.test(p.shortId));
        let updated = 0;

        for (const paper of arxivPapers) {
          try {
            const arxivId = paper.shortId.match(/^(\d{4}\.\d{4,5})/)![1];
            const alphaxivData = await getPaperOverview(arxivId);
            if (!alphaxivData?.overview) continue;

            const aiSummary = getBestSummary(alphaxivData.overview);
            if (!aiSummary) continue;

            // Extract original abstract
            let originalAbstract = paper.abstract;
            const marker = '**AI-Generated Summary (AlphaXiv):**';
            const divider = '\n\n---\n\n**Original Abstract:**';
            if (paper.abstract.includes(marker)) {
              const dividerIndex = paper.abstract.indexOf(divider);
              if (dividerIndex !== -1) {
                originalAbstract = paper.abstract.slice(dividerIndex + divider.length).trim();
              }
            }

            const newAbstract = `**AI-Generated Summary (AlphaXiv):**\n\n${aiSummary}\n\n---\n\n**Original Abstract:**\n${originalAbstract}`;
            await getPapersService().updateAbstract(paper.id, newAbstract);
            updated++;
            console.log(
              `[refreshAllAlphaXiv] Updated ${paper.shortId} (${updated}/${arxivPapers.length})`,
            );
          } catch {
            // Skip individual failures
          }
        }

        console.log(`[refreshAllAlphaXiv] Done: ${updated}/${arxivPapers.length} updated`);
        return ok({ updated, total: arxivPapers.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg);
      }
    },
  );

  // Get AlphaXiv summary for an arXiv paper (without saving to database)
  ipcMain.handle(
    'papers:getAlphaXivData',
    async (_, arxivId: string): Promise<IpcResult<string | null>> => {
      console.log('[papers:getAlphaXivData] Called with arxivId:', arxivId);
      try {
        const alphaxivData = await getPaperOverview(arxivId);
        console.log('[papers:getAlphaXivData] AlphaXiv data:', alphaxivData ? 'received' : 'null');

        if (!alphaxivData?.overview) {
          return ok(null);
        }

        const aiSummary = getBestSummary(alphaxivData.overview);
        console.log('[papers:getAlphaXivData] AI summary length:', aiSummary?.length || 0);
        return ok(aiSummary);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:getAlphaXivData] Error:', msg);
        return err(msg);
      }
    },
  );

  // Match a reference against local papers by arXiv ID, DOI, or title
  ipcMain.handle(
    'papers:matchReference',
    async (
      _,
      ref: { arxivId?: string; doi?: string; title?: string },
    ): Promise<IpcResult<unknown>> => {
      try {
        const { getPrismaClient } = await import('@db');
        const prisma = getPrismaClient();

        // Only match papers that have a local PDF
        const pdfFilter = { pdfPath: { not: null } };

        // 1. Try matching by arXiv ID (stored as shortId)
        if (ref.arxivId) {
          const paper = await prisma.paper.findFirst({
            where: { shortId: ref.arxivId, ...pdfFilter },
            include: { tags: { include: { tag: true } } },
          });
          if (paper) {
            return ok({
              id: paper.id,
              shortId: paper.shortId,
              title: paper.title,
              authors: paper.authorsJson ? JSON.parse(paper.authorsJson) : [],
              submittedAt: paper.submittedAt?.toISOString(),
              abstract: paper.abstract,
              pdfUrl: paper.pdfUrl,
              pdfPath: paper.pdfPath,
              sourceUrl: paper.sourceUrl,
              tagNames: paper.tags.map((pt) => pt.tag.name),
              year: paper.submittedAt ? paper.submittedAt.getFullYear() : null,
            });
          }
        }

        // 2. Try matching by title (case-insensitive contains)
        if (ref.title) {
          const paper = await prisma.paper.findFirst({
            where: {
              title: { contains: ref.title },
              ...pdfFilter,
            },
            include: { tags: { include: { tag: true } } },
          });
          if (paper) {
            return ok({
              id: paper.id,
              shortId: paper.shortId,
              title: paper.title,
              authors: paper.authorsJson ? JSON.parse(paper.authorsJson) : [],
              submittedAt: paper.submittedAt?.toISOString(),
              abstract: paper.abstract,
              pdfUrl: paper.pdfUrl,
              pdfPath: paper.pdfPath,
              sourceUrl: paper.sourceUrl,
              tagNames: paper.tags.map((pt) => pt.tag.name),
              year: paper.submittedAt ? paper.submittedAt.getFullYear() : null,
            });
          }
        }

        return ok(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:matchReference] Error:', msg);
        return err(msg);
      }
    },
  );

  // Get cached AI summary for a paper (any paper, not just arXiv)
  ipcMain.handle(
    'papers:getAiSummary',
    async (_, shortId: string): Promise<IpcResult<string | null>> => {
      try {
        const summary = await getCachedAiSummary(shortId);
        return ok(summary);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg);
      }
    },
  );

  // Generate AI summary for a paper with streaming output
  // Active generation controllers for cancellation support
  const activeAiSummaryControllers = new Map<string, AbortController>();

  // Generate AI summary using pure event-based streaming (no invoke/handle)
  // This avoids Electron batching send() events with the invoke response.
  ipcMain.on(
    'papers:generateAiSummary:start',
    (
      event,
      input: {
        paperId: string;
        shortId: string;
        title: string;
        abstract?: string;
        pdfUrl?: string;
        pdfPath?: string;
        language?: 'en' | 'zh';
      },
    ) => {
      console.log('[papers:generateAiSummary] Generating for:', input.shortId);

      // Cancel any previous generation for this paper
      const prev = activeAiSummaryControllers.get(input.paperId);
      if (prev) prev.abort();

      const controller = new AbortController();
      activeAiSummaryControllers.set(input.paperId, controller);

      const sender = event.sender;

      // Throttle chunk sends: accumulate in buffer, flush every 50ms
      // This prevents flooding the renderer with hundreds of IPC events in one tick.
      let chunkBuffer = '';
      const FLUSH_INTERVAL = 50; // ms
      const flushTimer = setInterval(() => {
        if (chunkBuffer && !sender.isDestroyed()) {
          sender.send('papers:aiSummaryChunk', { paperId: input.paperId, chunk: chunkBuffer });
          chunkBuffer = '';
        }
      }, FLUSH_INTERVAL);

      generateAiSummary(
        input.paperId,
        input.shortId,
        input.title,
        (chunk) => {
          chunkBuffer += chunk;
        },
        {
          abstract: input.abstract,
          pdfUrl: input.pdfUrl,
          pdfPath: input.pdfPath,
          language: input.language,
          signal: controller.signal,
          onPhase: (phase: string) => {
            if (!sender.isDestroyed()) {
              sender.send('papers:aiSummaryPhase', { paperId: input.paperId, phase });
            }
          },
        },
      )
        .then((summary) => {
          clearInterval(flushTimer);
          // Flush any remaining buffer
          if (chunkBuffer && !sender.isDestroyed()) {
            sender.send('papers:aiSummaryChunk', { paperId: input.paperId, chunk: chunkBuffer });
            chunkBuffer = '';
          }
          activeAiSummaryControllers.delete(input.paperId);
          console.log('[papers:generateAiSummary] Generated, length:', summary.length);
          if (!sender.isDestroyed()) {
            sender.send('papers:aiSummaryDone', { paperId: input.paperId, summary });
          }
        })
        .catch((e) => {
          clearInterval(flushTimer);
          activeAiSummaryControllers.delete(input.paperId);
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[papers:generateAiSummary] Error:', msg);
          if (!sender.isDestroyed()) {
            sender.send('papers:aiSummaryError', { paperId: input.paperId, error: msg });
          }
        });
    },
  );

  // Delete cached AI summary (for regeneration)
  ipcMain.handle(
    'papers:deleteAiSummary',
    async (_, shortId: string): Promise<IpcResult<boolean>> => {
      try {
        await deleteCachedAiSummary(shortId);
        return ok(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg);
      }
    },
  );

  // Extracted References - save to database for caching
  ipcMain.handle(
    'papers:getExtractedRefs',
    async (_, paperId: string): Promise<IpcResult<unknown[]>> => {
      try {
        const { getPrismaClient } = await import('@db');
        const prisma = getPrismaClient();
        const refs = await prisma.extractedReference.findMany({
          where: { paperId },
          orderBy: { refNumber: 'asc' },
        });
        return ok(refs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:getExtractedRefs] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'papers:saveExtractedRefs',
    async (
      _,
      paperId: string,
      refs: Array<{
        refNumber: number;
        text: string;
        title?: string;
        authors?: string;
        year?: number;
        doi?: string;
        arxivId?: string;
        url?: string;
        venue?: string;
      }>,
    ): Promise<IpcResult<unknown>> => {
      try {
        const { getPrismaClient } = await import('@db');
        const prisma = getPrismaClient();

        // Delete existing refs for this paper
        await prisma.extractedReference.deleteMany({
          where: { paperId },
        });

        // Insert new refs
        if (refs.length > 0) {
          await prisma.extractedReference.createMany({
            data: refs.map((ref) => ({
              paperId,
              refNumber: ref.refNumber,
              text: ref.text,
              title: ref.title ?? null,
              authors: ref.authors ?? null,
              year: ref.year ?? null,
              doi: ref.doi ?? null,
              arxivId: ref.arxivId ?? null,
              url: ref.url ?? null,
              venue: ref.venue ?? null,
            })),
          });
        }

        // Update citationsExtractedAt on paper
        await prisma.paper.update({
          where: { id: paperId },
          data: { citationsExtractedAt: new Date() },
        });

        return ok({ count: refs.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[papers:saveExtractedRefs] Error:', msg);
        return err(msg);
      }
    },
  );
}
