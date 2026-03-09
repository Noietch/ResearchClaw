import path from 'path';
import { app } from 'electron';
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingProviderStatus,
} from './embedding-provider';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;
const BATCH_SIZE = 8; // Reduced from 32 to lower memory pressure

type FeatureExtractionPipeline = (
  texts: string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ tolist: () => number[][] }>;

function getBundledModelPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'models');
  }
  // Development mode: models/ at project root
  return path.join(app.getAppPath(), 'models');
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

      // Use bundled model files — no network download needed
      env.localModelPath = getBundledModelPath();
      env.allowRemoteModels = false;
      env.allowLocalModels = true;

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
      const output = await this.pipeline(batch, {
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
}
