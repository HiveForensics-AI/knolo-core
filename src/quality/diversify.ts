// src/quality/diversify.ts
import { jaccard5 } from './similarity.js';

export type HitLike = { blockId: number; score: number; text: string; source?: string };

export type DiversifyOptions = {
  k: number;
  lambda?: number;      // trade-off relevance vs novelty
  simThreshold?: number; // near-duplicate cutoff
  sim?: (a: HitLike, b: HitLike) => number;
};

export function diversifyAndDedupe(
  hits: HitLike[],
  opts: DiversifyOptions
): HitLike[] {
  const { k, lambda = 0.8, simThreshold = 0.92, sim = (a, b) => jaccard5(a.text, b.text) } = opts;
  const pool = [...hits].sort((a, b) => b.score - a.score);
  const kept: HitLike[] = [];

  while (pool.length && kept.length < k) {
    // compute MMR for current pool against kept
    let bestIdx = 0;
    let bestMMR = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const h = pool[i];
      let maxSim = 0;
      for (const s of kept) {
        const v = sim(h, s);
        if (v > maxSim) maxSim = v;
        if (v >= simThreshold) { maxSim = v; break; } // early out
      }
      // skip near-duplicates
      if (maxSim >= simThreshold) continue;
      const mmr = lambda * h.score - (1 - lambda) * maxSim;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }
    // if everything was a near-duplicate, just take the next best by score
    const pick = pool.splice(bestMMR === -Infinity ? 0 : bestIdx, 1)[0];
    if (!pick) break;
    // final dedupe check before push
    if (!kept.some((x) => sim(x, pick) >= simThreshold)) kept.push(pick);
  }

  return kept;
}
