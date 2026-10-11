/**
 * KAR Experiment 5 runner.
 * The generalization compiler is frozen before this file evaluates any query.
 * Query-time activation never calls a model.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRanker } from '../../kar-theory/src/lexical.mjs';
import { poolRecall, prepareCorpus } from '../../kar-theory/src/evaluate.mjs';
import { factMask } from '../../kar-theory/src/selector.mjs';
import { bootstrapMean, mulberry32, summarize } from '../../kar-theory/src/stats.mjs';
import { activate as activateLexicon } from '../../kar-semantics/src/activate.mjs';
import { compileDocuments } from '../../kar-semantics/src/compile.mjs';
import { activate } from './activate.mjs';
import { semanticArtifactRoot } from './canonicalize.mjs';
import {
  G1_MODEL, G1_PROVIDER, G1_TEMPERATURE, G1_VERSION, PROMPT_DIGEST,
  compileWithModel, compilerTotals, relationCounts, resetCompilerTotals,
} from './compile.mjs';
import { DEV_COUNT, DEV_SEED, generateDevelopment, generateHoldout, generateNegative, HOLDOUT_SEED, NEGATIVE_CORPUS, NEGATIVE_SEED } from './corpus.mjs';
import { renderReport } from './report.mjs';
import { selfTestGeneralization } from './selftest.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'experiments/kar-generalization');
const HASH_FILE = path.join(OUT_DIR, 'frozen/COMPILER_HASH.txt');
const CACHE_FILE = path.join(OUT_DIR, 'frozen/g1-cache.jsonl');
const DIST = process.env.KNOLO_DIST ?? '/tmp/knolo-kar-dist';
const LIMIT = process.env.KAR_LIMIT ? Number(process.env.KAR_LIMIT) : null;
const DEPTH = 50;
const DAMAGE_DEPTH = 10;
const BOOT_SEED = 20261012;
const GATES = {
  opposition: 0.85,
  qualifier: 0.8,
  supportDrop: 0.05,
  damage: 0.1,
  lexiconControl: 0.15,
  parseFailure: 0.2,
};
const ABLATIONS = [
  ['full', {}],
  ['action-only', { mode: 'action-only' }],
  ['entity-only', { mode: 'entity-only' }],
  ['surface-only', { paraphrases: false }],
  ['siblings', { mode: 'siblings' }],
  ['no-lexical-union', {}],
];

function assertFrozenCompiler() {
  const files = ['compile.mjs', 'activate.mjs', 'canonicalize.mjs'];
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
    throw new Error('Generalization compiler source hash does not match the frozen hash. Refusing to evaluate.');
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
    heading: passage.heading ?? '',
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
    if (JSON.stringify(doc).includes(doc.id) && doc.text.includes('binding-limit')) {
      throw new Error('Compiler view contains a fact label');
    }
  }
}

function packDocs(instance) {
  return instance.passages.map((passage) => ({ id: passage.id, heading: passage.heading ?? '', text: passage.text }));
}

function recallOf(ids, prepared, instance) {
  const byId = new Map(prepared.map((item) => [item.id, item]));
  const pool = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) pool.push(item);
  }
  return poolRecall(pool, instance);
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

function included(ids, decoys) {
  const present = new Set(ids);
  return (decoys ?? []).some((id) => present.has(id)) ? 1 : 0;
}

function auditOf(artifact, latencyMs, bytes) {
  const claims = artifact?.claims ?? [];
  return {
    claims: claims.length,
    edges: artifact?.edges?.length ?? 0,
    aliasSlots: claims.reduce((sum, claim) => sum + (claim.entityAliases?.length ?? 0) + (claim.actionAliases?.length ?? 0) + (claim.aliases?.length ?? 0), 0),
    bytes,
    buildMs: latencyMs,
    relations: relationCounts(artifact),
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

async function modelAvailable() {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const body = await response.json();
    return (body.models ?? []).find((model) => model.name === G1_MODEL || model.model === G1_MODEL) ?? null;
  } catch {
    return null;
  }
}

async function evaluateInstance(instance, api) {
  const view = compilerDocs(instance);
  assertCompilerView(view);
  const docs = packDocs(instance);
  const bytes = await api.buildPack(docs);
  const pack = api.mountPackFromBuffer(arrayBufferOf(bytes));
  if (pack.blocks.length !== instance.passages.length) throw new Error(`Pack block count diverged on ${instance.id}`);
  if (pack.docIds?.some((id, index) => id !== instance.passages[index].id)) {
    throw new Error(`Pack document order diverged on ${instance.id}`);
  }
  const prepared = prepareCorpus(instance, api.tokenize, factMask);
  const baselineRanked = api.ranker.rankLexical(pack, instance.query, {}).ranked;
  const b0 = topIds(baselineRanked, instance.passages, DEPTH);
  const b0At10 = topIds(baselineRanked, instance.passages, DAMAGE_DEPTH);
  const l0Started = performance.now();
  const l0Artifact = compileDocuments(view, api.tokenize);
  const l0Latency = performance.now() - l0Started;
  const l0Frozen = semanticArtifactRoot(l0Artifact);
  const l0Parsed = JSON.parse(l0Frozen.canonical);
  const g1Started = performance.now();
  const g1Compiled = await compileWithModel(view, api.tokenize, { cacheFile: CACHE_FILE, model: G1_MODEL });
  const g1Latency = performance.now() - g1Started;
  const g1Frozen = semanticArtifactRoot(g1Compiled.artifact);
  if (g1Frozen.root !== g1Compiled.root) throw new Error(`Frozen G1 bytes did not reload on ${instance.id}`);
  const g1Artifact = JSON.parse(g1Frozen.canonical);
  const activateG1 = (flags) => activate(instance.query, g1Artifact, api.tokenize, flags);
  const l0Activation = activateLexicon(instance.query, l0Parsed, api.tokenize, {});
  const methods = {
    b0: recallOf(b0, prepared, instance),
    l0: recallOf(semanticIds(l0Activation, b0, DEPTH, true), prepared, instance),
    g1: recallOf(semanticIds(activateG1({}), b0, DEPTH, true), prepared, instance),
  };
  const oracleIds = instance.passages.filter((passage) => passage.facts.some((fact) => (
    (instance.required?.support ?? []).includes(fact)
    || (instance.required?.opposition ?? []).includes(fact)
    || (instance.required?.qualifiers ?? []).includes(fact)
  ))).map((passage) => passage.id);
  methods.oracle = recallOf(oracleIds, prepared, instance);
  const ablations = {};
  for (const [name, flags] of ABLATIONS) {
    const lexicalUnion = name !== 'no-lexical-union';
    ablations[name] = recallOf(semanticIds(activateG1(flags), b0, DEPTH, lexicalUnion), prepared, instance);
  }
  const negative = instance.decoyOppositionIds ? {
    b0Opposition: included(b0At10, instance.decoyOppositionIds),
    b0Qualifier: included(b0At10, instance.decoyQualifierIds),
    g1Opposition: included(semanticIds(activateG1({}), b0At10, DAMAGE_DEPTH, true), instance.decoyOppositionIds),
    g1Qualifier: included(semanticIds(activateG1({}), b0At10, DAMAGE_DEPTH, true), instance.decoyQualifierIds),
    actionOnlyOpposition: included(semanticIds(activateG1({ mode: 'action-only' }), b0At10, DAMAGE_DEPTH, true), instance.decoyOppositionIds),
    actionOnlyQualifier: included(semanticIds(activateG1({ mode: 'action-only' }), b0At10, DAMAGE_DEPTH, true), instance.decoyQualifierIds),
    b0Pool: b0.length,
    g1Pool: semanticIds(activateG1({}), b0, DEPTH, true).length,
  } : null;
  return {
    id: instance.id,
    split: instance.split,
    scenario: instance.scenario,
    domain: instance.domain,
    disconnect: Boolean(instance.disconnect),
    corpusSize: instance.passages.length,
    packBytes: bytes.byteLength,
    recall: methods,
    ablations,
    negative,
    audit: {
      l0: auditOf(l0Parsed, l0Latency, Buffer.byteLength(l0Frozen.canonical)),
      g1: auditOf(g1Artifact, g1Latency, Buffer.byteLength(g1Frozen.canonical)),
    },
    roots: { g1: g1Frozen.root },
    g1Meta: { calls: g1Compiled.calls, cacheHits: g1Compiled.cacheHits, failures: g1Compiled.failures, gated: g1Compiled.gated },
    proofArtifact: instance.split === 'development' || instance.variation === 0 ? g1Artifact : null,
    proofView: instance.split === 'development' && instance.variation === 0 ? view : null,
  };
}

function boot(values, rng) {
  return bootstrapMean(values, rng);
}

function metricBlock(rows, getter, rng) {
  return {
    support: boot(rows.map((row) => getter(row).support), rng),
    opposition: boot(rows.map((row) => getter(row).opposition), rng),
    qualifier: boot(rows.map((row) => getter(row).qualifier), rng),
  };
}

function fieldBlock(rows, selector, rng) {
  const block = {};
  for (const method of ['b0', 'l0', 'g1', 'oracle']) block[method] = metricBlock(rows, (row) => selector(row)[method], rng);
  return block;
}

function auditBlock(rows, key) {
  return {
    claims: summarize(rows.map((row) => row.audit[key].claims)),
    edges: summarize(rows.map((row) => row.audit[key].edges)),
    aliasSlots: summarize(rows.map((row) => row.audit[key].aliasSlots)),
    bytes: summarize(rows.map((row) => row.audit[key].bytes)),
    buildMs: summarize(rows.map((row) => row.audit[key].buildMs)),
  };
}

function decide(summary) {
  const g1 = summary.holdout?.g1;
  const b0 = summary.holdout?.b0;
  const l0 = summary.holdout?.l0;
  const damage = summary.damage ?? {};
  const parseRate = summary.model?.parseRate;
  const supportDrop = (b0?.support?.mean ?? 0) - (g1?.support?.mean ?? 0);
  const oppGain = (g1?.opposition?.mean ?? 0) - Math.max(b0?.opposition?.mean ?? 0, l0?.opposition?.mean ?? 0);
  const qualGain = (g1?.qualifier?.mean ?? 0) - Math.max(b0?.qualifier?.mean ?? 0, l0?.qualifier?.mean ?? 0);
  const fixtureBroken = !summary.model?.available
    || !summary.proof?.identical
    || (parseRate ?? 1) > GATES.parseFailure
    || (l0?.opposition?.mean ?? 1) > GATES.lexiconControl
    || (b0?.support?.mean ?? 0) < 0.95
    || (damage.baselineOpposition?.mean ?? 1) > 0
    || (damage.baselineQualifier?.mean ?? 1) > 0;
  const gatesOk = !fixtureBroken
    && summary.determinism?.mismatches === 0
    && (g1?.opposition?.mean ?? 0) >= GATES.opposition
    && (g1?.qualifier?.mean ?? 0) >= GATES.qualifier
    && supportDrop <= GATES.supportDrop
    && (damage.opposition?.mean ?? 1) <= GATES.damage
    && (damage.qualifier?.mean ?? 1) <= GATES.damage;
  let label = 'GENERALIZATION_NOT_SHOWN';
  if (fixtureBroken) label = 'INCONCLUSIVE';
  else if (gatesOk) label = 'GO_TO_KAR_SPEC';
  else if (oppGain >= 0.25 || qualGain >= 0.2) label = 'GENERALIZATION_PARTIAL';
  return { label, candidate: 'g1', gatesOk, fixtureBroken, supportDrop, oppGain, qualGain };
}

function buildSummary(records, proof, mismatches, modelInfo, rng) {
  const development = records.filter((row) => row.split === 'development');
  const holdout = records.filter((row) => row.split === 'holdout');
  const negative = records.filter((row) => row.split === 'negative');
  const ablations = { holdout: {}, development: {} };
  for (const [name] of ABLATIONS) {
    ablations.holdout[name] = metricBlock(holdout, (row) => row.ablations[name], rng);
    ablations.development[name] = metricBlock(development, (row) => row.ablations[name], rng);
  }
  const holdoutDomains = {};
  for (const domain of [...new Set(holdout.map((row) => row.domain))].sort()) {
    const rows = holdout.filter((row) => row.domain === domain);
    holdoutDomains[domain] = {
      opposition: boot(rows.map((row) => row.recall.g1.opposition), rng),
      qualifier: boot(rows.map((row) => row.recall.g1.qualifier), rng),
    };
  }
  const relations = {};
  for (const row of records) {
    for (const [relation, count] of Object.entries(row.audit.g1.relations ?? {})) relations[relation] = (relations[relation] ?? 0) + count;
  }
  const totals = compilerTotals();
  const attempted = totals.attempted;
  return {
    experiment: 'kar-generalization-1',
    seed: DEV_SEED,
    holdoutSeed: HOLDOUT_SEED,
    negativeSeed: NEGATIVE_SEED,
    limit: LIMIT,
    gates: GATES,
    counts: {
      development: development.length,
      holdout: holdout.length,
      negative: negative.length,
      negativeCorpus: NEGATIVE_CORPUS,
      devTarget: DEV_COUNT,
    },
    development: fieldBlock(development, (row) => row.recall, rng),
    holdout: fieldBlock(holdout, (row) => row.recall, rng),
    holdoutDomains,
    ablations,
    damage: {
      baselineOpposition: boot(negative.map((row) => row.negative.b0Opposition), rng),
      baselineQualifier: boot(negative.map((row) => row.negative.b0Qualifier), rng),
      g1Opposition: boot(negative.map((row) => row.negative.g1Opposition), rng),
      g1Qualifier: boot(negative.map((row) => row.negative.g1Qualifier), rng),
      opposition: boot(negative.map((row) => row.negative.g1Opposition - row.negative.b0Opposition), rng),
      qualifier: boot(negative.map((row) => row.negative.g1Qualifier - row.negative.b0Qualifier), rng),
      actionOnlyOpposition: boot(negative.map((row) => row.negative.actionOnlyOpposition - row.negative.b0Opposition), rng),
      actionOnlyQualifier: boot(negative.map((row) => row.negative.actionOnlyQualifier - row.negative.b0Qualifier), rng),
      poolGrowth: boot(negative.map((row) => row.negative.g1Pool - row.negative.b0Pool), rng),
    },
    audits: { l0: auditBlock(records, 'l0'), g1: auditBlock(records, 'g1') },
    relationTotals: Object.entries(relations).sort((a, b) => a[0].localeCompare(b[0])).map(([relation, count]) => ({ relation, count })),
    proof,
    determinism: { runs: mismatches === null ? 0 : 200, mismatches },
    model: {
      available: Boolean(modelInfo),
      provider: modelInfo ? G1_PROVIDER : null,
      model: modelInfo ? G1_MODEL : null,
      digest: modelInfo?.digest ?? null,
      temperature: modelInfo ? G1_TEMPERATURE : null,
      promptDigest: modelInfo ? PROMPT_DIGEST : null,
      compiler: modelInfo ? G1_VERSION : null,
      calls: totals.calls,
      cacheHits: totals.cacheHits,
      failures: totals.failures,
      attempted,
      parseRate: attempted > 0 ? totals.failures / attempted : null,
    },
  };
}

function stripRecord(record) {
  const copy = { ...record };
  delete copy.proofArtifact;
  delete copy.proofView;
  delete copy.g1Meta;
  return copy;
}

async function main() {
  assertFrozenCompiler();
  const api = await loadCore();
  selfTestGeneralization(api.tokenize);
  const modelInfo = await modelAvailable();
  if (!modelInfo) throw new Error('Local model llama3.1:latest is not available. Refusing to score a skipped compiler.');
  resetCompilerTotals();
  const development = generateDevelopment(api.tokenize).filter((instance) => !LIMIT || instance.variation < LIMIT);
  const holdout = generateHoldout(api.tokenize).filter((instance) => !LIMIT || instance.variation < LIMIT);
  const negative = generateNegative(api.tokenize).filter((instance) => !LIMIT || instance.variation < LIMIT);
  const queue = [...development, ...holdout, ...negative];
  const records = [];
  let proof = null;
  let determinismMismatches = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const instance = queue[index];
    const evaluated = await evaluateInstance(instance, api);
    if (!proof && evaluated.proofView) {
      const first = await compileWithModel(evaluated.proofView, api.tokenize, { cacheFile: CACHE_FILE, model: G1_MODEL });
      const second = await compileWithModel(evaluated.proofView, api.tokenize, { cacheFile: CACHE_FILE, model: G1_MODEL });
      const left = semanticArtifactRoot(first.artifact);
      const right = semanticArtifactRoot(second.artifact);
      const reloaded = semanticArtifactRoot(JSON.parse(left.canonical));
      if (left.root !== right.root || left.root !== reloaded.root) {
        throw new Error('Committed semantic root diverged across a frozen rebuild');
      }
      proof = {
        instance: evaluated.id,
        first: left.root,
        second: right.root,
        reloaded: reloaded.root,
        identical: true,
        canonicalBytes: Buffer.byteLength(left.canonical),
      };
      determinismMismatches += repeatActivation(instance.query, JSON.parse(left.canonical), api.tokenize);
    }
    if (instance.split === 'holdout' && instance.variation === 0) {
      determinismMismatches += repeatActivation(instance.query, evaluated.proofArtifact, api.tokenize);
    }
    delete evaluated.proofArtifact;
    delete evaluated.proofView;
    records.push(evaluated);
    if ((index + 1) % 10 === 0 || index + 1 === queue.length) process.stderr.write(`ranked ${index + 1}/${queue.length}\n`);
  }
  const rng = mulberry32(BOOT_SEED);
  const summary = buildSummary(records, proof, determinismMismatches, modelInfo, rng);
  summary.decision = decide(summary);
  const payload = { summary, records: records.map(stripRecord) };
  const probe = Boolean(LIMIT && LIMIT < 20);
  if (probe) {
    writeFileSync('/tmp/kar-generalization-summary.json', JSON.stringify(summary, null, 2));
    writeFileSync('/tmp/kar-generalization-report.md', renderReport(summary));
    process.stderr.write(`probe decision ${summary.decision.label}\n`);
    return;
  }
  mkdirSync(path.join(OUT_DIR, 'results'), { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'results/summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(OUT_DIR, 'results/results.json'), JSON.stringify(payload, null, 2));
  writeFileSync(path.join(OUT_DIR, 'SEMANTIC_GENERALIZATION_REPORT.md'), renderReport(summary));
  process.stderr.write(`decision ${summary.decision.label}\n`);
}

await main();
