/*
 * rank.ts
 * BM25L ranker with optional heading/phrase boosts and a proximity bonus hook.
 */

export type RankOptions = {
  k1?: number;
  b?: number;
  headingBoost?: number;
  phraseBoost?: number;
  proximityBonus?: (cand: {
    tf: Map<number, number>;
    pos?: Map<number, number[]>;
    hasPhrase?: boolean;
    headingScore?: number;
  }) => number;
};

export function rankBM25L(
  candidates: Map<number, { tf: Map<number, number>; pos?: Map<number, number[]>; hasPhrase?: boolean; headingScore?: number }>,
  avgLen: number,
  docCount: number,
  dfs: Map<number, number>,
  blockTokenLens?: number[],
  opts: RankOptions = {}
): Array<{ blockId: number; score: number }> {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const headingBoost = opts.headingBoost ?? 0.3;
  const phraseBoost = opts.phraseBoost ?? 0.6;

  const results: Array<{ blockId: number; score: number }> = [];
  for (const [bid, data] of candidates) {
    const len = blockTokenLens?.[bid] ?? (Array.from(data.tf.values()).reduce((sum, tf) => sum + tf, 0) || 1);
    let score = 0;
    for (const [tid, tf] of data.tf) {
      const df = dfs.get(tid) ?? 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const numer = tf * (k1 + 1);
      const denom = tf + k1 * (1 - b + b * (len / avgLen));
      score += idf * (numer / denom);
    }
    if (opts.proximityBonus) score *= opts.proximityBonus(data) ?? 1;
    if (data.hasPhrase) score *= 1 + phraseBoost;
    if (data.headingScore) score *= 1 + headingBoost * data.headingScore;

    results.push({ blockId: bid, score });
  }
  results.sort((a, b2) => b2.score - a.score);
  return results;
}
