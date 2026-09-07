import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REFLEX_SCHEMA_VERSIONS,
  validateReflexAtomV1,
  validateReflexManifestV1,
} from '../dist/index.js';

const digest = 'sha256-' + 'a'.repeat(64);

function manifest() {
  return {
    schema: REFLEX_SCHEMA_VERSIONS.manifest,
    behaviorRoot: digest,
    atomIds: [digest],
    bundleIds: [],
    projectionIds: [],
    sourceIds: [],
    profileIds: [],
    evaluationIds: [],
  };
}

test('validates a bounded Reflex manifest', () => {
  assert.doesNotThrow(() => validateReflexManifestV1(manifest()));
});

test('rejects unknown fields and duplicate IDs', () => {
  assert.throws(() => validateReflexManifestV1({ ...manifest(), extra: true }));
  assert.throws(() =>
    validateReflexManifestV1({ ...manifest(), atomIds: [digest, digest] })
  );
});

test('rejects invalid atom references', () => {
  assert.throws(() =>
    validateReflexAtomV1({
      schema: REFLEX_SCHEMA_VERSIONS.atom,
      type: 'procedure',
      key: 'support.recovery',
      scope: { namespace: 'support' },
      requires: ['not-a-digest'],
      conflicts: [],
      sourceIds: [],
      body: {},
    })
  );
});
