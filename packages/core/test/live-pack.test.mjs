import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPack, createLivePack, mountPack, query } from '../dist/index.js';

function stableHits(hits) {
  return hits.map(({ source, text, namespace }) => ({
    source,
    text,
    namespace,
  }));
}

function buildDocsSnapshot(pack, docId) {
  const index = pack.docIds?.findIndex((id) => id === docId) ?? -1;
  if (index < 0) {
    throw new Error(`Doc id not found in mounted pack: ${docId}`);
  }
  return {
    text: pack.blocks[index],
    heading: pack.headings?.[index] ?? null,
    namespace: pack.namespaces?.[index] ?? null,
  };
}

async function buildFixture() {
  const base = await mountPack({
    src: await buildPack([
      {
        id: 'b',
        heading: 'Base B',
        namespace: 'base',
        text: 'alpha same',
      },
      {
        id: 'shared',
        heading: 'Base Shared',
        namespace: 'base',
        text: 'alpha same',
      },
      {
        id: 'base-update',
        heading: 'Base Heading',
        namespace: 'base',
        text: 'base note',
      },
      {
        id: 'remove-me',
        heading: 'Remove Heading',
        namespace: 'base',
        text: 'obsolete unique',
      },
    ]),
  });

  const live = await createLivePack(base, [
    {
      id: 'a',
      heading: 'Live A',
      namespace: 'live',
      text: 'newterm aaabbc',
    },
    {
      id: 'z',
      heading: 'Live Z',
      namespace: 'live',
      text: 'newterm aabaad',
    },
    {
      id: 'shared',
      heading: 'Live Shared',
      namespace: 'live',
      text: 'alpha same',
    },
  ]);

  await live.addDocument({
    id: 'added',
    heading: 'Added',
    namespace: 'live',
    text: 'fresh term gamma',
  });
  await live.updateDocument({
    id: 'base-update',
    text: 'updated note',
  });
  await live.removeDocument('remove-me');
  await live.addDocument({
    id: 'remove-me',
    heading: 'Readded Heading',
    namespace: 'live',
    text: 'restored unique',
  });

  const bytes1 = await live.serialize();
  const bytes2 = await live.serialize();
  return { live, bytes1, bytes2 };
}

test('lifecycle probe', async () => {
  const { live, bytes1, bytes2 } = await buildFixture();

  assert.deepEqual(stableHits(live.query('newterm', { topK: 5 })), [
    { source: 'a', text: 'newterm aaabbc', namespace: 'live' },
    { source: 'z', text: 'newterm aabaad', namespace: 'live' },
  ]);
  assert.deepEqual(stableHits(live.query('fresh', { topK: 5 })), [
    { source: 'added', text: 'fresh term gamma', namespace: 'live' },
  ]);
  assert.deepEqual(stableHits(live.query('updated', { topK: 5 })), [
    { source: 'base-update', text: 'updated note', namespace: 'base' },
  ]);
  assert.deepEqual(stableHits(live.query('restored', { topK: 5 })), [
    { source: 'remove-me', text: 'restored unique', namespace: 'live' },
  ]);

  assert.equal(Buffer.compare(Buffer.from(bytes1), Buffer.from(bytes2)), 0);
});

test('roundtrip probe', async () => {
  const { bytes1 } = await buildFixture();
  const roundTrip = await mountPack({ src: bytes1 });
  const roundTripOpts = { topK: 5, queryExpansion: { enabled: false } };
  assert.deepEqual(stableHits(query(roundTrip, 'newterm', roundTripOpts)), [
    { source: 'a', text: 'newterm aaabbc', namespace: 'live' },
    { source: 'z', text: 'newterm aabaad', namespace: 'live' },
  ]);
  assert.deepEqual(stableHits(query(roundTrip, 'fresh', roundTripOpts)), [
    { source: 'added', text: 'fresh term gamma', namespace: 'live' },
  ]);
  assert.deepEqual(stableHits(query(roundTrip, 'updated', roundTripOpts)), [
    { source: 'base-update', text: 'updated note', namespace: 'base' },
  ]);
  assert.deepEqual(stableHits(query(roundTrip, 'restored', roundTripOpts)), [
    { source: 'remove-me', text: 'restored unique', namespace: 'live' },
  ]);

  assert.deepEqual(buildDocsSnapshot(roundTrip, 'base-update'), {
    text: 'updated note',
    heading: 'Base Heading',
    namespace: 'base',
  });
  assert.deepEqual(buildDocsSnapshot(roundTrip, 'remove-me'), {
    text: 'restored unique',
    heading: 'Readded Heading',
    namespace: 'live',
  });
  assert.equal(roundTrip.docIds?.filter((id) => id === 'shared').length, 1);
  assert.equal(roundTrip.namespaces?.[roundTrip.docIds?.findIndex((id) => id === 'shared') ?? -1], 'live');
});

test('merged corpus probe', async () => {
  const base = await mountPack({
    src: await buildPack([
      { id: 'base-short', text: 'alpha' },
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `base-${i}`,
        text: `alpha filler filler filler filler ${i}`,
      })),
    ]),
  });

  const live = await createLivePack(base, [
    {
      id: 'live-long',
      text: `alpha ${Array.from({ length: 25 }, (_, i) => `unique${i}`).join(' ')}`,
    },
  ]);

  const roundTrip = await mountPack({ src: await live.serialize() });
  const queryOpts = { topK: 3, queryExpansion: { enabled: false } };

  assert.deepEqual(
    stableHits(live.query('alpha', queryOpts)),
    stableHits(query(roundTrip, 'alpha', queryOpts))
  );
});

test('validation probe', async () => {
  const base = await mountPack({
    src: await buildPack([
      {
        id: 'known',
        text: 'known doc',
      },
    ]),
  });

  await assert.rejects(
    createLivePack(base, [{ text: 'missing id' }]),
    /id/i
  );

  const live = await createLivePack(base);
  await assert.rejects(
    live.updateDocument({ id: 'missing', text: 'nope' }),
    /unknown id/i
  );
  await assert.rejects(live.removeDocument('missing'), /unknown id/i);
});
