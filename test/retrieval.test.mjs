import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, mountPack, query, makeContextPatch } from '../dist/index.js';

test('supports smart quotes for required phrases', async () => {
  const docs = [
    { id: 'a', text: 'React native bridge event throttling improves performance.' },
    { id: 'b', text: 'Totally unrelated sentence.' }
  ];
  const bytes = await buildPack(docs);
  const kb = await mountPack({ src: bytes });
  const hits = query(kb, '“react native bridge” throttling', { topK: 3 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, 'a');
});

test('deduplicates near-identical blocks while keeping distinct results', async () => {
  const docs = [
    { id: 'd1', text: 'Throttle limits event rate across the bridge for better responsiveness.' },
    { id: 'd2', text: 'Throttle limits event rate across the bridge for better responsiveness.' },
    { id: 'd3', text: 'Debounce waits for silence while throttle enforces a maximum rate.' }
  ];
  const bytes = await buildPack(docs);
  const kb = await mountPack({ src: bytes });
  const hits = query(kb, 'throttle bridge maximum rate', { topK: 3 });
  assert.ok(hits.length >= 2);
  const uniqueSources = new Set(hits.map(h => h.source));
  assert.equal(uniqueSources.size, hits.length);
});

test('makeContextPatch preserves source attribution in snippets', async () => {
  const patch = makeContextPatch([
    { blockId: 0, score: 1, text: 'Alpha text.', source: 'alpha' }
  ]);
  assert.equal(patch.snippets[0].source, 'alpha');
});
