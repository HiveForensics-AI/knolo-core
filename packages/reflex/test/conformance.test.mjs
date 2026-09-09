import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildReflexImageV1,
  buildReflexMRSFrontierV1,
  calibrateReflexCapabilityV1,
  computeReflexTeacherRecordRootV1,
  distillReflexBehaviorV1,
  openReflexSessionV1,
  selectReflexContextV1,
  validateReflexMRSFrontierV1,
  validateReflexExtractionRecordV1,
  validateReflexTeacherRecordV1,
  verifyReflexSelectionReceiptV1,
} from '../dist/index.js';
import { canonicalCbor, digestDomain } from '@knolo/core';

const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/conformance-v1.json', import.meta.url),
    'utf8'
  )
);

function atom() {
  return {
    schema: 'knolo.reflex.atom/v1',
    type: 'procedure',
    key: 'support.recovery',
    scope: { namespace: 'support' },
    requires: [],
    conflicts: [],
    sourceIds: [],
    body: { steps: ['Identify the provider.'] },
  };
}

test('conformance fixture binds provenance, clusters, coefficients, frontier, and receipt contracts', async () => {
  const teacherRecord = fixture.teacherRecord;
  const teacherRecordRoot = computeReflexTeacherRecordRootV1(teacherRecord);
  validateReflexTeacherRecordV1({
    ...teacherRecord,
    recordRoot: teacherRecordRoot,
  });
  const distilled = await distillReflexBehaviorV1(
    [{ ...teacherRecord, recordRoot: teacherRecordRoot }],
    {
      namespace: 'support',
      extractor: () => ({ atoms: [atom()], behaviorSignature: 'recovery-v1' }),
    }
  );
  validateReflexExtractionRecordV1(distilled.extractionRecords[0]);
  assert.equal(
    distilled.extractionRecords[0].clusterId.startsWith('sha256-'),
    true
  );

  const calibration = calibrateReflexCapabilityV1(
    fixture.calibration.observations,
    fixture.calibration.config
  );
  assert.match(calibration.coefficientDigest, /^sha256-[0-9a-f]{64}$/);
  assert.match(calibration.calibrationDigest, /^sha256-[0-9a-f]{64}$/);

  const frontier = buildReflexMRSFrontierV1(fixture.frontierProblem);
  validateReflexMRSFrontierV1(frontier);
  assert.match(frontier.frontierDigest, /^sha256-[0-9a-f]{64}$/);

  const atomValue = atom();
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
      bytes: canonicalCbor(atomValue),
      meta: atomMeta,
    })
  );
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [atomValue],
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
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
  });
  const selection = selectReflexContextV1(session, 'recovery provider');
  assert.equal(selection.disposition, 'ready');
  verifyReflexSelectionReceiptV1(
    session,
    selection.receipt,
    'recovery provider'
  );
});
