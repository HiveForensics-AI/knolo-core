import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeReflexExtractionRootV1,
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
        behaviorSignature: 'account-recovery',
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
  assert.equal(result.bundles.length, 1);
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

test('commits teacher acceptance and complete normalized atom references', () => {
  const acceptedRecord = {
    schema: 'knolo.reflex.teacher-record/v1',
    id: 'acceptance-record',
    family: 'recovery',
    query: 'recover account',
    teacherOutput: 'Use the approved path.',
    provenance,
  };
  assert.equal(
    computeReflexTeacherRecordRootV1(acceptedRecord),
    computeReflexTeacherRecordRootV1({ ...acceptedRecord, accepted: true })
  );
  assert.notEqual(
    computeReflexTeacherRecordRootV1({ ...acceptedRecord, accepted: false }),
    computeReflexTeacherRecordRootV1(acceptedRecord)
  );

  const baseExtraction = {
    atoms: [atom('support.recovery')],
  };
  const root = computeReflexExtractionRootV1(
    'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseExtraction
  );
  assert.notEqual(
    computeReflexExtractionRootV1(
      'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      {
        atoms: [
          {
            ...atom('support.recovery'),
            requires: ['support.identity'],
          },
        ],
      }
    ),
    root
  );
  assert.notEqual(
    computeReflexExtractionRootV1(
      'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      {
        atoms: [
          {
            ...atom('support.recovery'),
            sourceIds: [
              'sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ],
          },
        ],
      }
    ),
    root
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

test('creates separate bounded bundles for distinct behavior signatures', async () => {
  const records = ['password', 'mfa'].map((variant) => ({
    schema: 'knolo.reflex.teacher-record/v1',
    id: `record-${variant}`,
    family: 'recovery',
    query: `${variant} recovery`,
    teacherOutput: `Use ${variant} recovery.`,
    provenance,
  }));
  const result = await distillReflexBehaviorV1(records, {
    namespace: 'support',
    extractor: (record) => ({
      atoms: [atom(`support.${record.query.split(' ')[0]}-recovery`)],
      behaviorSignature: record.query.split(' ')[0],
    }),
  });
  assert.equal(result.bundles.length, 2);
  assert.notEqual(result.bundles[0].key, result.bundles[1].key);
  assert.equal(
    new Set(result.extractionRecords.map((item) => item.clusterId)).size,
    2
  );
});
