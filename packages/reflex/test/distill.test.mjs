import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeReflexTeacherRecordRootV1,
  distillReflexBehaviorV1,
  distillReflexFrozenExtractionsV1,
  validateReflexTeacherRecordV1,
} from '../dist/index.js';

const provenance = {
  teacherModelId: 'teacher-model',
  teacherRevision: 'teacher-revision',
  promptContractDigest:
    'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  extractorId: 'extractor',
  extractorRevision: 'extractor-v1',
  extractionContractDigest:
    'sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  judgeId: 'judge',
  judgeRevision: 'judge-v1',
  datasetSplit: 'calibration',
};

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
        schema: 'knolo.reflex.teacher-record/v1',
        id: 'record-b',
        family: 'recovery',
        query: 'recover account',
        teacherOutput: 'Use the recovery procedure.',
        provenance,
      },
      {
        schema: 'knolo.reflex.teacher-record/v1',
        id: 'record-a',
        family: 'recovery',
        query: 'reset account',
        teacherOutput: 'Verify ownership first.',
        provenance,
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
        schema: 'knolo.reflex.teacher-record/v1',
        id: 'rejected',
        family: 'support',
        query: 'unknown',
        teacherOutput: 'not accepted',
        accepted: false,
        provenance,
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

test('commits teacher provenance and extracted behavior roots', async () => {
  const record = {
    schema: 'knolo.reflex.teacher-record/v1',
    id: 'provenance-record',
    family: 'recovery',
    query: 'recover account',
    teacherOutput: 'Use the approved path.',
    provenance,
  };
  const recordRoot = computeReflexTeacherRecordRootV1(record);
  validateReflexTeacherRecordV1({ ...record, recordRoot });
  const result = await distillReflexBehaviorV1([{ ...record, recordRoot }], {
    namespace: 'support',
    extractor: () => ({ atoms: [atom('support.recovery')] }),
  });
  assert.equal(result.extractionRecords.length, 1);
  assert.equal(result.extractionRecords[0].teacherRecordRoot, recordRoot);
  assert.match(
    result.extractionRecords[0].extractionRoot,
    /^sha256-[0-9a-f]{64}$/
  );
  assert.throws(() =>
    validateReflexTeacherRecordV1({
      ...record,
      recordRoot,
      teacherOutput: 'tampered',
    })
  );
});

test('replays serialized extraction records without an extractor', async () => {
  const record = {
    schema: 'knolo.reflex.teacher-record/v1',
    id: 'frozen-record',
    family: 'recovery',
    query: 'recover account',
    teacherOutput: 'Use the approved path.',
    provenance,
  };
  const extracted = await distillReflexBehaviorV1([record], {
    namespace: 'support',
    extractor: () => ({ atoms: [atom('support.recovery')] }),
  });
  const replayed = await distillReflexFrozenExtractionsV1(
    extracted.extractionRecords,
    { namespace: 'support' }
  );
  assert.deepEqual(
    replayed.extractionRecords.map((item) => item.extractionRoot),
    extracted.extractionRecords.map((item) => item.extractionRoot)
  );
  assert.deepEqual(replayed.bundles, extracted.bundles);
});
