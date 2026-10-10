import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { evaluate, verify } from '../dist/index.js';
import { bind, makeGraph, makeImage, makePlan } from './support.mjs';

const dualImage = makeImage([
  { id: 'doc-o', text: 'the booking stays committed' },
  { id: 'doc-s', text: 'the guest may end the stay' },
]);

function dualGraph(knowledgeRoot = dualImage.knowledgeRoot) {
  return makeGraph(knowledgeRoot, {
    nodes: ['anchor', 'oppose-node', 'support-node'],
    relations: [
      { id: 'r-o', from: 'anchor', relation: 'prohibits', to: 'oppose-node' },
      { id: 'r-s', from: 'anchor', relation: 'supports', to: 'support-node' },
    ],
    bindings: [
      bind('b-o', 'oppose-node', 'doc-o', ['o']),
      bind('b-s', 'support-node', 'doc-s', ['s']),
    ],
  });
}

const dualPlan = makePlan({
  frontierMap: { supports: 'F_S', prohibits: 'F_O' },
  requirements: { F_S: ['s'], F_O: ['o'], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
});

const cases = [];

test('replay produces one certificate across 100 evaluations', () => {
  const first = evaluate(dualImage.image, dualGraph(), 'guest cancel room whenever asked', dualPlan);
  assert.equal(first.status, 'SATISFIED');
  assert.deepEqual(first.evidenceIds, ['doc-o', 'doc-s']);
  const encoded = JSON.stringify(first.roots);
  for (let i = 0; i < 100; i += 1) {
    const again = evaluate(dualImage.image, dualGraph(), 'guest cancel room whenever asked', dualPlan);
    assert.equal(JSON.stringify(again.roots), encoded);
    assert.deepEqual(again.evidenceIds, first.evidenceIds);
  }
  assert.equal(verify(dualImage.image, dualGraph(), 'guest cancel room whenever asked', dualPlan, first).ok, true);
  const tampered = structuredClone(first);
  tampered.roots.karRoot = `${tampered.roots.karRoot.slice(0, -1)}0`;
  assert.equal(verify(dualImage.image, dualGraph(), 'guest cancel room whenever asked', dualPlan, tampered).ok, false);
  cases.push(record('replay-dual', dualImage.image, dualGraph(), 'guest cancel room whenever asked', dualPlan, first));
});

test('a positive opposition floor with an empty opposition frontier abstains', () => {
  const graph = makeGraph(dualImage.knowledgeRoot, {
    nodes: ['anchor', 'support-node'],
    relations: [{ id: 'r-s', from: 'anchor', relation: 'supports', to: 'support-node' }],
    bindings: [bind('b-s', 'support-node', 'doc-s', ['s'])],
  });
  const result = evaluate(dualImage.image, graph, 'q', dualPlan);
  assert.equal(result.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.deepEqual(result.evidenceIds, []);
  cases.push(record('abstain-empty-opposition', dualImage.image, graph, 'q', dualPlan, result));
});

test('an unmet opposition floor does not fall back to the lexical list', () => {
  const image = makeImage([{ id: 'doc-s', text: 'support text' }]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor'],
    relations: [],
    bindings: [],
  });
  const plan = makePlan({
    frontierMap: {},
    requirements: { F_S: ['s'], F_O: ['o'], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '0', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
    lexical: { frontier: 'F_S', evidenceIds: ['doc-s'] },
  });
  const result = evaluate(image.image, graph, 'q', plan);
  assert.equal(result.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.deepEqual(result.evidenceIds, []);
  assert.deepEqual(result.frontiers.F_S, ['doc-s']);
  cases.push(record('no-topk-fallback', image.image, graph, 'q', plan, result));
});

test('minimum-cover is minimal and keeps one binding per mask', () => {
  const tight = evaluate(dualImage.image, dualGraph(), 'q', { ...dualPlan, cardinalityBound: 1 });
  assert.equal(tight.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  const image = makeImage([
    { id: 'a-doc', text: 'alpha' },
    { id: 'b-doc', text: 'beta' },
  ]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'node-a', 'node-b'],
    relations: [
      { id: 'r-a', from: 'anchor', relation: 'supports', to: 'node-a' },
      { id: 'r-b', from: 'anchor', relation: 'supports', to: 'node-b' },
    ],
    bindings: [bind('b-a', 'node-a', 'a-doc', ['s']), bind('b-b', 'node-b', 'b-doc', ['s'])],
  });
  const plan = makePlan({
    frontierMap: { supports: 'F_S' },
    requirements: { F_S: ['s'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  });
  const result = evaluate(image.image, graph, 'q', plan);
  assert.equal(result.status, 'SATISFIED');
  assert.deepEqual(result.evidenceIds, ['a-doc']);
  cases.push(record('mask-economy', image.image, graph, 'q', plan, result));
});

test('opposition evidence does not count as support', () => {
  const result = evaluate(dualImage.image, dualGraph(), 'q', dualPlan);
  const support = result.choices.find((choice) => choice.evidenceId === 'doc-s');
  const opposition = result.choices.find((choice) => choice.evidenceId === 'doc-o');
  assert.deepEqual(support.frontiers, ['F_S']);
  assert.deepEqual(opposition.frontiers, ['F_O']);
  assert.equal(result.decision.coverage.F_S.covered, 1);
  assert.equal(result.decision.coverage.F_O.covered, 1);
});

test('a supplied anchor admits only the named node', () => {
  const image = makeImage([
    { id: 'kiln-doc', text: 'the kiln stays fired' },
    { id: 'pump-doc', text: 'the pump stays mounted' },
  ]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['kiln', 'kiln-end', 'pump', 'pump-end'],
    relations: [
      { id: 'r-kiln', from: 'kiln', relation: 'prohibits', to: 'kiln-end' },
      { id: 'r-pump', from: 'pump', relation: 'prohibits', to: 'pump-end' },
    ],
    bindings: [
      bind('b-kiln', 'kiln-end', 'kiln-doc', ['o']),
      bind('b-pump', 'pump-end', 'pump-doc', ['o']),
    ],
  });
  const narrow = makePlan({
    anchor: { mode: 'supplied', witness: [{ nodeId: 'pump', queryTerm: 'pump' }] },
    frontierMap: { prohibits: 'F_O' },
    requirements: { F_S: [], F_O: ['o'], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '0', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
  });
  const wide = makePlan({
    ...narrow,
    anchor: { mode: 'supplied', witness: [{ nodeId: 'kiln' }, { nodeId: 'pump' }] },
  });
  const narrowResult = evaluate(image.image, graph, 'crew cancel pump whenever asked', narrow);
  const wideResult = evaluate(image.image, graph, 'crew cancel pump whenever asked', wide);
  assert.deepEqual(narrowResult.frontiers.F_O, ['pump-doc']);
  assert.deepEqual(wideResult.frontiers.F_O, ['kiln-doc', 'pump-doc']);
  assert.notEqual(narrowResult.roots.planRoot, wideResult.roots.planRoot);
  cases.push(record('anchor-binding', image.image, graph, 'crew cancel pump whenever asked', narrow, narrowResult));
});

test('a witness outside V is rejected and still committed', () => {
  const missing = makePlan({ anchor: { mode: 'supplied', witness: [{ nodeId: 'missing', queryTerm: 'room' }] } });
  const rejected = evaluate(dualImage.image, dualGraph(), 'q', missing);
  assert.equal(rejected.status, 'ANCHOR_REJECTED');
  assert.deepEqual(rejected.evidenceIds, []);
  assert.notEqual(rejected.roots.anchorRoot, evaluate(dualImage.image, dualGraph(), 'q', dualPlan).roots.anchorRoot);
  cases.push(record('anchor-rejected', dualImage.image, dualGraph(), 'q', missing, rejected));
});

test('depth h excludes a walk of length h + 1', () => {
  const image = makeImage([
    { id: 'doc-clause', text: 'the clause forbids cancellation' },
    { id: 'doc-mid', text: 'the customer record' },
  ]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'clause', 'mid'],
    relations: [
      { id: 'r-time', from: 'anchor', relation: 'applies_to', to: 'mid' },
      { id: 'r-opp', from: 'mid', relation: 'contradicts', to: 'clause' },
    ],
    bindings: [
      bind('b-clause', 'clause', 'doc-clause', ['o']),
      bind('b-mid', 'mid', 'doc-mid', ['t']),
    ],
  });
  const base = {
    anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor' }] },
    frontierMap: { applies_to: 'F_T', contradicts: 'F_O' },
  };
  const shallow = evaluate(image.image, graph, 'q', makePlan({ ...base, depth: 1 }));
  const deep = evaluate(image.image, graph, 'q', makePlan({ ...base, depth: 2 }));
  assert.deepEqual(shallow.frontiers.F_T, ['doc-mid']);
  assert.deepEqual(shallow.frontiers.F_O, []);
  assert.deepEqual(deep.frontiers.F_T, ['doc-mid']);
  assert.deepEqual(deep.frontiers.F_O, ['doc-clause']);
  assert.ok(!deep.frontiers.F_T.includes('doc-clause'));
  assert.notEqual(shallow.roots.planRoot, deep.roots.planRoot);
  const witness = deep.witnesses.find((item) => item.evidenceId === 'doc-clause');
  assert.deepEqual(witness.path, [
    { node: 'anchor' },
    { relation: 'r-time', node: 'mid' },
    { relation: 'r-opp', node: 'clause' },
  ]);
  cases.push(record('last-edge-depth', image.image, graph, 'q', makePlan({ ...base, depth: 2 }), deep));
});

test('removing a lexical contributor changes the plan root and drops support', () => {
  const image = makeImage([{ id: 'doc-s', text: 'guest may cancel the room' }]);
  const graph = makeGraph(image.knowledgeRoot, { nodes: ['anchor'], relations: [], bindings: [] });
  const withLexical = makePlan({
    coverageMode: 'nonempty',
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    lexical: { frontier: 'F_S', evidenceIds: ['doc-s'] },
  });
  const without = makePlan({
    coverageMode: 'nonempty',
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    lexical: null,
  });
  const kept = evaluate(image.image, graph, 'q', withLexical);
  const dropped = evaluate(image.image, graph, 'q', without);
  assert.equal(kept.status, 'SATISFIED');
  assert.deepEqual(kept.evidenceIds, ['doc-s']);
  assert.equal(dropped.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.notEqual(kept.roots.planRoot, dropped.roots.planRoot);
  cases.push(record('lexical-union', image.image, graph, 'q', withLexical, kept));
});

test('closure and visit bounds fail closed', () => {
  const image = makeImage([
    { id: 'e1', text: 'one' },
    { id: 'e2', text: 'two' },
    { id: 'e3', text: 'three' },
  ]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'n1', 'n2', 'n3'],
    relations: [
      { id: 'r1', from: 'anchor', relation: 'supports', to: 'n1' },
      { id: 'r2', from: 'anchor', relation: 'supports', to: 'n2' },
      { id: 'r3', from: 'anchor', relation: 'supports', to: 'n3' },
    ],
    bindings: [bind('b1', 'n1', 'e1', ['s']), bind('b2', 'n2', 'e2', ['s']), bind('b3', 'n3', 'e3', ['s'])],
  });
  const plan = makePlan({
    frontierMap: { supports: 'F_S' },
    requirements: { F_S: ['s'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    bounds: { ...makePlan({}).bounds, maxClosureEdges: 2 },
  });
  const closed = evaluate(image.image, graph, 'q', plan);
  assert.equal(closed.status, 'CLOSURE_BOUND_EXCEEDED');
  assert.deepEqual(closed.frontiers.F_S, []);
  assert.deepEqual(closed.evidenceIds, []);
  const evidenceBound = makePlan({
    frontierMap: { supports: 'F_S' },
    bounds: { ...makePlan({}).bounds, maxFrontierEvidence: 1 },
  });
  const tooWide = evaluate(image.image, graph, 'q', evidenceBound);
  assert.equal(tooWide.status, 'CLOSURE_BOUND_EXCEEDED');
  assert.deepEqual(tooWide.frontiers.F_S, []);
  const visit = makePlan({
    frontierMap: { supports: 'F_S' },
    requirements: { F_S: ['s'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    bounds: { ...makePlan({}).bounds, maxCoverVisits: 1 },
  });
  const searched = evaluate(image.image, graph, 'q', visit);
  assert.equal(searched.status, 'SEARCH_BOUND_EXCEEDED');
  assert.deepEqual(searched.evidenceIds, []);
  assert.deepEqual(searched.frontiers.F_S, ['e1', 'e2', 'e3']);
  cases.push(record('closure-bound', image.image, graph, 'q', plan, closed));
  cases.push(record('visit-bound', image.image, graph, 'q', visit, searched));
});

test('unmapped relations are not traversed and a missing map is invalid', () => {
  const image = makeImage([{ id: 'doc', text: 'hidden opposition' }]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'hidden'],
    relations: [{ id: 'r', from: 'anchor', relation: 'requires', to: 'hidden' }],
    bindings: [bind('b', 'hidden', 'doc', ['s'])],
  });
  const plan = makePlan({ frontierMap: {} });
  const result = evaluate(image.image, graph, 'q', plan);
  assert.deepEqual(result.frontiers.F_S, []);
  assert.equal(result.status, 'SATISFIED');
  const omitted = { ...plan };
  delete omitted.frontierMap;
  assert.equal(evaluate(image.image, graph, 'q', omitted).status, 'PLAN_INVALID');
  cases.push(record('unmapped-relation', image.image, graph, 'q', plan, result));
});

test('object key order does not change the semantic root, and a foreign image is unbound', () => {
  const image = makeImage([{ id: 'doc-s', text: 'alpha' }]);
  const first = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'support-node'],
    relations: [{ id: 'r-s', from: 'anchor', relation: 'supports', to: 'support-node' }],
    bindings: [bind('b-s', 'support-node', 'doc-s', ['s'])],
  });
  const second = {
    bindings: first.bindings,
    nodes: [{ id: 'support-node' }, { id: 'anchor' }],
    relations: first.relations,
    provenance: { note: undefined, producer: 'hand' },
    knowledgeRoot: first.knowledgeRoot,
    version: 1,
  };
  delete second.provenance.note;
  const plan = makePlan({ frontierMap: { supports: 'F_S' } });
  const left = evaluate(image.image, first, 'q', plan);
  const right = evaluate(image.image, second, 'q', plan);
  assert.equal(left.roots.semanticRoot, right.roots.semanticRoot);
  const foreign = { ...first, knowledgeRoot: `sha256-${'ab'.repeat(32)}` };
  const unbound = evaluate(image.image, foreign, 'q', plan);
  assert.equal(unbound.status, 'GRAPH_NOT_BOUND');
  assert.deepEqual(unbound.evidenceIds, []);
  cases.push(record('root-stability', image.image, first, 'q', plan, left));
  cases.push(record('graph-not-bound', image.image, foreign, 'q', plan, unbound));
});

test('the supplied witness is inside AnchorRoot', () => {
  const room = makePlan({ anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'room' }] } });
  const lodging = makePlan({ anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'lodging' }] } });
  const roomResult = evaluate(dualImage.image, dualGraph(), 'q', { ...dualPlan, anchor: room.anchor });
  const lodgingResult = evaluate(dualImage.image, dualGraph(), 'q', { ...dualPlan, anchor: lodging.anchor });
  assert.deepEqual(roomResult.evidenceIds, lodgingResult.evidenceIds);
  assert.notEqual(roomResult.roots.anchorRoot, lodgingResult.roots.anchorRoot);
  assert.notEqual(roomResult.roots.karRoot, lodgingResult.roots.karRoot);
  const roomPlan = { ...dualPlan, anchor: room.anchor };
  cases.push(record('anchor-witness', dualImage.image, dualGraph(), 'q', roomPlan, roomResult));
});

test('minimum-cover ignores redundancy unless the plan names that profile', () => {
  const image = makeImage([
    { id: 'a-dup-1', text: 'red red' },
    { id: 'a-dup-2', text: 'red red' },
    { id: 'm-1', text: 'blue' },
    { id: 'm-2', text: 'green' },
    { id: 'solo', text: 'alpha alpha alpha' },
  ]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'n-solo', 'n1', 'n2', 'n3', 'n4'],
    relations: [
      { id: 'ro', from: 'anchor', relation: 'prohibits', to: 'n-solo' },
      { id: 'rs', from: 'anchor', relation: 'supports', to: 'n-solo' },
      { id: 'r1', from: 'anchor', relation: 'supports', to: 'n1' },
      { id: 'r2', from: 'anchor', relation: 'prohibits', to: 'n2' },
      { id: 'r3', from: 'anchor', relation: 'supports', to: 'n3' },
      { id: 'r4', from: 'anchor', relation: 'prohibits', to: 'n4' },
    ],
    bindings: [
      bind('bs', 'n-solo', 'solo', ['s', 'o']),
      bind('b1', 'n1', 'a-dup-1', ['s']),
      bind('b2', 'n2', 'a-dup-2', ['o']),
      bind('b3', 'n3', 'm-1', ['s']),
      bind('b4', 'n4', 'm-2', ['o']),
    ],
  });
  const common = {
    frontierMap: { supports: 'F_S', prohibits: 'F_O' },
    requirements: { F_S: ['s'], F_O: ['o'], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
  };
  const small = evaluate(image.image, graph, 'q', makePlan(common));
  assert.deepEqual(small.evidenceIds, ['solo']);
  const pairGraph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'n1', 'n2', 'n3', 'n4'],
    relations: [
      { id: 'r1', from: 'anchor', relation: 'supports', to: 'n1' },
      { id: 'r2', from: 'anchor', relation: 'prohibits', to: 'n2' },
      { id: 'r3', from: 'anchor', relation: 'supports', to: 'n3' },
      { id: 'r4', from: 'anchor', relation: 'prohibits', to: 'n4' },
    ],
    bindings: [
      bind('b1', 'n1', 'a-dup-1', ['s']),
      bind('b2', 'n2', 'a-dup-2', ['o']),
      bind('b3', 'n3', 'm-1', ['s']),
      bind('b4', 'n4', 'm-2', ['o']),
    ],
  });
  const plain = evaluate(image.image, pairGraph, 'q', makePlan(common));
  const redundant = evaluate(image.image, pairGraph, 'q', makePlan({ ...common, profile: 'minimum-cover-redundancy-v1' }));
  assert.deepEqual(plain.evidenceIds, ['a-dup-1', 'a-dup-2']);
  assert.deepEqual(redundant.evidenceIds, ['a-dup-1', 'm-2']);
  assert.ok(redundant.decision.redundancy);
  assert.equal(plain.decision.redundancy, undefined);
  cases.push(record('redundancy-profile', image.image, pairGraph, 'q', makePlan({ ...common, profile: 'minimum-cover-redundancy-v1' }), redundant));
});

test('member-id-v1 anchors identifier tokens only', () => {
  const image = makeImage([{ id: 'doc', text: 'lodging stays' }]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['kiln', 'lodging', 'lodging-end'],
    relations: [{ id: 'r', from: 'lodging', relation: 'prohibits', to: 'lodging-end' }],
    bindings: [bind('b', 'lodging-end', 'doc', ['o'])],
  });
  const plan = makePlan({
    anchor: { mode: 'recompute', procedure: 'member-id-v1' },
    frontierMap: { prohibits: 'F_O' },
    requirements: { F_S: [], F_O: ['o'], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '0', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
  });
  const hit = evaluate(image.image, graph, 'please lodging tonight', plan);
  const miss = evaluate(image.image, graph, 'please room tonight', plan);
  assert.deepEqual(hit.evidenceIds, ['doc']);
  assert.equal(miss.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  cases.push(record('member-id', image.image, graph, 'please lodging tonight', plan, hit));
});

after(() => {
  assert.ok(cases.length >= 12);
  const ordered = [...cases].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  mkdirSync(new URL('../fixtures', import.meta.url), { recursive: true });
  writeFileSync(new URL('../fixtures/expected.json', import.meta.url), `${JSON.stringify(ordered, null, 2)}\n`);
});

function record(name, image, graph, query, plan, result) {
  return {
    name,
    image,
    graph,
    query,
    plan,
    status: result.status,
    evidenceIds: result.evidenceIds,
    choices: result.choices,
    frontiers: result.frontiers,
    witnesses: result.witnesses,
    decision: result.decision,
    roots: result.roots,
  };
}

