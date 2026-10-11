import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAnchor } from '../../dist/anchor.js';
import { closeFrontiers } from '../../dist/closure.js';
import { selectCover } from '../../dist/cover.js';
import { prepareGraph, prepareImage } from '../../dist/graph.js';
import { evaluate, verify } from '../../dist/index.js';
import { validatePlan } from '../../dist/plan.js';
import { bind, makeGraph, makeImage, makePlan } from '../../test/support.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
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
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
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
  const rows = [];
  const bindings = [];
  const bound = Math.min(8, count - 1);
  for (let index = 1; index <= bound; index += 1) {
    const evidenceId = `e${String(index).padStart(2, '0')}`;
    rows.push({ id: evidenceId, text: `scale evidence ${evidenceId}` });
    bindings.push(bind(`b-${evidenceId}`, idOf(index), evidenceId, ['need']));
  }
  const image = makeImage(rows);
  const graph = makeGraph(image.knowledgeRoot, { nodes, relations, bindings, note: `scale-${count}-d${degree}` });
  return { image: image.image, graph, anchor: idOf(0), relations: relations.length };
}

function measure(count, family) {
  const built = build(count, family.degree);
  const depth = family.depth(count);
  const plan = makePlan({
    anchor: { mode: 'supplied', witness: [{ nodeId: built.anchor, queryTerm: 'scale' }] },
    frontierMap: { supports: 'F_S' },
    depth,
    cardinalityBound: 1,
    requirements: { F_S: ['need'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    bounds: {
      maxAnchorNodes: 4,
      maxClosureNodes: count + 2,
      maxClosureEdges: built.relations + 2,
      maxFrontierEvidence: 16,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 16,
      maxCoverVisits: 100000,
    },
  });
  const preparedImage = prepareImage(built.image);
  const preparedGraph = prepareGraph(built.graph);
  const validated = validatePlan(plan);
  const nodeIds = new Set(preparedGraph.nodes.map((node) => node.id));
  const reps = count <= 100 ? 15 : count <= 1000 ? 9 : count <= 10000 ? 5 : 3;
  const anchor = [];
  const closure = [];
  const cover = [];
  const verification = [];
  const heap = [];
  let frontierSize = 0;
  let edges = 0;
  let status = '';
  for (let rep = 0; rep < reps; rep += 1) {
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const anchorStart = performance.now();
    const resolved = resolveAnchor('scale the lodging rule', nodeIds, validated.anchor);
    anchor.push(performance.now() - anchorStart);
    const closureStart = performance.now();
    const closed = closeFrontiers(preparedGraph, validated, resolved.commitment.nodes);
    closure.push(performance.now() - closureStart);
    const coverStart = performance.now();
    const selected = selectCover(validated, closed.ok ? closed.admissions : [], preparedImage.texts);
    cover.push(performance.now() - coverStart);
    heap.push(process.memoryUsage().heapUsed - before);
    const full = evaluate(built.image, built.graph, 'scale the lodging rule', plan);
    const verifyStart = performance.now();
    const verdict = verify(built.image, built.graph, 'scale the lodging rule', plan, full);
    verification.push(performance.now() - verifyStart);
    if (!verdict.ok) throw new Error(`verify failed for ${family.name} ${count}`);
    frontierSize = FRONTIER_SIZE(closed);
    edges = closed.edges;
    status = selected.status;
    if (!closed.ok) throw new Error(`closure failed for ${family.name} ${count}`);
  }
  if (family.degree === 1 && depth === count - 1 && edges !== count - 1) {
    throw new Error(`expected ${count - 1} edges, saw ${edges}`);
  }
  return {
    family: family.name,
    nodes: count,
    degree: family.degree,
    depth,
    relations: built.relations,
    reps,
    status,
    frontierSize,
    visitedEdges: edges,
    anchorMs: summarize(anchor),
    closureMs: summarize(closure),
    coverMs: summarize(cover),
    verifyMs: summarize(verification),
    heapBytes: summarize(heap),
  };
}

function FRONTIER_SIZE(closed) {
  if (!closed.ok) return 0;
  return Object.values(closed.frontiers).reduce((sum, ids) => sum + ids.length, 0);
}

const results = [];
for (const family of families) {
  for (const count of sizes) {
    const row = measure(count, family);
    results.push(row);
    fs.writeFileSync(path.join(here, 'scale-results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`${row.family} n=${row.nodes} closure p50=${row.closureMs.p50.toFixed(2)}ms edges=${row.visitedEdges} frontier=${row.frontierSize}`);
  }
}
