import { ipcMain, dialog, shell, app } from 'electron';
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
import { resumeAutomaticPaperProcessing } from '../services/paper-processing.service';

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

  ipcMain.handle('settings:getBuiltinModelStatus', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.getBuiltinModelStatus();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:getBuiltinModelStatus] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:checkBuiltinModelExists', async (): Promise<IpcResult<unknown>> => {
    try {
      const result = providersService.checkBuiltinModelExists();
      return ok(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:checkBuiltinModelExists] Error:', msg);
      return err(msg);
    }
  });

  ipcMain.handle('settings:downloadBuiltinModel', async (): Promise<IpcResult<unknown>> => {
    try {
      providersService.startBuiltinModelDownload();
      return ok({ started: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[settings:downloadBuiltinModel] Error:', msg);
      return err(msg);
    }
  });

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
      let config: import('../store/app-settings-store').EmbeddingConfig | undefined;
      if (id === '__builtin__') {
        config = {
          id: '__builtin__',
          name: 'Built-in Model',
          provider: 'builtin',
          embeddingModel: 'all-MiniLM-L6-v2',
        };
      } else {
        const configs = providersService.listEmbeddingConfigs().configs;
        config = configs.find((c) => c.id === id);
      }
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
}
