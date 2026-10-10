/**
 * Experiment-only mirror of the current lexical candidate walk in
 * packages/core/src/query.ts. It calls the same ranker, postings reader,
 * proximity, expansion, and MMR functions. It exists so the benchmark can
 * see the pre-MMR ranking, which query() does not return.
 */

export function createRanker(api) {
  const {
    tokenize,
    parsePhrases,
    normalize,
    rankBM25L,
    minCoverSpan,
    proximityMultiplier,
    diversifyAndDedupe,
    applyHardConstraints,
    createLegacyLexicalPostingsReader,
    createVqfLexicalPostingsReader,
    expandQueryWithGraph,
    query,
  } = api;

  function normalizeFilter(input) {
    if (input === undefined) return new Set();
    const values = Array.isArray(input) ? input : [input];
    return new Set(values.map((value) => normalize(value)).filter(Boolean));
  }

  function containsPhrase(text, seq) {
    if (seq.length === 0) return false;
    const seqNorm = tokenize(seq.join(' ')).map((token) => token.term);
    const tokens = tokenize(text).map((token) => token.term);
    outer: for (let i = 0; i <= tokens.length - seqNorm.length; i += 1) {
      for (let j = 0; j < seqNorm.length; j += 1) {
        if (tokens[i + j] !== seqNorm[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  function deriveExpansionTerms(pack, prelim, baseTermSet, requiredPhrases, opts) {
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
    const termScores = new Map();
    for (let i = 0; i < cap; i += 1) {
      const hit = prelim[i];
      const text = pack.blocks[hit.blockId] ?? '';
      const docWeight = Math.max(hit.score / bestScore, 0.2);
      const localTfs = new Map();
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
    const selected = [...termScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.terms);
    return new Map(selected.map(([tid, score]) => [tid, opts.weight * Math.max(0.5, Math.min(1.5, score))]));
  }

  function rankLexical(pack, q, opts = {}) {
    const expansionOpts = {
      enabled: opts.queryExpansion?.enabled ?? true,
      docs: Math.max(1, opts.queryExpansion?.docs ?? 3),
      terms: Math.max(1, opts.queryExpansion?.terms ?? 4),
      weight: Math.max(0, opts.queryExpansion?.weight ?? 0.35),
      minTermLength: Math.max(2, opts.queryExpansion?.minTermLength ?? 3),
    };
    const graphQuery =
      opts.graph?.expand === true
        ? expandQueryWithGraph(pack, q, {
            maxExtraTerms: opts.graph?.maxExtraTerms,
            predicates: opts.graph?.predicates,
          })
        : q;
    const normTokens = tokenize(graphQuery).map((token) => token.term);
    const quoted = parsePhrases(q).map((seq) =>
      seq
        .map((token) => normalize(token))
        .flatMap((part) => part.split(/\s+/))
        .filter(Boolean),
    );
    const extraReq = (opts.requirePhrases ?? [])
      .map((phrase) => tokenize(phrase).map((token) => token.term))
      .filter((arr) => arr.length > 0);
    const requiredPhrases = [...quoted, ...extraReq];
    const namespaceFilter = normalizeFilter(opts.namespace);
    const sourceFilter = normalizeFilter(opts.source);
    const termIds = normTokens.map((token) => pack.lexicon.get(token)).filter((id) => id !== undefined);
    const termSet = new Set(termIds);
    const candidates = new Map();
    const dfs = new Map();
    const postings = pack.vqfLexicalIndex
      ? createVqfLexicalPostingsReader(pack.vqfLexicalIndex)
      : createLegacyLexicalPostingsReader(pack.postings, {
          offsetBlockIds: (pack.meta?.version ?? 1) >= 3,
        });

    function scanForTermIds(idWeights, cfg = { collectPositions: true, createCandidates: true }) {
      const requested = [];
      for (const [tid, weight] of idWeights) {
        if (weight > 0 && postings.hasTerm(tid)) requested.push([tid, weight]);
      }
      requested.sort((a, b) => postings.termOrder(a[0]) - postings.termOrder(b[0]));
      const collectPositions = cfg.collectPositions !== false;
      const createCandidates = cfg.createCandidates !== false;
      for (const [tid, weight] of requested) {
        dfs.set(tid, postings.documentFrequency(tid));
        for (const posting of postings.read(tid, { positions: collectPositions })) {
          const bid = posting.blockId;
          if (bid < 0) continue;
          let entry = candidates.get(bid);
          if (!entry && createCandidates) {
            entry = { tf: new Map(), pos: new Map() };
            candidates.set(bid, entry);
          }
          if (!entry) continue;
          const prevTf = entry.tf.get(tid) ?? 0;
          entry.tf.set(tid, prevTf + posting.termFrequency * weight);
          if (collectPositions) entry.pos.set(tid, posting.positions);
        }
      }
    }

    if (termSet.size > 0) scanForTermIds(new Map([...termSet].map((tid) => [tid, 1])));

    if (pack.chunks) {
      for (const chunk of pack.chunks) {
        const fieldTokens = tokenize(chunk.fieldedText ?? chunk.text).map((token) => token.term);
        const matched = normTokens.filter((token) => fieldTokens.includes(token));
        if (matched.length === 0) continue;
        const entry = candidates.get(chunk.id) ?? { tf: new Map(), pos: new Map() };
        entry.fieldScore = new Set(matched).size / Math.max(1, new Set(normTokens).size);
        for (const token of new Set(matched)) {
          const tid = pack.lexicon.get(token);
          if (tid === undefined) continue;
          const positions = fieldTokens.flatMap((value, position) => (value === token ? [position] : []));
          if (!entry.tf.has(tid)) entry.tf.set(tid, Math.max(1, positions.length));
          if (!entry.pos.has(tid)) entry.pos.set(tid, positions);
        }
        candidates.set(chunk.id, entry);
      }
      applyHardConstraints(pack, candidates, {
        namespace: namespaceFilter,
        source: sourceFilter,
        requiredPhrases,
      });
    }

    if (candidates.size === 0 && requiredPhrases.length > 0) {
      const phraseTokenIds = new Set();
      for (const seq of requiredPhrases) {
        for (const token of seq) {
          const id = pack.lexicon.get(token);
          if (id !== undefined) phraseTokenIds.add(id);
        }
      }
      if (phraseTokenIds.size > 0) scanForTermIds(new Map([...phraseTokenIds].map((tid) => [tid, 1])));
    }

    applyHardConstraints(pack, candidates, {
      namespace: namespaceFilter,
      source: sourceFilter,
      requiredPhrases,
    });
    if (requiredPhrases.length === 0 && quoted.length > 0) {
      for (const [bid, data] of candidates) {
        const text = pack.blocks[bid] || '';
        data.hasPhrase = quoted.some((seq) => containsPhrase(text, seq));
      }
    }
    if (candidates.size === 0) return { ranked: [], expansionTerms: 0 };

    if (pack.headings?.length) {
      const qset = new Set(normTokens);
      const qUniqueCount = new Set(normTokens).size || 1;
      for (const [bid, data] of candidates) {
        const heading = pack.headings[bid] ?? '';
        const headingTerms = tokenize(heading || '').map((token) => token.term);
        const overlap = new Set(headingTerms.filter((token) => qset.has(token))).size;
        data.headingScore = overlap / qUniqueCount;
      }
    }

    const avgLen =
      pack.meta?.stats?.avgBlockLen ??
      (pack.blocks.length ? pack.blocks.reduce((sum, block) => sum + tokenize(block).length, 0) / pack.blocks.length : 1);
    const docCount = pack.meta?.stats?.blocks ?? pack.blocks.length;
    const proximity = {
      proximityBonus: (cand) => proximityMultiplier(minCoverSpan(cand.pos)),
    };
    let prelim = rankBM25L(candidates, avgLen, docCount, dfs, pack.blockTokenLens, proximity);
    let expansionTerms = 0;
    if (expansionOpts.enabled && prelim.length > 0) {
      const expansionWeights = deriveExpansionTerms(pack, prelim, termSet, requiredPhrases, expansionOpts);
      expansionTerms = expansionWeights.size;
      if (expansionWeights.size > 0) {
        scanForTermIds(expansionWeights, { collectPositions: false, createCandidates: true });
        applyHardConstraints(pack, candidates, {
          namespace: namespaceFilter,
          source: sourceFilter,
          requiredPhrases,
        });
        prelim = rankBM25L(candidates, avgLen, docCount, dfs, pack.blockTokenLens, proximity);
      }
    }
    return { ranked: prelim, expansionTerms };
  }

  function mmrSelect(pack, ranked, topK) {
    const pool = ranked.slice(0, topK * 5).map((hit) => ({
      blockId: hit.blockId,
      score: hit.score,
      text: pack.blocks[hit.blockId] || '',
      source: pack.docIds?.[hit.blockId] ?? undefined,
    }));
    return diversifyAndDedupe(pool, { k: topK });
  }

  function productionHits(pack, q, topK) {
    return query(pack, q, {
      topK,
      queryExpansion: { enabled: true, docs: 3, terms: 4, weight: 0.35, minTermLength: 3 },
      graph: { expand: false },
      semantic: { enabled: false },
    });
  }

  return { rankLexical, mmrSelect, productionHits, tokenize, diversifyAndDedupe };
}
