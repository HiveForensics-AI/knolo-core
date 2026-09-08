import assert from 'node:assert/strict';
import test from 'node:test';
import { distillReflexBehaviorV1 } from '../dist/index.js';

function atom(key, type = 'intent') {
  return {
    schema: 'knolo.reflex.atom/v1',
    type,
    key,
    scope: { namespace: 'support' },
    requires: [],
    conflicts: [],
    sourceIds: [],
    body: { instruction: key },
  };
}

test('distills frozen teacher records into deduplicated atoms and bundles', async () => {
  const result = await distillReflexBehaviorV1(
    [
      {
        id: 'record-b',
        family: 'recovery',
        query: 'recover account',
        teacherOutput: 'Use the recovery procedure.',
      },
      {
        id: 'record-a',
        family: 'recovery',
        query: 'reset account',
        teacherOutput: 'Verify ownership first.',
      },
    ],
    {
      namespace: 'support',
      extractor: (record) => ({
        atoms: [
          atom('support.account-recovery'),
          atom('support.verify-ownership', 'constraint'),
        ],
        triggerAtomKeys:
          record.id === 'record-a' ? ['support.account-recovery'] : undefined,
      }),
    }
  );
  assert.deepEqual(result.acceptedRecordIds, ['record-a', 'record-b']);
  assert.equal(result.atoms.length, 2);
  assert.equal(result.duplicateAtomCount, 2);
  assert.deepEqual(result.bundles[0].requiredAtomKeys, [
    'support.account-recovery',
    'support.verify-ownership',
  ]);
  assert.deepEqual(result.bundles[0].triggerAtomKeys, [
    'support.account-recovery',
  ]);
  assert.match(result.distillationDigest, /^sha256-[0-9a-f]{64}$/);
});

test('records rejected teacher runs without silently making atoms', async () => {
  const result = await distillReflexBehaviorV1(
    [
      {
        id: 'rejected',
        family: 'support',
        query: 'unknown',
        teacherOutput: 'not accepted',
        accepted: false,
      },
    ],
    {
      namespace: 'support',
      extractor: () => ({ atoms: [atom('support.nope')] }),
    }
  );
  assert.equal(result.atoms.length, 0);
  assert.deepEqual(result.rejectedRecords, [
    { id: 'rejected', reason: 'teacher record was not accepted' },
  ]);
});
