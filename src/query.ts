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
  namespace?: string | string[];
  source?: string | string[];
  queryExpansion?: {
    enabled?: boolean;
    docs?: number;
    terms?: number;
    weight?: number;
    minTermLength?: number;
  };
};

export type Hit = {
  blockId: number;
  score: number;
  text: string;
  source?: string;
  namespace?: string;
};

export function query(pack: Pack, q: string, opts: QueryOptions = {}): Hit[] {
  const topK = opts.topK ?? 10;
  const expansionOpts = {
    enabled: opts.queryExpansion?.enabled ?? true,
    docs: Math.max(1, opts.queryExpansion?.docs ?? 3),
    terms: Math.max(1, opts.queryExpansion?.terms ?? 4),
    weight: Math.max(0, opts.queryExpansion?.weight ?? 0.35),
    minTermLength: Math.max(2, opts.queryExpansion?.minTermLength ?? 3),
  };

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

  const namespaceFilter = normalizeNamespaceFilter(opts.namespace);
  const sourceFilter = normalizeSourceFilter(opts.source);

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
  function scanForTermIds(
    idWeights: Map<number, number>,
    cfg: { collectPositions?: boolean; createCandidates?: boolean } = { collectPositions: true, createCandidates: true }
  ) {
    const p = pack.postings;
    let i = 0;
    while (i < p.length) {
      const tid = p[i++];
      if (tid === 0) continue;
      const weight = idWeights.get(tid) ?? 0;
      const relevant = weight > 0;
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
          if (!entry && cfg.createCandidates !== false) {
            entry = { tf: new Map(), pos: new Map() };
            candidates.set(bid, entry);
          }
          if (entry) {
            const prevTf = entry.tf.get(tid) ?? 0;
            entry.tf.set(tid, prevTf + positions.length * weight);
            if (cfg.collectPositions !== false) {
              entry.pos.set(tid, positions);
            }
          }
        }
        encodedBid = p[i++];
      }
      if (relevant) dfs.set(tid, termDf);
    }
  }

  // 1) Scan using tokens from q (if any)
  if (termSet.size > 0) {
    scanForTermIds(new Map(Array.from(termSet.values(), (tid) => [tid, 1])));
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
      scanForTermIds(new Map(Array.from(phraseTokenIds.values(), (tid) => [tid, 1])));
    }
  }

  // --- Namespace filtering
  if (namespaceFilter.size > 0) {
    for (const bid of [...candidates.keys()]) {
      const ns = pack.namespaces?.[bid];
      const normalizedNs = typeof ns === "string" ? normalize(ns) : "";
      if (!normalizedNs || !namespaceFilter.has(normalizedNs)) {
        candidates.delete(bid);
      }
    }
  }

  // --- Source/docId filtering
  if (sourceFilter.size > 0) {
    for (const bid of [...candidates.keys()]) {
      const source = pack.docIds?.[bid];
      const normalizedSource = typeof source === "string" ? normalize(source) : "";
      if (!normalizedSource || !sourceFilter.has(normalizedSource)) {
        candidates.delete(bid);
      }
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

  let prelim = rankBM25L(candidates, avgLen, docCount, dfs, pack.blockTokenLens, {
    proximityBonus: (cand) => proximityMultiplier(minCoverSpan(cand.pos)),
  });

  if (expansionOpts.enabled && prelim.length > 0) {
    const expansionWeights = deriveExpansionTerms(pack, prelim, termSet, requiredPhrases, expansionOpts);
    if (expansionWeights.size > 0) {
      scanForTermIds(expansionWeights, { collectPositions: false, createCandidates: true });
      prelim = rankBM25L(candidates, avgLen, docCount, dfs, pack.blockTokenLens, {
        proximityBonus: (cand) => proximityMultiplier(minCoverSpan(cand.pos)),
      });
    }
  }

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
      namespace: pack.namespaces?.[r.blockId] ?? undefined,
    };
  });

  const finalHits = diversifyAndDedupe(pool, { k: topK });
  return finalHits;
}

function deriveExpansionTerms(
  pack: Pack,
  prelim: Array<{ blockId: number; score: number }>,
  baseTermSet: Set<number>,
  requiredPhrases: string[][],
  opts: { docs: number; terms: number; weight: number; minTermLength: number }
): Map<number, number> {
  if (prelim.length === 0 || opts.weight <= 0) return new Map();

  const forbidden = new Set(baseTermSet);
  for (const seq of requiredPhrases) {
    for (const term of seq) {
      const tid = pack.lexicon.get(term);
      if (tid !== undefined) forbidden.add(tid);
    }
  }

  const cap = Math.min(opts.docs, prelim.length);
  const bestScore = Math.max(prelim[0]?.score ?? 0, 1e-6);
  const termScores = new Map<number, number>();

  for (let i = 0; i < cap; i++) {
    const item = prelim[i];
    const text = pack.blocks[item.blockId] ?? "";
    const docWeight = Math.max(item.score / bestScore, 0.2);
    const localTfs = new Map<number, number>();

    for (const tok of tokenize(text)) {
      if (tok.term.length < opts.minTermLength) continue;
      const tid = pack.lexicon.get(tok.term);
      if (tid === undefined || forbidden.has(tid)) continue;
      localTfs.set(tid, (localTfs.get(tid) ?? 0) + 1);
    }

    for (const [tid, tf] of localTfs) {
      termScores.set(tid, (termScores.get(tid) ?? 0) + tf * docWeight);
    }
  }

  const selected = [...termScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.terms);

  return new Map(selected.map(([tid, score]) => [tid, opts.weight * Math.max(0.5, Math.min(1.5, score))]));
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


function normalizeNamespaceFilter(input?: string | string[]): Set<string> {
  if (input === undefined) return new Set();
  const values = Array.isArray(input) ? input : [input];
  return new Set(values.map((v) => normalize(v)).filter(Boolean));
}

function normalizeSourceFilter(input?: string | string[]): Set<string> {
  if (input === undefined) return new Set();
  const values = Array.isArray(input) ? input : [input];
  return new Set(values.map((v) => normalize(v)).filter(Boolean));
}
