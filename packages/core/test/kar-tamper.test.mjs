import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonicalize } from '../dist/experimental/kar/canonicalize.js';
import { evaluateKarProjection, verifyKarProjection } from '../dist/experimental/kar/index.js';

const TAMPER_SEED = 20261012;
const TAMPER_COUNT = 10000;
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

test(`randomized certificate tamper seed ${TAMPER_SEED}`, { timeout: 180000 }, () => {
  const frozen = JSON.parse(readFileSync(path.join(repo, 'research/kar-1/fixtures/expected.json'), 'utf8'));
  const bases = frozen.map((row) => evaluateKarProjection(row.image, row.graph, row.query, row.plan));
  for (const [index, base] of bases.entries()) {
    const verdict = verifyKarProjection(frozen[index].image, frozen[index].graph, frozen[index].query, frozen[index].plan, base);
    assert.equal(verdict.ok, true, verdict.reason);
  }
  const random = mulberry32(TAMPER_SEED);
  let changed = 0;
  let accepted = 0;
  let invalidShape = 0;
  let firstAcceptance = null;
  while (changed < TAMPER_COUNT) {
    const index = Math.floor(random() * bases.length);
    const base = bases[index];
    const tampered = mutate(structuredClone(base), random);
    if (canonicalize(tampered) === canonicalize(base)) continue;
    changed += 1;
    const row = frozen[index];
    const verdict = verifyKarProjection(row.image, row.graph, row.query, row.plan, tampered);
    if (verdict.code === 'KAR_RESULT_INVALID') invalidShape += 1;
    if (verdict.ok) {
      accepted += 1;
      firstAcceptance ??= { index: row.name, code: verdict.code };
    }
  }
  assert.equal(accepted, 0, JSON.stringify(firstAcceptance));
  assert.equal(changed, TAMPER_COUNT);
  assert.ok(invalidShape < TAMPER_COUNT);
});

function mutate(result, random) {
  const kind = Math.floor(random() * 14);
  if (kind === 0) {
    result.status = result.status === 'SATISFIED' ? 'UNSATISFIED_EVIDENCE_REQUIREMENTS' : 'SATISFIED';
    result.decision.status = result.status;
  } else if (kind === 1) {
    result.evidenceIds = result.evidenceIds.length === 0 ? ['tampered'] : [];
  } else if (kind === 2) {
    result.choices = [{ evidenceId: 'tampered', frontiers: ['F_S'] }];
  } else if (kind === 3) {
    result.frontiers.F_S = [...result.frontiers.F_S, 'tampered-frontier'];
  } else if (kind === 4) {
    result.witnesses = result.witnesses.length === 0
      ? [{ evidenceId: 'tampered', frontier: 'F_S', anchorId: 'anchor', path: [{ node: 'anchor' }] }]
      : result.witnesses.map((witness, index) => index === 0 ? { ...witness, anchorId: witness.anchorId === 'tampered' ? 'other' : 'tampered' } : witness);
  } else if (kind === 5) {
    result.decision.cardinality += 1;
  } else if (kind === 6) {
    result.decision.coverage.F_O = { covered: result.decision.coverage.F_O.covered + 3, required: result.decision.coverage.F_O.required };
  } else if (kind === 7) {
    result.roots.karRoot = flipDigest(result.roots.karRoot);
  } else if (kind === 8) {
    const names = Object.keys(result.roots);
    const name = names[Math.floor(random() * names.length)];
    result.roots[name] = flipDigest(result.roots[name]);
  } else if (kind === 9) {
    result.version = 'kar-1-research-2';
  } else if (kind === 10) {
    result.decision.profile = `${result.decision.profile}-tampered`;
  } else if (kind === 11) {
    result.witnesses = [...result.witnesses].reverse();
  } else if (kind === 12) {
    result.note = 'uncommitted';
  } else {
    result.roots = { ...result.roots, extra: result.roots.karRoot };
  }
  return result;
}

function flipDigest(value) {
  const last = value.endsWith('a') ? 'b' : 'a';
  return `${value.slice(0, -1)}${last}`;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
