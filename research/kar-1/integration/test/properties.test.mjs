import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, verify } from '../../dist/index.js';
import { bind, makeGraph, makeImage, makePlan } from '../../test/support.mjs';

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function operational(result) {
  return {
    status: result.status,
    evidenceIds: result.evidenceIds,
    choices: result.choices,
    frontiers: result.frontiers,
    witnesses: result.witnesses,
    decision: result.decision,
  };
}

test('property invariants of the frozen minimum-cover engine', () => {
  const image = makeImage([
    { id: 's', text: 'support text' },
    { id: 'o', text: 'opposition text' },
    { id: 'q', text: 'qualifier text' },
  ]);
  const graph = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'support', 'oppose', 'qualify'],
    relations: [
      { id: 'rs', from: 'anchor', relation: 'supports', to: 'support' },
      { id: 'ro', from: 'anchor', relation: 'prohibits', to: 'oppose' },
      { id: 'rq', from: 'anchor', relation: 'qualifies', to: 'qualify' },
    ],
    bindings: [
      bind('bs', 'support', 's', ['s0']),
      bind('bo', 'oppose', 'o', ['o0']),
      bind('bq', 'qualify', 'q', ['q0']),
    ],
  });
  const base = makePlan({
    frontierMap: { supports: 'F_S', prohibits: 'F_O', qualifies: 'F_Q' },
    requirements: { F_S: ['s0'], F_O: ['o0'], F_Q: ['q0'], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '1', F_Q: '1', F_T: '0', F_A: '0' },
    cardinalityBound: 3,
    bounds: { ...makePlan({}).bounds, maxCoverVisits: 100000 },
  });
  const satisfied = evaluate(image.image, graph, 'q', base);
  assert.equal(satisfied.status, 'SATISFIED');
  assert.deepEqual(satisfied.evidenceIds, ['o', 'q', 's']);

  const random = mulberry32(20261010);
  const floorLadder = ['0', '0.25', '0.5', '1', '2'];
  for (let trial = 0; trial < 80; trial += 1) {
    const lower = floorLadder[Math.floor(random() * (floorLadder.length - 1))];
    const higher = floorLadder[floorLadder.indexOf(lower) + 1 + Math.floor(random() * (floorLadder.length - floorLadder.indexOf(lower) - 1))];
    const frontier = ['F_S', 'F_O', 'F_Q'][Math.floor(random() * 3)];
    const withGap = { ...base.requirements, [frontier]: [...base.requirements[frontier], 'missing'] };
    const lowPlan = { ...base, requirements: withGap, floors: { ...base.floors, [frontier]: lower } };
    const highPlan = { ...base, requirements: withGap, floors: { ...base.floors, [frontier]: higher } };
    const low = evaluate(image.image, graph, 'q', lowPlan);
    const high = evaluate(image.image, graph, 'q', highPlan);
    if (low.status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS') {
      assert.notEqual(high.status, 'SATISFIED', `trial ${trial} ${frontier} ${lower} -> ${higher}`);
    }
  }

  for (let cardinality = 1; cardinality <= 3; cardinality += 1) {
    const wide = evaluate(image.image, graph, 'q', { ...base, cardinalityBound: cardinality });
    const narrow = evaluate(image.image, graph, 'q', { ...base, cardinalityBound: cardinality - 1 });
    if (wide.status === 'SATISFIED' && narrow.status === 'SATISFIED') {
      assert.ok(narrow.evidenceIds.length <= wide.evidenceIds.length);
    }
    assert.ok(narrow.evidenceIds.length <= cardinality - 1 || narrow.status !== 'SATISFIED');
    if (wide.status === 'SATISFIED' && wide.evidenceIds.length <= cardinality - 1) {
      assert.equal(narrow.status, 'SATISFIED');
      assert.deepEqual(narrow.evidenceIds, wide.evidenceIds);
    }
  }

  const removed = {
    version: 1,
    evidence: image.image.evidence.filter((row) => row.id !== satisfied.evidenceIds[0]),
  };
  assert.equal(verify(removed, graph, 'q', base, satisfied).ok, false);
  const withoutBinding = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'support', 'oppose', 'qualify'],
    relations: graph.relations.filter((relation) => relation.id !== 'rs'),
    bindings: graph.bindings.filter((binding) => binding.evidenceId !== 's'),
  });
  assert.equal(verify(image.image, withoutBinding, 'q', base, satisfied).ok, false);

  const onlySupport = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'support'],
    relations: [{ id: 'rs', from: 'anchor', relation: 'supports', to: 'support' }],
    bindings: [bind('bs', 'support', 's', ['s0'])],
  });
  const supportPlan = makePlan({
    frontierMap: { supports: 'F_S' },
    requirements: { F_S: ['s0'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  });
  const withRelation = evaluate(image.image, onlySupport, 'q', supportPlan);
  assert.equal(withRelation.status, 'SATISFIED');
  const noRelation = makeGraph(image.knowledgeRoot, {
    nodes: ['anchor', 'support'],
    relations: [],
    bindings: [bind('bs', 'support', 's', ['s0'])],
  });
  const abstained = evaluate(image.image, noRelation, 'q', supportPlan);
  assert.equal(abstained.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.deepEqual(abstained.evidenceIds, []);

  const decoy = makeGraph(image.knowledgeRoot, {
    nodes: graph.nodes.map((node) => node.id),
    relations: [...graph.relations, { id: 'decoy', from: 'anchor', relation: 'mentions', to: 'support' }],
    bindings: graph.bindings,
  });
  const isolated = evaluate(image.image, decoy, 'q', base);
  assert.deepEqual(operational(isolated), operational(satisfied));
  assert.notEqual(isolated.roots.semanticRoot, satisfied.roots.semanticRoot);
  assert.notEqual(isolated.roots.karRoot, satisfied.roots.karRoot);

  const shuffle = mulberry32(20261010);
  for (let trial = 0; trial < 20; trial += 1) {
    const shuffleRows = (rows) => {
      const copy = [...rows];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(shuffle() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }
      return copy;
    };
    const shuffledImage = { version: 1, evidence: shuffleRows(image.image.evidence) };
    const shuffledGraph = {
      ...graph,
      nodes: shuffleRows(graph.nodes),
      relations: shuffleRows(graph.relations),
      bindings: shuffleRows(graph.bindings),
    };
    const again = evaluate(shuffledImage, shuffledGraph, 'q', base);
    assert.deepEqual(again.roots, satisfied.roots, `order trial ${trial}`);
    assert.deepEqual(again.evidenceIds, satisfied.evidenceIds);
  }

  const duplicateNode = { ...graph, nodes: [...graph.nodes, { id: 'anchor' }] };
  assert.equal(evaluate(image.image, duplicateNode, 'q', base).status, 'GRAPH_INVALID');
  const duplicateRelation = { ...graph, relations: [...graph.relations, { ...graph.relations[0] }] };
  assert.equal(evaluate(image.image, duplicateRelation, 'q', base).status, 'GRAPH_INVALID');
  const duplicateBinding = { ...graph, bindings: [...graph.bindings, { ...graph.bindings[0] }] };
  assert.equal(evaluate(image.image, duplicateBinding, 'q', base).status, 'GRAPH_INVALID');
  const duplicateEvidence = { version: 1, evidence: [...image.image.evidence, { ...image.image.evidence[0] }] };
  assert.equal(evaluate(duplicateEvidence, graph, 'q', base).status, 'GRAPH_INVALID');
  assert.deepEqual(evaluate(duplicateEvidence, graph, 'q', base).evidenceIds, []);

  const singlePlan = makePlan({
    frontierMap: { supports: 'F_S' },
    requirements: { F_S: ['s0'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
  });
  const atTwo = evaluate(image.image, graph, 'q', { ...singlePlan, cardinalityBound: 2 });
  const atOne = evaluate(image.image, graph, 'q', { ...singlePlan, cardinalityBound: 1 });
  const atZero = evaluate(image.image, graph, 'q', { ...singlePlan, cardinalityBound: 0 });
  assert.deepEqual(atTwo.evidenceIds, ['s']);
  assert.deepEqual(atOne.evidenceIds, ['s']);
  assert.equal(atZero.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.ok(atZero.evidenceIds.length < atOne.evidenceIds.length);
});
