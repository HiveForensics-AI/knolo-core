/*
 * rank.ts
 *
 * Implements a simple BM25L ranker with optional boosts for headings and
 * phrase matches. The inputs to the ranker are a map of block IDs to term
 * frequency maps and additional boolean flags. The outputs are sorted by
 * descending relevance score. This ranking algorithm can be replaced or
 * augmented in the future without impacting the public API of the query
 * function.
 */

export type RankOptions = {
  k1?: number;
  b?: number;
  headingBoost?: number;
  phraseBoost?: number;
};

/**
 * Rank a set of candidate blocks using BM25L. Each candidate carries a term
 * frequency (tf) map keyed by termId. Additional properties may include
 * `hasPhrase` and `headingScore` to apply multiplicative boosts. The average
 * document length (avgLen) is required for BM25L normalization.
 */
export function rankBM25L(
  candidates: Map<number, { tf: Map<number, number>; hasPhrase?: boolean; headingScore?: number }>,
  avgLen: number,
  opts: RankOptions = {}
): Array<{ blockId: number; score: number }> {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const headingBoost = opts.headingBoost ?? 0.3;
  const phraseBoost = opts.phraseBoost ?? 0.6;

  const results: Array<{ blockId: number; score: number }> = [];
  for (const [bid, data] of candidates) {
    const len = Array.from(data.tf.values()).reduce((sum, tf) => sum + tf, 0) || 1;
    let score = 0;
    for (const [, tf] of data.tf) {
      const idf = 1; // placeholder; no document frequency available in v0
      const numer = tf * (k1 + 1);
      const denom = tf + k1 * (1 - b + b * (len / avgLen));
      score += idf * (numer / denom);
    }
    // Apply boosts multiplicatively
    if (data.hasPhrase) {
      score *= 1 + phraseBoost;
    }
    if (data.headingScore) {
      score *= 1 + headingBoost * data.headingScore;
    }
    results.push({ blockId: bid, score });
  }
  results.sort((a, b2) => b2.score - a.score);
  return results;
}