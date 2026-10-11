import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateInstances, GENERATOR_VERSION, PER_SCENARIO, SEED } from '../../kar-theory/fixtures/generate.mjs';
import { createRanker } from '../../kar-theory/src/lexical.mjs';
import { alignRanking, poolRecall, prepareCorpus, unionByScore } from '../../kar-theory/src/evaluate.mjs';
import { factMask } from '../../kar-theory/src/selector.mjs';
import { bootstrapMean, mulberry32 } from '../../kar-theory/src/stats.mjs';
import {
  ACTIVATION_VERSION,
  activateAll,
  expandedQuery,
  graphInventory,
  mirrorPrefixQuery,
  selfTestActivation,
} from './activate.mjs';
import { renderReport } from './report.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'experiments/kar-activation');
const DIST = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
const LIMIT = process.env.KAR_LIMIT ? Number(process.env.KAR_LIMIT) : PER_SCENARIO;
const ADVERSARIAL = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'I', 'J']);
const DEPTHS = [10, 20, 50];
const PRIMARY = 50;
const EXPERIMENT1_OPPOSITION = 0.78125;
const NEGATIVE_CORPUS = 500;
const BLIND = ['endpoint', 'phrase', 'reverse', 'twohop', 'bridge', 'typed'];
const METHODS = ['baseline', 'prefix', ...BLIND, 'union', 'ceiling'];
const SOURCE_BANS = ['counterQuery', 'qualifierQuery', 'non-terminable', 'irrevocable', 'grandfathered', 'cutoff', '.relation', '.facts', 'kar-theory/fixtures'];
const PADDING_BAN = ['customer', 'cancel', 'agreement', 'after', 'order', 'policy', 'non-terminable', 'irrevocable', 'grandfathered', 'cutoff'];
const NOISE_VOCAB = ['warehouse', 'pallet', 'forklift', 'aisle', 'freight', 'dock', 'staging', 'outbound', 'marker', 'lane', 'crate', 'barcode'];

function assertActivatorIsBlind() {
  const source = readFileSync(path.join(import.meta.dirname, 'activate.mjs'), 'utf8');
  const hits = SOURCE_BANS.filter((term) => source.includes(term));
  if (hits.length) throw new Error(`Activation source contains withheld material: ${hits.join(', ')}`);
}

function ensureDist() {
  if (existsSync(path.join(DIST, 'query.js'))) return;
  const result = spawnSync('npx', ['tsc', '-p', 'packages/core/tsconfig.json', '--outDir', DIST, '--declaration', 'false'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Failed to compile packages/core for the experiment.');
}

async function loadCore() {
  ensureDist();
  const core = await import(pathToFileURL(path.join(DIST, 'index.js')).href);
  const rank = await import(pathToFileURL(path.join(DIST, 'rank.js')).href);
  const proximity = await import(pathToFileURL(path.join(DIST, 'quality/proximity.js')).href);
  const diversify = await import(pathToFileURL(path.join(DIST, 'quality/diversify.js')).href);
  const tokenize = await import(pathToFileURL(path.join(DIST, 'tokenize.js')).href);
  const legacy = await import(pathToFileURL(path.join(DIST, 'compression/vqf1/lexical_postings.js')).href);
  const postings = await import(pathToFileURL(path.join(DIST, 'compression/vqf1/postings.js')).href);
  const graph = await import(pathToFileURL(path.join(DIST, 'graph/query_expand.js')).href);
  return {
    buildPack: core.buildPack,
    mountPackFromBuffer: core.mountPackFromBuffer,
    query: core.query,
    expandQueryWithGraph: graph.expandQueryWithGraph,
    tokenize: tokenize.tokenize,
    normalize: tokenize.normalize,
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

function paddingText(variation, index) {
  const parts = [`Warehouse pallet v${variation} p${index} uses forklift aisle markers for outbound freight staging lanes and barcode crates.`];
  while (parts.join(' ').split(/\s+/).length < 40) parts.push(NOISE_VOCAB[parts.length % NOISE_VOCAB.length]);
  return parts.join(' ');
}

function assertPadding(text) {
  const tokens = new Set(text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean));
  for (const banned of PADDING_BAN) {
    if (tokens.has(banned)) throw new Error(`Negative-control padding contains ${banned}`);
  }
  if (/\bis\b|\bare\b/.test(text)) throw new Error('Negative-control padding contains a definitional copula');
}

function withNegativeCorpus(instance) {
  if (instance.scenario !== 'N') return instance;
  const passages = instance.passages.slice();
  let index = 0;
  while (passages.length < NEGATIVE_CORPUS) {
    const text = paddingText(instance.variation, index);
    assertPadding(text);
    passages.push({
      id: `N-${instance.variation}-pad-${String(index).padStart(4, '0')}`,
      sourceId: 'activation-padding',
      relation: 'irrelevant',
      facts: [],
      text,
      heading: 'Warehouse freight notes',
      authority: 1,
    });
    index += 1;
  }
  return { ...instance, passages };
}

function publicDocs(instance) {
  return instance.passages.map((passage) => ({ id: passage.id, heading: passage.heading, text: passage.text }));
}

function recallAt(scored, instance) {
  const out = {};
  for (const depth of DEPTHS) out[depth] = poolRecall(scored.slice(0, depth), instance);
  return out;
}

function boot(rows, getter, rng) {
  const values = [];
  for (const row of rows) {
    const value = getter(row);
    if (value !== null && value !== undefined && Number.isFinite(value)) values.push(value);
  }
  return bootstrapMean(values, rng, 1000);
}

function rankSummary(rows, eligible, rankOf) {
  const values = [];
  let count = 0;
  for (const row of rows) {
    if (!eligible(row)) continue;
    count += 1;
    const rank = rankOf(row);
    if (rank != null) values.push(rank);
  }
  values.sort((a, b) => a - b);
  const mid = values.length === 0 ? null : values[Math.floor((values.length - 1) / 2)];
  return {
    eligible: count,
    scored: values.length,
    median: mid,
    within10: values.filter((rank) => rank <= 10).length,
    within50: values.filter((rank) => rank <= 50).length,
  };
}

function meanOf(rows, getter) {
  const values = rows.map(getter).filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addMaps(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) target[key] = (target[key] ?? 0) + value;
}

async function main() {
  assertActivatorIsBlind();
  const api = await loadCore();
  selfTestActivation(api.tokenize, api.normalize);
  const limit = Number.isInteger(LIMIT) && LIMIT > 0 ? LIMIT : PER_SCENARIO;
  const instances = generateInstances()
    .filter((instance) => instance.variation < limit)
    .map(withNegativeCorpus);
  const records = [];
  const predicateTotals = {};
  let exampleUnreached = null;
  let negativeCorpusMin = Infinity;

  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (instance.scenario === 'N') negativeCorpusMin = Math.min(negativeCorpusMin, instance.passages.length);
    const docs = publicDocs(instance);
    const bytes = await api.buildPack(docs);
    const pack = api.mountPackFromBuffer(arrayBufferOf(bytes));
    const items = prepareCorpus(instance, api.tokenize, factMask);
    const producedPrefix = api.expandQueryWithGraph(pack, instance.query);
    const mirroredPrefix = mirrorPrefixQuery(instance.query, pack.claimGraph, api.tokenize, api.normalize);
    if (mirroredPrefix !== producedPrefix) {
      throw new Error(`Prefix mirror diverged from expandQueryWithGraph on ${instance.id}`);
    }
    const activation = activateAll(instance.query, pack.claimGraph, api.tokenize, api.normalize);
    const queries = {
      baseline: instance.query,
      prefix: instance.query,
      ceiling: expandedQuery(instance.query, activation.ceiling.terms),
    };
    for (const name of BLIND) queries[name] = expandedQuery(instance.query, activation[name].terms);
    const cache = new Map();
    const scoreQuery = (text, graphExpand) => {
      const key = `${graphExpand ? '1' : '0'}\n${text}`;
      if (cache.has(key)) return cache.get(key);
      const ranked = api.ranker.rankLexical(pack, text, graphExpand ? { graph: { expand: true } } : {});
      const produced = api.query(pack, text, {
        topK: 5,
        queryExpansion: { enabled: true, docs: 3, terms: 4, weight: 0.35, minTermLength: 3 },
        graph: { expand: graphExpand },
        semantic: { enabled: false },
      });
      const mirrored = api.ranker.mmrSelect(pack, ranked.ranked, 5);
      if (!sameHits(mirrored, produced)) throw new Error(`Lexical mirror diverged on ${instance.id}`);
      const scored = alignRanking(items, ranked.ranked, pack.docIds).scored;
      cache.set(key, scored);
      return scored;
    };
    const scored = {
      baseline: scoreQuery(queries.baseline, false),
      prefix: scoreQuery(queries.prefix, true),
    };
    for (const name of BLIND) scored[name] = scoreQuery(queries[name], false);
    scored.ceiling = scoreQuery(queries.ceiling, false);
    const recall = {};
    for (const name of ['baseline', 'prefix', ...BLIND, 'ceiling']) recall[name] = recallAt(scored[name], instance);
    const unions = {};
    recall.union = {};
    for (const depth of DEPTHS) {
      unions[depth] = unionByScore(['baseline', 'prefix', ...BLIND].map((name) => scored[name].slice(0, depth)));
      recall.union[depth] = poolRecall(unions[depth], instance);
    }
    const inventory = graphInventory(pack.claimGraph);
    addMaps(predicateTotals, inventory.predicates);
    const queryTokens = new Set(api.tokenize(instance.query).map((token) => token.term));
    if (!exampleUnreached && pack.claimGraph?.edges) {
      const labels = new Map((pack.claimGraph.nodes ?? []).map((node) => [node.id, node.label]));
      for (const edge of pack.claimGraph.edges) {
        if (edge.p !== 'is') continue;
        const objectLabel = labels.get(edge.to) ?? '';
        const shares = api.tokenize(objectLabel).some((token) => queryTokens.has(token.term));
        if (!shares && objectLabel) {
          exampleUnreached = `${labels.get(edge.from) ?? ''} is ${objectLabel}`.slice(0, 180);
          break;
        }
      }
    }
    const relations = new Map(instance.passages.map((passage) => [passage.id, passage.relation]));
    const flagPool = (pool) => ({
      unrequested: pool.some((item) => relations.get(item.id) === 'contradict') ? 1 : 0,
      irrelevant: pool.some((item) => relations.get(item.id) === 'irrelevant') ? 1 : 0,
    });
    let negative = null;
    if (instance.scenario === 'N') {
      const rank = scored.baseline.findIndex((item) => relations.get(item.id) === 'contradict');
      negative = {
        baseline: Object.fromEntries(DEPTHS.map((depth) => [depth, flagPool(scored.baseline.slice(0, depth))])),
        union: Object.fromEntries(DEPTHS.map((depth) => [depth, flagPool(unions[depth])])),
        ceiling: Object.fromEntries(DEPTHS.map((depth) => [depth, flagPool(scored.ceiling.slice(0, depth))])),
        unrequestedRank: rank === -1 ? null : rank + 1,
        unionSize50: unions[PRIMARY].length,
      };
    }
    const activity = {};
    for (const name of BLIND) {
      activity[name] = {
        terms: activation[name].terms.length,
        anchored: activation[name].anchored,
        edges: activation[name].edges,
      };
    }
    const relationRank = (list, relation, maskKey) => {
      const found = list.findIndex((item) => item.relation === relation && item.mask[maskKey] !== 0);
      return found === -1 ? null : found + 1;
    };
    records.push({
      id: instance.id,
      scenario: instance.scenario,
      variation: instance.variation,
      corpusSize: instance.passages.length,
      oppositionRequired: instance.required.opposition.length > 0,
      qualifierRequired: instance.required.qualifiers.length > 0,
      ranks: {
        baselineOpposition: relationRank(scored.baseline, 'contradict', 'o'),
        ceilingOpposition: relationRank(scored.ceiling, 'contradict', 'o'),
        baselineQualifier: relationRank(scored.baseline, 'qualify', 'q'),
        ceilingQualifier: relationRank(scored.ceiling, 'qualify', 'q'),
      },
      recall,
      activity,
      prefixChanged: producedPrefix !== instance.query,
      prefixTerms: producedPrefix === instance.query ? 0 : api.tokenize(producedPrefix).length - api.tokenize(instance.query).length,
      inventory,
      negative,
    });
    if ((index + 1) % 20 === 0 || index === instances.length - 1) console.error(`ranked ${index + 1}/${instances.length}`);
  }

  const first = instances[0];
  const firstDocs = publicDocs(first);
  const firstBytes = await api.buildPack(firstDocs);
  const firstPack = api.mountPackFromBuffer(arrayBufferOf(firstBytes));
  const firstActivation = JSON.stringify(activateAll(first.query, firstPack.claimGraph, api.tokenize, api.normalize));
  for (let run = 0; run < 20; run += 1) {
    const again = JSON.stringify(activateAll(first.query, firstPack.claimGraph, api.tokenize, api.normalize));
    if (again !== firstActivation) throw new Error('Activation was not repeatable');
  }

  const rng = mulberry32(SEED);
  const adversarial = records.filter((row) => ADVERSARIAL.has(row.scenario));
  const negativeRows = records.filter((row) => row.scenario === 'N');
  const methods = {};
  for (const name of METHODS) {
    methods[name] = {};
    for (const depth of DEPTHS) {
      methods[name][depth] = {
        opposition: boot(adversarial, (row) => row.recall[name][depth].opposition, rng),
        qualifier: boot(adversarial, (row) => row.recall[name][depth].qualifier, rng),
        support: boot(adversarial, (row) => row.recall[name][depth].support, rng),
      };
    }
  }
  const byScenario = {};
  for (const scenario of [...ADVERSARIAL, 'N']) {
    const rows = records.filter((row) => row.scenario === scenario);
    byScenario[scenario] = {};
    for (const name of METHODS) byScenario[scenario][name] = boot(rows, (row) => row.recall[name][PRIMARY].opposition, rng);
  }
  const negative = {};
  for (const depth of DEPTHS) {
    negative[depth] = {
      baselineUnrequested: boot(negativeRows, (row) => row.negative.baseline[depth].unrequested, rng),
      baselineIrrelevant: boot(negativeRows, (row) => row.negative.baseline[depth].irrelevant, rng),
      baselineSupport: boot(negativeRows, (row) => row.recall.baseline[depth].support, rng),
      unionUnrequested: boot(negativeRows, (row) => row.negative.union[depth].unrequested, rng),
      unionIrrelevant: boot(negativeRows, (row) => row.negative.union[depth].irrelevant, rng),
      unionSupport: boot(negativeRows, (row) => row.recall.union[depth].support, rng),
      ceilingUnrequested: boot(negativeRows, (row) => row.negative.ceiling[depth].unrequested, rng),
    };
  }
  const activity = {};
  for (const name of BLIND) {
    activity[name] = {
      meanTerms: meanOf(records, (row) => row.activity[name].terms),
      meanAnchored: meanOf(records, (row) => row.activity[name].anchored),
      meanEdges: meanOf(records, (row) => row.activity[name].edges),
      queriesChanged: records.filter((row) => row.activity[name].terms > 0).length,
    };
  }
  const baselineOpposition = methods.baseline[PRIMARY].opposition.mean;
  const baselineDelta = baselineOpposition === null ? null : baselineOpposition - EXPERIMENT1_OPPOSITION;
  if (limit === PER_SCENARIO && Math.abs(baselineDelta) > 0.005) {
    throw new Error(`Baseline opposition recall ${baselineOpposition} did not reproduce Experiment 1 (${EXPERIMENT1_OPPOSITION})`);
  }
  if (limit === PER_SCENARIO && negativeCorpusMin < NEGATIVE_CORPUS) {
    throw new Error(`Negative corpus min ${negativeCorpusMin} is below ${NEGATIVE_CORPUS}`);
  }
  const opp = methods.union[PRIMARY].opposition.mean ?? 0;
  const qual = methods.union[PRIMARY].qualifier.mean ?? 0;
  const dOpp = byScenario.D.union.mean ?? 0;
  const supportDrop = (methods.baseline[PRIMARY].support.mean ?? 0) - (methods.union[PRIMARY].support.mean ?? 0);
  const unrequested10 = negative[10].unionUnrequested.mean ?? 1;
  const ceilingD = byScenario.D.ceiling.mean ?? 0;
  const ceilingQual = methods.ceiling[PRIMARY].qualifier.mean ?? 0;
  const ranks = {
    ceilingOpposition: rankSummary(adversarial, (row) => row.oppositionRequired, (row) => row.ranks.ceilingOpposition),
    ceilingQualifier: rankSummary(adversarial, (row) => row.qualifierRequired, (row) => row.ranks.ceilingQualifier),
    baselineOpposition: rankSummary(adversarial, (row) => row.oppositionRequired, (row) => row.ranks.baselineOpposition),
  };
  const recallPass = opp >= 0.9 && qual >= 0.85 && dOpp >= 0.5 && supportDrop <= 0.05;
  const damageOk = unrequested10 <= 0.1;
  const decision = decide({
    opp,
    qual,
    dOpp,
    supportDrop,
    unrequested10,
    ceilingD,
    ceilingQual,
    recallPass,
    damageOk,
    negative,
    predicateTotals,
    ranks,
  });
  const summary = {
    commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
    seed: SEED,
    generator: GENERATOR_VERSION,
    activationVersion: ACTIVATION_VERSION,
    instanceCount: records.length,
    limited: limit !== PER_SCENARIO,
    perScenario: limit,
    negativeCorpusMin: Number.isFinite(negativeCorpusMin) ? negativeCorpusMin : 0,
    baselineDeltaToExperiment1: baselineDelta,
    methods,
    byScenario,
    negative,
    activity,
    prefixQueriesChanged: records.filter((row) => row.prefixChanged).length,
    graph: {
      packs: records.length,
      meanNodes: meanOf(records, (row) => row.inventory.nodes),
      meanEdges: meanOf(records, (row) => row.inventory.edges),
      predicateTotals,
      exampleUnreached,
    },
    ranks,
    unrequestedRank: {
      mean: meanOf(negativeRows.filter((row) => row.negative.unrequestedRank != null), (row) => row.negative.unrequestedRank),
      missing: negativeRows.filter((row) => row.negative.unrequestedRank == null).length,
    },
    decision,
  };
  const report = renderReport(summary);
  if (limit !== PER_SCENARIO) {
    writeFileSync('/tmp/kar-activation-summary.json', JSON.stringify(summary));
    writeFileSync('/tmp/kar-activation-report.md', report);
    console.error(`probe decision ${decision.label}`);
    return;
  }
  mkdirSync(path.join(OUT_DIR, 'results'), { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'results/results.json'), JSON.stringify({ commit: summary.commit, seed: SEED, records }));
  writeFileSync(path.join(OUT_DIR, 'results/summary.json'), JSON.stringify(summary));
  writeFileSync(path.join(OUT_DIR, 'RELATIONSHIP_ACTIVATION_REPORT.md'), report);
  console.error(`decision ${decision.label}`);
}

function decide(metrics) {
  const base = `Blind union opposition recall at depth 50 is ${pct(metrics.opp)}. Qualifier recall is ${pct(metrics.qual)}. Scenario D opposition recall is ${pct(metrics.dOpp)}. Support recall changes by ${pct(-metrics.supportDrop)} relative to the baseline. The gate asked for at least 90% opposition, 85% qualifier, scenario D at least 50%, and support within 5 points of the baseline.`;
  const ceiling = metrics.ceilingD >= 0.5
    ? metrics.dOpp >= 0.5
      ? `The all-edges ceiling reaches scenario D opposition recall ${pct(metrics.ceilingD)}, and the blind union also reaches ${pct(metrics.dOpp)}.`
      : `The all-edges ceiling reaches scenario D opposition recall ${pct(metrics.ceilingD)}. Those definitional edges are stored. The blind anchors do not reach them.`
    : `The all-edges ceiling stays at scenario D opposition recall ${pct(metrics.ceilingD)}. Activating every stored edge does not surface that contradiction.`;
  const qualifierRank = metrics.ranks?.ceilingQualifier;
  const qualifier = `The ceiling qualifier recall at depth 50 is ${pct(metrics.ceilingQual)}. Among ${qualifierRank?.eligible ?? 0} instances that require a qualifier, the ceiling places that passage inside rank 10 on ${qualifierRank?.within10 ?? 0} and gives it any score on ${qualifierRank?.scored ?? 0}. Median rank when scored: ${qualifierRank?.median ?? 'n/a'}.`;
  const damage = `On the 500-document negative corpus, unrequested-contradiction inclusion for the blind union is ${pct(metrics.negative[10].unionUnrequested.mean)} at depth 10, ${pct(metrics.negative[20].unionUnrequested.mean)} at depth 20, and ${pct(metrics.negative[50].unionUnrequested.mean)} at depth 50.`;
  const typedNames = ['except', 'exception', 'superseded_by', 'supersede', 'valid_before', 'valid_after', 'applies_to', 'overrides', 'contradicted_by', 'qualify', 'defined_as'];
  const typedPresent = typedNames.filter((name) => (metrics.predicateTotals?.[name] ?? 0) > 0);
  const typedSentence = typedPresent.length
    ? `Typed predicates other than is that occur in the packs: ${typedPresent.join(', ')}.`
    : 'The exception, override, and time predicates the typed rule knows how to walk do not occur in these packs.';
  const dSentence = metrics.dOpp >= 0.5
    ? 'Scenario D moved, and another part of the gate still failed.'
    : 'Scenario D stays below the pre-registered bar. Exact and prefix anchors, endpoint overlap, phrase anchors, reverse edges, two-hop closure, structural bridges, and typed traversal do not put that lexically disconnected contradiction into the candidate pool.';
  if (!metrics.recallPass) {
    return {
      label: 'FAIL',
      prose: `${base} ${ceiling} ${qualifier} ${damage} ${dSentence} ${typedSentence} This run does not design that layer and does not write a KAR specification.`,
    };
  }
  if (!metrics.damageOk) {
    return {
      label: 'PROMISING BUT DAMAGE',
      prose: `${base} ${ceiling} ${qualifier} ${damage} The recall gates pass and the depth-10 negative control does not. A later specification is not justified until unrequested activation stays low in a large corpus. This run does not write that specification.`,
    };
  }
  return {
    label: 'PASS',
    prose: `${base} ${ceiling} ${qualifier} ${damage} Deterministic relationship activation reached the disconnected contradiction on this corpus without the answer key. The pre-registered condition for a later mathematical specification is met. This run does not write that specification.`,
  };
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
