import path from 'path';
import fs from 'fs';
import * as https from 'node:https';
import * as http from 'node:http';
import { app } from 'electron';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxy } from '../store/app-settings-store';
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
 * Returns the writable model directory:
 * - Packaged: userData/models  (persists across app updates)
 * - Dev: project root models/  (existing behavior)
 */
export function getModelDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'models');
  }
  return path.join(app.getAppPath(), 'models');
}

export interface ModelDownloadProgress {
  phase: 'downloading' | 'completed' | 'error';
  file?: string;
  percent?: number;
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

  /** Check if the ONNX model file exists at the model path */
  checkModelExists(): boolean {
    const modelOnnxPath = path.join(
      getModelDir(),
      'Xenova',
      'all-MiniLM-L6-v2',
      'onnx',
      'model.onnx',
    );
    return fs.existsSync(modelOnnxPath);
  }

  getModelPath(): string {
    return getModelDir();
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

      env.localModelPath = getModelDir();
      env.allowLocalModels = true;

      // Always use local models only — download is triggered manually via Settings
      env.allowRemoteModels = false;

      // Configure ONNX Runtime for lower memory usage
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
    return new Promise((resolve, reject) => {
      this.embeddingQueue = this.embeddingQueue
        .then(async () => {
          if (!this.pipeline) {
            await this.initialize();
          }
          if (!this.pipeline) {
            throw new Error('Built-in embedding pipeline failed to initialize');
          }
          return this._embedTextsInternal(texts);
        })
        .then(resolve)
        .catch(reject);
    });
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

    for (const file of MODEL_FILES) {
      const url = `${HF_BASE_URL}/${file}`;
      const destPath = path.join(destDir, file);

      onProgress({ phase: 'downloading', file, percent: 0 });

      await downloadFile(url, destPath, agent, (percent) => {
        onProgress({ phase: 'downloading', file, percent });
      });
    }

    onProgress({ phase: 'completed' });
  }
}

function downloadFile(
  url: string,
  destPath: string,
  agent: http.Agent | undefined,
  onPercent: (pct: number) => void,
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
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Redirect with no location for ${url}`));
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
          onPercent(Math.round((downloaded / total) * 100));
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        onPercent(100);
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
