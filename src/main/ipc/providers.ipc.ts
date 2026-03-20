import { ipcMain, dialog, shell, app, BrowserWindow, session } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { providersService } from '../services/providers.service';
import { getShellPath } from '../services/cli-runner.service';
import { type IpcResult, ok, err } from '@shared';
import type {
  ProxyScope,
  SemanticSearchSettings,
  EmbeddingConfig,
} from '../store/app-settings-store';
import {
  resumeAutomaticPaperProcessing,
  rebuildAllEmbeddings,
  rebuildSelectedEmbeddings,
  cancelEmbeddingRebuild,
  getEmbeddingRebuildStatus,
} from '../services/paper-processing.service';
import {
  getOverleafSessionCookie,
  setOverleafSessionCookie,
  hasOverleafSessionCookie,
} from '../store/app-settings-store';
import { overleafService } from '../services/overleaf.service';
import { PapersService } from '../services/papers.service';

function getOverleafPapersService() {
  return new PapersService();
}

export function setupProvidersIpc() {
  ipcMain.handle('providers:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.listProviders();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[providers:list] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'providers:save',
    async (_, config: Parameters<typeof providersService.save>[0]): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.save(config);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[providers:save] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('providers:getActive', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getActiveId();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[providers:getActive] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('providers:setActive', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.setActive(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[providers:setActive] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'providers:getApiKey',
    async (_, providerId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.getMaskedApiKey(providerId);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[providers:getApiKey] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:get', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getSettings();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:get] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:setStorageDir', async (_, dir: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.setStorageDir(dir);
      if (!result.success) return err(result.error ?? 'Migration failed');
      // Relaunch the app so it picks up the new DATABASE_URL and storage paths
      app.relaunch();
      app.exit(0);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:setStorageDir] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:selectFolder', async (): Promise<IpcResult<string | null>> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Storage Folder',
      });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:selectFolder] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:selectPdfFile', async (): Promise<IpcResult<string[] | null>> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        title: 'Select PDF Files',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok(result.filePaths);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:selectPdfFile] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:setEditor', async (_, cmd: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.setEditor(cmd);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:setEditor] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:setProxy',
    async (_, proxy: string | undefined): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setProxy(proxy);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setProxy] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'settings:setProxyScope',
    async (_, scope: ProxyScope): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setProxyScopeSettings(scope);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setProxyScope] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:getProxyEnabled', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getProxyEnabledState();
      return ok({ enabled: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getProxyEnabled] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:setProxyEnabled',
    async (_, enabled: boolean): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setProxyEnabledState(enabled);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setProxyEnabled] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'settings:testProxy',
    async (_, proxyUrl?: string): Promise<IpcResult<unknown>> => {
      try {
        // Empty string means "test direct connection (no proxy)"; undefined means "use saved setting"
        const result = await providersService.testProxy(proxyUrl === '' ? null : proxyUrl);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:testProxy] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:getStorageRoot', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getStorageRoot();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getStorageRoot] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:getSemanticSearch', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getSemanticSearchSettings();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getSemanticSearch] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:setSemanticSearch',
    async (_, settings: Partial<SemanticSearchSettings>): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setSemanticSearchSettings(settings);
        await resumeAutomaticPaperProcessing().catch((error) => {
          console.warn('[settings:setSemanticSearch] Failed to resume processing:', error);
        });
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setSemanticSearch] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'settings:testSemanticEmbedding',
    async (_, settings?: Partial<SemanticSearchSettings>): Promise<IpcResult<unknown>> => {
      try {
        const result = await providersService.testSemanticEmbedding(settings);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:testSemanticEmbedding] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'settings:getSemanticDebugInfo',
    async (_, settings?: Partial<SemanticSearchSettings>): Promise<IpcResult<unknown>> => {
      try {
        const result = await providersService.getSemanticDebugInfo(settings);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:getSemanticDebugInfo] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'settings:startSemanticModelPull',
    async (_, settings?: Partial<SemanticSearchSettings>): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.startSemanticModelPull(settings);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:startSemanticModelPull] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('embedding:list', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.listEmbeddingConfigs();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[embedding:list] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'embedding:save',
    async (_, config: EmbeddingConfig): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.saveEmbeddingConfig(config);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[embedding:save] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('embedding:delete', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.deleteEmbeddingConfig(id);
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[embedding:delete] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('embedding:setActive', async (_, id: string): Promise<IpcResult<unknown>> => {
    try {
      const configs = providersService.listEmbeddingConfigs().configs;
      const config = configs.find((c) => c.id === id);
      if (!config) return err(`Embedding config not found: ${id}`);
      const result = providersService.switchEmbeddingConfig(config);
      await resumeAutomaticPaperProcessing().catch((error) => {
        console.warn('[embedding:setActive] Failed to resume processing:', error);
      });
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[embedding:setActive] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:listSemanticModelPullJobs', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.listSemanticModelPullJobs();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:listSemanticModelPullJobs] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:saveBibtexFile',
    async (_, content: string): Promise<IpcResult<boolean>> => {
      try {
        const result = await dialog.showSaveDialog({
          title: 'Export BibTeX',
          defaultPath: 'references.bib',
          filters: [{ name: 'BibTeX Files', extensions: ['bib'] }],
        });
        if (result.canceled || !result.filePath) return ok(false);
        await fs.writeFile(result.filePath, content, 'utf-8');
        return ok(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:saveBibtexFile] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:getDevMode', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getDevMode();
      return ok({ enabled: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getDevMode] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:setDevMode',
    async (_, enabled: boolean): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setDevMode(enabled);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setDevMode] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('settings:getLanguage', async (): Promise<IpcResult<unknown>> => {
    try {
      const lang = providersService.getLanguage();
      return ok({ language: lang });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getLanguage] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'settings:setLanguage',
    async (_, lang: 'en' | 'zh'): Promise<IpcResult<unknown>> => {
      try {
        const result = providersService.setLanguage(lang);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[settings:setLanguage] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'shell:openInEditor',
    async (_, dirPath: string): Promise<IpcResult<{ success: boolean; error?: string }>> => {
      try {
        const cmd = providersService.getEditor();
        const env = { ...process.env, PATH: getShellPath() };

        // Helper to run command with spawn (avoids command injection)
        const runSpawn = (
          binary: string,
          args: string[],
        ): Promise<{ success: boolean; error?: string }> => {
          return new Promise((resolve) => {
            const proc = spawn(binary, args, { env });
            let stderr = '';

            proc.stderr.on('data', (data) => {
              stderr += data.toString();
            });

            proc.on('error', (err) => {
              resolve({ success: false, error: err.message });
            });

            proc.on('close', (code) => {
              if (code === 0) {
                resolve({ success: true });
              } else {
                resolve({ success: false, error: stderr || `Exited with code ${code}` });
              }
            });

            // Timeout after 5 seconds - assume success if still running
            setTimeout(() => {
              resolve({ success: true });
            }, 5000);
          });
        };

        // Try to open with the configured editor
        const cmdParts = cmd.trim().split(/\s+/);
        const binary = cmdParts[0];
        const args = [...cmdParts.slice(1), dirPath];
        const result = await runSpawn(binary, args);

        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[shell:openInEditor] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'embedding:rebuildAll',
    async (_, options?: { force?: boolean }): Promise<IpcResult<unknown>> => {
      try {
        const result = await rebuildAllEmbeddings(options);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[embedding:rebuildAll] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle('embedding:cancelRebuild', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = cancelEmbeddingRebuild();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[embedding:cancelRebuild] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('embedding:getRebuildStatus', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = getEmbeddingRebuildStatus();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[embedding:getRebuildStatus] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'embedding:rebuildSelected',
    async (_, paperIds: string[]): Promise<IpcResult<unknown>> => {
      try {
        const result = await rebuildSelectedEmbeddings(paperIds);
        return ok(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[embedding:rebuildSelected] Error:', msg);
        return err(msg);
      }
    },
  );

  // ── Overleaf Integration ────────────────────────────────────────────────────────

  ipcMain.handle('overleaf:getSession', async (): Promise<IpcResult<unknown>> => {
    try {
      const hasCookie = hasOverleafSessionCookie();
      if (!hasCookie) {
        return ok({ hasCookie: false, masked: null });
      }
      const cookie = getOverleafSessionCookie();
      return ok({ hasCookie: true, masked: cookie ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[overleaf:getSession] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('overleaf:setSession', async (_, cookie: string): Promise<IpcResult<unknown>> => {
    try {
      setOverleafSessionCookie(cookie || undefined);
      return ok({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[overleaf:setSession] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('overleaf:testSession', async (): Promise<IpcResult<unknown>> => {
    try {
      const cookie = getOverleafSessionCookie();
      console.log('[overleaf:testSession] Testing session, cookie length:', cookie?.length ?? 0);
      const valid = await overleafService.validateSession();
      return ok({ valid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[overleaf:testSession] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('overleaf:listProjects', async (): Promise<IpcResult<unknown>> => {
    try {
      const projects = await overleafService.listProjects();
      // Filter out archived and trashed projects by default
      const activeProjects = projects.filter((p) => !p.archived && !p.trashed);
      // Sort by lastUpdated descending (newest first)
      activeProjects.sort(
        (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
      );

      // Check which projects are already imported and when
      const svc = getOverleafPapersService();
      const importedMap: Record<string, { paperId: string; importedAt: string }> = {};
      for (const p of activeProjects) {
        const shortId = overleafService.generateShortId(p.id);
        const paper = await svc.getByShortId(shortId);
        if (paper) {
          importedMap[p.id] = {
            paperId: paper.id,
            importedAt: paper.createdAt?.toISOString?.() ?? paper.createdAt,
          };
        }
      }

      return ok({ projects: activeProjects, importedMap });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[overleaf:listProjects] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle(
    'overleaf:getProjectDetails',
    async (_, projectId: string): Promise<IpcResult<unknown>> => {
      try {
        const details = await overleafService.getProjectDetails(projectId);
        return ok(details);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[overleaf:getProjectDetails] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'overleaf:prepareImport',
    async (_, projectId: string): Promise<IpcResult<unknown>> => {
      try {
        const result = await overleafService.prepareProjectImport(projectId);
        const svc = getOverleafPapersService();
        const paper = await svc.importOverleafPdf(
          result.shortId,
          result.title,
          result.pdfPath,
          result.sourceUrl,
        );
        console.log('[overleaf:prepareImport] Created paper:', paper.id, result.title);
        return ok({ ...result, paperId: paper.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[overleaf:prepareImport] Error:', msg);
        return err(msg);
      }
    },
  );

  ipcMain.handle(
    'overleaf:batchImport',
    async (_, projectIds: string[]): Promise<IpcResult<unknown>> => {
      const results: Array<{ projectId: string; success: boolean; error?: string }> = [];
      const svc = getOverleafPapersService();

      for (let i = 0; i < projectIds.length; i++) {
        const projectId = projectIds[i];
        // Broadcast progress
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('overleaf:importProgress', {
            current: i + 1,
            total: projectIds.length,
            projectId,
          });
        }

        try {
          const result = await overleafService.prepareProjectImport(projectId);
          await svc.importOverleafPdf(
            result.shortId,
            result.title,
            result.pdfPath,
            result.sourceUrl,
          );
          results.push({ projectId, success: true });
          console.log(
            `[overleaf:batchImport] ${i + 1}/${projectIds.length} imported: ${result.title}`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ projectId, success: false, error: msg });
          console.error(`[overleaf:batchImport] ${i + 1}/${projectIds.length} failed:`, msg);
        }
      }

      return ok(results);
    },
  );

  // Open Overleaf login window and auto-extract cookie
  ipcMain.handle('overleaf:openLoginWindow', async (): Promise<IpcResult<unknown>> => {
    try {
      return await new Promise((resolve) => {
        const loginWindow = new BrowserWindow({
          width: 1000,
          height: 700,
          title: 'Login to Overleaf',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        loginWindow.loadURL('https://www.overleaf.com/login');

        // Check for cookie when window is closed or URL changes
        loginWindow.webContents.on('did-navigate', async () => {
          const url = loginWindow.webContents.getURL();
          // If redirected to project list, user is logged in
          if (url.includes('overleaf.com/project') || url === 'https://www.overleaf.com/') {
            const cookies = await loginWindow.webContents.session.cookies.get({
              domain: '.overleaf.com',
              name: 'overleaf_session2',
            });

            if (cookies.length > 0) {
              const cookieValue = cookies[0].value;
              console.log(
                '[overleaf:openLoginWindow] Cookie captured, length:',
                cookieValue.length,
                ', preview:',
                cookieValue.slice(0, 30) + '...',
              );
              setOverleafSessionCookie(cookieValue);
              loginWindow.close();
              resolve(ok({ success: true, autoDetected: true }));
            }
          }
        });

        loginWindow.on('closed', async () => {
          // Try to get cookie from default session as fallback
          const cookies = await session.defaultSession.cookies.get({
            domain: '.overleaf.com',
            name: 'overleaf_session2',
          });

          if (cookies.length > 0) {
            setOverleafSessionCookie(cookies[0].value);
            resolve(ok({ success: true, autoDetected: true }));
          } else {
            resolve(ok({ success: false, autoDetected: false }));
          }
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[overleaf:openLoginWindow] Error:', msg);
      return err(msg);
    }
  });

  // Try to auto-get cookie from existing browser session
  ipcMain.handle('overleaf:autoGetCookie', async (): Promise<IpcResult<unknown>> => {
    try {
      // Try to get cookie from the default session (might have it if user logged in via webview)
      const cookies = await session.defaultSession.cookies.get({
        domain: '.overleaf.com',
        name: 'overleaf_session2',
      });

      if (cookies.length > 0) {
        const cookieValue = cookies[0].value;
        console.log(
          '[overleaf:autoGetCookie] Cookie found, length:',
          cookieValue.length,
          ', preview:',
          cookieValue.slice(0, 30) + '...',
        );
        setOverleafSessionCookie(cookieValue);
        return ok({ success: true, found: true });
      }

      // Also check for sharelatex.sid (legacy)
      const legacyCookies = await session.defaultSession.cookies.get({
        domain: '.overleaf.com',
        name: 'sharelatex.sid',
      });

      if (legacyCookies.length > 0) {
        setOverleafSessionCookie(legacyCookies[0].value);
        return ok({ success: true, found: true, legacy: true });
      }

      return ok({ success: false, found: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[overleaf:autoGetCookie] Error:', msg);
      return err(msg);
    }
  });
}
