import { bitCount, coverageOfIds, minimumFeasibleSize, selectGreedy, selectOracle } from './selector.mjs';

export const BUDGETS = [2, 3, 4, 5, 8, 10];
export const DEPTHS = [10, 20, 50, 100];

const EPS = 1e-9;

export function prepareCorpus(instance, tokenize, factMask) {
  return instance.passages.map((passage, blockId) => ({
    ...passage,
    blockId,
    authority: passage.authority ?? 0,
    tokens: new Set(tokenize(passage.text).map((token) => token.term)),
    mask: factMask(passage, instance),
  }));
}

export function alignRanking(items, ranked, docIds) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const scored = ranked.map((hit) => {
    const id = docIds[hit.blockId];
    const item = byId.get(id);
    if (!item) throw new Error(`Ranked block ${hit.blockId} has doc id ${String(id)} with no fixture passage`);
    return { ...item, score: hit.score, blockId: hit.blockId };
  });
  const seen = new Set(scored.map((item) => item.id));
  const rest = items
    .filter((item) => !seen.has(item.id))
    .map((item) => ({ ...item, score: 0 }))
    .sort((a, b) => a.blockId - b.blockId);
  return { scored, ceiling: scored.concat(rest) };
}

function limitsFor(instance, K, override = {}) {
  return {
    K,
    tau: override.tau ?? instance.tau ?? 1,
    gamma: override.gamma ?? instance.gamma ?? 1,
    qTau: override.qTau ?? instance.qTau ?? 1,
  };
}

function isDual(sc, oc, qc, instance, limits) {
  if (instance.required.support.length > 0 && !(sc >= limits.tau - EPS)) return 0;
  if (instance.required.opposition.length > 0 && !(oc >= limits.gamma - EPS)) return 0;
  if (instance.required.qualifiers.length > 0 && !(qc >= limits.qTau - EPS)) return 0;
  return 1;
}

function zeroCoverage(instance) {
  return {
    sc: instance.required.support.length ? 0 : null,
    oc: instance.required.opposition.length ? 0 : null,
    qc: instance.required.qualifiers.length ? 0 : null,
  };
}

export function metricCell(selection, pool, instance, limits, mode) {
  const ids = selection.ids ?? [];
  const zeros = zeroCoverage(instance);
  let sc = zeros.sc;
  let oc = zeros.oc;
  let qc = zeros.qc;
  let redundancy = 0;
  let sources = 0;
  let authority = 0;
  if (ids.length > 0) {
    const scored = coverageOfIds(ids, pool, instance);
    sc = scored.sc;
    oc = scored.oc;
    qc = scored.qc;
    redundancy = scored.redundancy;
    sources = scored.sources;
    authority = scored.authority;
  }
  const dual = isDual(sc ?? 1, oc ?? 1, qc ?? 1, instance, limits);
  const abstained = mode === 'kar' ? selection.status !== 'SATISFIED' : ids.length === 0;
  const claimsSufficient = !abstained;
  const feasible = minimumFeasibleSize(pool, instance, limits) !== null;
  const selected = ids.map((id) => pool.find((item) => item.id === id));
  const unrequested = selected.filter((item) => {
    if (!item) return false;
    if (item.relation === 'irrelevant') return true;
    if (instance.required.opposition.length === 0 && item.relation === 'contradict') return true;
    if (instance.required.qualifiers.length === 0 && item.relation === 'qualify') return true;
    return false;
  }).length;
  return {
    status: selection.status ?? (ids.length ? 'RETURNED' : 'EMPTY'),
    ids,
    size: ids.length,
    sc,
    oc,
    qc,
    dual,
    redundancy,
    sources,
    authority,
    claimsSufficient,
    falseSufficient: claimsSufficient && dual === 0,
    falseAbsence: abstained && feasible,
    unrequested,
    independent: selected.some((item) => item?.sourceId === 'regulator-memo'),
  };
}

function topByScore(pool, K) {
  return pool
    .slice()
    .sort((a, b) => b.score - a.score || a.blockId - b.blockId)
    .slice(0, K)
    .map((item) => item.id);
}

function mmrIds(pool, K, diversifyAndDedupe) {
  const hits = pool.map((item) => ({
    blockId: item.blockId,
    score: item.score,
    text: item.text,
    source: item.sourceId,
  }));
  return diversifyAndDedupe(hits, { k: K }).map((hit) => {
    const item = pool.find((entry) => entry.blockId === hit.blockId);
    if (!item) throw new Error(`MMR returned unknown block ${hit.blockId}`);
    return item.id;
  });
}

function kar(kind, pool, instance, limits) {
  const selected = kind === 'oracle' ? selectOracle(pool, instance, limits) : selectGreedy(pool, instance, limits);
  return metricCell(selected, pool, instance, limits, 'kar');
}

function baseline(ids, pool, instance, limits) {
  return metricCell({ ids, status: ids.length ? 'RETURNED' : 'EMPTY' }, pool, instance, limits, 'baseline');
}

export function unionByScore(pools) {
  const map = new Map();
  for (const pool of pools) {
    for (const item of pool) {
      const existing = map.get(item.id);
      if (!existing || item.score > existing.score || (item.score === existing.score && item.blockId < existing.blockId)) {
        map.set(item.id, item);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score || a.blockId - b.blockId);
}

export function poolRecall(pool, instance) {
  if (pool.length === 0) {
    const zeros = zeroCoverage(instance);
    return { support: zeros.sc, opposition: zeros.oc, qualifier: zeros.qc };
  }
  const covered = coverageOfIds(pool.map((item) => item.id), pool, instance);
  return { support: covered.sc, opposition: covered.oc, qualifier: covered.qc };
}

export function oppositionRanks(scored, instance) {
  const count = instance.required.opposition.length;
  if (count === 0) return { first: null, full: null };
  let mask = 0;
  let first = null;
  let full = null;
  for (let index = 0; index < scored.length; index += 1) {
    if (scored[index].mask.o !== 0 && first === null) first = index + 1;
    mask |= scored[index].mask.o;
    if (full === null && bitCount(mask) === count) full = index + 1;
  }
  return { first, full };
}

export function ndcgAtK(idsInRankOrder, pool, K) {
  const gainOf = new Map(pool.map((item) => [item.id, bitCount(item.mask.s) + bitCount(item.mask.o) + bitCount(item.mask.q)]));
  const gains = [...gainOf.values()].sort((a, b) => b - a).slice(0, K);
  const ideal = dcg(gains);
  if (ideal === 0) return null;
  const actual = dcg(idsInRankOrder.slice(0, K).map((id) => gainOf.get(id) ?? 0));
  return actual / ideal;
}

function dcg(gains) {
  let sum = 0;
  for (let index = 0; index < gains.length; index += 1) sum += gains[index] / Math.log2(index + 2);
  return sum;
}

export function evaluatePrepared(instance, scored, ceiling, counterScored, qualifierScored, productionHitsByK, diversifyAndDedupe) {
  const byK = {};
  for (const K of BUDGETS) {
    const limits = limitsFor(instance, K);
    const production = productionHitsByK.get(K) ?? [];
    const productionIds = production.map((hit) => {
      const item = ceiling.find((entry) => entry.blockId === hit.blockId);
      if (!item) throw new Error(`Production hit ${hit.blockId} missing from ceiling on ${instance.id}`);
      return item.id;
    });
    byK[K] = {
      B0: baseline(topByScore(scored, K), scored, instance, limits),
      B1: baseline(productionIds, ceiling, instance, limits),
      B1pool: K === 5 ? baseline(mmrIds(ceiling, K, diversifyAndDedupe), ceiling, instance, limits) : null,
      ORACLE: kar('oracle', ceiling, instance, limits),
      GREEDY: kar('greedy', ceiling, instance, limits),
    };
    byK[K].B0.ndcg = ndcgAtK(byK[K].B0.ids, ceiling, K);
    byK[K].ORACLE.ndcg = ndcgAtK(byK[K].ORACLE.ids, ceiling, K);
  }

  const lexical = {};
  const dual = {};
  for (const depth of DEPTHS) {
    const queryPool = scored.slice(0, depth);
    const united = unionByScore([queryPool, counterScored.slice(0, depth)]);
    lexical[depth] = {};
    dual[depth] = {};
    for (const K of BUDGETS) {
      const limits = limitsFor(instance, K);
      lexical[depth][K] = {
        ORACLE: kar('oracle', queryPool, instance, limits),
        GREEDY: kar('greedy', queryPool, instance, limits),
      };
      dual[depth][K] = {
        ORACLE: kar('oracle', united, instance, limits),
        GREEDY: kar('greedy', united, instance, limits),
        TOPK: baseline(topByScore(united, K), united, instance, limits),
      };
    }
  }

  const probePool = unionByScore([scored.slice(0, 50), counterScored.slice(0, 50), qualifierScored.slice(0, 50)]);
  const qualifierProbe = {};
  for (const K of BUDGETS) qualifierProbe[K] = kar('oracle', probePool, instance, limitsFor(instance, K));

  const candidateRecall = {};
  const counterRecall = {};
  for (const depth of DEPTHS) {
    candidateRecall[depth] = poolRecall(scored.slice(0, depth), instance);
    counterRecall[depth] = poolRecall(unionByScore([scored.slice(0, depth), counterScored.slice(0, depth)]), instance);
  }

  return {
    byK,
    lexical,
    dual,
    qualifierProbe,
    candidateRecall,
    counterRecall,
    ranks: oppositionRanks(scored, instance),
    counterRanks: oppositionRanks(unionByScore([scored, counterScored]), instance),
    corpusSize: instance.passages.length,
    scoredCount: scored.length,
  };
}

export function sensitivityOracle(ceiling, instance, K, tau, gamma) {
  const limits = { K, tau, gamma, qTau: gamma };
  return kar('oracle', ceiling, instance, limits);
}
