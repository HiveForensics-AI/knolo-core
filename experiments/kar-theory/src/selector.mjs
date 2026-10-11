/**
 * Experiment-only KAR set selectors.
 *
 * KAR-ORACLE is an exact lexicographic set selector over ground-truth
 * fixture labels. KAR-GREEDY is a deterministic marginal-gain approximation.
 * Neither is a production ranker. There is no multiplicative score.
 */

export const ORACLE_VERSION = 'KAR-ORACLE-exp1';
export const GREEDY_VERSION = 'KAR-GREEDY-exp1';

const EPS = 1e-9;

export function bitCount(n) {
  let c = 0;
  let x = n >>> 0;
  while (x) {
    x &= x - 1;
    c += 1;
  }
  return c;
}

export function maskOf(facts, required) {
  let mask = 0;
  if (!facts || required.length === 0) return 0;
  for (const fact of facts) {
    const index = required.indexOf(fact);
    if (index >= 0) mask |= 1 << index;
  }
  return mask;
}

export function isApplicable(passage, instance) {
  if (passage.unauthorized) return false;
  if (instance.minAuthority != null && (passage.authority ?? 0) < instance.minAuthority) return false;
  if (passage.validFrom && instance.asOf < passage.validFrom) return false;
  if (passage.validTo && instance.asOf >= passage.validTo) return false;
  return true;
}

export function factMask(passage, instance) {
  const applicable = isApplicable(passage, instance);
  if (!applicable) return { s: 0, o: 0, q: 0, applicable: false };
  const support = passage.relation === 'support' ? maskOf(passage.facts, instance.required.support) : 0;
  const opposition = passage.relation === 'contradict' ? maskOf(passage.facts, instance.required.opposition) : 0;
  const qualifier = passage.relation === 'qualify' ? maskOf(passage.facts, instance.required.qualifiers) : 0;
  return { s: support, o: opposition, q: qualifier, applicable: true };
}

export function tokenJaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Mean pairwise token-set Jaccard. A set of size 0 or 1 has redundancy 0. */
export function redundancy(items) {
  if (items.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      sum += tokenJaccard(items[i].tokens, items[j].tokens);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

function coverageRatio(mask, count) {
  if (count === 0) return 1;
  return bitCount(mask) / count;
}

function meetsThresholds(sc, oc, qc, instance, tau, gamma, qTau) {
  if (instance.required.support.length > 0 && sc < tau - EPS) return false;
  if (instance.required.opposition.length > 0 && oc < gamma - EPS) return false;
  if (instance.required.qualifiers.length > 0 && qc < qTau - EPS) return false;
  return true;
}

function publicCoverage(ratio, count) {
  return count === 0 ? null : ratio;
}

function emptyResult(instance) {
  return {
    status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS',
    ids: [],
    size: 0,
    sc: publicCoverage(0, instance.required.support.length),
    oc: publicCoverage(0, instance.required.opposition.length),
    qc: publicCoverage(0, instance.required.qualifiers.length),
    redundancy: 0,
    ineligible: 0,
    authority: 0,
    sources: 0,
    idKey: '',
  };
}

/**
 * Lexicographic comparison. Higher coverage wins before smaller size.
 * Returns a positive number when `a` is better than `b`.
 */
function compareSolutions(a, b) {
  const numeric = [
    [a._oc, b._oc],
    [a._sc, b._sc],
    [a._qc, b._qc],
    [-a.ineligible, -b.ineligible],
    [-a.size, -b.size],
    [-a.redundancy, -b.redundancy],
    [a.authority, b.authority],
  ];
  for (const [left, right] of numeric) {
    if (left > right + EPS) return 1;
    if (left < right - EPS) return -1;
  }
  if (a.idKey < b.idKey) return 1;
  if (a.idKey > b.idKey) return -1;
  return 0;
}

function unionMasks(items) {
  let s = 0;
  let o = 0;
  let q = 0;
  let ineligible = 0;
  let authority = 0;
  for (const item of items) {
    s |= item.mask.s;
    o |= item.mask.o;
    q |= item.mask.q;
    if (!item.mask.applicable) ineligible += 1;
    authority += item.authority ?? 0;
  }
  return { s, o, q, ineligible, authority };
}

function solutionFrom(items, instance) {
  const counts = frontierCounts(instance);
  const union = unionMasks(items);
  const sc = coverageRatio(union.s, counts.nS);
  const oc = coverageRatio(union.o, counts.nO);
  const qc = coverageRatio(union.q, counts.nQ);
  const ids = items.map((item) => item.id).sort();
  return {
    status: 'SATISFIED',
    ids,
    size: items.length,
    sc: publicCoverage(sc, counts.nS),
    oc: publicCoverage(oc, counts.nO),
    qc: publicCoverage(qc, counts.nQ),
    _sc: sc,
    _oc: oc,
    _qc: qc,
    redundancy: redundancy(items),
    ineligible: union.ineligible,
    authority: union.authority,
    sources: new Set(items.map((item) => item.sourceId)).size,
    idKey: ids.join('\n'),
  };
}

function frontierCounts(instance) {
  return {
    nS: instance.required.support.length,
    nO: instance.required.opposition.length,
    nQ: instance.required.qualifiers.length,
  };
}

function groupsOf(items) {
  const groups = new Map();
  for (const item of items) {
    if ((item.mask.s | item.mask.o | item.mask.q) === 0) continue;
    const key = `${item.mask.s}:${item.mask.o}:${item.mask.q}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const list = [...groups.values()].map((group) => group.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  list.sort((a, b) => (a[0].id < b[0].id ? -1 : a[0].id > b[0].id ? 1 : 0));
  return list;
}

/**
 * Exact feasibility check independent of the lexicographic walk.
 * Minimum size to reach each fact-mask, using at most one document per mask.
 * Two documents with the same mask cannot both belong to a minimum cover.
 */
export function minimumFeasibleSize(items, instance, limits) {
  const tau = limits.tau ?? 1;
  const gamma = limits.gamma ?? 1;
  const qTau = limits.qTau ?? 1;
  const K = limits.K;
  const counts = frontierCounts(instance);
  const groups = groupsOf(items);
  let best = new Map([['0:0:0', 0]]);
  for (const group of groups) {
    const mask = group[0].mask;
    const snapshot = [...best.entries()];
    for (const [key, size] of snapshot) {
      if (size + 1 > K) continue;
      const [s, o, q] = key.split(':').map(Number);
      const nextKey = `${s | mask.s}:${o | mask.o}:${q | mask.q}`;
      const nextSize = size + 1;
      const previous = best.get(nextKey);
      if (previous === undefined || nextSize < previous) best.set(nextKey, nextSize);
    }
  }
  let min = null;
  for (const [key, size] of best) {
    const [s, o, q] = key.split(':').map(Number);
    const sc = coverageRatio(s, counts.nS);
    const oc = coverageRatio(o, counts.nO);
    const qc = coverageRatio(q, counts.nQ);
    if (!meetsThresholds(sc, oc, qc, instance, tau, gamma, qTau)) continue;
    if (min === null || size < min) min = size;
  }
  return min;
}

/**
 * KAR-ORACLE. Among sets of size <= K that meet the coverage floors, prefer
 * higher opposition, support, and qualifier coverage, then fewer inapplicable
 * documents, then smaller size, then lower token-Jaccard redundancy, then
 * higher total authority, then the lexicographically smaller sorted id list.
 */
export function selectOracle(items, instance, limits) {
  const tau = limits.tau ?? 1;
  const gamma = limits.gamma ?? 1;
  const qTau = limits.qTau ?? 1;
  const K = limits.K;
  const counts = frontierCounts(instance);
  const groups = groupsOf(items);
  let best = null;
  let visits = 0;
  const visitCap = limits.visitCap ?? 2_000_000;

  function consider(chosen) {
    if (chosen.length > K) return;
    const union = unionMasks(chosen);
    const sc = coverageRatio(union.s, counts.nS);
    const oc = coverageRatio(union.o, counts.nO);
    const qc = coverageRatio(union.q, counts.nQ);
    if (!meetsThresholds(sc, oc, qc, instance, tau, gamma, qTau)) return;
    const candidate = solutionFrom(chosen, instance);
    if (!best || compareSolutions(candidate, best) > 0) best = candidate;
  }

  function optimisticCanBeat(groupIndex, chosen) {
    if (!best) return true;
    const union = unionMasks(chosen);
    let { s, o, q } = union;
    let authority = union.authority;
    for (let index = groupIndex; index < groups.length; index += 1) {
      const sample = groups[index][0].mask;
      s |= sample.s;
      o |= sample.o;
      q |= sample.q;
      let maxAuthority = 0;
      for (const item of groups[index]) maxAuthority = Math.max(maxAuthority, item.authority ?? 0);
      authority += maxAuthority;
    }
    const optimistic = {
      _sc: coverageRatio(s, counts.nS),
      _oc: coverageRatio(o, counts.nO),
      _qc: coverageRatio(q, counts.nQ),
      ineligible: union.ineligible,
      size: chosen.length,
      redundancy: 0,
      authority,
      idKey: '',
    };
    return compareSolutions(optimistic, best) >= 0;
  }

  function walk(groupIndex, chosen) {
    visits += 1;
    if (visits > visitCap) {
      throw new Error(`KAR-ORACLE exceeded ${visitCap} visits`);
    }
    if (!optimisticCanBeat(groupIndex, chosen)) return;
    if (groupIndex === groups.length) {
      consider(chosen);
      return;
    }
    walk(groupIndex + 1, chosen);
    if (chosen.length >= K) return;
    for (const item of groups[groupIndex]) {
      chosen.push(item);
      walk(groupIndex + 1, chosen);
      chosen.pop();
    }
  }

  walk(0, []);
  const feasibleSize = minimumFeasibleSize(items, instance, { K, tau, gamma, qTau });
  const satisfied = best !== null;
  if (satisfied !== (feasibleSize !== null)) {
    throw new Error(`KAR-ORACLE feasibility disagreed with the mask DP (oracle=${satisfied}, dp=${feasibleSize})`);
  }
  if (!best) {
    return { ...emptyResult(instance), visits, version: ORACLE_VERSION, feasibleSize: null };
  }
  if (best.size > K) throw new Error('KAR-ORACLE returned a set larger than K');
  return { ...best, visits, version: ORACLE_VERSION, feasibleSize };
}

function gainBits(chosen, item, field) {
  let have = 0;
  for (const current of chosen) have |= current.mask[field];
  return bitCount((have ^ (have | item.mask[field])) >>> 0);
}

function betterGain(next, nextId, current, currentId) {
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] > current[i] + EPS) return true;
    if (next[i] < current[i] - EPS) return false;
  }
  return nextId < currentId;
}

/**
 * KAR-GREEDY. Repeatedly add the candidate with the largest unmet
 * opposition, then support, then qualifier gain. Ties break on applicability,
 * lower redundancy, higher authority, then id. Stops when no required fact
 * remains or the budget is exhausted. Abstains when the floors are unmet.
 */
export function selectGreedy(items, instance, limits) {
  const tau = limits.tau ?? 1;
  const gamma = limits.gamma ?? 1;
  const qTau = limits.qTau ?? 1;
  const K = limits.K;
  const chosen = [];
  while (chosen.length < K) {
    let best = null;
    let bestKey = null;
    for (const item of items) {
      if (chosen.includes(item)) continue;
      const gainO = gainBits(chosen, item, 'o');
      const gainS = gainBits(chosen, item, 's');
      const gainQ = gainBits(chosen, item, 'q');
      if (gainO + gainS + gainQ === 0) continue;
      const trial = chosen.concat([item]);
      const key = [gainO, gainS, gainQ, item.mask.applicable ? 1 : 0, -redundancy(trial), item.authority ?? 0];
      if (!best || betterGain(key, item.id, bestKey, best.id)) {
        best = item;
        bestKey = key;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  if (chosen.length === 0) return { ...emptyResult(instance), version: GREEDY_VERSION, partialIds: [] };
  const scored = solutionFrom(chosen, instance);
  if (!meetsThresholds(scored._sc, scored._oc, scored._qc, instance, tau, gamma, qTau)) {
    return {
      ...emptyResult(instance),
      version: GREEDY_VERSION,
      partialIds: scored.ids,
      partialSc: scored.sc,
      partialOc: scored.oc,
      partialQc: scored.qc,
    };
  }
  return { ...scored, version: GREEDY_VERSION, partialIds: scored.ids };
}

export function coverageOfIds(ids, items, instance) {
  const chosen = [];
  const wanted = new Set(ids);
  for (const item of items) if (wanted.has(item.id)) chosen.push(item);
  if (chosen.length !== wanted.size) {
    throw new Error('coverageOfIds missing a selected id');
  }
  return solutionFrom(chosen, instance);
}

function item(id, relation, facts, textTokens, extra = {}) {
  const passage = {
    id,
    sourceId: extra.sourceId ?? id,
    relation,
    facts,
    authority: extra.authority ?? 1,
    unauthorized: extra.unauthorized ?? false,
    validFrom: extra.validFrom,
    validTo: extra.validTo,
    text: extra.text ?? id,
  };
  const tokens = new Set(textTokens);
  return { ...passage, mask: factMask(passage, extra.instance), tokens };
}

export function selfTestSelectors() {
  const instance = {
    asOf: '2024-06-15',
    minAuthority: null,
    required: { support: ['s1', 's2'], opposition: ['o1'], qualifiers: [] },
  };
  const supportAll = item('a-cover', 'support', ['s1', 's2'], ['alpha', 'policy'], { instance, text: 'alpha policy' });
  const supportPart = item('b-part', 'support', ['s1'], ['alpha', 'policy', 'repeat'], { instance });
  const oppose = item('c-opp', 'contradict', ['o1'], ['beta', 'limit'], { instance, text: 'beta limit' });
  const noise = item('d-noise', 'irrelevant', [], ['warehouse'], { instance });
  supportAll.mask = factMask(supportAll, instance);
  supportPart.mask = factMask(supportPart, instance);
  oppose.mask = factMask(oppose, instance);
  noise.mask = factMask(noise, instance);
  const pool = [supportPart, supportAll, oppose, noise];
  const picked = selectOracle(pool, instance, { K: 2 });
  if (picked.ids.join(',') !== 'a-cover,c-opp') {
    throw new Error(`oracle min-set self-test failed: ${picked.ids.join(',')}`);
  }

  const low = item('red-low', 'support', ['s1', 's2'], ['xylophone', 'quartet'], { instance });
  const high = item('red-high', 'support', ['s1', 's2'], ['beta', 'limit', 'shared'], { instance });
  low.mask = factMask(low, instance);
  high.mask = factMask(high, instance);
  const redundant = selectOracle([low, high, oppose], instance, { K: 2 });
  if (!redundant.ids.includes('red-low') || redundant.ids.includes('red-high')) {
    throw new Error(`redundancy self-test failed: ${redundant.ids.join(',')}`);
  }

  const weak = item('auth-weak', 'support', ['s1', 's2'], ['same', 'text'], { instance, authority: 1 });
  const strong = item('auth-strong', 'support', ['s1', 's2'], ['same', 'text'], { instance, authority: 9 });
  weak.mask = factMask(weak, instance);
  strong.mask = factMask(strong, instance);
  const authoritative = selectOracle([weak, strong, oppose], instance, { K: 2 });
  if (!authoritative.ids.includes('auth-strong')) {
    throw new Error(`authority self-test failed: ${authoritative.ids.join(',')}`);
  }

  const stale = item('stale-opp', 'contradict', ['o1'], ['beta'], {
    instance,
    validTo: '2020-01-01',
  });
  stale.mask = factMask(stale, instance);
  const onlyStale = selectOracle([supportAll, stale], instance, { K: 4 });
  if (onlyStale.status !== 'UNSATISFIED_EVIDENCE_REQUIREMENTS') {
    throw new Error('ineligible opposition was treated as coverage');
  }

  const tieA = item('a-tie', 'support', ['s1', 's2'], ['identical'], { instance });
  const tieB = item('b-tie', 'support', ['s1', 's2'], ['identical'], { instance });
  tieA.mask = factMask(tieA, instance);
  tieB.mask = factMask(tieB, instance);
  const tied = selectOracle([tieB, tieA, oppose], instance, { K: 2 });
  if (tied.ids[0] !== 'a-tie') throw new Error(`id tie-break failed: ${tied.ids.join(',')}`);

  const trapInstance = {
    asOf: '2024-06-15',
    minAuthority: null,
    required: { support: ['s1', 's2'], opposition: ['o1', 'o2', 'o3', 'o4'], qualifiers: [] },
  };
  const trapItems = [
    ['h-aa-partial', 'contradict', ['o1', 'o3']],
    ['h-mm-left', 'contradict', ['o1', 'o2']],
    ['h-mm-right', 'contradict', ['o3', 'o4']],
    ['h-cover-support', 'support', ['s1', 's2']],
  ].map(([id, relation, facts]) => {
    const built = item(id, relation, facts, ['unique', id], { instance: trapInstance });
    built.mask = factMask(built, trapInstance);
    return built;
  });
  const trapOracle = selectOracle(trapItems, trapInstance, { K: 3 });
  const trapGreedy = selectGreedy(trapItems, trapInstance, { K: 3 });
  if (trapOracle.status !== 'SATISFIED' || trapOracle.size !== 3 || trapOracle.ids.includes('h-aa-partial')) {
    throw new Error(`trap oracle failed: ${trapOracle.status} ${trapOracle.ids.join(',')}`);
  }
  if (trapGreedy.status !== 'UNSATISFIED_EVIDENCE_REQUIREMENTS') {
    throw new Error(`trap greedy unexpectedly succeeded: ${trapGreedy.ids.join(',')}`);
  }

  const negative = {
    asOf: '2024-06-15',
    minAuthority: null,
    required: { support: ['s1'], opposition: [], qualifiers: [] },
  };
  const negSupport = item('n-support', 'support', ['s1'], ['policy'], { instance: negative });
  const negFight = item('n-fight', 'contradict', ['unrequested'], ['conflict'], { instance: negative });
  negSupport.mask = factMask(negSupport, negative);
  negFight.mask = factMask(negFight, negative);
  const neg = selectOracle([negSupport, negFight], negative, { K: 4 });
  if (neg.ids.join(',') !== 'n-support') throw new Error(`negative control selected ${neg.ids.join(',')}`);

  return { ok: true, oracle: ORACLE_VERSION, greedy: GREEDY_VERSION };
}
