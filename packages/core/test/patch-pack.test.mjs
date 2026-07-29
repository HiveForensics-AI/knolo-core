import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPatchPack,
  createPatchPack,
  deserializePatchPack,
  mergePatchPacks,
  mountPack,
  serializePatchPack,
} from '../dist/index.js';

test('patch packs serialize, merge, and replay deterministically', async () => {
  const base = await mountPack({
    src: await (await import('../dist/index.js')).buildPack([
      { id: 'base', text: 'old knowledge', heading: 'Old' },
      { id: 'remove', text: 'remove this' },
    ]),
  });
  const a = createPatchPack(base, [{
    op: 'upsert', id: 'base', ts: 2, actor: 'agent-a',
    doc: { id: 'base', text: 'new knowledge', heading: 'New' },
  }]);
  const b = createPatchPack(base, [{
    op: 'remove', id: 'remove', ts: 3, actor: 'agent-b',
  }, {
    op: 'upsert', id: 'added', ts: 4, actor: 'agent-b',
    doc: { id: 'added', text: 'delta knowledge', namespace: 'updates' },
  }]);
  const merged = mergePatchPacks(a, b);
  const bytes1 = serializePatchPack(merged);
  const bytes2 = serializePatchPack(deserializePatchPack(bytes1));
  assert.deepEqual([...bytes1], [...bytes2]);

  const live = await applyPatchPack(base, deserializePatchPack(bytes1));
  assert.deepEqual(live.query('new', { queryExpansion: { enabled: false } }).map(h => h.source), ['base']);
  assert.deepEqual(live.query('delta', { queryExpansion: { enabled: false } }).map(h => h.source), ['added']);
  assert.equal(live.query('remove', { queryExpansion: { enabled: false } }).length, 0);
});

test('LivePack exports its append-only mutations and rejects another base', async () => {
  const { buildPack, createLivePack } = await import('../dist/index.js');
  const base = await mountPack({ src: await buildPack([{ id: 'one', text: 'one' }]) });
  const live = await createLivePack(base, [], { actor: 'test' });
  await live.addDocument({ id: 'two', text: 'two' });
  await live.updateDocument({ id: 'two', text: 'two revised' });
  const patch = deserializePatchPack(await live.serializePatchPack());
  assert.equal(patch.ops.length, 2);
  assert.equal(patch.ops[1].op, 'upsert');
  assert.equal(patch.ops[1].doc.text, 'two revised');

  const other = await mountPack({ src: await buildPack([{ id: 'other', text: 'other' }]) });
  await assert.rejects(applyPatchPack(other, patch), /fingerprint mismatch/i);
});
