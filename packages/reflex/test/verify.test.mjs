import assert from 'node:assert/strict';
import test from 'node:test';
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
