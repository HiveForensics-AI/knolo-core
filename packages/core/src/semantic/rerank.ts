import type { SemanticSidecar } from './types.js';
import { cosineSimilarity, normalizeVector } from './cosine.js';

export function rerankCandidates(params: {
  lexical: Array<{ blockId: number; score: number }>;
  sidecar: SemanticSidecar;
  queryEmbedding: Float32Array;
  topN: number;
  blend: { enabled: boolean; wLex: number; wSem: number };
  minSemanticScore?: number;
}): {
  reranked: Array<{ blockId: number; score: number }>;
  semanticScores: Map<number, number>;
  blendedScores: Map<number, number>;
} {
  const topN = Math.min(params.topN, params.lexical.length);
  const head = params.lexical.slice(0, topN);
  const tail = params.lexical.slice(topN);
  const q = normalizeVector(params.queryEmbedding);
  const semanticScores = new Map<number, number>();
  const blendedScores = new Map<number, number>();

  const lexNorm = minMax(head.map((h) => h.score));
  const semRaw: number[] = [];
  for (const item of head) {
    const rec = params.sidecar.blocks.find((b) => b.blockId === item.blockId);
    const vec = rec ? Float32Array.from(rec.vector) : new Float32Array(q.length);
    semRaw.push(cosineSimilarity(q, vec));
  }
  const semNorm = minMax(semRaw);

  const denom = params.blend.wLex + params.blend.wSem;
  const wLex = denom > 0 ? params.blend.wLex / denom : 0.7;
  const wSem = denom > 0 ? params.blend.wSem / denom : 0.3;

  const reranked = head.map((item, idx) => {
    const sem = semNorm[idx];
    semanticScores.set(item.blockId, sem);
    if ((params.minSemanticScore ?? 0) > sem) {
      blendedScores.set(item.blockId, lexNorm[idx]);
      return { blockId: item.blockId, score: lexNorm[idx] };
    }
    const blended = params.blend.enabled ? wLex * lexNorm[idx] + wSem * sem : sem;
    blendedScores.set(item.blockId, blended);
    return { blockId: item.blockId, score: blended };
  });

  reranked.sort((a, b) => b.score - a.score || a.blockId - b.blockId);
  return { reranked: [...reranked, ...tail], semanticScores, blendedScores };
}

function minMax(values: number[]): number[] {
  if (values.length === 0) return values;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return values.map(() => 1);
  return values.map((v) => Math.min(1, Math.max(0, (v - min) / (max - min))));
}
