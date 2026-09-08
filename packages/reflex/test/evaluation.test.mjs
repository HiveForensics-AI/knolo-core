import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  clopperPearsonUpper,
  evaluateReflexPolicyV1,
  openReflexSessionV1,
} from '../dist/index.js';
import { buildReflexImageV1 } from '../dist/index.js';

async function session() {
  const atom = {
    schema: 'knolo.reflex.atom/v1',
    type: 'procedure',
    key: 'support.recovery',
    scope: { namespace: 'support' },
    requires: [],
    conflicts: [],
    sourceIds: [],
    body: { steps: ['Identify the provider.'] },
  };
  const atomMeta = {
    reflex_namespace: 'support',
    reflex_role: 'atom',
    reflex_schema: 'knolo.reflex.atom/v1',
    reflex_type: 'procedure',
  };
  const atomId = digestDomain(
    'object',
    canonicalCbor({
      kind: 'metadata',
      bytes: canonicalCbor(atom),
      meta: atomMeta,
    })
  );
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [atom],
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.recovery.default',
        namespace: 'support',
        atomIds: [atomId],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  return openReflexSessionV1(built.image.bytes, { namespace: 'support' });
}

test('reports evaluation counts, coverage, and a calibrated risk bound', async () => {
  const report = await evaluateReflexPolicyV1(
    await session(),
    [
      { id: '1', family: 'recovery', query: 'recovery provider' },
      { id: '2', family: 'recovery', query: 'recovery provider' },
    ],
    {
      modelId: 'test-model',
      revision: 'test-revision',
      run: async () => ({ failure: false, outputTokens: 3, latencyMs: 12 }),
    },
    {
      riskCeiling: 0.8,
      datasetSplitDigest:
        'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }
  );
  assert.equal(report.answeredTasks, 2);
  assert.equal(report.coverage, 1);
  assert.equal(report.failures, 0);
  assert.equal(report.status, 'certified');
  assert.equal(report.profile.modelId, 'test-model');
  assert.equal(report.totalInputTokens > 0, true);
  assert.equal(report.totalOutputTokens, 6);
  assert.equal(report.p95LatencyMs, 12);
  assert.equal(report.profile.metricScale, 1_000_000);
  assert.match(report.profile.policyDigest, /^sha256-[0-9a-f]{64}$/);
  assert.match(report.profile.datasetSplitDigest, /^sha256-[0-9a-f]{64}$/);
  assert.equal(
    Number.isInteger(report.profile.metrics.upperFailureBoundPpm),
    true
  );
});

test('returns uncertified when no task is answered', () => {
  assert.equal(clopperPearsonUpper(0, 0, 0.05), 1);
});

test('does not certify policy violations or insufficient family coverage', async () => {
  const report = await evaluateReflexPolicyV1(
    await session(),
    [
      { id: '1', family: 'recovery', query: 'recovery provider' },
      { id: '2', family: 'out-of-domain', query: 'weather' },
    ],
    {
      modelId: 'test-model',
      revision: 'test-revision',
      run: async () => ({ failure: false, policyViolation: true }),
    },
    { minCoverage: 0.5, minFamilyCoverage: { 'out-of-domain': 1 } }
  );
  assert.equal(report.policyViolations, 1);
  assert.equal(report.status, 'uncertified');
  assert.equal(report.byFamily['out-of-domain'].coverage, 0);
});
