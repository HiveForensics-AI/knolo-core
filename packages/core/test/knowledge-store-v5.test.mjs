import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KnowledgeImageStoreV5,
  createKnowledgeImageV5,
  inspectKnowledgeImageV5,
} from '../dist/index.js';

function genesis() {
  return createKnowledgeImageV5({
    actor: 'fixture',
    objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('genesis'), meta: { version: 1 } }],
  });
}

test('V5 store commits append-only objects and preserves snapshot readers', () => {
  const initial = genesis();
  const store = new KnowledgeImageStoreV5(initial.bytes);
  const before = store.snapshot();
  const beforeBytes = [...before.bytes];

  const tx = store.beginTransaction({ actor: 'writer-a' });
  tx.addObject({ kind: 'source', bytes: new TextEncoder().encode('alpha'), meta: { source: 'a.md' } });
  assert.throws(() => store.beginTransaction(), /already active/i);

  const committed = tx.commit();
  assert.deepEqual([...before.bytes], beforeBytes);
  assert.equal(before.stateRoot, initial.stateRoot);
  assert.notEqual(committed.stateRoot, before.stateRoot);
  assert.equal(committed.commit.sequence, 2);
  assert.deepEqual(committed.commit.parents, [before.commitDigest]);
  assert.equal(committed.objects.length, 2);
  assert.equal(committed.events.length, 2);
  assert.equal(committed.events.some((event) => event.parents.includes(before.commitDigest)), true);
  assert.equal(inspectKnowledgeImageV5(committed.bytes).stateRoot, committed.stateRoot);
  assert.throws(() => tx.addObject({ kind: 'source', bytes: new Uint8Array(), meta: {} }), /closed/i);
});

test('V5 transaction rollback releases the single writer slot', () => {
  const store = new KnowledgeImageStoreV5(genesis());
  const tx = store.beginTransaction();
  tx.rollback();
  assert.throws(() => tx.commit(), /closed/i);
  const next = store.beginTransaction();
  next.rollback();
});

test('V5 store snapshots are detached from internal state', () => {
  const store = new KnowledgeImageStoreV5(genesis());
  const snapshot = store.snapshot();
  snapshot.bytes[0] ^= 0xff;
  snapshot.objects[0].bytes[0] ^= 0xff;
  const reread = store.snapshot();
  assert.equal(reread.bytes[0], 75);
  assert.equal(new TextDecoder().decode(reread.objects[0].bytes), 'genesis');
});
