import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAnchor } from '../../../research/kar-1/dist/anchor.js';
import { closeFrontiers as researchClose } from '../../../research/kar-1/dist/closure.js';
import { selectCover as researchCover } from '../../../research/kar-1/dist/cover.js';
import { prepareGraph, prepareImage } from '../../../research/kar-1/dist/graph.js';
import { evaluate as researchEvaluate, verify as researchVerify } from '../../../research/kar-1/dist/index.js';
import { validatePlan } from '../../../research/kar-1/dist/plan.js';
import { canonicalize } from '../dist/experimental/kar/canonicalize.js';
import { closeFrontiers as coreClose } from '../dist/experimental/kar/closure.js';
import { selectCover as coreCover } from '../dist/experimental/kar/cover.js';
import {
  createKarProjectionSession,
  evaluateKar,
  verifyKarProjection,
} from '../dist/experimental/kar/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../../../docs/kar');
const sizes = [100, 1000, 10000, 50000];
const families = [
  { name: 'chain-degree-1', degree: 1, depth: (count) => count - 1 },
  { name: 'local-degree-3-depth-4', degree: 3, depth: () => 4 },
];

function percentile(samples, p) {
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summarize(samples) {
  return {
    p50: Number(percentile(samples, 50).toFixed(3)),
    p95: Number(percentile(samples, 95).toFixed(3)),
    max: Number(Math.max(...samples).toFixed(3)),
  };
}

function build(count, degree) {
  const width = String(count - 1).length;
  const idOf = (index) => `n${String(index).padStart(width, '0')}`;
  const nodes = [];
  const relations = [];
  for (let index = 0; index < count; index += 1) nodes.push(idOf(index));
  for (let index = 0; index < count; index += 1) {
    for (let step = 1; step <= degree; step += 1) {
      const target = index + step;
      if (target >= count) continue;
      relations.push({ id: `r-${idOf(index)}-${step}`, from: idOf(index), relation: 'supports', to: idOf(target) });
    }
  }
  const evidence = [];
  const bindings = [];
  const bound = Math.min(8, count - 1);
  for (let index = 1; index <= bound; index += 1) {
    const evidenceId = `e${String(index).padStart(2, '0')}`;
    evidence.push({ id: evidenceId, text: `scale evidence ${evidenceId}` });
    bindings.push({ id: `b-${evidenceId}`, nodeId: idOf(index), evidenceId, requirements: ['need'] });
  }
  const image = { version: 1, evidence };
  return { image, nodes, relations, bindings, anchor: idOf(0) };
}

function repsFor(count) {
  if (count <= 100) return 15;
  if (count <= 1000) return 9;
  if (count <= 10000) return 5;
  return 3;
}

function measure(count, family) {
  const built = build(count, family.degree);
  const depth = family.depth(count);
  const { digest } = globalThis.__karDigest;
  const graph = {
    version: 1,
    knowledgeRoot: digest(built.image),
    provenance: { producer: 'hand', note: `scale-${count}-d${family.degree}` },
    nodes: built.nodes.map((id) => ({ id })),
    relations: built.relations,
    bindings: built.bindings,
  };
  const plan = {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: built.anchor, queryTerm: 'scale' }] },
    frontierMap: { supports: 'F_S' },
    depth,
    cardinalityBound: 1,
    coverageMode: 'requirements',
    requirements: { F_S: ['need'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-10-10',
    minAuthority: null,
    bounds: {
      maxAnchorNodes: 4,
      maxClosureNodes: count + 2,
      maxClosureEdges: built.relations.length + 2,
      maxFrontierEvidence: 16,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 16,
      maxCoverVisits: 100000,
    },
    lexical: null,
  };
  const preparedImage = prepareImage(built.image);
  const preparedGraph = prepareGraph(graph);
  const validated = validatePlan(plan);
  const nodeIds = new Set(preparedGraph.nodes.map((node) => node.id));
  const resolved = resolveAnchor('scale the lodging rule', nodeIds, validated.anchor);
  const researchResult = researchEvaluate(built.image, graph, 'scale the lodging rule', plan);
  const reps = repsFor(count);
  const buckets = {
    researchClosure: [],
    researchCover: [],
    researchVerify: [],
    session: [],
    coldEval: [],
    warmEval: [],
    closure: [],
    cover: [],
    verify: [],
    heap: [],
  };
  let edges = 0;
  let status = '';
  for (let rep = 0; rep < reps; rep += 1) {
    if (global.gc) global.gc();
    const researchClosureStart = performance.now();
    const researchClosed = researchClose(preparedGraph, validated, resolved.commitment.nodes);
    buckets.researchClosure.push(performance.now() - researchClosureStart);
    const researchCoverStart = performance.now();
    researchCover(validated, researchClosed.ok ? researchClosed.admissions : [], preparedImage.texts);
    buckets.researchCover.push(performance.now() - researchCoverStart);
    const researchVerifyStart = performance.now();
    const researchVerdict = researchVerify(built.image, graph, 'scale the lodging rule', plan, researchResult);
    buckets.researchVerify.push(performance.now() - researchVerifyStart);
    if (!researchVerdict.ok) throw new Error(`research verify failed ${family.name} ${count}`);

    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const sessionStart = performance.now();
    const session = createKarProjectionSession({ image: built.image, graph });
    buckets.session.push(performance.now() - sessionStart);
    const coldStart = performance.now();
    const cold = evaluateKar(session, { proposition: 'scale the lodging rule', plan });
    buckets.coldEval.push(performance.now() - coldStart);
    const warmStart = performance.now();
    const warm = evaluateKar(session, { proposition: 'scale the lodging rule', plan });
    buckets.warmEval.push(performance.now() - warmStart);
    const closureStart = performance.now();
    const closed = coreClose(session.graph, validated, resolved.commitment.nodes, session.indexes);
    buckets.closure.push(performance.now() - closureStart);
    const coverStart = performance.now();
    const selected = coreCover(validated, closed.ok ? closed.admissions : [], session.texts);
    buckets.cover.push(performance.now() - coverStart);
    buckets.heap.push(process.memoryUsage().heapUsed - before);
    const verifyStart = performance.now();
    const verdict = verifyKarProjection(built.image, graph, 'scale the lodging rule', plan, cold.certificate);
    buckets.verify.push(performance.now() - verifyStart);
    if (!verdict.ok) throw new Error(`core verify failed ${family.name} ${count}: ${verdict.reason}`);
    if (canonicalize(cold.certificate) !== canonicalize(researchResult) || canonicalize(warm.certificate) !== canonicalize(researchResult)) {
      throw new Error(`certificate mismatch ${family.name} ${count}`);
    }
    if (!closed.ok || !researchClosed.ok) throw new Error(`closure failed ${family.name} ${count}`);
    if (canonicalize(closed.witnesses) !== canonicalize(researchClosed.witnesses)) {
      throw new Error(`witness mismatch ${family.name} ${count}`);
    }
    edges = closed.edges;
    status = selected.status;
    if (family.degree === 1 && depth === count - 1 && edges !== count - 1) {
      throw new Error(`expected ${count - 1} edges, saw ${edges}`);
    }
  }
  return {
    family: family.name,
    nodes: count,
    degree: family.degree,
    depth,
    relations: built.relations.length,
    reps,
    status,
    visitedEdges: edges,
    frontierWitnessRoot: researchResult.roots.frontierWitnessRoot,
    karRoot: researchResult.roots.karRoot,
    certificateEqual: true,
    witnessesEqual: true,
    sessionMs: summarize(buckets.session),
    coldEvalMs: summarize(buckets.coldEval),
    warmEvalMs: summarize(buckets.warmEval),
    closureMs: summarize(buckets.closure),
    coverMs: summarize(buckets.cover),
    verifyMs: summarize(buckets.verify),
    researchClosureMs: summarize(buckets.researchClosure),
    researchCoverMs: summarize(buckets.researchCover),
    researchVerifyMs: summarize(buckets.researchVerify),
    heapBytes: summarize(buckets.heap),
    closureSpeedup: Number((percentile(buckets.researchClosure, 50) / percentile(buckets.closure, 50)).toFixed(2)),
  };
}

const { digest } = await import('../dist/experimental/kar/canonicalize.js');
globalThis.__karDigest = { digest };
const results = [];
for (const family of families) {
  for (const count of sizes) {
    const row = measure(count, family);
    results.push(row);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'benchmarks.json'), `${JSON.stringify({ generatedAt: '2026-10-10', results }, null, 2)}\n`);
    console.log(`${row.family} n=${row.nodes} researchClosure=${row.researchClosureMs.p50} coreClosure=${row.closureMs.p50} speedup=${row.closureSpeedup} warm=${row.warmEvalMs.p50} session=${row.sessionMs.p50} verify=${row.verifyMs.p50}`);
  }
}
console.log('bench-kar complete');
