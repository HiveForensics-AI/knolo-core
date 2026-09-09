import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrateReflexCapabilityV1 } from '../dist/index.js';

const splitDigest =
  'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function observation(id, atomIds, success) {
  return {
    schema: 'knolo.reflex.ablation-observation/v1',
    id,
    modelId: 'gemma4:e2b',
    modelRevision: 'gemma4:e2b',
    family: 'recovery',
    queryId: `query-${id.slice(-2)}`,
    datasetSplit: 'calibration',
    atomIds,
    success,
    inputTokens: atomIds.length * 4,
    outputTokens: 10,
    latencyMs: 20,
  };
}

test('fits deterministic capability coefficients from ablation observations', () => {
  const observations = [];
  const groups = [
    [[], 1],
    [['atom-a'], 7],
    [['atom-b'], 4],
    [['atom-a', 'atom-b'], 9],
  ];
  let index = 0;
  for (const [atomIds, successes] of groups) {
    for (let repeat = 0; repeat < 10; repeat++) {
      observations.push(
        observation(
          `observation-${String(index++).padStart(2, '0')}`,
          atomIds,
          repeat < successes
        )
      );
    }
  }
  const config = {
    modelId: 'gemma4:e2b',
    modelRevision: 'gemma4:e2b',
    family: 'recovery',
    candidateAtomIds: ['atom-a', 'atom-b'],
    interactionAtomPairs: [['atom-a', 'atom-b']],
    datasetSplitDigest: splitDigest,
    minObservations: 20,
  };
  const result = calibrateReflexCapabilityV1(observations, config);
  assert.equal(result.observations, 40);
  assert.equal(result.successes, 21);
  assert.equal(result.converged, true);
  assert.equal(result.features.length, 4);
  assert.ok(
    result.features.find((feature) => feature.name === 'atom:atom-a')
      .coefficient > 0
  );
  assert.ok(
    result.features.find((feature) => feature.name === 'atom:atom-b')
      .coefficient > 0
  );
  assert.match(result.coefficientDigest, /^sha256-[0-9a-f]{64}$/);
  assert.match(result.calibrationDigest, /^sha256-[0-9a-f]{64}$/);
  assert.deepEqual(
    result,
    calibrateReflexCapabilityV1(observations.slice().reverse(), config)
  );
});

test('rejects calibration that mixes models, splits, or one-sided outcomes', () => {
  const base = observation('observation-00', [], true);
  assert.throws(() =>
    calibrateReflexCapabilityV1(
      [
        base,
        { ...base, id: 'observation-01', success: false, modelId: 'other' },
      ],
      {
        modelId: 'gemma4:e2b',
        modelRevision: 'gemma4:e2b',
        family: 'recovery',
        candidateAtomIds: ['atom-a'],
        datasetSplitDigest: splitDigest,
        minObservations: 2,
      }
    )
  );
  assert.throws(() =>
    calibrateReflexCapabilityV1(
      [
        base,
        { ...base, id: 'observation-01', success: false, datasetSplit: 'test' },
      ],
      {
        modelId: 'gemma4:e2b',
        modelRevision: 'gemma4:e2b',
        family: 'recovery',
        candidateAtomIds: ['atom-a'],
        datasetSplitDigest: splitDigest,
        minObservations: 2,
      }
    )
  );
});
