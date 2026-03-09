import type { Pack } from '../pack.runtime.js';
import type { SemanticSidecar } from './types.js';

export function createPackFingerprint(pack: Pick<Pack, 'blocks' | 'docIds' | 'meta'>): string {
  let hash = 2166136261;
  const parts = [String(pack.meta?.version ?? 0), ...(pack.docIds ?? []), ...pack.blocks];
  for (const part of parts) {
    const text = String(part ?? '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function serializeSidecar(sidecar: SemanticSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

export function parseSidecar(raw: string): SemanticSidecar {
  const parsed = JSON.parse(raw) as SemanticSidecar;
  if (parsed.version !== 1) throw new Error(`Unsupported semantic sidecar version: ${parsed.version}`);
  if (parsed.metric !== 'cosine') throw new Error(`Unsupported semantic metric: ${parsed.metric}`);
  return parsed;
}

export function validateSidecarForPack(input: {
  sidecar: SemanticSidecar;
  pack: Pick<Pack, 'blocks' | 'docIds' | 'meta'>;
  modelId: string;
}): void {
  const expectedFingerprint = createPackFingerprint(input.pack);
  if (input.sidecar.packFingerprint !== expectedFingerprint) {
    throw new Error(
      `Semantic sidecar pack fingerprint mismatch: expected ${expectedFingerprint}, got ${input.sidecar.packFingerprint}. Regenerate the sidecar for this pack.`
    );
  }
  if (input.sidecar.modelId !== input.modelId) {
    throw new Error(
      `Semantic model mismatch: sidecar model is ${input.sidecar.modelId}, but query provider is ${input.modelId}. Use the same embedding model or regenerate the sidecar.`
    );
  }
}
