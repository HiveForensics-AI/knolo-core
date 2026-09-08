import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeMinimumReflexSetV1 } from '../dist/index.js';

test('finds the minimum-token feasible context by exhaustive search', () => {
  const result = optimizeMinimumReflexSetV1({
    atoms: [
      { id: 'a', tokenCost: 5, contribution: 4 },
      { id: 'b', tokenCost: 2, contribution: 2 },
      { id: 'c', tokenCost: 1, contribution: 2, requires: ['b'] },
    ],
    intercept: -1,
    successThreshold: 0.9,
  });
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.selectedAtomIds, ['b', 'c']);
  assert.equal(result.tokenCost, 3);
  assert.equal(result.enumeratedSubsets, 8);
  assert.ok(result.predictedSuccess >= 0.9);
});

test('does not claim optimality when the finite search limit is exceeded', () => {
  const result = optimizeMinimumReflexSetV1({
    atoms: [
      { id: 'a', tokenCost: 1, contribution: 1 },
      { id: 'b', tokenCost: 1, contribution: 1 },
    ],
    intercept: 0,
    successThreshold: 0.5,
    maxSearchAtoms: 1,
  });
  assert.equal(result.status, 'search_limit');
  assert.equal(result.tokenCost, null);
});
