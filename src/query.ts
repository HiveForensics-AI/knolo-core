/*
 * query.ts
 *
 * Deterministic, embedding-free retrieval with:
 *  - REQUIRED phrase enforcement (quoted and requirePhrases)
 *  - Proximity bonus based on min cover span
 *  - Optional heading overlap boost
 *  - KNS numeric-signature tie-breaker (tiny)
 *  - Near-duplicate suppression + MMR diversity
 */

import { tokenize, parsePhrases, normalize } from "./tokenize.js";
import { rankBM25L } from "./rank.js";
import type { Pack } from "./pack.js";
import { minCoverSpan, proximityMultiplier } from "./quality/proximity.js";
import { diversifyAndDedupe } from "./quality/diversify.js";
import { knsSignature, knsDistance } from "./quality/signature.js";

export type QueryOptions = {
  topK?: number;
  requirePhrases?: string[];
};

export type Hit = {
  blockId: number;
  score: number;
  text: string;
  source?: string;
};

export function query(pack: Pack, q: string, opts: QueryOptions = {}): Hit[] {
  const topK = opts.topK ?? 10;

  // --- Query parsing
  const normTokens = tokenize(q).map((t) => t.term);

  // Normalize quoted phrases from q
  const quotedRaw = parsePhrases(q);
  const quoted = quotedRaw.map((seq) => seq.map((t) => normalize(t)).flatMap((s) => s.split(/\s+/)).filter(Boolean));

  // Normalize requirePhrases the same way
  const extraReq = (opts.requirePhrases ?? [])
    .map((s) => tokenize(s).map((t) => t.term))
    .filter((arr) => arr.length > 0);

  const requiredPhrases: string[][] = [...quoted, ...extraReq];

  // --- Term ids for the free (unquoted) tokens in q
  const termIds = normTokens
    .map((t) => pack.lexicon.get(t))
    .filter((id): id is number => id !== undefined);

  // If there are no free tokens but there ARE required phrases, we'll fill candidates from phrases later.
  const termSet = new Set(termIds);

  // --- Candidate map
  const candidates = new Map<
    number,
    { tf: Map<number, number>; pos: Map<number, number[]>; hasPhrase?: boolean; headingScore?: number }
  >();

  // Query-time document frequency collection for BM25 IDF.
  const dfs = new Map<number, number>();

  const usesOffsetBlockIds = (pack.meta?.version ?? 1) >= 3;

  // Helper to harvest postings for a given set of termIds into candidates
  function scanForTermIds(idSet: Set<number>) {
    const p = pack.postings;
    let i = 0;
    while (i < p.length) {
      const tid = p[i++];
      if (tid === 0) continue;
      const relevant = idSet.has(tid);
      let termDf = 0;
      let encodedBid = p[i++];
      while (encodedBid !== 0) {
        const bid = usesOffsetBlockIds ? encodedBid - 1 : encodedBid;
        let pos = p[i++];
        const positions: number[] = [];
        while (pos !== 0) {
          positions.push(pos);
          pos = p[i++];
        }
        termDf++;
        if (relevant && bid >= 0) {
          let entry = candidates.get(bid);
          if (!entry) {
            entry = { tf: new Map(), pos: new Map() };
            candidates.set(bid, entry);
          }
          entry.tf.set(tid, positions.length);
          entry.pos.set(tid, positions);
        }
        encodedBid = p[i++];
      }
      if (relevant) dfs.set(tid, termDf);
    }
  }

  // 1) Scan using tokens from q (if any)
  if (termSet.size > 0) {
    scanForTermIds(termSet);
  }

  // 2) Phrase-first rescue:
  // If nothing matched the free tokens, but we do have required phrases,
  // build a fallback term set from ALL tokens that appear in those phrases and scan again.
  if (candidates.size === 0 && requiredPhrases.length > 0) {
    const phraseTokenIds = new Set<number>();
    for (const seq of requiredPhrases) {
      for (const t of seq) {
        const id = pack.lexicon.get(t);
        if (id !== undefined) phraseTokenIds.add(id);
      }
    }
    if (phraseTokenIds.size > 0) {
      scanForTermIds(phraseTokenIds);
    }
  }

  // --- Phrase enforcement (now that we have some candidates)
  if (requiredPhrases.length > 0) {
    for (const [bid, data] of [...candidates]) {
      const text = pack.blocks[bid] || "";
      const ok = requiredPhrases.every((seq) => containsPhrase(text, seq));
      if (!ok) candidates.delete(bid);
      else data.hasPhrase = true;
    }
  } else if (quoted.length > 0) {
    for (const [bid, data] of candidates) {
      const text = pack.blocks[bid] || "";
      data.hasPhrase = quoted.some((seq) => containsPhrase(text, seq));
    }
  }

  // If still nothing, bail early
  if (candidates.size === 0) return [];

  // --- Heading overlap
  if (pack.headings?.length) {
    const qset = new Set(normTokens);
    const qUniqueCount = new Set(normTokens).size || 1;
    for (const [bid, data] of candidates) {
      const h = pack.headings[bid] ?? "";
      const hTerms = tokenize(h || "").map((t) => t.term);
      const overlap = new Set(hTerms.filter((t) => qset.has(t))).size;
      data.headingScore = overlap / qUniqueCount;
    }
  }

  // --- Rank with proximity bonus
  const avgLen =
    pack.meta?.stats?.avgBlockLen ??
    (pack.blocks.length
      ? pack.blocks.reduce((s, b) => s + tokenize(b).length, 0) / pack.blocks.length
      : 1);

  const docCount = pack.meta?.stats?.blocks ?? pack.blocks.length;

  const prelim = rankBM25L(candidates, avgLen, docCount, dfs, pack.blockTokenLens, {
    proximityBonus: (cand) => proximityMultiplier(minCoverSpan(cand.pos)),
  });

  if (prelim.length === 0) return [];

  // --- KNS tie-breaker + de-dup/MMR
  const qSig = knsSignature(normalize(q));
  const pool = prelim.slice(0, topK * 5).map((r) => {
    const text = pack.blocks[r.blockId] || "";
    const boost = 1 + 0.02 * (1 - knsDistance(qSig, knsSignature(text)));
    return {
      blockId: r.blockId,
      score: r.score * boost,
      text,
      source: pack.docIds?.[r.blockId] ?? undefined,
    };
  });

  const finalHits = diversifyAndDedupe(pool, { k: topK });
  return finalHits;
}

/** Ordered phrase check using the SAME tokenizer/normalizer path as the index. */
function containsPhrase(text: string, seq: string[]): boolean {
  if (seq.length === 0) return false;
  const seqNorm = tokenize(seq.join(" ")).map((t) => t.term);
  const toks = tokenize(text).map((t) => t.term);
  outer: for (let i = 0; i <= toks.length - seqNorm.length; i++) {
    for (let j = 0; j < seqNorm.length; j++) {
      if (toks[i + j] !== seqNorm[j]) continue outer;
    }
    return true;
  }
  return false;
}
