import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../dist/index.js';
import { bind, makeGraph, makeImage, makePlan } from './support.mjs';

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function brute(candidates, required, cardinalityBound) {
  const pool = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let best = null;
  const walk = (start, chosen) => {
    const covered = new Set();
    for (const candidate of chosen) {
      for (const requirement of candidate.reqs) if (required.includes(requirement)) covered.add(requirement);
    }
    if (required.every((requirement) => covered.has(requirement))) {
      const ids = chosen.map((candidate) => candidate.id).sort();
      const key = ids.join('\0');
      if (!best || ids.length < best.ids.length || (ids.length === best.ids.length && key < best.key)) {
        best = { ids, key };
      }
    }
    if (chosen.length >= cardinalityBound) return;
    for (let index = start; index < pool.length; index += 1) walk(index + 1, chosen.concat(pool[index]));
  };
  walk(0, []);
  return best ? best.ids : null;
}

test('minimum-cover matches exhaustive enumeration on 200 tiny graphs', () => {
  const random = mulberry32(20261010);
  const required = ['r0', 'r1', 'r2'];
  for (let trial = 0; trial < 200; trial += 1) {
    const count = 1 + Math.floor(random() * 8);
    const cardinalityBound = Math.floor(random() * 4);
    const candidates = [];
    const nodes = ['anchor'];
    const relations = [];
    const bindings = [];
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const id = `e${String(index).padStart(2, '0')}`;
      const node = `n${String(index).padStart(2, '0')}`;
      const reqs = required.filter(() => random() < 0.45);
      nodes.push(node);
      relations.push({ id: `r${String(index).padStart(2, '0')}`, from: 'anchor', relation: 'supports', to: node });
      bindings.push(bind(`b${String(index).padStart(2, '0')}`, node, id, reqs));
      rows.push({ id, text: `text ${id} ${reqs.join(' ')}` });
      candidates.push({ id, reqs });
    }
    const image = makeImage(rows);
    const graph = makeGraph(image.knowledgeRoot, { nodes, relations, bindings });
    const plan = makePlan({
      frontierMap: { supports: 'F_S' },
      cardinalityBound,
      requirements: { F_S: required, F_O: [], F_Q: [], F_T: [], F_A: [] },
      floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
      bounds: { ...makePlan({}).bounds, maxCoverVisits: 100000 },
    });
    const result = evaluate(image.image, graph, 'anchor', plan);
    const expected = brute(candidates, required, cardinalityBound);
    if (expected === null) {
      assert.equal(result.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS', `trial ${trial}`);
      assert.deepEqual(result.evidenceIds, []);
    } else {
      assert.equal(result.status, 'SATISFIED', `trial ${trial} expected ${expected.join(',')}`);
      assert.deepEqual(result.evidenceIds, expected, `trial ${trial}`);
      for (const id of expected) {
        const subset = expected.filter((item) => item !== id);
        const covered = new Set();
        for (const candidate of candidates) {
          if (subset.includes(candidate.id)) for (const requirement of candidate.reqs) covered.add(requirement);
        }
        assert.equal(required.every((requirement) => covered.has(requirement)), false, `trial ${trial} subset`);
      }
    }
  }
});
