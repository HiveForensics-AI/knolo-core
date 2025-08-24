/*
 * query.ts
 *
 * Implements the main query function that ties together tokenization, lexical
 * lookup in the pack's lexicon, scanning the postings list to generate
 * candidates, and ranking them using the BM25L ranker. Phrase detection
 * operates on the block text itself and is naive but effective for short
 * queries. Future versions may incorporate more advanced mechanisms.
 */

import { tokenize, parsePhrases } from "./tokenize.js";
import { rankBM25L } from "./rank.js";
import type { Pack } from './pack';

export type QueryOptions = {
  topK?: number;
  /** Additional phrases (unquoted) that must be present in results. */
  requirePhrases?: string[];
};

export type Hit = {
  blockId: number;
  score: number;
  text: string;
  source?: string;
};

/** Execute a search against a mounted pack. The query string can contain
 * quoted phrases; unquoted terms are treated individually. The `topK`
 * parameter controls how many results are returned. If `requirePhrases`
 * contains strings, those phrases must appear verbatim in candidate blocks.
 */
export function query(pack: Pack, q: string, opts: QueryOptions = {}): Hit[] {
  const topK = opts.topK ?? 10;
  const normTokens = tokenize(q).map((t) => t.term);
  const phraseTerms = parsePhrases(q);
  // Include explicitly provided phrases
  if (opts.requirePhrases) {
    for (const p of opts.requirePhrases) {
      const terms = p.split(/\s+/).filter(Boolean);
      if (terms.length > 0) phraseTerms.push(terms);
    }
  }

  // Translate tokens to term IDs. Terms not in the lexicon are skipped.
  const termIds = normTokens
    .map((t) => pack.lexicon.get(t))
    .filter((id): id is number => id !== undefined);

  // Map from blockId to candidate data (term frequencies, flags)
  const candidates = new Map<
    number,
    { tf: Map<number, number>; hasPhrase?: boolean; headingScore?: number }
  >();

  // Scan postings list. The format is [termId, blockId, pos... 0, blockId, pos... 0, 0, termId, ...]
  const p = pack.postings;
  let i = 0;
  while (i < p.length) {
    const tid = p[i++];
    if (tid === 0) continue;
    const relevant = termIds.includes(tid);
    let bid = p[i++];
    while (bid !== 0) {
      let pos = p[i++];
      const positions: number[] = [];
      while (pos !== 0) {
        positions.push(pos);
        pos = p[i++];
      }
      if (relevant) {
        let entry = candidates.get(bid);
        if (!entry) {
          entry = { tf: new Map() };
          candidates.set(bid, entry);
        }
        // accumulate tf per termId; positions array length is tf
        entry.tf.set(tid, positions.length);
      }
      bid = p[i++];
    }
    // end of term section; skip trailing zero already consumed
  }

  // Check phrases on candidate texts. If a candidate does not contain all
  // required phrases, it will be filtered out in ranking.
  for (const [bid, data] of candidates) {
    const text = pack.blocks[bid] || '';
    data.hasPhrase = phraseTerms.some((seq) => containsPhrase(text, seq));
  }

  // Compute average block length for ranking normalization
  const avgLen = pack.blocks.length
    ? pack.blocks.reduce((sum, b) => sum + tokenize(b).length, 0) / pack.blocks.length
    : 1;

  const ranked = rankBM25L(candidates, avgLen);
  return ranked.slice(0, topK).map((res) => ({
    blockId: res.blockId,
    score: res.score,
    text: pack.blocks[res.blockId] || '',
  }));
}

/** Determine whether the given sequence of terms appears in order within the
 * text. The algorithm tokenizes the text and performs a sliding window
 * comparison. This is case‑insensitive and uses the same normalization as
 * other parts of the system.
 */
function containsPhrase(text: string, seq: string[]): boolean {
  if (seq.length === 0) return false;
  const toks = tokenize(text).map((t) => t.term);
  outer: for (let i = 0; i <= toks.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (toks[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}