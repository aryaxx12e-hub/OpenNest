import type { AiProviderConfig, AiProviderStore } from "./types";

export function createMemoryAiProviderStore(): AiProviderStore {
  const providers = new Map<string, AiProviderConfig>();

  return {
    async list() {
      return [...providers.values()].map(cloneProvider);
    },
    async get(id) {
      const provider = providers.get(id);
      return provider === undefined ? null : cloneProvider(provider);
    },
    async put(config) {
      providers.set(config.id, cloneProvider(config));
    },
    async delete(id) {
      providers.delete(id);
    },
    async clear() {
      providers.clear();
    },
  };
}

function cloneProvider(config: AiProviderConfig): AiProviderConfig {
  return {
    ...config,
    models: [...config.models],
    capabilities: [...config.capabilities],
  };
}
