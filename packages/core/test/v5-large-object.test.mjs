import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPack,
  createKnowledgeImageV5,
  migrateV4ToV5,
  mountKnowledgeImageV5,
  verifyKnowledgeImageV5,
} from '../dist/index.js';

// Larger than the argument limit of a single function call.
const LARGE = 1_000_000;

test('V5 images round-trip an object with large bytes', () => {
  const bytes = new Uint8Array(LARGE).map((_, index) => index % 251);
  const image = createKnowledgeImageV5({
    objects: [{ kind: 'chunk', bytes, meta: {} }],
  });
  const mounted = mountKnowledgeImageV5(image.bytes);
  assert.equal(mounted.stateRoot, image.stateRoot);
  assert.deepEqual(mounted.objects[0].bytes, bytes);
  verifyKnowledgeImageV5(image.bytes);
});

test('V5 images round-trip a large metadata string', () => {
  const title = 'é'.repeat(LARGE);
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('alpha'),
        meta: { title },
      },
    ],
  });
  const mounted = mountKnowledgeImageV5(image.bytes);
  assert.equal(mounted.objects[0].meta.title, title);
});

test('migrateV4ToV5 accepts a large document', async () => {
  const text = 'refund policy '.repeat(20_000);
  const pack = await buildPack([{ id: 'large', text }]);
  const migrated = await migrateV4ToV5(pack);
  const mounted = mountKnowledgeImageV5(migrated.image);
  const source = mounted.objects.find((object) => object.kind === 'source');
  assert.equal(new TextDecoder().decode(source.bytes), text);
});
