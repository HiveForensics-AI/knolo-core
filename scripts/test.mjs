import assert from 'node:assert/strict';
import { buildPack, mountPack, query, makeContextPatch } from '../dist/index.js';

async function testSmartQuotePhrase() {
  const docs = [
    { id: 'a', text: 'React native bridge throttling improves app stability.' },
    { id: 'b', text: 'Bridge patterns without phrase match.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, '“react native bridge” throttling', { topK: 5 });
  assert.ok(hits.length > 0, 'expected smart-quoted phrase query to match');
  assert.equal(hits[0].source, 'a');
}

async function testFirstBlockRetrieval() {
  const docs = [
    { id: 'first', text: 'alpha beta gamma only appears here' },
    { id: 'second', text: 'unrelated content' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, 'alpha', { topK: 2 });
  assert.ok(hits.some((h) => h.source === 'first'), 'expected block 0 to be retrievable');
}

async function testNearDuplicateDedupe() {
  const docs = [
    { id: 'd1', text: 'Rate limiting reduces spikes in API traffic and protects services from overload.' },
    { id: 'd2', text: 'Rate limiting reduces spikes in API traffic and protects services from overload.' },
    { id: 'd3', text: 'Circuit breakers stop cascading failures when downstream services are unhealthy.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, 'rate limiting services', { topK: 3 });
  const sources = hits.map((h) => h.source);
  assert.equal(sources.filter((s) => s === 'd1' || s === 'd2').length, 1, 'expected one near-duplicate to be removed');
}

async function testContextPatchSourcePropagation() {
  const docs = [{ id: 'src-doc', text: 'Knowledge packs can carry source ids for citations.' }];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, 'source ids', { topK: 1 });
  const patch = makeContextPatch(hits, { budget: 'mini' });
  assert.equal(patch.snippets[0]?.source, 'src-doc');
}

await testSmartQuotePhrase();
await testFirstBlockRetrieval();
await testNearDuplicateDedupe();
await testContextPatchSourcePropagation();

console.log('All tests passed.');
