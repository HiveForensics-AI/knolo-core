import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReflexMRSFrontierV1,
  computeReflexMRSProblemDigestV1,
  lookupReflexMRSFrontierV1,
  optimizeMinimumReflexSetV1,
  validateReflexMRSFrontierV1,
} from '../dist/index.js';

function problem() {
  return {
    atoms: [
      { id: 'atom.expensive', tokenCost: 2, contribution: 2 },
      { id: 'atom.cheap', tokenCost: 1, contribution: 1 },
      { id: 'atom.dominated', tokenCost: 3, contribution: -1 },
    ],
    intercept: 0,
    successThreshold: 0.55,
    maxSearchAtoms: 10,
  };
}

test('builds and validates a deterministic MRS Pareto frontier', () => {
  const first = buildReflexMRSFrontierV1(problem());
  const second = buildReflexMRSFrontierV1({
    ...problem(),
    atoms: problem().atoms.slice().reverse(),
  });
  assert.equal(first.frontierDigest, second.frontierDigest);
  assert.equal(first.problemDigest, computeReflexMRSProblemDigestV1(problem()));
  validateReflexMRSFrontierV1(first);
  assert.deepEqual(
    first.entries.map((entry) => entry.selectedAtomIds),
    [['atom.cheap'], ['atom.expensive'], ['atom.cheap', 'atom.expensive']]
  );
  assert.ok(
    first.entries.every(
      (entry) => !entry.selectedAtomIds.includes('atom.dominated')
    )
  );
});

test('frontier lookup matches exhaustive optimization without subset search', () => {
  const candidateProblem = problem();
  const frontier = buildReflexMRSFrontierV1(candidateProblem);
  const optimized = optimizeMinimumReflexSetV1(candidateProblem);
  const lookup = lookupReflexMRSFrontierV1(
    frontier,
    ['atom.cheap', 'atom.expensive'],
    { maxContextAtoms: 2, maxInputTokens: 2 }
  );
  assert.equal(optimized.status, 'optimal');
  assert.deepEqual(lookup?.selectedAtomIds, optimized.selectedAtomIds);
  assert.equal(lookup?.tokenCost, optimized.tokenCost);
  assert.equal(
    lookupReflexMRSFrontierV1(frontier, ['atom.expensive'], {
      maxContextAtoms: 0,
    }),
    null
  );
});

test('rejects tampered frontier contents', () => {
  const frontier = buildReflexMRSFrontierV1(problem());
  const tampered = {
    ...frontier,
    entries: frontier.entries.slice(0, -1),
  };
  assert.throws(() => validateReflexMRSFrontierV1(tampered), /digest mismatch/);
});
