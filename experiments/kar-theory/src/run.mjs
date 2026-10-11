import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateInstances, GENERATOR_VERSION, PER_SCENARIO, SCENARIOS, SEED } from '../fixtures/generate.mjs';
import { createRanker } from './lexical.mjs';
import { alignRanking, BUDGETS, DEPTHS, evaluatePrepared, prepareCorpus, sensitivityOracle } from './evaluate.mjs';
import { factMask, selectGreedy, selectOracle, selfTestSelectors } from './selector.mjs';
import { bootstrapMean, latencyQuantiles, mulberry32, summarize } from './stats.mjs';
import { renderReport } from './report.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'experiments/kar-theory');
const RESULT_DIR = path.join(OUT_DIR, 'results');
const DIST = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
const PRIMARY_K = 5;
const PRIMARY_DEPTH = 50;
const ADVERSARIAL = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'I', 'J']);
const LIMIT = process.env.KAR_LIMIT ? Number(process.env.KAR_LIMIT) : PER_SCENARIO;

function ensureDist() {
  if (process.env.KNOLO_DIST && existsSync(path.join(DIST, 'query.js'))) return;
  const result = spawnSync(
    'npx',
    ['tsc', '-p', 'packages/core/tsconfig.json', '--outDir', DIST, '--declaration', 'false'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Failed to compile packages/core for the experiment.');
}

async function loadCore() {
  ensureDist();
  const core = await import(pathToFileURL(path.join(DIST, 'index.js')).href);
  const rank = await import(pathToFileURL(path.join(DIST, 'rank.js')).href);
  const proximity = await import(pathToFileURL(path.join(DIST, 'quality/proximity.js')).href);
  const diversify = await import(pathToFileURL(path.join(DIST, 'quality/diversify.js')).href);
  const similarity = await import(pathToFileURL(path.join(DIST, 'quality/similarity.js')).href);
  const tokenize = await import(pathToFileURL(path.join(DIST, 'tokenize.js')).href);
  const legacy = await import(pathToFileURL(path.join(DIST, 'compression/vqf1/lexical_postings.js')).href);
  const postings = await import(pathToFileURL(path.join(DIST, 'compression/vqf1/postings.js')).href);
  const graph = await import(pathToFileURL(path.join(DIST, 'graph/query_expand.js')).href);
  return {
    buildPack: core.buildPack,
    mountPackFromBuffer: core.mountPackFromBuffer,
    queryWithPlan: core.queryWithPlan,
    jaccard5: similarity.jaccard5,
    ranker: createRanker({
      tokenize: tokenize.tokenize,
      parsePhrases: tokenize.parsePhrases,
      normalize: tokenize.normalize,
      rankBM25L: rank.rankBM25L,
      minCoverSpan: proximity.minCoverSpan,
      proximityMultiplier: proximity.proximityMultiplier,
      diversifyAndDedupe: diversify.diversifyAndDedupe,
      applyHardConstraints: core.applyHardConstraints,
      createLegacyLexicalPostingsReader: legacy.createLegacyLexicalPostingsReader,
      createVqfLexicalPostingsReader: postings.createVqfLexicalPostingsReader,
      expandQueryWithGraph: graph.expandQueryWithGraph,
      query: core.query,
    }),
  };
}

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sameHits(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index].blockId !== expected[index].blockId) return false;
    if (actual[index].score !== expected[index].score) return false;
  }
  return true;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function replayPayload(instance, ceiling, selectedIds) {
  return {
    selectorVersion: 'KAR-ORACLE-exp1',
    query: instance.query,
    candidateIds: ceiling.map((item) => item.id).sort(),
    requirements: instance.required,
    relations: ceiling
      .map((item) => ({
        id: item.id,
        relation: item.relation,
        facts: item.facts,
        applicable: Boolean(item.mask.applicable),
        authority: item.authority ?? 0,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    selectedIds: selectedIds.slice().sort(),
  };
}

function validateFixtures(instances, tokenize, jaccard5) {
  const problems = [];
  const seen = new Set();
  for (const instance of instances) {
    if (instance.required.support.length > 20 || instance.required.opposition.length > 20 || instance.required.qualifiers.length > 20) {
      problems.push(`${instance.id} has too many required facts for the exact mask`);
    }
    const items = prepareCorpus(instance, tokenize, factMask);
    for (const item of items) {
      if (seen.has(item.id)) problems.push(`duplicate passage id ${item.id}`);
      seen.add(item.id);
    }
    const oracle = selectOracle(items, instance, { K: 10, tau: 1, gamma: 1, qTau: 1 });
    if (instance.expectFeasible && oracle.status !== 'SATISFIED') {
      problems.push(`${instance.id} expected a feasible set but oracle abstained`);
    }
    if (!instance.expectFeasible && oracle.status === 'SATISFIED') {
      problems.push(`${instance.id} expected abstention but oracle selected ${oracle.ids.join(',')}`);
    }
    if (instance.designedMinSize != null && oracle.size !== instance.designedMinSize) {
      problems.push(`${instance.id} designed min ${instance.designedMinSize}, oracle ${oracle.size} [${oracle.ids.join(',')}]`);
    }
    if (instance.scenario === 'A' || instance.scenario === 'B') {
      const supports = items.filter((item) => item.relation === 'support');
      const scores = [];
      for (let i = 0; i < supports.length; i += 1) {
        for (let j = i + 1; j < supports.length; j += 1) scores.push(jaccard5(supports[i].text, supports[j].text));
      }
      const low = scores.length ? Math.min(...scores) : 1;
      const high = scores.length ? Math.max(...scores) : 1;
      if (instance.scenario === 'A' && low < 0.92) {
        problems.push(`${instance.id} support 5-gram Jaccard ${low.toFixed(3)} is below 0.92`);
      }
      if (instance.scenario === 'B' && scores.length > 0 && scores.every((score) => score >= 0.92)) {
        problems.push(`${instance.id} support paraphrases are all 5-gram near-duplicates (min ${low.toFixed(3)}, max ${high.toFixed(3)})`);
      }
    }
    if (instance.scenario === 'C' && oracle.status === 'SATISFIED') {
      if (!oracle.ids.some((id) => id.includes('current-policy'))) problems.push(`${instance.id} missed current policy`);
      if (!oracle.ids.some((id) => id.includes('current-contract'))) problems.push(`${instance.id} missed current contract`);
      if (oracle.ids.some((id) => id.includes('stale') || id.includes('future'))) problems.push(`${instance.id} selected ineligible ${oracle.ids.join(',')}`);
    }
    if (instance.scenario === 'N' && oracle.ids.some((id) => id.includes('unrequested') || id.includes('decoy'))) {
      problems.push(`${instance.id} negative control selected ${oracle.ids.join(',')}`);
    }
    if (instance.params.trap && oracle.ids.some((id) => id.includes('aa-partial'))) {
      problems.push(`${instance.id} trap oracle used the partial opposition doc`);
    }
  }
  if (problems.length) {
    throw new Error(`Fixture validation failed:\n${problems.slice(0, 20).join('\n')}`);
  }
}

function stripCell(cell) {
  if (!cell) return null;
  return {
    status: cell.status,
    ids: cell.ids,
    size: cell.size,
    sc: cell.sc,
    oc: cell.oc,
    qc: cell.qc,
    dual: cell.dual,
    redundancy: cell.redundancy,
    sources: cell.sources,
    authority: cell.authority,
    claimsSufficient: cell.claimsSufficient,
    falseSufficient: cell.falseSufficient,
    falseAbsence: cell.falseAbsence,
    unrequested: cell.unrequested,
    independent: cell.independent,
    ndcg: cell.ndcg ?? null,
  };
}

function stripEval(evaluated) {
  const byK = {};
  for (const K of BUDGETS) {
    byK[K] = Object.fromEntries(Object.entries(evaluated.byK[K]).map(([name, cell]) => [name, stripCell(cell)]));
  }
  const lexical = {};
  const dual = {};
  for (const depth of DEPTHS) {
    lexical[depth] = {};
    dual[depth] = {};
    for (const K of BUDGETS) {
      lexical[depth][K] = Object.fromEntries(Object.entries(evaluated.lexical[depth][K]).map(([name, cell]) => [name, stripCell(cell)]));
      dual[depth][K] = Object.fromEntries(Object.entries(evaluated.dual[depth][K]).map(([name, cell]) => [name, stripCell(cell)]));
    }
  }
  const qualifierProbe = {};
  for (const K of BUDGETS) qualifierProbe[K] = stripCell(evaluated.qualifierProbe[K]);
  return { ...evaluated, byK, lexical, dual, qualifierProbe };
}

async function buildAndRank(instance, passages, api) {
  const docs = passages.map((passage) => ({ id: passage.id, heading: passage.heading, text: passage.text }));
  const started = performance.now();
  const bytes = await api.buildPack(docs);
  const pack = api.mountPackFromBuffer(arrayBufferOf(bytes));
  const buildMs = performance.now() - started;
  const items = prepareCorpus({ ...instance, passages }, api.ranker.tokenize, factMask);
  const rankStarted = performance.now();
  const queryRank = api.ranker.rankLexical(pack, instance.query);
  const rankMs = performance.now() - rankStarted;
  const counterStarted = performance.now();
  const counterRank = api.ranker.rankLexical(pack, instance.counterQuery);
  const counterMs = performance.now() - counterStarted;
  const qualifierStarted = performance.now();
  const qualifierRank = api.ranker.rankLexical(pack, instance.qualifierQuery);
  const qualifierMs = performance.now() - qualifierStarted;
  for (const K of [3, 5, 10]) {
    const mirrored = api.ranker.mmrSelect(pack, queryRank.ranked, K);
    const produced = api.ranker.productionHits(pack, instance.query, K);
    if (!sameHits(mirrored, produced)) {
      throw new Error(
        `Lexical mirror diverged from query() on ${instance.id} at K=${K}.\n` +
          `mirror=${mirrored.map((hit) => `${hit.blockId}:${hit.score}`).slice(0, 8).join(',')}\n` +
          `query=${produced.map((hit) => `${hit.blockId}:${hit.score}`).slice(0, 8).join(',')}`,
      );
    }
  }
  const b1Started = performance.now();
  const productionHitsByK = new Map(BUDGETS.map((K) => [K, api.ranker.productionHits(pack, instance.query, K)]));
  const b1Ms = performance.now() - b1Started;
  const aligned = alignRanking(items, queryRank.ranked, pack.docIds);
  const counter = alignRanking(items, counterRank.ranked, pack.docIds);
  const qualifier = alignRanking(items, qualifierRank.ranked, pack.docIds);
  return {
    pack,
    items,
    aligned,
    counter: counter.scored,
    qualifier: qualifier.scored,
    expansionTerms: queryRank.expansionTerms,
    timings: { buildMs, rankMs, counterMs, qualifierMs, b1Ms },
  };
}

function values(rows, getter) {
  const out = [];
  for (const row of rows) {
    const value = getter(row);
    if (value !== null && value !== undefined && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function boot(rows, getter, rng) {
  return bootstrapMean(values(rows, getter), rng, 1000);
}

function methodStats(rows, cellOf, fields, rng) {
  const stats = { n: rows.length };
  for (const field of fields) stats[field] = boot(rows, (row) => cellOf(row)?.[field], rng);
  stats.falseSufficiencyRate = boot(rows, (row) => (cellOf(row)?.falseSufficient ? 1 : 0), rng);
  stats.falseAbsenceRate = boot(rows, (row) => (cellOf(row)?.falseAbsence ? 1 : 0), rng);
  stats.abstentionRate = boot(rows, (row) => (cellOf(row)?.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS' || cellOf(row)?.status === 'EMPTY' ? 1 : 0), rng);
  return stats;
}

const FIELDS = ['dual', 'sc', 'oc', 'qc', 'size', 'redundancy', 'ndcg'];

function aggregate(instances, rng) {
  const overall = { ceiling: {}, lexical: {}, dual: {}, qualifierProbe: {} };
  for (const K of BUDGETS) {
    overall.ceiling[K] = {};
    for (const method of ['B0', 'B1', 'B1pool', 'ORACLE', 'GREEDY']) {
      const rows = instances.filter((instance) => instance.byK[K][method]);
      if (rows.length === 0) continue;
      overall.ceiling[K][method] = methodStats(rows, (row) => row.byK[K][method], FIELDS, rng);
    }
    overall.lexical[K] = {};
    overall.dual[K] = {};
    for (const method of ['ORACLE', 'GREEDY']) {
      overall.lexical[K][method] = methodStats(instances, (row) => row.lexical[PRIMARY_DEPTH][K][method], FIELDS, rng);
    }
    for (const method of ['ORACLE', 'GREEDY', 'TOPK']) {
      overall.dual[K][method] = methodStats(instances, (row) => row.dual[PRIMARY_DEPTH][K][method], FIELDS, rng);
    }
    overall.qualifierProbe[K] = methodStats(instances, (row) => row.qualifierProbe[K], FIELDS, rng);
  }

  const byScenario = {};
  for (const scenario of SCENARIOS) {
    const rows = instances.filter((instance) => instance.scenario === scenario);
    byScenario[scenario] = { n: rows.length, ceiling: {}, lexical: {}, dual: {}, recall: {} };
    for (const method of ['B0', 'B1', 'ORACLE', 'GREEDY']) {
      byScenario[scenario].ceiling[method] = methodStats(rows, (row) => row.byK[PRIMARY_K][method], FIELDS, rng);
    }
    if (rows.some((row) => row.byK[PRIMARY_K].B1pool)) {
      byScenario[scenario].ceiling.B1pool = methodStats(rows, (row) => row.byK[PRIMARY_K].B1pool, FIELDS, rng);
    }
    byScenario[scenario].lexical.ORACLE = methodStats(rows, (row) => row.lexical[PRIMARY_DEPTH][PRIMARY_K].ORACLE, FIELDS, rng);
    byScenario[scenario].dual.ORACLE = methodStats(rows, (row) => row.dual[PRIMARY_DEPTH][PRIMARY_K].ORACLE, FIELDS, rng);
    byScenario[scenario].dual.TOPK = methodStats(rows, (row) => row.dual[PRIMARY_DEPTH][PRIMARY_K].TOPK, FIELDS, rng);
    for (const depth of DEPTHS) {
      byScenario[scenario].recall[depth] = {
        support: boot(rows, (row) => row.candidateRecall[depth].support, rng),
        opposition: boot(rows, (row) => row.candidateRecall[depth].opposition, rng),
        qualifier: boot(rows, (row) => row.candidateRecall[depth].qualifier, rng),
        counterOpposition: boot(rows, (row) => row.counterRecall[depth].opposition, rng),
      };
    }
  }
  return { overall, byScenario };
}

function delta(rows, left, right, rng) {
  return boot(rows, (row) => {
    const a = left(row);
    const b = right(row);
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return a - b;
  }, rng);
}

function gatesFor(instances, rng) {
  const adversarial = instances.filter((instance) => ADVERSARIAL.has(instance.scenario));
  const gaps = instances.filter((instance) => instance.expectAbstain);
  const negative = instances.filter((instance) => instance.negativeControl);
  const K = PRIMARY_K;
  const ceilingFeasible = instances.filter((instance) => instance.byK[K].ORACLE.status === 'SATISFIED');
  const lexicalFeasible = instances.filter((instance) => instance.lexical[PRIMARY_DEPTH][K].ORACLE.status === 'SATISFIED');
  const gate1 = delta(
    ceilingFeasible,
    (row) => row.byK[K].ORACLE.dual,
    (row) => row.byK[K].B0.dual,
    rng,
  );
  const gate1VsB1 = delta(
    ceilingFeasible,
    (row) => row.byK[K].ORACLE.dual,
    (row) => row.byK[K].B1.dual,
    rng,
  );
  const gate1LexicalConditional = delta(
    lexicalFeasible,
    (row) => row.lexical[PRIMARY_DEPTH][K].ORACLE.dual,
    (row) => row.byK[K].B0.dual,
    rng,
  );
  const b2DualDelta = delta(
    adversarial,
    (row) => row.lexical[PRIMARY_DEPTH][K].ORACLE.dual,
    (row) => row.byK[K].B0.dual,
    rng,
  );
  const b4OppositionDelta = delta(
    adversarial,
    (row) => row.dual[PRIMARY_DEPTH][K].ORACLE.oc,
    (row) => row.byK[K].B0.oc,
    rng,
  );
  const ceilingOppositionDelta = delta(
    adversarial,
    (row) => row.byK[K].ORACLE.oc,
    (row) => row.byK[K].B0.oc,
    rng,
  );
  const b2OppositionDelta = delta(
    adversarial,
    (row) => row.lexical[PRIMARY_DEPTH][K].ORACLE.oc,
    (row) => row.byK[K].B0.oc,
    rng,
  );
  const b4TopkOppositionDelta = delta(
    adversarial,
    (row) => row.dual[PRIMARY_DEPTH][K].TOPK.oc,
    (row) => row.byK[K].B0.oc,
    rng,
  );
  const b4OppositionAbsolute = boot(adversarial, (row) => row.dual[PRIMARY_DEPTH][K].ORACLE.oc, rng);
  const oracleFsr = boot(instances, (row) => (row.byK[K].ORACLE.falseSufficient ? 1 : 0), rng);
  const abstention = boot(gaps, (row) => (row.byK[K].ORACLE.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS' ? 1 : 0), rng);
  const ratios = [];
  let greedyMisses = 0;
  let greedyComparable = 0;
  for (const row of instances) {
    const oracle = row.byK[K].ORACLE;
    const greedy = row.byK[K].GREEDY;
    if (oracle.status !== 'SATISFIED' || oracle.size === 0) continue;
    greedyComparable += 1;
    if (greedy.status !== 'SATISFIED') {
      greedyMisses += 1;
      continue;
    }
    ratios.push(greedy.size / oracle.size);
  }
  const msr = bootstrapMean(ratios, rng, 1000);
  const negativeAbstain = boot(negative, (row) => (row.byK[K].ORACLE.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS' ? 1 : 0), rng);
  const negativeExtra = boot(negative, (row) => (row.byK[K].ORACLE.unrequested > 0 ? 1 : 0), rng);
  const negativeSize = boot(negative, (row) => row.byK[K].ORACLE.size, rng);
  const b4NegativeExtra = boot(negative, (row) => (row.dual[PRIMARY_DEPTH][K].ORACLE.unrequested > 0 ? 1 : 0), rng);
  const b4NegativeAbstain = boot(negative, (row) => (row.dual[PRIMARY_DEPTH][K].ORACLE.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS' ? 1 : 0), rng);
  return {
    primaryK: K,
    primaryDepth: PRIMARY_DEPTH,
    ceilingFeasibleN: ceilingFeasible.length,
    lexicalFeasibleN: lexicalFeasible.length,
    adversarialN: adversarial.length,
    gate1CeilingConditionalDualDelta: gate1,
    gate1VsProductionMmr: gate1VsB1,
    gate1LexicalPoolConditionalDualDelta: gate1LexicalConditional,
    b2UnconditionalDualDelta: b2DualDelta,
    ceilingOppositionDelta: ceilingOppositionDelta,
    b2OppositionDelta: b2OppositionDelta,
    b4OppositionDelta: b4OppositionDelta,
    b4OppositionAbsolute: b4OppositionAbsolute,
    b4TopkOppositionDelta: b4TopkOppositionDelta,
    oracleFalseSufficiency: oracleFsr,
    abstentionAccuracy: abstention,
    greedyMsr: msr,
    greedyMissRate: greedyComparable === 0 ? null : greedyMisses / greedyComparable,
    greedyComparable,
    negativeAbstain,
    negativeExtra,
    negativeSize,
    b4NegativeExtra,
    b4NegativeAbstain,
  };
}

function decide(gates, determinismMismatches) {
  const cleanNegative =
    (gates.negativeAbstain.mean ?? 1) <= 0.05 &&
    (gates.negativeExtra.mean ?? 1) <= 0.1 &&
    (gates.negativeSize.mean ?? 9) <= 1.25;
  const ceilingPass = (gates.gate1CeilingConditionalDualDelta.mean ?? 0) >= 0.2;
  const ciLow = gates.gate1CeilingConditionalDualDelta.ci95?.[0];
  const ceilingCiExcludesZero = ciLow != null && ciLow > 0;
  const fsrPass = (gates.oracleFalseSufficiency.mean ?? 1) === 0;
  const abstainPass = (gates.abstentionAccuracy.mean ?? 0) >= 0.95;
  const detPass = determinismMismatches === 0;
  const b2Pass = (gates.b2UnconditionalDualDelta.mean ?? 0) >= 0.2 && (gates.b2OppositionDelta.mean ?? 0) >= 0.2;
  const b4Pass = (gates.b4OppositionDelta.mean ?? 0) >= 0.2 || (gates.b4OppositionAbsolute?.mean ?? 0) >= 0.7;
  let label = 'INCONCLUSIVE';
  let recommendation = 'run another research experiment';
  let reason = 'unclassified';
  if (!detPass) {
    label = 'NO-GO';
    recommendation = 'stop';
    reason = 'repeated executions disagreed';
  } else if (!cleanNegative) {
    label = 'NO-GO';
    recommendation = 'stop';
    reason = 'negative control was harmed on the selection ceiling';
  } else if (!abstainPass) {
    label = 'NO-GO';
    recommendation = 'stop';
    reason = 'intentional gaps did not abstain';
  } else if (!fsrPass) {
    label = 'INCONCLUSIVE';
    recommendation = 'run another research experiment';
    reason = 'oracle false sufficiency is a harness failure until shown otherwise';
  } else if (!ceilingCiExcludesZero) {
    label = 'INCONCLUSIVE';
    recommendation = 'run another research experiment';
    reason = 'the 95% interval for the ceiling dual delta includes 0';
  } else if (!ceilingPass) {
    label = 'NO-GO';
    recommendation = 'stop';
    reason = 'ceiling dual-frontier selection missed the 20 point gate';
  } else if (b2Pass) {
    label = 'GO';
    recommendation = 'proceed to formal KAR-1 design';
    reason = 'ceiling and normal lexical discovery both cleared the gates';
  } else if (b4Pass) {
    label = 'PROMISING BUT BLOCKED';
    recommendation = 'run another research experiment';
    reason = 'selection ceiling passed; normal lexical discovery did not; a hand-authored counter-query moved opposition coverage';
  } else {
    label = 'NO-GO';
    recommendation = 'stop';
    reason = 'counter-evidence stayed outside the lexical pool even with a hand-authored opposing query';
  }
  return {
    label,
    recommendation,
    reason,
    cleanNegative,
    ceilingPass,
    ceilingCiExcludesZero,
    fsrPass,
    abstainPass,
    detPass,
    b2Pass,
    b4Pass,
  };
}

function recallTable(instances, rng) {
  const table = {};
  const adversarial = instances.filter((instance) => ADVERSARIAL.has(instance.scenario));
  for (const depth of DEPTHS) {
    table[depth] = {
      all: {
        support: boot(instances, (row) => row.candidateRecall[depth].support, rng),
        opposition: boot(instances, (row) => row.candidateRecall[depth].opposition, rng),
        qualifier: boot(instances, (row) => row.candidateRecall[depth].qualifier, rng),
      },
      adversarial: {
        support: boot(adversarial, (row) => row.candidateRecall[depth].support, rng),
        opposition: boot(adversarial, (row) => row.candidateRecall[depth].opposition, rng),
        qualifier: boot(adversarial, (row) => row.candidateRecall[depth].qualifier, rng),
        counterOpposition: boot(adversarial, (row) => row.counterRecall[depth].opposition, rng),
      },
    };
  }
  return table;
}

function strongerSignal(instances) {
  const rows = instances.filter(
    (row) => ADVERSARIAL.has(row.scenario) && row.byK[PRIMARY_K].ORACLE.dual === 1 && row.byK[PRIMARY_K].B0.dual === 0,
  );
  const mean = (getter) => {
    const nums = rows.map(getter).filter((value) => Number.isFinite(value));
    if (!nums.length) return null;
    return nums.reduce((sum, value) => sum + value, 0) / nums.length;
  };
  return {
    n: rows.length,
    adversarialN: instances.filter((row) => ADVERSARIAL.has(row.scenario)).length,
    b0Support: mean((row) => row.byK[PRIMARY_K].B0.sc),
    b0Opposition: mean((row) => row.byK[PRIMARY_K].B0.oc),
    b0Qualifier: mean((row) => row.byK[PRIMARY_K].B0.qc),
    b0Size: mean((row) => row.byK[PRIMARY_K].B0.size),
    oracleSupport: mean((row) => row.byK[PRIMARY_K].ORACLE.sc),
    oracleOpposition: mean((row) => row.byK[PRIMARY_K].ORACLE.oc),
    oracleQualifier: mean((row) => row.byK[PRIMARY_K].ORACLE.qc),
    oracleSize: mean((row) => row.byK[PRIMARY_K].ORACLE.size),
    b0Redundancy: mean((row) => row.byK[PRIMARY_K].B0.redundancy),
    oracleRedundancy: mean((row) => row.byK[PRIMARY_K].ORACLE.redundancy),
  };
}

function overlapBins(instances, rng) {
  const bins = [
    ['0', (row) => row.params.overlap === 0],
    ['1', (row) => row.params.overlap === 1],
    ['2', (row) => row.params.overlap === 2],
    ['3+', (row) => (row.params.overlap ?? 0) >= 3],
  ];
  const out = {};
  for (const [label, pred] of bins) {
    const rows = instances.filter((row) => ADVERSARIAL.has(row.scenario) && pred(row));
    out[label] = {
      n: rows.length,
      b0Opposition: boot(rows, (row) => row.byK[PRIMARY_K].B0.oc, rng),
      oracleOpposition: boot(rows, (row) => row.byK[PRIMARY_K].ORACLE.oc, rng),
      recall50: boot(rows, (row) => row.candidateRecall[50].opposition, rng),
      recall100: boot(rows, (row) => row.candidateRecall[100].opposition, rng),
      counterRecall50: boot(rows, (row) => row.counterRecall[50].opposition, rng),
    };
  }
  return out;
}

function duplicateBins(instances, rng) {
  const bins = [
    ['1-10', (row) => row.params.dupCount <= 10],
    ['11-20', (row) => row.params.dupCount > 10 && row.params.dupCount <= 20],
    ['21+', (row) => row.params.dupCount > 20],
  ];
  const out = {};
  for (const [label, pred] of bins) {
    const rows = instances.filter((row) => ADVERSARIAL.has(row.scenario) && pred(row));
    out[label] = {
      n: rows.length,
      b0Dual: boot(rows, (row) => row.byK[PRIMARY_K].B0.dual, rng),
      b1Dual: boot(rows, (row) => row.byK[PRIMARY_K].B1.dual, rng),
      oracleDual: boot(rows, (row) => row.byK[PRIMARY_K].ORACLE.dual, rng),
    };
  }
  return out;
}

function variationSplit(instances, rng) {
  const slices = {
    variation0: instances.filter((row) => row.variation === 0),
    rest: instances.filter((row) => row.variation !== 0),
  };
  const out = {};
  for (const [label, rows] of Object.entries(slices)) {
    const adversarial = rows.filter((row) => ADVERSARIAL.has(row.scenario));
    out[label] = {
      n: rows.length,
      adversarialN: adversarial.length,
      b0Dual: boot(adversarial, (row) => row.byK[PRIMARY_K].B0.dual, rng),
      b1Dual: boot(adversarial, (row) => row.byK[PRIMARY_K].B1.dual, rng),
      oracleDual: boot(adversarial, (row) => row.byK[PRIMARY_K].ORACLE.dual, rng),
      b2Dual: boot(adversarial, (row) => row.lexical[PRIMARY_DEPTH][PRIMARY_K].ORACLE.dual, rng),
      b4Dual: boot(adversarial, (row) => row.dual[PRIMARY_DEPTH][PRIMARY_K].ORACLE.dual, rng),
      b0Oc: boot(adversarial, (row) => row.byK[PRIMARY_K].B0.oc, rng),
      b2Oc: boot(adversarial, (row) => row.lexical[PRIMARY_DEPTH][PRIMARY_K].ORACLE.oc, rng),
      b4Oc: boot(adversarial, (row) => row.dual[PRIMARY_DEPTH][PRIMARY_K].ORACLE.oc, rng),
      recall50: boot(adversarial, (row) => row.candidateRecall[50].opposition, rng),
      counterRecall50: boot(adversarial, (row) => row.counterRecall[50].opposition, rng),
    };
  }
  return out;
}

function corpusDisclosure(instances) {
  const out = {};
  for (const scenario of SCENARIOS) {
    const rows = instances.filter((row) => row.scenario === scenario);
    out[scenario] = {
      corpusSize: summarize(rows.map((row) => row.corpusSize)),
      scoredCount: summarize(rows.map((row) => row.scoredCount)),
    };
  }
  out.all = {
    corpusSize: summarize(instances.map((row) => row.corpusSize)),
    scoredCount: summarize(instances.map((row) => row.scoredCount)),
  };
  return out;
}

function thresholdGrid(records, instancesById, prepared, K, rng) {
  const rows = [];
  for (const tau of [1, 0.75, 0.5]) {
    for (const gamma of [1, 0.75, 0.5]) {
      const oracleDuals = [];
      const b0Duals = [];
      for (const record of records) {
        const instance = instancesById.get(record.id);
        const oracle = sensitivityOracle(prepared.get(record.id), instance, K, tau, gamma);
        const b0 = record.byK[K].B0;
        const b0Dual =
          (instance.required.support.length === 0 || b0.sc >= tau) &&
          (instance.required.opposition.length === 0 || b0.oc >= gamma) &&
          (instance.required.qualifiers.length === 0 || b0.qc >= gamma)
            ? 1
            : 0;
        oracleDuals.push(oracle.dual);
        b0Duals.push(b0Dual);
      }
      rows.push({
        K,
        tau,
        gamma,
        n: records.length,
        oracleDual: bootstrapMean(oracleDuals, rng, 1000),
        b0Dual: bootstrapMean(b0Duals, rng, 1000),
      });
    }
  }
  return rows;
}

function budgetCurve(instances, rng) {
  const adversarial = instances.filter((row) => ADVERSARIAL.has(row.scenario));
  const curve = {};
  for (const K of BUDGETS) {
    const feasible = adversarial.filter((row) => row.byK[K].ORACLE.status === 'SATISFIED');
    curve[K] = {
      b0Dual: boot(adversarial, (row) => row.byK[K].B0.dual, rng),
      b1Dual: boot(adversarial, (row) => row.byK[K].B1.dual, rng),
      oracleDual: boot(adversarial, (row) => row.byK[K].ORACLE.dual, rng),
      greedyDual: boot(adversarial, (row) => row.byK[K].GREEDY.dual, rng),
      b2Dual: boot(adversarial, (row) => row.lexical[PRIMARY_DEPTH][K].ORACLE.dual, rng),
      b4Dual: boot(adversarial, (row) => row.dual[PRIMARY_DEPTH][K].ORACLE.dual, rng),
      b4TopkDual: boot(adversarial, (row) => row.dual[PRIMARY_DEPTH][K].TOPK.dual, rng),
      b0Oc: boot(adversarial, (row) => row.byK[K].B0.oc, rng),
      oracleOc: boot(adversarial, (row) => row.byK[K].ORACLE.oc, rng),
      b2Oc: boot(adversarial, (row) => row.lexical[PRIMARY_DEPTH][K].ORACLE.oc, rng),
      b4Oc: boot(adversarial, (row) => row.dual[PRIMARY_DEPTH][K].ORACLE.oc, rng),
      conditionalCeilingDelta: delta(feasible, (row) => row.byK[K].ORACLE.dual, (row) => row.byK[K].B0.dual, rng),
      feasibleN: feasible.length,
    };
  }
  return curve;
}

async function repeatDeterminism(instance, api) {
  const built = await buildAndRank(instance, instance.passages, api);
  const fingerprints = [];
  for (let run = 0; run < 100; run += 1) {
    const ranked = api.ranker.rankLexical(built.pack, instance.query);
    const hits = api.ranker.productionHits(built.pack, instance.query, PRIMARY_K);
    const aligned = alignRanking(built.items, ranked.ranked, built.pack.docIds);
    const oracle = selectOracle(aligned.ceiling, instance, { K: PRIMARY_K, tau: 1, gamma: 1, qTau: 1 });
    fingerprints.push(
      canonical({
        ranked: ranked.ranked.map((hit) => [hit.blockId, hit.score]),
        hits: hits.map((hit) => [hit.blockId, hit.score]),
        ids: oracle.ids,
        status: oracle.status,
        sc: oracle.sc,
        oc: oracle.oc,
        qc: oracle.qc,
      }),
    );
  }
  const unique = new Set(fingerprints);
  const rng = mulberry32((SEED ^ instance.variation ^ instance.scenario.charCodeAt(0)) >>> 0);
  let shuffleOracleMismatches = 0;
  let shuffleBaselineMismatches = 0;
  const baseOracle = selectOracle(built.aligned.ceiling, instance, { K: PRIMARY_K, tau: 1, gamma: 1, qTau: 1 }).ids.join(',');
  const baseB0 = built.aligned.scored
    .slice()
    .sort((a, b) => b.score - a.score || a.blockId - b.blockId)
    .slice(0, PRIMARY_K)
    .map((item) => item.id)
    .join(',');
  for (let shuffle = 0; shuffle < 10; shuffle += 1) {
    const passages = instance.passages.slice();
    for (let i = passages.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [passages[i], passages[j]] = [passages[j], passages[i]];
    }
    const shuffled = await buildAndRank({ ...instance, passages }, passages, api);
    const oracleIds = selectOracle(shuffled.aligned.ceiling, instance, { K: PRIMARY_K, tau: 1, gamma: 1, qTau: 1 }).ids.join(',');
    const b0Ids = shuffled.aligned.scored
      .slice()
      .sort((a, b) => b.score - a.score || a.blockId - b.blockId)
      .slice(0, PRIMARY_K)
      .map((item) => item.id)
      .join(',');
    if (oracleIds !== baseOracle) shuffleOracleMismatches += 1;
    if (b0Ids !== baseB0) shuffleBaselineMismatches += 1;
  }
  const first = replayPayload(instance, built.aligned.ceiling, baseOracle.split(',').filter(Boolean));
  const secondBuilt = await buildAndRank(instance, instance.passages, api);
  const secondOracle = selectOracle(secondBuilt.aligned.ceiling, instance, { K: PRIMARY_K, tau: 1, gamma: 1, qTau: 1 });
  const second = replayPayload(instance, secondBuilt.aligned.ceiling, secondOracle.ids);
  return {
    id: instance.id,
    repeatMismatches: unique.size === 1 ? 0 : unique.size - 1,
    shuffleOracleMismatches,
    shuffleBaselineMismatches,
    replayMatch: digest(first) === digest(second),
    replayDigest: digest(first),
  };
}

function distIsStale() {
  const file = path.join(ROOT, 'packages/core/dist/query.js');
  if (!existsSync(file)) return true;
  return !readFileSync(file, 'utf8').includes('createLegacyLexicalPostingsReader');
}

async function main() {
  const started = performance.now();
  selfTestSelectors();
  const api = await loadCore();
  const limit = Number.isInteger(LIMIT) && LIMIT > 0 ? LIMIT : PER_SCENARIO;
  const instances = generateInstances().filter((instance) => instance.variation < limit);
  validateFixtures(instances, api.ranker.tokenize, api.jaccard5);
  mkdirSync(RESULT_DIR, { recursive: true });

  const records = [];
  const timings = { buildMs: [], rankMs: [], counterMs: [], b1Ms: [], oracleMs: [], greedyMs: [], totalMs: [] };
  let heapMax = 0;
  let planExample = null;
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    const totalStarted = performance.now();
    const built = await buildAndRank(instance, instance.passages, api);
    if (!planExample) {
      planExample = api.queryWithPlan(built.pack, instance.query, {
        topK: PRIMARY_K,
        queryExpansion: { enabled: true },
        graph: { expand: false },
        semantic: { enabled: false },
      }).plan;
    }
    const productionHitsByK = new Map();
    const b1Started = performance.now();
    for (const K of BUDGETS) productionHitsByK.set(K, api.ranker.productionHits(built.pack, instance.query, K));
    timings.b1Ms.push(performance.now() - b1Started);
    const oracleStarted = performance.now();
    selectOracle(built.aligned.ceiling, instance, { K: PRIMARY_K, tau: 1, gamma: 1, qTau: 1 });
    timings.oracleMs.push(performance.now() - oracleStarted);
    const greedyStarted = performance.now();
    selectGreedy(built.aligned.ceiling, instance, { K: PRIMARY_K, tau: 1, gamma: 1, qTau: 1 });
    timings.greedyMs.push(performance.now() - greedyStarted);
    const withProduction = evaluatePrepared(
      instance,
      built.aligned.scored,
      built.aligned.ceiling,
      built.counter,
      built.qualifier,
      productionHitsByK,
      api.ranker.diversifyAndDedupe,
    );
    timings.buildMs.push(built.timings.buildMs);
    timings.rankMs.push(built.timings.rankMs);
    timings.counterMs.push(built.timings.counterMs);
    timings.totalMs.push(performance.now() - totalStarted);
    heapMax = Math.max(heapMax, process.memoryUsage().heapUsed);
    records.push(
      stripEval({
        ...withProduction,
        id: instance.id,
        scenario: instance.scenario,
        variation: instance.variation,
        params: instance.params,
        expectAbstain: instance.expectAbstain,
        negativeControl: instance.negativeControl,
        designedMinSize: instance.designedMinSize,
        expansionTerms: built.expansionTerms,
        query: instance.query,
        counterQuery: instance.counterQuery,
      }),
    );
    if ((index + 1) % 10 === 0 || index === instances.length - 1) {
      console.error(`ranked ${index + 1}/${instances.length}`);
    }
  }

  const representatives = SCENARIOS.map((scenario) => instances.find((instance) => instance.scenario === scenario)).filter(Boolean);
  const determinism = [];
  for (const instance of representatives) {
    console.error(`determinism ${instance.id}`);
    determinism.push(await repeatDeterminism(instance, api));
  }
  const determinismMismatches =
    determinism.reduce((sum, row) => sum + row.repeatMismatches + (row.replayMatch ? 0 : 1), 0);

  const rng = mulberry32(SEED);
  const aggregated = aggregate(records, rng);
  const gates = gatesFor(records, rng);
  const decision = decide(gates, determinismMismatches);
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const sensitivity = { byK: budgetCurve(records, rng) };
  const kept = new Map(instances.map((instance) => [instance.id, instance]));
  const adversarialRecords = records.filter((record) => ADVERSARIAL.has(record.scenario));
  const evenE = adversarialRecords.filter((record) => record.scenario === 'E' && record.variation % 2 === 0);
  const prepared = new Map(
    instances.map((instance) => [
      instance.id,
      prepareCorpus(instance, api.ranker.tokenize, factMask).map((item) => ({ ...item, score: 0 })),
    ]),
  );
  sensitivity.thresholds = thresholdGrid(adversarialRecords, kept, prepared, PRIMARY_K, rng);
  sensitivity.thresholdsK2 = thresholdGrid(adversarialRecords, kept, prepared, 2, rng);
  sensitivity.thresholdsEEvenK2 = thresholdGrid(evenE, kept, prepared, 2, rng);

  const summary = {
    commit,
    seed: SEED,
    generator: GENERATOR_VERSION,
    instanceCount: records.length,
    perScenario: limit,
    limited: limit !== PER_SCENARIO,
    distStale: distIsStale(),
    retrievalSource: 'packages/core/src compiled for the experiment; production dist was not modified',
    primaryK: PRIMARY_K,
    primaryDepth: PRIMARY_DEPTH,
    thresholds: { tau: 1, gamma: 1, qTau: 1 },
    planExample,
    gates,
    decision,
    overall: aggregated.overall,
    byScenario: aggregated.byScenario,
    candidateRecall: recallTable(records, rng),
    corpus: corpusDisclosure(records),
    budgetCurve: sensitivity.byK,
    thresholdSensitivity: sensitivity.thresholds,
    thresholdSensitivityK2: sensitivity.thresholdsK2,
    thresholdSensitivityEEvenK2: sensitivity.thresholdsEEvenK2,
    overlapBins: overlapBins(records, rng),
    duplicateBins: duplicateBins(records, rng),
    variationSplit: variationSplit(records, rng),
    strongerSignal: strongerSignal(records),
    latency: {
      buildMs: latencyQuantiles(timings.buildMs),
      candidateMs: latencyQuantiles(timings.rankMs),
      counterCandidateMs: latencyQuantiles(timings.counterMs),
      baselineMs: latencyQuantiles(timings.b1Ms),
      selectionMs: latencyQuantiles(timings.oracleMs),
      greedyMs: latencyQuantiles(timings.greedyMs),
      totalMs: latencyQuantiles(timings.totalMs),
    },
    memory: { maxHeapBytes: heapMax },
    determinism,
    determinismMismatches,
    parityMismatches: 0,
    elapsedMs: performance.now() - started,
  };

  const report = renderReport(summary);
  if (limit !== PER_SCENARIO) {
    writeFileSync('/tmp/kar-probe-summary.json', JSON.stringify(summary));
    writeFileSync('/tmp/kar-probe-report.md', report);
    console.error(`probe only; decision ${decision.label}; wrote /tmp/kar-probe-report.md`);
    return;
  }
  writeFileSync(path.join(OUT_DIR, 'fixtures/instances.json'), JSON.stringify(instances));
  writeFileSync(
    path.join(OUT_DIR, 'fixtures/seed.json'),
    JSON.stringify({ seed: SEED, generator: GENERATOR_VERSION, perScenario: limit, scenarios: SCENARIOS }, null, 2),
  );
  writeFileSync(path.join(RESULT_DIR, 'results.json'), JSON.stringify({ commit, seed: SEED, generator: GENERATOR_VERSION, records }));
  writeFileSync(path.join(RESULT_DIR, 'summary.json'), JSON.stringify(summary));
  writeFileSync(path.join(OUT_DIR, 'KAR_THEORY_REPORT.md'), report);
  console.error(`wrote report in ${Math.round(summary.elapsedMs)}ms; decision ${decision.label}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
