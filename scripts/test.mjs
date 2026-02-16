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


async function testNamespaceFiltering() {
  const docs = [
    { id: 'mobile-1', namespace: 'mobile', text: 'Bridge events use throttle controls for performance.' },
    { id: 'backend-1', namespace: 'backend', text: 'API gateways also throttle traffic bursts.' },
    { id: 'none-1', text: 'General throttling information without explicit namespace.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const mobileHits = query(pack, 'throttle', { topK: 5, namespace: 'mobile' });
  assert.ok(mobileHits.length > 0, 'expected namespace query to return results');
  assert.ok(mobileHits.every((h) => h.namespace === 'mobile'), 'expected only mobile namespace hits');

  const multiHits = query(pack, 'throttle', { topK: 5, namespace: ['mobile', 'backend'] });
  const namespaces = new Set(multiHits.map((h) => h.namespace));
  assert.ok(namespaces.has('mobile') || namespaces.has('backend'), 'expected namespaced hits in multi-namespace query');
  assert.ok(!namespaces.has(undefined), 'expected namespace filter to exclude unscoped docs');
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
await testNamespaceFiltering();
await testContextPatchSourcePropagation();

console.log('All tests passed.');
