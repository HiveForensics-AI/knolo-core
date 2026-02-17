import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPack, mountPack, query, makeContextPatch } from '../dist/index.js';



function buildLegacyV1PackBytes() {
  const enc = new TextEncoder();
  const meta = enc.encode(JSON.stringify({ version: 1, stats: { docs: 1, blocks: 1, terms: 0 } }));
  const lexicon = enc.encode(JSON.stringify([]));
  const blocks = enc.encode(JSON.stringify(['legacy fixture block text']));

  const total = 4 + meta.length + 4 + lexicon.length + 4 + 0 + 4 + blocks.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let offset = 0;

  dv.setUint32(offset, meta.length, true); offset += 4;
  out.set(meta, offset); offset += meta.length;
  dv.setUint32(offset, lexicon.length, true); offset += 4;
  out.set(lexicon, offset); offset += lexicon.length;
  dv.setUint32(offset, 0, true); offset += 4;
  dv.setUint32(offset, blocks.length, true); offset += 4;
  out.set(blocks, offset);

  return out;
}

async function testPackWithoutSemanticTail() {
  const docs = [{ id: 'plain', text: 'packs without semantic tails should mount normally' }];
  const pack = await mountPack({ src: await buildPack(docs) });
  assert.equal(pack.semantic, undefined, 'expected semantic section to be absent by default');
}

async function testPackWithSemanticTail() {
  const docs = [{ id: 'sem', text: 'pack with semantic metadata and blob' }];
  const semBlob = new Uint8Array(14);
  semBlob.set([1, -2, 3, -4, 5, -6, 7, -8].map((n) => (n + 256) % 256), 0);
  semBlob.set([0x20, 0x03, 0x40, 0x06, 0x60, 0x09], 8);

  const semJson = {
    modelId: 'test-model',
    dims: 4,
    encoding: 'int8_l2norm',
    perVectorScale: true,
    blocks: {
      vectors: { byteOffset: 0, length: 8 },
      scales: { byteOffset: 8, length: 3 },
    },
  };

  const pack = await mountPack({
    src: await buildPack(docs, {
      semantic: {
        enabled: true,
        modelId: 'test-model',
        dims: 4,
        semJson,
        semBlob,
      },
    }),
  });

  assert.ok(pack.semantic, 'expected semantic section to mount');
  assert.equal(pack.semantic?.modelId, 'test-model');
  assert.equal(pack.semantic?.dims, 4);
  assert.equal(pack.semantic?.vecs.length, 8, 'expected int8 vector view length to match semantic JSON');
  assert.equal(pack.semantic?.scales?.length, 3, 'expected uint16 scale view length to match semantic JSON');
}

async function testMountLegacyPackWithoutSemanticTail() {
  const legacy = buildLegacyV1PackBytes();
  const pack = await mountPack({ src: legacy });
  assert.equal(pack.blocks[0], 'legacy fixture block text', 'expected legacy pack block to mount');
  assert.equal(pack.semantic, undefined, 'expected legacy pack to mount without semantic section');
}

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

async function testQueryExpansionRecall() {
  const docs = [
    { id: 'seed', text: 'Throttling controls event bursts and smooths bridge pressure in React Native apps.' },
    { id: 'related', text: 'Rate limiting is used to cap request bursts and protect systems under load.' },
    { id: 'offtopic', text: 'Image caching accelerates rendering and reduces repeated network fetches.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const withExpansion = query(pack, 'throttling bridge pressure', {
    topK: 3,
    queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 0.4 },
  });

  const withoutExpansion = query(pack, 'throttling bridge pressure', {
    topK: 3,
    queryExpansion: { enabled: false },
  });

  assert.ok(
    withExpansion.some((h) => h.source === 'related'),
    'expected deterministic query expansion to pull in lexical neighbor content'
  );

  assert.ok(
    !withoutExpansion.some((h) => h.source === 'related'),
    'expected disabling query expansion to keep strict lexical matching behavior'
  );
}


async function testMinScoreFiltering() {
  const docs = [
    { id: 'hi', text: 'Throttle bridge events to keep UI smooth and responsive.' },
    { id: 'lo', text: 'Backend workers should throttle background jobs during peak load.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const baseline = query(pack, 'throttle bridge ui', { topK: 5 });
  assert.ok(baseline.length >= 1, 'expected baseline query to return at least one hit');

  const filtered = query(pack, 'throttle bridge ui', { topK: 5, minScore: baseline[0].score + 1 });
  assert.equal(filtered.length, 0, 'expected minScore to remove hits below the threshold');
}

async function testSourceFiltering() {
  const docs = [
    { id: 'mobile-guide', namespace: 'mobile', text: 'Bridge throttling improves app responsiveness.' },
    { id: 'backend-guide', namespace: 'backend', text: 'Traffic throttling protects API availability.' },
    { text: 'Unnamed notes about throttling behavior.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const singleSourceHits = query(pack, 'throttling', { topK: 5, source: 'mobile-guide' });
  assert.ok(singleSourceHits.length > 0, 'expected single source filter to return hits');
  assert.ok(singleSourceHits.every((h) => h.source === 'mobile-guide'), 'expected only the requested source id');

  const scopedSourcesHits = query(pack, 'throttling', {
    topK: 5,
    source: ['mobile-guide', 'backend-guide'],
  });
  const sources = new Set(scopedSourcesHits.map((h) => h.source));
  assert.ok(sources.has('mobile-guide') || sources.has('backend-guide'), 'expected requested source ids in results');
  assert.ok(!sources.has(undefined), 'expected source filter to exclude blocks without source ids');
}

async function testContextPatchSourcePropagation() {
  const docs = [{ id: 'src-doc', text: 'Knowledge packs can carry source ids for citations.' }];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, 'source ids', { topK: 1 });
  const patch = makeContextPatch(hits, { budget: 'mini' });
  assert.equal(patch.snippets[0]?.source, 'src-doc');
}

async function testMountPackFromLocalPathAndFileUrl() {
  const docs = [{ id: 'local-doc', text: 'local path loading should work in Node runtimes.' }];
  const bytes = await buildPack(docs);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'knolo-pack-'));
  const packPath = path.join(tmpDir, 'knowledge.knolo');

  try {
    await writeFile(packPath, bytes);

    const fromPath = await mountPack({ src: packPath });
    const pathHits = query(fromPath, 'local path loading', { topK: 1 });
    assert.equal(pathHits[0]?.source, 'local-doc', 'expected mountPack to load plain filesystem paths');

    const fromFileUrl = await mountPack({ src: pathToFileURL(packPath).href });
    const fileUrlHits = query(fromFileUrl, 'local path loading', { topK: 1 });
    assert.equal(fileUrlHits[0]?.source, 'local-doc', 'expected mountPack to load file:// URLs');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

await testSmartQuotePhrase();
await testFirstBlockRetrieval();
await testNearDuplicateDedupe();
await testNamespaceFiltering();
await testQueryExpansionRecall();
await testSourceFiltering();
await testMinScoreFiltering();
await testContextPatchSourcePropagation();
await testMountPackFromLocalPathAndFileUrl();
await testPackWithoutSemanticTail();
await testPackWithSemanticTail();
await testMountLegacyPackWithoutSemanticTail();

console.log('All tests passed.');
