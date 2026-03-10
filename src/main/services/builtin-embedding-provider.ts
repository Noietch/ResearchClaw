import path from 'path';
import fs from 'fs';
import * as https from 'node:https';
import * as http from 'node:http';
import { app } from 'electron';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxy, getBuiltinModelPath } from '../store/app-settings-store';
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingProviderStatus,
} from './embedding-provider';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;
const BATCH_SIZE = 8; // Reduced from 32 to lower memory pressure

// Files to download from HuggingFace
const MODEL_FILES = ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'onnx/model.onnx'];

const HF_BASE_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';

type FeatureExtractionPipeline = (
  texts: string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ tolist: () => number[][] }>;

/**
 * Returns the default writable model directory.
 * - Packaged: userData/models  (persists across app updates)
 * - Dev: project root models/
 */
export function getModelDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'models');
  }
  return path.join(app.getAppPath(), 'models');
}

const ONNX_REL_PATH = path.join('Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model.onnx');

/**
 * Returns the effective model directory, checking in order:
 * 1. User-configured path (from Settings)
 * 2. Default model directory
 */
export function getEffectiveModelDir(): string {
  const custom = getBuiltinModelPath();
  if (custom && fs.existsSync(path.join(custom, ONNX_REL_PATH))) {
    return custom;
  }
  return getModelDir();
}

export interface ModelDownloadProgress {
  phase: 'downloading' | 'completed' | 'error';
  file?: string;
  /** Per-file percent 0-100 */
  percent?: number;
  /** Overall progress: which file index (1-based) */
  fileIndex?: number;
  /** Total number of files to download */
  totalFiles?: number;
  /** Bytes downloaded for current file */
  downloadedBytes?: number;
  /** Total bytes for current file (0 if unknown) */
  totalBytes?: number;
  error?: string;
}

export class BuiltinEmbeddingProvider implements EmbeddingProvider {
  readonly info: EmbeddingProviderInfo = {
    id: 'builtin',
    name: 'Built-in (all-MiniLM-L6-v2)',
    modelName: 'all-MiniLM-L6-v2',
    dimensions: DIMENSIONS,
  };

  private pipeline: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private status: EmbeddingProviderStatus = { ready: false };
  private embeddingQueue: Promise<number[][]> = Promise.resolve([]);

  /** Check if the ONNX model file exists (user path or default) */
  checkModelExists(): boolean {
    return fs.existsSync(path.join(getEffectiveModelDir(), ONNX_REL_PATH));
  }

  getModelPath(): string {
    return getEffectiveModelDir();
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      this.status = { ready: false };

      const { pipeline, env } = await import('@huggingface/transformers');

      env.localModelPath = getEffectiveModelDir();
      env.allowLocalModels = true;

      // Always use local models only — download is triggered manually via Settings
      env.allowRemoteModels = false;

      // Configure ONNX Runtime for lower memory usage
      // @ts-ignore - WASM configuration is read-only in newer versions
      env.backends.onnx.wasm = {
        numThreads: 1, // Single-threaded to reduce memory
      };

      this.pipeline = (await pipeline('feature-extraction', MODEL_ID, {
        dtype: 'fp32',
        device: 'cpu',
        // Use smaller memory arena for ONNX Runtime
        session_options: {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
          enableCpuMemArena: false, // Disable memory arena to reduce peak memory
        },
      })) as unknown as FeatureExtractionPipeline;

      this.status = { ready: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { ready: false, error: message };
      this.initPromise = null;
      throw error;
    }
  }

  getStatus(): EmbeddingProviderStatus {
    return { ...this.status };
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    // Serialize all embedding requests (including initialization) to prevent
    // concurrent ONNX inference which can cause memory allocation failures
    const resultPromise = this.embeddingQueue.then(async () => {
      if (!this.pipeline) {
        await this.initialize();
      }
      if (!this.pipeline) {
        throw new Error('Built-in embedding pipeline failed to initialize');
      }
      return this._embedTextsInternal(texts);
    });
    this.embeddingQueue = resultPromise.catch(() => []);
    return resultPromise;
  }

  private async _embedTextsInternal(texts: string[]): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const output = await this.pipeline!(batch, {
        pooling: 'mean',
        normalize: true,
      });
      const vectors = output.tolist();
      allEmbeddings.push(...vectors);
    }

    return allEmbeddings;
  }

  dispose(): void {
    this.pipeline = null;
    this.initPromise = null;
    this.status = { ready: false };
    this.embeddingQueue = Promise.resolve([]);
  }

  /**
   * Download model files from HuggingFace.
   * Respects the app proxy setting.
   */
  async downloadModel(onProgress: (progress: ModelDownloadProgress) => void): Promise<void> {
    const destDir = path.join(getModelDir(), 'Xenova', 'all-MiniLM-L6-v2');

    // Ensure directories exist
    fs.mkdirSync(path.join(destDir, 'onnx'), { recursive: true });

    const proxyUrl = getProxy();
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    const totalFiles = MODEL_FILES.length;
    for (let i = 0; i < totalFiles; i++) {
      const file = MODEL_FILES[i];
      const url = `${HF_BASE_URL}/${file}`;
      const destPath = path.join(destDir, file);
      const fileIndex = i + 1;

      onProgress({ phase: 'downloading', file, percent: 0, fileIndex, totalFiles });

      await downloadFile(url, destPath, agent, (percent, downloadedBytes, totalBytes) => {
        onProgress({
          phase: 'downloading',
          file,
          percent,
          fileIndex,
          totalFiles,
          downloadedBytes,
          totalBytes,
        });
      });
    }

    onProgress({ phase: 'completed' });
  }
}

function downloadFile(
  url: string,
  destPath: string,
  agent: http.Agent | undefined,
  onPercent: (pct: number, downloadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const req = https.get(url, { agent } as https.RequestOptions, (res) => {
      // Follow redirects (HuggingFace uses CDN redirects)
      if (
        res.statusCode === 301 ||
        res.statusCode === 302 ||
        res.statusCode === 307 ||
        res.statusCode === 308
      ) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Redirect with no location for ${url}`));
        }
        // Handle relative redirects by resolving against the original URL
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        res.resume();
        file.close();
        // Follow the redirect
        downloadFile(redirectUrl, destPath, agent, onPercent).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = parseInt(res.headers['content-length'] ?? '0', 10);
      let downloaded = 0;

      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          onPercent(Math.round((downloaded / total) * 100), downloaded, total);
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        onPercent(100, downloaded, total);
        resolve();
      });
    });

    req.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });

    file.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}
