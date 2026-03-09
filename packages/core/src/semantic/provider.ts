import type { EmbeddingProvider, SemanticQueryOptions } from './types.js';

export function ensureProviderModelId(options?: SemanticQueryOptions): string | undefined {
  return options?.provider?.modelId;
}

export function assertProviderCompatible(options?: SemanticQueryOptions, provider?: EmbeddingProvider): void {
  if (!options?.enabled) return;
  if (!provider && !options.queryEmbedding) {
    throw new Error('semantic.enabled=true requires either semantic.queryEmbedding or an EmbeddingProvider.');
  }
  if (provider && options.provider?.modelId && options.provider.modelId !== provider.modelId) {
    throw new Error(
      `Semantic provider model mismatch: options requested ${options.provider.modelId}, provider exposes ${provider.modelId}.`
    );
  }
}
