import {
  getModelConfigs,
  getActiveModelIds,
  getActiveModel,
  setActiveModel,
  saveModelConfig,
  deleteModelConfig,
  getDecryptedApiKey,
  type ModelConfig,
  type ModelKind,
} from '../store/model-config-store';
import { testApiConnection } from './ai-provider.service';

export class ModelsService {
  listModels(): (ModelConfig & { hasApiKey: boolean })[] {
    const models = getModelConfigs();
    return models.map((m) => ({
      ...m,
      apiKeyEncrypted: undefined,
      hasApiKey: !!m.apiKeyEncrypted,
    }));
  }

  getActiveIds(): Record<ModelKind, string | null> {
    return getActiveModelIds();
  }

  getActive(kind: ModelKind): (ModelConfig & { hasApiKey: boolean }) | null {
    const model = getActiveModel(kind);
    if (!model) return null;
    return {
      ...model,
      apiKeyEncrypted: undefined,
      hasApiKey: !!model.apiKeyEncrypted,
    };
  }

  save(config: Omit<ModelConfig, 'apiKeyEncrypted'> & { apiKey?: string }): { success: boolean } {
    saveModelConfig(config);
    return { success: true };
  }

  delete(id: string): { success: boolean } {
    deleteModelConfig(id);
    return { success: true };
  }

  setActive(kind: ModelKind, id: string): { success: boolean } {
    setActiveModel(kind, id);
    return { success: true };
  }

  getApiKey(id: string): string | null {
    const key = getDecryptedApiKey(id) ?? null;
    return key;
  }

  async testConnection(params: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'custom';
    model: string;
    apiKey?: string;
    baseURL?: string;
  }): Promise<{ success: boolean; error?: string }> {
    return testApiConnection(params);
  }

  async testSavedConnection(id: string): Promise<{ success: boolean; error?: string }> {
    const models = getModelConfigs();
    const model = models.find((m) => m.id === id);
    if (!model || model.backend !== 'api') {
      return { success: false, error: 'Model not found or not an API model' };
    }
    const apiKey = getDecryptedApiKey(id);
    return testApiConnection({
      provider: model.provider ?? 'openai',
      model: model.model ?? '',
      apiKey,
      baseURL: model.baseURL,
    });
  }
}

export const modelsService = new ModelsService();
