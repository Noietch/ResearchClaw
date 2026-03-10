export interface EmbeddingProviderInfo {
  id: 'builtin' | 'openai-compatible';
  name: string;
  modelName: string;
  dimensions: number;
}

export interface EmbeddingProviderStatus {
  ready: boolean;
  error?: string;
}

export interface EmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  initialize(): Promise<void>;
  getStatus(): EmbeddingProviderStatus;
  embedTexts(texts: string[]): Promise<number[][]>;
  dispose(): void;
}
