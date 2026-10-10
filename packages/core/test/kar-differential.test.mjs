import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { evaluate as researchEvaluate } from '../../../research/kar-1/dist/index.js';
import { canonicalize, digest } from '../dist/experimental/kar/canonicalize.js';
import { evaluateKarProjection } from '../dist/experimental/kar/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const DIFFERENTIAL_SEED = 20261011;
const DIFFERENTIAL_CASES = 50000;

function sha256File(relative) {
  return createHash('sha256').update(readFileSync(path.join(repo, relative))).digest('hex');
}

function certificateView(result) {
  return {
    status: result.status,
    evidenceIds: result.evidenceIds,
    choices: result.choices,
    frontiers: result.frontiers,
    witnesses: result.witnesses,
    decision: result.decision,
    roots: result.roots,
  };
}

function compare(row, label) {
  const research = researchEvaluate(row.image, row.graph, row.query, row.plan);
  const core = evaluateKarProjection(row.image, row.graph, row.query, row.plan);
  const left = canonicalize(research);
  const right = canonicalize(core);
  if (left === right) return null;
  return {
    label,
    researchStatus: research.status,
    coreStatus: core.status,
    researchRoot: research.roots?.karRoot,
    coreRoot: core.roots?.karRoot,
  };
}

test('frozen spec and expected vectors are unchanged', () => {
  assert.equal(sha256File('spec/KAR-1.md'), 'a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66');
  assert.equal(sha256File('research/kar-1/fixtures/expected.json'), '154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf');
});

test('experimental core matches the 16 frozen vectors and 12 integration fixtures', () => {
  const frozen = JSON.parse(readFileSync(path.join(repo, 'research/kar-1/fixtures/expected.json'), 'utf8'));
  for (const row of frozen) {
    const mismatch = compare(row, row.name);
    assert.equal(mismatch, null, JSON.stringify(mismatch));
    const core = evaluateKarProjection(row.image, row.graph, row.query, row.plan);
    assert.equal(canonicalize(certificateView(core)), canonicalize(certificateView(row)));
  }
  const dir = path.join(repo, 'research/kar-1/integration/fixtures/normalized');
  const names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert.equal(names.length, 12);
  for (const name of names) {
    const row = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    const mismatch = compare(row, name);
    assert.equal(mismatch, null, JSON.stringify(mismatch));
  }
});

test('deep chain witness bytes match the research oracle', () => {
  const count = 400;
  const width = String(count - 1).length;
  const idOf = (index) => `n${String(index).padStart(width, '0')}`;
  const evidence = [{ id: 'e-end', text: 'end of chain' }];
  const image = { version: 1, evidence };
  const graph = {
    version: 1,
    knowledgeRoot: digest(image),
    provenance: { producer: 'hand' },
    nodes: Array.from({ length: count }, (_, index) => ({ id: idOf(index) })),
    relations: Array.from({ length: count - 1 }, (_, index) => ({
      id: `r-${idOf(index)}`,
      from: idOf(index),
      relation: 'supports',
      to: idOf(index + 1),
    })),
    bindings: [{ id: 'b-end', nodeId: idOf(count - 1), evidenceId: 'e-end', requirements: ['need'] }],
  };
  const plan = basePlan({
    anchor: { mode: 'supplied', witness: [{ nodeId: idOf(0), queryTerm: 'end' }] },
    frontierMap: { supports: 'F_S' },
    depth: count - 1,
    cardinalityBound: 1,
    requirements: { F_S: ['need'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    bounds: { ...basePlan().bounds, maxClosureNodes: count + 2, maxClosureEdges: count + 2 },
  });
  const mismatch = compare({ image, graph, query: 'follow the chain', plan }, 'deep-chain');
  assert.equal(mismatch, null, JSON.stringify(mismatch));
});

test(`differential ${DIFFERENTIAL_CASES} generated graphs seed ${DIFFERENTIAL_SEED}`, { timeout: 600000 }, () => {
  const random = mulberry32(DIFFERENTIAL_SEED);
  let mismatches = 0;
  let first = null;
  for (let index = 0; index < DIFFERENTIAL_CASES; index += 1) {
    const row = generateCase(random, index);
    const mismatch = compare(row, `case-${index}`);
    if (mismatch) {
      mismatches += 1;
      first ??= { index, ...mismatch };
      break;
    }
  }
  assert.equal(mismatches, 0, JSON.stringify(first));
});

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function basePlan(patch = {}) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'room' }] },
    frontierMap: { supports: 'F_S' },
    depth: 1,
    cardinalityBound: 3,
    coverageMode: 'requirements',
    requirements: { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-10-10',
    minAuthority: null,
    bounds: {
      maxAnchorNodes: 8,
      maxClosureNodes: 32,
      maxClosureEdges: 64,
      maxFrontierEvidence: 16,
      maxRequirementsPerFrontier: 8,
      maxEvidenceBindings: 32,
      maxCoverVisits: 10000,
    },
    lexical: null,
    ...patch,
  };
}

function generateCase(random, index) {
  const roll = random();
  if (roll < 0.03) return { image: null, graph: null, query: random() < 0.5 ? 'q' : 4, plan: basePlan() };
  if (roll < 0.06) return { image: { version: 1, evidence: [] }, graph: { version: 1 }, query: 'q', plan: { version: 1 } };
  if (roll < 0.08) return { image: { version: 1, evidence: [{ id: 'e', text: 't' }] }, graph: null, query: 'anchor', plan: null };

  const count = 1 + Math.floor(random() * 5);
  const symbols = ['supports', 'prohibits', 'qualifies', 'during', 'cites'];
  const frontierOf = { supports: 'F_S', prohibits: 'F_O', qualifies: 'F_Q', during: 'F_T', cites: 'F_A' };
  const frontierMap = {};
  for (const symbol of symbols) if (random() < 0.8) frontierMap[symbol] = frontierOf[symbol];
  if (Object.keys(frontierMap).length === 0) frontierMap.supports = 'F_S';

  const nodes = ['anchor'];
  const relations = [];
  const bindings = [];
  const evidence = [];
  for (let item = 0; item < count; item += 1) {
    const node = `n${item}`;
    nodes.push(node);
    const id = `e${index.toString(36)}x${item}`;
    const requirements = ['a', 'b', 'c', 'd'].filter(() => random() < 0.45);
    evidence.push({ id, text: `text ${id} ${requirements.join(' ')} ${random() < 0.4 ? 'Alpha BETA' : 'gamma'}` });
    const from = item === 0 || random() < 0.7 ? 'anchor' : nodes[1 + Math.floor(random() * item)];
    relations.push({ id: `r${index}x${item}`, from, relation: pick(random, symbols), to: node });
    const binding = { id: `b${index}x${item}`, nodeId: node, evidenceId: id, requirements };
    if (random() < 0.25) binding.authority = Math.floor(random() * 90);
    if (random() < 0.05) binding.unauthorized = true;
    if (random() < 0.2) {
      binding.validFrom = '2024-01-01';
      binding.validUntil = random() < 0.5 ? '2025-01-01' : '2028-01-01';
    }
    bindings.push(binding);
  }
  if (random() < 0.15) {
    nodes.push('mid', 'end');
    relations.push({ id: `r${index}mid`, from: 'n0', relation: 'supports', to: 'mid' });
    relations.push({ id: `r${index}end`, from: 'mid', relation: pick(random, symbols), to: 'end' });
    const id = `e${index.toString(36)}end`;
    evidence.push({ id, text: `deeper ${id}` });
    bindings.push({ id: `b${index}end`, nodeId: 'end', evidenceId: id, requirements: random() < 0.5 ? ['z'] : ['a'] });
  }

  const image = { version: 1, evidence: [...evidence].reverse() };
  const sorted = [...evidence].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const knowledgeRoot = digest({ version: 1, evidence: sorted });
  const unbound = random() < 0.04;
  const graph = {
    version: 1,
    knowledgeRoot: unbound ? digest({ unbound: index }) : knowledgeRoot,
    provenance: { producer: 'hand', ...(random() < 0.5 ? { note: `case ${index}` } : {}) },
    nodes: nodes.map((id) => ({ id })),
    relations,
    bindings,
  };
  const profiles = ['minimum-cover', 'minimum-cover-redundancy-v1', 'exp1-lexicographic'];
  const requirements = {
    F_S: random() < 0.7 ? ['a'] : ['a', 'b'],
    F_O: random() < 0.5 ? [] : ['c'],
    F_Q: random() < 0.7 ? [] : ['d'],
    F_T: [],
    F_A: random() < 0.8 ? [] : ['z'],
  };
  const anchorMode = random();
  let anchor = { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'room' }] };
  let query = 'ask anchor about the room';
  if (anchorMode < 0.25) {
    anchor = { mode: 'recompute', procedure: 'member-id-v1' };
    query = 'the anchor token is present';
  } else if (anchorMode < 0.3) {
    anchor = { mode: 'supplied', witness: [{ nodeId: 'missing-node', queryTerm: 'room' }] };
  }
  const plan = basePlan({
    anchor,
    frontierMap,
    depth: random() < 0.2 ? 0 : random() < 0.7 ? 1 : 3,
    cardinalityBound: Math.floor(random() * 4),
    coverageMode: random() < 0.2 ? 'nonempty' : 'requirements',
    requirements,
    floors: {
      F_S: pick(random, ['0', '1', '0.5']),
      F_O: pick(random, ['0', '1']),
      F_Q: '0',
      F_T: '0',
      F_A: pick(random, ['0', '1']),
    },
    profile: random() < 0.7 ? 'minimum-cover' : pick(random, profiles),
    asOf: random() < 0.5 ? '2026-10-10' : '2024-06-01',
    minAuthority: random() < 0.2 ? 40 : null,
    bounds: {
      ...basePlan().bounds,
      maxCoverVisits: random() < 0.05 ? Math.floor(random() * 4) : 10000,
      maxClosureEdges: random() < 0.03 ? 0 : 64,
    },
    lexical: random() < 0.08 ? { frontier: 'F_S', evidenceIds: [sorted[0].id] } : null,
  });
  if (!unbound && random() < 0.03) plan.lexical = { frontier: 'F_O', evidenceIds: ['missing-evidence'] };
  return { image, graph, query, plan };
}
