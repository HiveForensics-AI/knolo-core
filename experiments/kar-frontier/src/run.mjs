import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateInstances, GENERATOR_VERSION, PER_SCENARIO, SEED } from '../../kar-theory/fixtures/generate.mjs';
import { createRanker } from '../../kar-theory/src/lexical.mjs';
import { alignRanking, poolRecall, prepareCorpus, unionByScore } from '../../kar-theory/src/evaluate.mjs';
import { factMask } from '../../kar-theory/src/selector.mjs';
import { bootstrapMean, mulberry32 } from '../../kar-theory/src/stats.mjs';
import { cueFrontier, FRONTIER_VERSION, harvestFrontier, morphologicalFrontier } from './frontiers.mjs';
import { renderReport } from './report.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'experiments/kar-frontier');
const DIST = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
const LIMIT = process.env.KAR_LIMIT ? Number(process.env.KAR_LIMIT) : PER_SCENARIO;
const ADVERSARIAL = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'I', 'J']);
const DEPTH = 50;
const EXPERIMENT1_OPPOSITION = 0.78125;

const SOURCE_BANS = ['counterQuery', 'qualifierQuery', 'non-terminable', 'irrevocable', 'grandfathered', 'cutoff', '.relation', '.facts'];

function assertGeneratorIsBlind() {
  const source = readFileSync(path.join(import.meta.dirname, 'frontiers.mjs'), 'utf8');
  const hits = SOURCE_BANS.filter((term) => source.includes(term));
  if (hits.length) throw new Error(`Blind generator source contains withheld material: ${hits.join(', ')}`);
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

function publicDocs(instance) {
  return instance.passages.map((passage) => ({
    id: passage.id,
    heading: passage.heading,
    text: passage.text,
  }));
}

function recallOf(scored, instance) {
  return poolRecall(scored.slice(0, DEPTH), instance);
}

function boot(rows, getter, rng) {
  const values = [];
  for (const row of rows) {
    const value = getter(row);
    if (value !== null && value !== undefined && Number.isFinite(value)) values.push(value);
  }
  return bootstrapMean(values, rng, 1000);
}

async function main() {
  assertGeneratorIsBlind();
  const api = await loadCore();
  const limit = Number.isInteger(LIMIT) && LIMIT > 0 ? LIMIT : PER_SCENARIO;
  const instances = generateInstances().filter((instance) => instance.variation < limit);
  const records = [];
  const harvestCounts = new Map();
  let cueSentences = 0;
  const graphStats = [];

  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    const docs = publicDocs(instance);
    const bytes = await api.buildPack(docs);
    const pack = api.mountPackFromBuffer(arrayBufferOf(bytes));
    const items = prepareCorpus(instance, api.tokenize, factMask);
    const morph = morphologicalFrontier(instance.query, api.tokenize);
    const cues = cueFrontier();
    const harvest = harvestFrontier(instance.query, docs.map((doc) => doc.text), api.tokenize);
    cueSentences += harvest.cueSentences;
    for (const term of harvest.terms) harvestCounts.set(term.term, (harvestCounts.get(term.term) ?? 0) + 1);

    const expanded = api.expandQueryWithGraph(pack, instance.query);
    const queries = {
      baseline: instance.query,
      graph: instance.query,
      morphology: morph.query,
      cues: cues.query,
      'cue-harvest': harvest.query,
    };
    const scored = {};
    for (const [name, query] of Object.entries(queries)) {
      if (!query) {
        scored[name] = [];
        continue;
      }
      const opts = name === 'graph' ? { graph: { expand: true } } : {};
      const ranked = api.ranker.rankLexical(pack, query, opts);
      const produced = api.query(pack, query, {
        topK: 5,
        queryExpansion: { enabled: true, docs: 3, terms: 4, weight: 0.35, minTermLength: 3 },
        graph: { expand: name === 'graph' },
        semantic: { enabled: false },
      });
      const mirrored = api.ranker.mmrSelect(pack, ranked.ranked, 5);
      if (!sameHits(mirrored, produced)) {
        throw new Error(`Lexical mirror diverged on ${instance.id} method ${name}`);
      }
      scored[name] = alignRanking(items, ranked.ranked, pack.docIds).scored;
    }
    const union = unionByScore(Object.values(scored).map((list) => list.slice(0, DEPTH)));
    const recall = {};
    for (const name of Object.keys(scored)) recall[name] = recallOf(scored[name], instance);
    recall.union = poolRecall(union, instance);

    const graph = pack.claimGraph;
    const queryTokens = new Set(api.tokenize(instance.query).map((token) => token.term));
    let unreached = 0;
    let isEdges = 0;
    let example = null;
    if (graph?.edges) {
      const labels = new Map((graph.nodes ?? []).map((node) => [node.id, node.label]));
      for (const edge of graph.edges) {
        if (edge.p !== 'is') continue;
        isEdges += 1;
        const objectLabel = labels.get(edge.to) ?? '';
        const objectTokens = api.tokenize(objectLabel).map((token) => token.term);
        const shares = objectTokens.some((term) => queryTokens.has(term));
        if (!shares && objectTokens.length) {
          unreached += 1;
          if (!example) example = `${labels.get(edge.from) ?? ''} is ${objectLabel}`.slice(0, 180);
        }
      }
    }
    graphStats.push({
      nodes: graph?.nodes?.length ?? 0,
      edges: graph?.edges?.length ?? 0,
      isEdges,
      unreached,
      changed: expanded !== instance.query,
      example,
    });

    const relations = new Map(instance.passages.map((passage) => [passage.id, passage.relation]));
    const flag = (pool, relation) => (pool.some((item) => relations.get(item.id) === relation) ? 1 : 0);
    records.push({
      id: instance.id,
      scenario: instance.scenario,
      variation: instance.variation,
      recall,
      harvestTerms: harvest.terms.map((term) => term.term),
      expandedChanged: expanded !== instance.query,
      negative: {
        baselineUnrequested: flag(scored.baseline.slice(0, DEPTH), 'contradict'),
        baselineIrrelevant: flag(scored.baseline.slice(0, DEPTH), 'irrelevant'),
        unionUnrequested: flag(union, 'contradict'),
        unionIrrelevant: flag(union, 'irrelevant'),
      },
    });
    if ((index + 1) % 20 === 0 || index === instances.length - 1) console.error(`ranked ${index + 1}/${instances.length}`);
  }

  const repeated = morphologicalFrontier(instances[0].query, api.tokenize).query;
  for (let run = 0; run < 20; run += 1) {
    if (morphologicalFrontier(instances[0].query, api.tokenize).query !== repeated) {
      throw new Error('Morphological frontier was not repeatable');
    }
  }

  const rng = mulberry32(SEED);
  const adversarial = records.filter((row) => ADVERSARIAL.has(row.scenario));
  const negativeRows = records.filter((row) => row.scenario === 'N');
  const methodNames = ['baseline', 'graph', 'morphology', 'cues', 'cue-harvest', 'union'];
  const methods = {};
  for (const name of methodNames) {
    methods[name] = {
      opposition: boot(adversarial, (row) => row.recall[name].opposition, rng),
      qualifier: boot(adversarial, (row) => row.recall[name].qualifier, rng),
      support: boot(adversarial, (row) => row.recall[name].support, rng),
    };
  }
  const byScenario = {};
  for (const scenario of [...ADVERSARIAL, 'N']) {
    const rows = records.filter((row) => row.scenario === scenario);
    byScenario[scenario] = {};
    for (const name of methodNames) byScenario[scenario][name] = boot(rows, (row) => row.recall[name].opposition, rng);
  }
  const negative = {
    baselineUnrequested: boot(negativeRows, (row) => row.negative.baselineUnrequested, rng),
    baselineIrrelevant: boot(negativeRows, (row) => row.negative.baselineIrrelevant, rng),
    baselineSupport: boot(negativeRows, (row) => row.recall.baseline.support, rng),
    unionUnrequested: boot(negativeRows, (row) => row.negative.unionUnrequested, rng),
    unionIrrelevant: boot(negativeRows, (row) => row.negative.unionIrrelevant, rng),
    unionSupport: boot(negativeRows, (row) => row.recall.union.support, rng),
  };
  const baselineOpposition = methods.baseline.opposition.mean;
  const baselineDelta = baselineOpposition === null ? null : baselineOpposition - EXPERIMENT1_OPPOSITION;
  if (limit === PER_SCENARIO && Math.abs(baselineDelta) > 0.005) {
    throw new Error(`Baseline opposition recall ${baselineOpposition} did not reproduce Experiment 1 (${EXPERIMENT1_OPPOSITION})`);
  }
  const opp = methods.union.opposition.mean ?? 0;
  const qual = methods.union.qualifier.mean ?? 0;
  const damage = negative.unionUnrequested.mean ?? 1;
  const supportDrop = (negative.baselineSupport.mean ?? 0) - (negative.unionSupport.mean ?? 0);
  const passed = opp >= 0.9 && qual >= 0.85 && damage <= 0.1 && supportDrop <= 0.05;
  const decision = passed
    ? {
        label: 'PASS',
        prose: `The blind union reaches opposition recall ${pct(opp)} and qualifier recall ${pct(qual)} at depth 50, with negative-control unrequested inclusion ${pct(damage)} and support-recall change ${pct(-supportDrop)}. A later formal specification can treat deterministic frontier discovery as demonstrated on this corpus. This run does not write that specification.`,
      }
    : {
        label: 'FAIL',
        prose: `The blind union reaches opposition recall ${pct(opp)} and qualifier recall ${pct(qual)}. The gate asked for at least 90% and 85%. Negative-control unrequested inclusion is ${pct(damage)} in the union and ${pct(negative.baselineUnrequested.mean ?? 0)} in the baseline top 50. Support recall on N changes by ${pct(-supportDrop)} relative to the baseline. The per-method table is the measurement of what each frontier moved. The definitional edges stored in the pack stay unreached when \`expandQueryWithGraph\` changes no query, because the expander only walks labels that match the query. On this evidence, raw-text deterministic discovery does not meet the recall target. Frontier discovery still needs a relationship layer that connects the question to those edges. This run does not design that layer.`,
      };
  const mean = (getter) => graphStats.reduce((sum, row) => sum + getter(row), 0) / graphStats.length;
  const summary = {
    commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
    seed: SEED,
    generator: GENERATOR_VERSION,
    frontierVersion: FRONTIER_VERSION,
    instanceCount: records.length,
    limited: limit !== PER_SCENARIO,
    perScenario: limit,
    baselineDeltaToExperiment1: baselineDelta,
    methods,
    byScenario,
    negative,
    graph: {
      packs: graphStats.length,
      packsWithGraph: graphStats.filter((row) => row.edges > 0).length,
      meanNodes: mean((row) => row.nodes),
      meanEdges: mean((row) => row.edges),
      meanIsEdges: mean((row) => row.isEdges),
      meanUnreachedIsEdges: mean((row) => row.unreached),
      queriesChanged: graphStats.filter((row) => row.changed).length,
      exampleUnreached: graphStats.find((row) => row.example)?.example ?? null,
    },
    harvestLeaders: [...harvestCounts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 12)
      .map(([term, instances]) => ({ term, instances })),
    meanCueSentences: cueSentences / records.length,
    decision,
  };
  const report = renderReport(summary);
  if (limit !== PER_SCENARIO) {
    writeFileSync('/tmp/kar-frontier-summary.json', JSON.stringify(summary));
    writeFileSync('/tmp/kar-frontier-report.md', report);
    console.error(`probe decision ${decision.label}`);
    return;
  }
  mkdirSync(path.join(OUT_DIR, 'results'), { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'results/results.json'), JSON.stringify({ commit: summary.commit, seed: SEED, records }));
  writeFileSync(path.join(OUT_DIR, 'results/summary.json'), JSON.stringify(summary));
  writeFileSync(path.join(OUT_DIR, 'FRONTIER_DISCOVERY_REPORT.md'), report);
  console.error(`decision ${decision.label}`);
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
