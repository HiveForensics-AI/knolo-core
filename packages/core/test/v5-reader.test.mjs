import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeImageV5, openKnowledgeImageV5 } from '../dist/index.js';

function image() {
  return createKnowledgeImageV5({
    objects: [
      {
        kind: 'source',
        bytes: new TextEncoder().encode('alpha'),
        meta: { n: 1 },
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('beta'),
        meta: { n: 2 },
      },
    ],
  });
}

test('openKnowledgeImageV5 verifies once and selectively returns owned objects', () => {
  const original = image();
  const reader = openKnowledgeImageV5(original.bytes);
  assert.equal(reader.stateRoot, original.stateRoot);
  assert.equal(reader.commitDigest, original.commitDigest);
  const alpha = original.objects.find(
    (object) => new TextDecoder().decode(object.bytes) === 'alpha'
  );
  const first = reader.getObject(alpha.id);
  assert.ok(first);
  first.bytes[0] ^= 0xff;
  first.meta.n = 99;
  const second = reader.getObject(alpha.id);
  assert.equal(new TextDecoder().decode(second.bytes), 'alpha');
  assert.equal(second.meta.n, 1n);
  assert.equal(
    reader.getObjects(['missing', original.objects[1].id]).length,
    1
  );
  assert.equal(reader.materialize().stateRoot, original.stateRoot);
});

test('openKnowledgeImageV5 owns its input and rejects corruption before reads', () => {
  const original = image();
  const input = original.bytes.slice();
  const reader = openKnowledgeImageV5(input);
  input[input.length - 1] ^= 1;
  assert.equal(reader.materialize().stateRoot, original.stateRoot);
  const corrupt = original.bytes.slice();
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => openKnowledgeImageV5(corrupt));
});

test('reader query-index access remains optional', () => {
  const reader = openKnowledgeImageV5(image().bytes);
  assert.equal(reader.getQueryIndex(), undefined);
});
