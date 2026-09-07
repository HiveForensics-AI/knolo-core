import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyKnowledgeImageV5 } from '@knolo/core';
import { buildReflexImageV1 } from '../dist/index.js';

function input() {
  return {
    namespace: 'support',
    sources: [{ bytes: new TextEncoder().encode('Never request a password.') }],
    atoms: [
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'procedure',
        key: 'support.account-recovery',
        scope: { namespace: 'support', locale: 'en' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: {
          steps: ['Identify the provider.'],
          mustNot: ['Request a password.'],
        },
      },
    ],
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.account-recovery.default',
        namespace: 'support',
        atomKeys: ['support.account-recovery'],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  };
}

test('builds a verified deterministic V5 image', () => {
  const first = buildReflexImageV1(input());
  const second = buildReflexImageV1(input());
  assert.deepEqual(first.image.bytes, second.image.bytes);
  assert.equal(first.behaviorRoot, second.behaviorRoot);
  verifyKnowledgeImageV5(first.image.bytes);
  assert.equal(
    first.image.objects.filter((object) => object.kind === 'chunk').length,
    1
  );
  assert.equal(first.manifest.bundleIds.length, 1);
});
