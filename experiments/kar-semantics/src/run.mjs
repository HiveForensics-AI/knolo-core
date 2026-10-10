/**
 * KAR Experiment 4 runner.
 * The semantic compiler is frozen before this file evaluates any holdout query.
 * Query-time activation never calls a model.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateInstances, PER_SCENARIO, SEED } from '../../kar-theory/fixtures/generate.mjs';
import { createRanker } from '../../kar-theory/src/lexical.mjs';
import { poolRecall, prepareCorpus } from '../../kar-theory/src/evaluate.mjs';
import { factMask, selectOracle } from '../../kar-theory/src/selector.mjs';
import { bootstrapMean, mulberry32, round } from '../../kar-theory/src/stats.mjs';
import { activateAll, expandedQuery } from '../../kar-activation/src/activate.mjs';
import { activate } from './activate.mjs';
import { semanticArtifactRoot } from './canonicalize.mjs';
import { compileDocuments, projectProductionGraph, relationCounts } from './compile.mjs';
import { generateHoldout, generateNegative } from './holdout.mjs';
import { renderReport } from './report.mjs';
import { selfTestSemantics } from './selftest.mjs';
import { S2_MODEL, S2_PROVIDER, S2_TEMPERATURE, S2_VERSION, compileWithModel, PROMPT_DIGEST } from './s2.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'experiments/kar-semantics');
const HASH_FILE = path.join(OUT_DIR, 'frozen/COMPILER_HASH.txt');
const CACHE_FILE = path.join(OUT_DIR, 'frozen/s2-cache.jsonl');
const DIST = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
const LIMIT = process.env.KAR_LIMIT ? Number(process.env.KAR_LIMIT) : null;
const SKIP_S2 = process.env.KAR_SKIP_S2 === '1';
const DEPTH = 50;
const DAMAGE_DEPTH = 10;
const ADVERSARIAL = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'I', 'J']);
const BLIND = ['endpoint', 'phrase', 'reverse', 'twohop', 'bridge', 'typed'];
const DEV_BASELINE_OPPOSITION = 0.78125;
const GATES = { opposition: 0.9, qualifier: 0.85, disconnect: 0.75, supportDrop: 0.05, damage: 0.1 };
const ABLATIONS = {
  full: {},
  'no-aliases': { aliases: false },
  'no-typed': { typed: false },
  'no-reverse': { reverse: false },
  'no-exceptions': { exceptions: false },
  'no-temporal': { temporal: false },
  'no-lexical-union': {},
  'no-alias-no-reverse': { aliases: false, reverse: false },
};

function assertFrozenCompiler() {
  const files = ['lexicon.mjs', 'compile.mjs', 'activate.mjs', 'canonicalize.mjs', 's2.mjs'];
  const hash = createHash('sha256');
  const lines = [];
  for (const file of files) {
    const text = readFileSync(path.join(import.meta.dirname, file));
    lines.push(`${file} ${createHash('sha256').update(text).digest('hex')}`);
    hash.update(file);
    hash.update('\0');
    hash.update(text);
  }
  lines.push(`combined ${hash.digest('hex')}`);
  const expected = readFileSync(HASH_FILE, 'utf8').trim().split('\n').filter((line) => !line.startsWith('frozen-before'));
  if (expected.join('\n') !== lines.join('\n')) {
    throw new Error('Semantic compiler source hash does not match the frozen hash. Refusing to evaluate.');
  }
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
    tokenize: tokenize.tokenize,
    normalize: tokenize.normalize,
    diversify: diversify.diversifyAndDedupe,
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

function compilerDocs(instance) {
  return instance.passages.map((passage) => ({
    id: passage.id,
    heading: passage.heading,
    text: passage.text,
    source: {
      sourceId: passage.sourceId ?? null,
      validFrom: passage.validFrom ?? null,
      validTo: passage.validTo ?? null,
    },
  }));
}

function assertCompilerView(docs) {
  for (const doc of docs) {
    const keys = Object.keys(doc).sort().join(',');
    if (keys !== 'heading,id,source,text') throw new Error(`Compiler view leaked keys ${keys}`);
  }
}

function packDocs(instance) {
  return instance.passages.map((passage) => ({ id: passage.id, heading: passage.heading, text: passage.text }));
}

function applicable(passage, instance) {
  if (passage.unauthorized) return false;
  if (passage.validFrom && instance.asOf < passage.validFrom) return false;
  if (passage.validTo && instance.asOf >= passage.validTo) return false;
  return true;
}

function temporalRecall(ids, instance) {
  const wanted = new Set(instance.required?.temporal ?? []);
  const datedFacts = instance.passages.filter((passage) => {
    if (!applicable(passage, instance)) return false;
    if (wanted.size > 0) return passage.facts.some((fact) => wanted.has(fact));
    if (!passage.validFrom && !passage.validTo) return false;
    const required = new Set([...(instance.required?.support ?? []), ...(instance.required?.opposition ?? []), ...(instance.required?.qualifiers ?? [])]);
    return passage.facts.some((fact) => required.has(fact));
  });
  if (datedFacts.length === 0) return null;
  if (wanted.size > 0) {
    const covered = new Set();
    for (const passage of datedFacts) {
      if (!ids.includes(passage.id)) continue;
      for (const fact of passage.facts) if (wanted.has(fact)) covered.add(fact);
    }
    return covered.size / wanted.size;
  }
  const hit = datedFacts.filter((passage) => ids.includes(passage.id)).length;
  return hit / datedFacts.length;
}

function recallOf(ids, prepared, instance) {
  const byId = new Map(prepared.map((item) => [item.id, item]));
  const pool = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) pool.push(item);
  }
  const covered = poolRecall(pool, instance);
  return {
    support: covered.support,
    opposition: covered.opposition,
    qualifier: covered.qualifier,
    temporal: temporalRecall(ids, instance),
  };
}

function mmrIds(ranked, pack, passages, diversify, k) {
  const hits = ranked.slice(0, Math.max(k * 5, k)).map((hit) => ({
    blockId: hit.blockId,
    score: hit.score,
    text: pack.blocks[hit.blockId] ?? '',
    source: passages[hit.blockId]?.sourceId ?? '',
  }));
  return diversify(hits, { k }).map((hit) => passages[hit.blockId].id);
}

function topIds(ranked, passages, depth) {
  return ranked.slice(0, depth).map((hit) => passages[hit.blockId].id);
}

function semanticIds(activation, lexicalIds, depth, lexicalUnion) {
  const ids = [];
  const seen = new Set();
  const add = (list) => {
    for (const id of (list ?? []).slice(0, depth)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };
  add(activation.frontiers.opposition);
  add(activation.frontiers.qualifier);
  add(activation.frontiers.temporal);
  add(activation.frontiers.support);
  if (lexicalUnion) add(lexicalIds);
  return ids;
}

function reload(artifact) {
  const frozen = semanticArtifactRoot(artifact);
  const parsed = JSON.parse(frozen.canonical);
  const again = semanticArtifactRoot(parsed);
  if (again.root !== frozen.root) throw new Error('Frozen semantic bytes did not reload to the same root');
  return { artifact: parsed, root: frozen.root, bytes: Buffer.byteLength(frozen.canonical) };
}

function auditOf(artifact, latencyMs, bytes) {
  const aliasSlots = (artifact.claims ?? []).reduce((sum, claim) => sum + (claim.aliases?.length ?? 0), 0);
  return {
    claims: artifact.claims?.length ?? 0,
    edges: artifact.edges?.length ?? 0,
    aliasCount: aliasSlots,
    conceptKeys: Object.keys(artifact.aliases ?? {}).length,
    relations: relationCounts(artifact),
    bytes,
    latencyMs,
  };
}

function intersects(ids, decoys) {
  const present = new Set(ids);
  return decoys.some((id) => present.has(id)) ? 1 : 0;
}

function fractionIncluded(ids, decoys) {
  if (!decoys?.length) return null;
  const present = new Set(ids);
  return decoys.filter((id) => present.has(id)).length / decoys.length;
}

function sameHits(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index].blockId !== expected[index].blockId) return false;
    if (actual[index].score !== expected[index].score) return false;
  }
  return true;
}

function pushMetric(bucket, recall) {
  for (const key of ['support', 'opposition', 'qualifier', 'temporal']) {
    if (Number.isFinite(recall[key])) bucket[key].push(recall[key]);
  }
}

function boot(values, rng) {
  return bootstrapMean(values, rng, 1000);
}

async function modelAvailable() {
  if (SKIP_S2) return false;
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    if (!response.ok) return false;
    const body = await response.json();
    return (body.models ?? []).some((model) => model.name === S2_MODEL);
  } catch {
    return false;
  }
}

async function modelDigest() {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    const body = await response.json();
    return (body.models ?? []).find((model) => model.name === S2_MODEL)?.digest ?? null;
  } catch {
    return null;
  }
}

async function evaluateInstance(instance, api, s2On) {
  const view = compilerDocs(instance);
  assertCompilerView(view);
  const docs = packDocs(instance);
  const buildStarted = performance.now();
  const bytes = await api.buildPack(docs);
  const packMs = performance.now() - buildStarted;
  const pack = api.mountPackFromBuffer(arrayBufferOf(bytes));
  if (pack.blocks.length !== instance.passages.length) throw new Error(`Pack block count diverged on ${instance.id}`);
  const prepared = prepareCorpus(instance, api.tokenize, factMask);
  const cache = new Map();
  const score = (text, graphExpand) => {
    const key = `${graphExpand ? '1' : '0'}\n${text}`;
    if (cache.has(key)) return cache.get(key);
    const ranked = api.ranker.rankLexical(pack, text, graphExpand ? { graph: { expand: true } } : {}).ranked;
    cache.set(key, ranked);
    return ranked;
  };
  const baselineRanked = score(instance.query, false);
  if (instance.scenario === 'A' && instance.variation === 0 && (instance.split ?? 'development') === 'development') {
    const produced = api.ranker.productionHits(pack, instance.query, 5);
    const mirrored = api.ranker.mmrSelect(pack, baselineRanked, 5);
    if (!sameHits(mirrored, produced)) throw new Error('Lexical mirror diverged from production query() on A-00');
  }
  if (pack.docIds?.some((id, index) => id !== instance.passages[index].id)) {
    throw new Error(`Pack document order diverged on ${instance.id}`);
  }
  const b0 = topIds(baselineRanked, instance.passages, DEPTH);
  const b0At10 = topIds(baselineRanked, instance.passages, DAMAGE_DEPTH);
  const b1 = mmrIds(baselineRanked, pack, instance.passages, api.diversify, DEPTH);
  const b1At10 = mmrIds(baselineRanked, pack, instance.passages, api.diversify, DAMAGE_DEPTH);
  const b2 = topIds(score(instance.query, true), instance.passages, DEPTH);
  const blind = activateAll(instance.query, pack.claimGraph, api.tokenize, api.normalize);
  const b3Ids = new Set(b0);
  const prefixRanked = score(instance.query, true);
  for (const id of topIds(prefixRanked, instance.passages, DEPTH)) b3Ids.add(id);
  for (const name of BLIND) {
    for (const id of topIds(score(expandedQuery(instance.query, blind[name].terms), false), instance.passages, DEPTH)) b3Ids.add(id);
  }
  const s1Started = performance.now();
  const s1Compiled = compileDocuments(view, api.tokenize);
  const s1Latency = performance.now() - s1Started;
  const s1Frozen = reload(s1Compiled);
  const s0Frozen = reload(projectProductionGraph(pack.claimGraph, instance.passages.map((passage) => passage.id)));
  let s2Frozen = null;
  let s2Meta = null;
  if (s2On) {
    const s2Started = performance.now();
    const s2Compiled = await compileWithModel(view, api.tokenize, { cacheFile: CACHE_FILE, model: S2_MODEL });
    s2Frozen = reload(s2Compiled.artifact);
    s2Meta = { ...s2Compiled, latencyMs: performance.now() - s2Started, bytes: s2Frozen.bytes, root: s2Frozen.root };
    delete s2Meta.artifact;
  }
  const activateFrozen = (frozen, flags) => activate(instance.query, frozen.artifact, api.tokenize, flags);
  const methods = {
    b0: recallOf(b0, prepared, instance),
    b1: recallOf(b1, prepared, instance),
    b2: recallOf(b2, prepared, instance),
    b3: recallOf([...b3Ids], prepared, instance),
    s0: recallOf(semanticIds(activateFrozen(s0Frozen, {}), b0, DEPTH, true), prepared, instance),
    s1: recallOf(semanticIds(activateFrozen(s1Frozen, {}), b0, DEPTH, true), prepared, instance),
  };
  if (s2Frozen) methods.s2 = recallOf(semanticIds(activateFrozen(s2Frozen, {}), b0, DEPTH, true), prepared, instance);
  const oracleIds = instance.passages.filter((passage) => applicable(passage, instance) && passage.facts.some((fact) => (
    (instance.required?.support ?? []).includes(fact)
    || (instance.required?.opposition ?? []).includes(fact)
    || (instance.required?.qualifiers ?? []).includes(fact)
    || (instance.required?.temporal ?? []).includes(fact)
  ))).map((passage) => passage.id);
  methods.oracle = recallOf(oracleIds, prepared, instance);
  const ablations = {};
  for (const [name, flags] of Object.entries(ABLATIONS)) {
    const lexicalUnion = name !== 'no-lexical-union';
    ablations[name] = {
      s1: recallOf(semanticIds(activateFrozen(s1Frozen, flags), b0, DEPTH, lexicalUnion), prepared, instance),
    };
    if (s2Frozen) ablations[name].s2 = recallOf(semanticIds(activateFrozen(s2Frozen, flags), b0, DEPTH, lexicalUnion), prepared, instance);
  }
  const selectorPool = (ids) => ids.map((id) => prepared.find((item) => item.id === id)).filter(Boolean);
  const limits = { K: 5, tau: 1, gamma: 1, qTau: 1 };
  const selector = {
    b0: selectOracle(selectorPool(b0), instance, limits).status === 'SATISFIED' ? 1 : 0,
    s1: selectOracle(selectorPool(semanticIds(activateFrozen(s1Frozen, {}), b0, DEPTH, true)), instance, limits).status === 'SATISFIED' ? 1 : 0,
  };
  const negative = instance.decoyOppositionIds ? {
    b0Opposition: intersects(b0At10, instance.decoyOppositionIds),
    b0Qualifier: intersects(b0At10, instance.decoyQualifierIds),
    b1Opposition: intersects(b1At10, instance.decoyOppositionIds),
    s1Opposition: intersects(semanticIds(activateFrozen(s1Frozen, {}), b0At10, DAMAGE_DEPTH, true), instance.decoyOppositionIds),
    s1Qualifier: intersects(semanticIds(activateFrozen(s1Frozen, {}), b0At10, DAMAGE_DEPTH, true), instance.decoyQualifierIds),
    s1OppositionFraction: fractionIncluded(semanticIds(activateFrozen(s1Frozen, {}), b0At10, DAMAGE_DEPTH, true), instance.decoyOppositionIds),
    s1QualifierFraction: fractionIncluded(semanticIds(activateFrozen(s1Frozen, {}), b0At10, DAMAGE_DEPTH, true), instance.decoyQualifierIds),
    b0Pool: b0.length,
    s1Pool: semanticIds(activateFrozen(s1Frozen, {}), b0, DEPTH, true).length,
  } : null;
  if (negative && s2Frozen) {
    const s2Ids = semanticIds(activateFrozen(s2Frozen, {}), b0At10, DAMAGE_DEPTH, true);
    negative.s2Opposition = intersects(s2Ids, instance.decoyOppositionIds);
    negative.s2Qualifier = intersects(s2Ids, instance.decoyQualifierIds);
    negative.s2Pool = semanticIds(activateFrozen(s2Frozen, {}), b0, DEPTH, true).length;
  }
  return {
    id: instance.id,
    split: instance.split ?? 'development',
    scenario: instance.scenario,
    domain: instance.domain ?? null,
    oppositionStratum: instance.oppositionStratum ?? null,
    qualifierStratum: instance.qualifierStratum ?? null,
    disconnect: Boolean(instance.disconnect),
    corpusSize: instance.passages.length,
    packBytes: bytes.byteLength,
    packMs,
    recall: methods,
    ablations,
    selector,
    negative,
    audit: {
      s0: auditOf(s0Frozen.artifact, 0, s0Frozen.bytes),
      s1: auditOf(s1Frozen.artifact, s1Latency, s1Frozen.bytes),
      ...(s2Meta ? { s2: auditOf(s2Frozen.artifact, s2Meta.latencyMs, s2Meta.bytes) } : {}),
    },
    roots: { s1: s1Frozen.root, ...(s2Frozen ? { s2: s2Frozen.root } : {}) },
    s2Meta: s2Meta ? { calls: s2Meta.calls, cacheHits: s2Meta.cacheHits, failures: s2Meta.failures } : null,
    proofArtifact: s1Frozen.artifact,
    proofView: view,
  };
}

function repeatActivation(query, artifact, tokenize) {
  const first = JSON.stringify(activate(query, artifact, tokenize, {}));
  let mismatches = 0;
  for (let run = 0; run < 100; run += 1) {
    if (JSON.stringify(activate(query, artifact, tokenize, {})) !== first) mismatches += 1;
  }
  return mismatches;
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function addRelations(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) target[key] = (target[key] ?? 0) + value;
}

function passesRecall(metrics, baselineSupport) {
  if (!metrics) return false;
  return metrics.opposition.mean >= GATES.opposition
    && metrics.qualifier.mean >= GATES.qualifier
    && metrics.disconnect.mean >= GATES.disconnect
    && metrics.support.mean >= baselineSupport - GATES.supportDrop;
}

function decide(summary) {
  const candidate = summary.s2Status.startsWith('NOT RUN') ? 's1' : (summary.best ?? 's1');
  const holdout = summary.holdout[candidate];
  const dev = summary.development[candidate];
  const damage = summary.damage[candidate];
  const holdoutPass = passesRecall(holdout, summary.holdout.b0.support.mean);
  const devPass = dev
    && dev.opposition.mean >= GATES.opposition
    && dev.qualifier.mean >= GATES.qualifier
    && dev.scenarioD.mean >= GATES.disconnect
    && dev.support.mean >= summary.development.b0.support.mean - GATES.supportDrop;
  const damagePass = damage.opposition.mean <= GATES.damage && damage.qualifier.mean <= GATES.damage;
  const detPass = summary.determinism.mismatches === 0;
  const oppGain = (holdout?.opposition.mean ?? 0) - summary.holdout.b0.opposition.mean;
  const disconnectGain = (holdout?.disconnect.mean ?? 0) - summary.holdout.b0.disconnect.mean;
  const devDGain = (dev?.scenarioD.mean ?? 0) - (summary.development.b0.scenarioD.mean ?? 0);
  const substantial = oppGain >= 0.1 || disconnectGain >= 0.25 || devDGain >= 0.25;
  let label = 'INCONCLUSIVE';
  if (holdoutPass && devPass && damagePass && detPass) label = 'GO_TO_KAR_SPEC';
  else if (substantial) label = 'SEMANTIC_LAYER_PROMISING_BUT_BLOCKED';
  else if (oppGain < 0.05 && disconnectGain < 0.1 && devDGain < 0.1) label = 'CURRENT_KAR_DIRECTION_NO_GO';
  return {
    label,
    candidate,
    holdoutPass,
    devPass,
    damagePass,
    detPass,
    oppGain,
    disconnectGain,
    devDGain,
    substantial,
  };
}

async function main() {
  assertFrozenCompiler();
  const api = await loadCore();
  await selfTestSemantics(api.tokenize);
  const s2On = await modelAvailable();
  const development = generateInstances().filter((instance) => !LIMIT || instance.variation < LIMIT);
  const holdout = generateHoldout(api.tokenize).filter((instance) => !LIMIT || instance.variation < LIMIT);
  const negative = generateNegative(api.tokenize).filter((instance) => !LIMIT || instance.variation < LIMIT);
  const queue = [
    ...development.map((instance) => ({ ...instance, split: 'development' })),
    ...holdout,
    ...negative,
  ];
  const records = [];
  let proof = null;
  let determinismMismatches = 0;
  const s2Totals = { calls: 0, cacheHits: 0, failures: 0 };
  for (let index = 0; index < queue.length; index += 1) {
    const evaluated = await evaluateInstance(queue[index], api, s2On);
    if (evaluated.s2Meta) {
      s2Totals.calls += evaluated.s2Meta.calls;
      s2Totals.cacheHits += evaluated.s2Meta.cacheHits;
      s2Totals.failures += evaluated.s2Meta.failures;
    }
    if (!proof && evaluated.split === 'development') {
      const first = compileDocuments(evaluated.proofView, api.tokenize);
      const second = compileDocuments(evaluated.proofView, api.tokenize);
      const left = semanticArtifactRoot(first);
      const right = semanticArtifactRoot(second);
      const reloaded = semanticArtifactRoot(JSON.parse(left.canonical));
      proof = {
        instance: evaluated.id,
        first: left.root,
        second: right.root,
        reloaded: reloaded.root,
        identical: left.root === right.root && left.root === reloaded.root,
        canonicalBytes: Buffer.byteLength(left.canonical),
      };
      determinismMismatches += repeatActivation(queue[index].query, JSON.parse(left.canonical), api.tokenize);
    }
    if (evaluated.split === 'holdout' && evaluated.id === holdout[0]?.id) {
      determinismMismatches += repeatActivation(queue[index].query, evaluated.proofArtifact, api.tokenize);
    }
    delete evaluated.proofArtifact;
    delete evaluated.proofView;
    delete evaluated.s2Meta;
    records.push(evaluated);
    if ((index + 1) % 20 === 0 || index + 1 === queue.length) process.stderr.write(`ranked ${index + 1}/${queue.length}\n`);
  }
  const fullDev = !LIMIT || LIMIT >= PER_SCENARIO;
  const devRows = records.filter((row) => row.split === 'development');
  const adversarial = devRows.filter((row) => ADVERSARIAL.has(row.scenario));
  if (fullDev) {
    const observed = mean(adversarial.map((row) => row.recall.b0.opposition));
    if (Math.abs(observed - DEV_BASELINE_OPPOSITION) > 0.005) {
      throw new Error(`Development baseline opposition ${observed} drifted from ${DEV_BASELINE_OPPOSITION}`);
    }
  }
  const negativeRows = records.filter((row) => row.split === 'negative');
  const baselineDamage = mean(negativeRows.map((row) => row.negative.b0Opposition));
  if (negativeRows.length >= NEGATIVE_MIN() && baselineDamage > 0) {
    throw new Error(`Negative control is not discriminative: baseline opposition inclusion at depth 10 is ${baselineDamage}`);
  }
  const rng = mulberry32(SEED);
  const summary = buildSummary(records, proof, determinismMismatches, s2On, s2Totals, rng);
  summary.model = {
    provider: s2On ? S2_PROVIDER : null,
    model: s2On ? S2_MODEL : null,
    digest: s2On ? await modelDigest() : null,
    temperature: s2On ? S2_TEMPERATURE : null,
    promptDigest: s2On ? PROMPT_DIGEST : null,
    compiler: s2On ? S2_VERSION : null,
    calls: s2Totals.calls,
    cacheHits: s2Totals.cacheHits,
    failures: s2Totals.failures,
  };
  summary.decision = decide(summary);
  const probe = Boolean(LIMIT && LIMIT < PER_SCENARIO);
  const payload = { summary, records: records.map(stripRecord) };
  if (probe) {
    writeFileSync('/tmp/kar-semantics-summary.json', JSON.stringify(summary, null, 2));
    writeFileSync('/tmp/kar-semantics-report.md', renderReport(summary));
    process.stderr.write(`probe decision ${summary.decision.label}\n`);
    return;
  }
  mkdirSync(path.join(OUT_DIR, 'results'), { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'results/summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(OUT_DIR, 'results/results.json'), JSON.stringify(payload, null, 2));
  writeFileSync(path.join(OUT_DIR, 'COMMITTED_SEMANTICS_REPORT.md'), renderReport(summary));
  process.stderr.write(`decision ${summary.decision.label}\n`);
}

function NEGATIVE_MIN() {
  return LIMIT ? Math.min(LIMIT, 100) : 100;
}

function metricBlock(rows, getter, rng) {
  return {
    support: boot(rows.map((row) => getter(row).support), rng),
    opposition: boot(rows.map((row) => getter(row).opposition), rng),
    qualifier: boot(rows.map((row) => getter(row).qualifier), rng),
    temporal: boot(rows.map((row) => getter(row).temporal), rng),
  };
}

function buildSummary(records, proof, mismatches, s2On, s2Totals, rng) {
  const dev = records.filter((row) => row.split === 'development' && ADVERSARIAL.has(row.scenario));
  const scenarioD = dev.filter((row) => row.scenario === 'D');
  const holdout = records.filter((row) => row.split === 'holdout');
  const negative = records.filter((row) => row.split === 'negative');
  const methods = ['b0', 'b1', 'b2', 'b3', 's0', 's1', ...(s2On ? ['s2'] : []), 'oracle'];
  const development = {};
  const holdoutMetrics = {};
  for (const method of methods) {
    development[method] = {
      ...metricBlock(dev, (row) => row.recall[method], rng),
      scenarioD: boot(scenarioD.map((row) => row.recall[method].opposition), rng),
    };
    holdoutMetrics[method] = {
      ...metricBlock(holdout, (row) => row.recall[method], rng),
      disconnect: boot(holdout.map((row) => row.recall[method].opposition), rng),
      inLexiconOpposition: boot(holdout.filter((row) => row.oppositionStratum === 'in-lexicon').map((row) => row.recall[method].opposition), rng),
      stressOpposition: boot(holdout.filter((row) => row.oppositionStratum === 'stress').map((row) => row.recall[method].opposition), rng),
      inLexiconQualifier: boot(holdout.filter((row) => row.qualifierStratum === 'in-lexicon').map((row) => row.recall[method].qualifier), rng),
      stressQualifier: boot(holdout.filter((row) => row.qualifierStratum === 'stress').map((row) => row.recall[method].qualifier), rng),
    };
  }
  const best = s2On && (holdoutMetrics.s2.opposition.mean ?? 0) > (holdoutMetrics.s1.opposition.mean ?? 0) ? 's2' : 's1';
  const ablations = {};
  for (const name of Object.keys(ABLATIONS)) {
    ablations[name] = {
      developmentOpposition: boot(dev.map((row) => row.ablations[name][best].opposition), rng),
      developmentQualifier: boot(dev.map((row) => row.ablations[name][best].qualifier), rng),
      scenarioD: boot(scenarioD.map((row) => row.ablations[name][best].opposition), rng),
      holdoutOpposition: boot(holdout.map((row) => row.ablations[name][best].opposition), rng),
      holdoutQualifier: boot(holdout.map((row) => row.ablations[name][best].qualifier), rng),
      holdoutSupport: boot(holdout.map((row) => row.ablations[name][best].support), rng),
      holdoutTemporal: boot(holdout.map((row) => row.ablations[name][best].temporal), rng),
    };
  }
  const damageFor = (method) => ({
    opposition: boot(negative.map((row) => row.negative[`${method}Opposition`] - row.negative.b0Opposition), rng),
    qualifier: boot(negative.map((row) => row.negative[`${method}Qualifier`] - row.negative.b0Qualifier), rng),
    baselineOpposition: boot(negative.map((row) => row.negative.b0Opposition), rng),
    methodOpposition: boot(negative.map((row) => row.negative[`${method}Opposition`]), rng),
    baselineQualifier: boot(negative.map((row) => row.negative.b0Qualifier), rng),
    methodQualifier: boot(negative.map((row) => row.negative[`${method}Qualifier`]), rng),
    poolGrowth: boot(negative.map((row) => (row.negative[`${method}Pool`] ?? row.negative.s1Pool) - row.negative.b0Pool), rng),
  });
  const audits = {};
  for (const kind of ['s0', 's1', ...(s2On ? ['s2'] : [])]) {
    const rows = records.filter((row) => row.audit[kind]);
    const relations = {};
    for (const row of rows) addRelations(relations, row.audit[kind].relations);
    audits[kind] = {
      claims: boot(rows.map((row) => row.audit[kind].claims), rng),
      edges: boot(rows.map((row) => row.audit[kind].edges), rng),
      aliasCount: boot(rows.map((row) => row.audit[kind].aliasCount), rng),
      bytes: boot(rows.map((row) => row.audit[kind].bytes), rng),
      latencyMs: boot(rows.map((row) => row.audit[kind].latencyMs), rng),
      packBytes: boot(rows.map((row) => row.packBytes), rng),
      relations,
    };
  }
  const selector = {
    b0: boot(dev.map((row) => row.selector.b0), rng),
    s1: boot(dev.map((row) => row.selector.s1), rng),
    holdoutB0: boot(holdout.map((row) => row.selector.b0), rng),
    holdoutS1: boot(holdout.map((row) => row.selector.s1), rng),
  };
  return {
    experiment: 'kar-semantics-1',
    seed: SEED,
    holdoutSeed: 20261010,
    negativeSeed: 20261011,
    limit: LIMIT,
    gates: GATES,
    s2Status: s2On ? 'RUN' : 'NOT RUN — MODEL UNAVAILABLE',
    s2Totals,
    counts: {
      development: records.filter((row) => row.split === 'development').length,
      adversarial: dev.length,
      scenarioD: scenarioD.length,
      holdout: holdout.length,
      holdoutDisconnect: holdout.filter((row) => row.disconnect).length,
      holdoutQualifier: holdout.filter((row) => Number.isFinite(row.recall.b0.qualifier)).length,
      holdoutTemporal: holdout.filter((row) => Number.isFinite(row.recall.b0.temporal)).length,
      negative: negative.length,
      negativeCorpus: negative[0]?.corpusSize ?? 0,
    },
    development,
    holdout: holdoutMetrics,
    damage: { s1: damageFor('s1'), ...(s2On ? { s2: damageFor('s2') } : {}) },
    ablations,
    best,
    audits,
    selector,
    proof,
    determinism: { runs: 200, mismatches },
    compilerClassification: {
      s1: 'deterministic compiler',
      s2: s2On ? 'non-deterministic compiler with committed frozen output' : 'NOT RUN — MODEL UNAVAILABLE',
    },
  };
}

function stripRecord(record) {
  return {
    id: record.id,
    split: record.split,
    scenario: record.scenario,
    domain: record.domain,
    oppositionStratum: record.oppositionStratum,
    qualifierStratum: record.qualifierStratum,
    disconnect: record.disconnect,
    corpusSize: record.corpusSize,
    packBytes: record.packBytes,
    recall: record.recall,
    ablations: record.ablations,
    selector: record.selector,
    negative: record.negative,
    audit: record.audit,
    roots: record.roots,
  };
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
