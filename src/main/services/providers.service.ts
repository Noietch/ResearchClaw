import {
  getProviders,
  saveProvider,
  getActiveProviderId,
  setActiveProvider,
  getDecryptedApiKey,
  type ProviderConfig,
} from '../store/provider-store';
import {
  getAppSettings,
  setPapersDir,
  setEditorCommand,
  getEditorCommand,
  getProxy,
  setProxy,
  getStorageRoot as getStorageRootPath,
} from '../store/app-settings-store';

export class ProvidersService {
  listProviders(): (ProviderConfig & { hasApiKey: boolean })[] {
    const providers = getProviders();
    return providers.map((p) => ({
      ...p,
      hasApiKey: !!p.apiKeyEncrypted,
      apiKeyEncrypted: undefined,
    }));
  }

  save(config: Omit<ProviderConfig, 'apiKeyEncrypted'> & { apiKey?: string }): {
    success: boolean;
  } {
    saveProvider(config);
    return { success: true };
  }

  getActiveId(): string {
    return getActiveProviderId();
  }

  setActive(id: string): { success: boolean } {
    setActiveProvider(id);
    return { success: true };
  }

  getMaskedApiKey(providerId: string): string | null {
    const key = getDecryptedApiKey(providerId);
    if (!key) return null;
    return key.slice(0, 8) + '...' + key.slice(-4);
  }

  getSettings() {
    return getAppSettings();
  }

  setPapersDir(dir: string): { success: boolean } {
    setPapersDir(dir);
    return { success: true };
  }

  setEditor(cmd: string): { success: boolean } {
    setEditorCommand(cmd);
    return { success: true };
  }

  getEditor(): string {
    return getEditorCommand();
  }

  setProxy(proxy: string | undefined): { success: boolean } {
    setProxy(proxy || undefined);
    return { success: true };
  }

  getProxyUrl(): string | undefined {
    return getProxy();
  }

  getStorageRoot(): string {
    return getStorageRootPath();
  }
}

export const providersService = new ProvidersService();
