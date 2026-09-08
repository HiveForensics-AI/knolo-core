import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalCbor,
  createKnowledgeImageV5,
  decodeCanonicalCbor,
} from '@knolo/core';
import { buildReflexImageV1, verifyReflexImageV1 } from '../dist/index.js';

test('verifies Reflex manifest references and projections', () => {
  const result = buildReflexImageV1({
    namespace: 'support',
    atoms: [],
    bundles: [],
  });
  const verification = verifyReflexImageV1(result.image.bytes);
  assert.equal(verification.valid, true);
  assert.equal(verification.objects, 1);
  assert.equal(verification.atoms, 0);
});

test('enforces Reflex object limits', () => {
  const result = buildReflexImageV1({
    namespace: 'support',
    atoms: [],
    bundles: [],
  });
  assert.throws(() =>
    verifyReflexImageV1(result.image.bytes, { maxObjects: 0 })
  );
});

test('rejects an image whose manifest behavior root was changed', () => {
  const result = buildReflexImageV1({
    namespace: 'support',
    atoms: [],
    bundles: [],
  });
  const objects = result.image.objects.map((object) => {
    if (object.meta.reflex_role !== 'manifest') return object;
    const manifest = decodeCanonicalCbor(object.bytes);
    const { id: _oldId, ...withoutId } = object;
    return {
      ...withoutId,
      bytes: canonicalCbor({
        ...manifest,
        behaviorRoot: 'sha256-' + '0'.repeat(64),
      }),
    };
  });
  const tampered = createKnowledgeImageV5({
    actor: 'test-tamper',
    objects,
  });
  assert.throws(
    () => verifyReflexImageV1(tampered.bytes),
    /behavior root mismatch/
  );
});
