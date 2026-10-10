import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../dist/index.js';
import { bind, makeGraph, makeImage, makePlan } from '../../test/support.mjs';

const FRONTIERS = ['F_S', 'F_O', 'F_Q', 'F_T', 'F_A'];
const RELATION = { F_S: 'supports', F_O: 'prohibits', F_Q: 'qualifies', F_T: 'constrains', F_A: 'authorizes' };
const here = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function floorMicros(floor) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(floor);
  if (!match) throw new Error(floor);
  const fraction = (match[2] ?? '').padEnd(6, '0');
  return Number(match[1]) * 1_000_000 + Number(fraction);
}

function passes(covered, required, micros) {
  if (required === 0) return true;
  return BigInt(covered) * 1_000_000n >= BigInt(micros) * BigInt(required);
}

function applicable(binding, plan) {
  if (binding.unauthorized) return false;
  if (plan.minAuthority !== null && (binding.authority === undefined || binding.authority < plan.minAuthority)) return false;
  if (binding.validFrom !== undefined && plan.asOf < binding.validFrom) return false;
  if (binding.validUntil !== undefined && plan.asOf >= binding.validUntil) return false;
  return true;
}

function brute(candidates, requirements, floors, cardinalityBound) {
  const pool = candidates
    .filter((candidate) => FRONTIERS.some((frontier) => (candidate.reqs[frontier] ?? []).some((id) => requirements[frontier].includes(id))))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const micros = Object.fromEntries(FRONTIERS.map((frontier) => [frontier, floorMicros(floors[frontier])]));
  const feasible = (chosen) => FRONTIERS.every((frontier) => {
    const requiredList = requirements[frontier];
    if (requiredList.length === 0) return true;
    const hit = new Set();
    for (const candidate of chosen) {
      for (const requirement of candidate.reqs[frontier] ?? []) {
        if (requiredList.includes(requirement)) hit.add(requirement);
      }
    }
    return passes(hit.size, requiredList.length, micros[frontier]);
  });
  const maxSize = Math.min(cardinalityBound, pool.length);
  for (let size = 0; size <= maxSize; size += 1) {
    if (size === 0) {
      if (feasible([])) return { status: 'SATISFIED', evidenceIds: [] };
      continue;
    }
    const index = Array.from({ length: size }, (_, offset) => offset);
    while (true) {
      const combo = index.map((offset) => pool[offset]);
      if (feasible(combo)) return { status: 'SATISFIED', evidenceIds: combo.map((candidate) => candidate.id) };
      let cursor = size - 1;
      while (cursor >= 0 && index[cursor] === pool.length - size + cursor) cursor -= 1;
      if (cursor < 0) break;
      index[cursor] += 1;
      for (let next = cursor + 1; next < size; next += 1) index[next] = index[next - 1] + 1;
    }
  }
  return { status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS', evidenceIds: [] };
}

test('minimum-cover matches exhaustive enumeration on 10000 tiny graphs', { timeout: 300000 }, () => {
  const random = mulberry32(20261010);
  const floorChoices = ['0', '0.25', '0.5', '1'];
  let mismatches = 0;
  let first = null;
  for (let trial = 0; trial < 10000; trial += 1) {
    const count = 1 + Math.floor(random() * 10);
    const requirementCount = Math.floor(random() * 6);
    const cardinalityBound = Math.floor(random() * (count + 1));
    const minAuthority = random() < 0.5 ? null : 5;
    const requirements = { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
    const floors = { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' };
    for (const frontier of FRONTIERS) floors[frontier] = floorChoices[Math.floor(random() * floorChoices.length)];
    for (let index = 0; index < requirementCount; index += 1) {
      const frontier = FRONTIERS[Math.floor(random() * FRONTIERS.length)];
      requirements[frontier].push(`${frontier}-r${index}`);
    }
    const nodes = ['anchor'];
    const relations = [];
    const bindings = [];
    const rows = [];
    const candidates = [];
    for (let index = 0; index < count; index += 1) {
      const id = `e${String(index).padStart(2, '0')}`;
      const node = `n${String(index).padStart(2, '0')}`;
      const frontier = FRONTIERS[Math.floor(random() * FRONTIERS.length)];
      const reqs = { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
      for (const requirement of requirements[frontier]) {
        if (random() < 0.55) reqs[frontier].push(requirement);
      }
      const expired = random() < 0.2;
      const weak = random() < 0.25;
      const unauthorized = random() < 0.2;
      const extra = {};
      if (unauthorized) extra.unauthorized = true;
      if (expired) extra.validUntil = '2020-01-01';
      if (weak) extra.authority = 1;
      else if (random() < 0.5) extra.authority = 10;
      nodes.push(node);
      relations.push({ id: `r${String(index).padStart(2, '0')}`, from: 'anchor', relation: RELATION[frontier], to: node });
      const binding = bind(`b${String(index).padStart(2, '0')}`, node, id, reqs[frontier], extra);
      bindings.push(binding);
      rows.push({ id, text: `text ${id}` });
      if (applicable(binding, { minAuthority, asOf: '2026-10-10' })) candidates.push({ id, reqs });
    }
    const image = makeImage(rows);
    const graph = makeGraph(image.knowledgeRoot, { nodes, relations, bindings });
    const plan = makePlan({
      anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'q' }] },
      frontierMap: { supports: 'F_S', prohibits: 'F_O', qualifies: 'F_Q', constrains: 'F_T', authorizes: 'F_A' },
      cardinalityBound,
      requirements,
      floors,
      minAuthority,
      bounds: { ...makePlan({}).bounds, maxCoverVisits: 200000, maxFrontierEvidence: 20, maxClosureEdges: 40, maxEvidenceBindings: 20 },
    });
    const result = evaluate(image.image, graph, 'q', plan);
    const expected = brute(candidates, requirements, floors, cardinalityBound);
    if (result.status === 'SEARCH_BOUND_EXCEEDED' || result.status === 'CLOSURE_BOUND_EXCEEDED' || result.status === 'PLAN_INVALID' || result.status === 'GRAPH_INVALID') {
      mismatches += 1;
      first ??= { trial, status: result.status };
      continue;
    }
    if (result.status !== expected.status || result.evidenceIds.join(',') !== expected.evidenceIds.join(',')) {
      mismatches += 1;
      first ??= { trial, status: result.status, ids: result.evidenceIds, expected };
    }
  }
  const summary = { seed: 20261010, graphs: 10000, mismatches, first };
  fs.mkdirSync(path.join(here, '..', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(here, '..', 'fixtures', 'enumerate-10k.json'), `${JSON.stringify(summary, null, 2)}\n`);
  assert.equal(mismatches, 0, JSON.stringify(first));
});
