import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildPack,
  mountPack,
  query,
  makeContextPatch,
  decodeScaleF16,
  lexConfidence,
  hasSemantic,
  validateQueryOptions,
  validateSemanticQueryOptions,
  listAgents,
  getAgent,
  resolveAgent,
  buildSystemPrompt,
  isToolAllowed,
  assertToolAllowed,
} from '../dist/index.js';

const execFileAsync = promisify(execFile);

async function buildSemanticFixturePack() {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        '../fixtures/semantic-enabled.knolo.fixture.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const docs = fixture.docs;
  const embeddings = fixture.embeddings.map((vec) => Float32Array.from(vec));
  const bytes = await buildPack(docs, {
    semantic: {
      enabled: true,
      modelId: fixture.modelId,
      embeddings,
      quantization: { type: 'int8_l2norm', perVectorScale: true },
    },
  });
  return mountPack({ src: bytes });
}

function buildLegacyV1PackBytes() {
  const enc = new TextEncoder();
  const meta = enc.encode(
    JSON.stringify({ version: 1, stats: { docs: 1, blocks: 1, terms: 0 } })
  );
  const lexicon = enc.encode(JSON.stringify([]));
  const blocks = enc.encode(JSON.stringify(['legacy fixture block text']));

  const total =
    4 + meta.length + 4 + lexicon.length + 4 + 0 + 4 + blocks.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let offset = 0;

  dv.setUint32(offset, meta.length, true);
  offset += 4;
  out.set(meta, offset);
  offset += meta.length;
  dv.setUint32(offset, lexicon.length, true);
  offset += 4;
  out.set(lexicon, offset);
  offset += lexicon.length;
  dv.setUint32(offset, 0, true);
  offset += 4;
  dv.setUint32(offset, blocks.length, true);
  offset += 4;
  out.set(blocks, offset);

  return out;
}

async function testPackWithoutSemanticTail() {
  const docs = [
    { id: 'plain', text: 'packs without semantic tails should mount normally' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  assert.equal(
    pack.semantic,
    undefined,
    'expected semantic section to be absent by default'
  );
}

async function testPackWithSemanticTail() {
  const docs = [
    { id: 'sem-1', text: 'pack with semantic vectors one' },
    { id: 'sem-2', text: 'pack with semantic vectors two' },
    { id: 'sem-3', text: 'pack with semantic vectors three' },
  ];
  const embeddings = [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([0, 2, 0, 0]),
    new Float32Array([-1, -1, 0, 0]),
  ];

  const pack = await mountPack({
    src: await buildPack(docs, {
      semantic: {
        enabled: true,
        modelId: 'test-model',
        embeddings,
        quantization: { type: 'int8_l2norm', perVectorScale: true },
      },
    }),
  });

  assert.ok(pack.semantic, 'expected semantic section to mount');
  assert.equal(pack.semantic?.modelId, 'test-model');
  assert.equal(pack.semantic?.dims, 4);
  assert.equal(
    pack.semantic?.vecs.length,
    12,
    'expected concatenated int8 vectors for 3 blocks'
  );
  assert.equal(
    pack.semantic?.scales?.length,
    3,
    'expected one uint16 scale per block'
  );

  const expectedVecs = [127, 0, 0, 0, 0, 127, 0, 0, -127, -127, 0, 0];
  assert.deepEqual(
    Array.from(pack.semantic?.vecs ?? []),
    expectedVecs,
    'expected quantized int8 vectors'
  );
  assert.ok(
    (pack.semantic?.vecs ?? new Int8Array()).every(
      (n) => n >= -127 && n <= 127
    ),
    'expected int8 clamp range'
  );

  const expectedScales = [1 / 127, 1 / 127, 0.7071067811865475 / 127];
  const decodedScales = Array.from(pack.semantic?.scales ?? []).map((v) =>
    decodeScaleF16(v)
  );
  decodedScales.forEach((value, i) => {
    assert.ok(
      Math.abs(value - expectedScales[i]) < 1e-5,
      `expected decoded scale at index ${i} to be close`
    );
  });
}

async function testMountLegacyPackWithoutSemanticTail() {
  const legacy = buildLegacyV1PackBytes();
  const pack = await mountPack({ src: legacy });
  assert.equal(
    pack.blocks[0],
    'legacy fixture block text',
    'expected legacy pack block to mount'
  );
  assert.equal(
    pack.semantic,
    undefined,
    'expected legacy pack to mount without semantic section'
  );
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
  assert.ok(
    hits.some((h) => h.source === 'first'),
    'expected block 0 to be retrievable'
  );
}

async function testNearDuplicateDedupe() {
  const docs = [
    {
      id: 'd1',
      text: 'Rate limiting reduces spikes in API traffic and protects services from overload.',
    },
    {
      id: 'd2',
      text: 'Rate limiting reduces spikes in API traffic and protects services from overload.',
    },
    {
      id: 'd3',
      text: 'Circuit breakers stop cascading failures when downstream services are unhealthy.',
    },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, 'rate limiting services', { topK: 3 });
  const sources = hits.map((h) => h.source);
  assert.equal(
    sources.filter((s) => s === 'd1' || s === 'd2').length,
    1,
    'expected one near-duplicate to be removed'
  );
}

async function testNamespaceFiltering() {
  const docs = [
    {
      id: 'mobile-1',
      namespace: 'mobile',
      text: 'Bridge events use throttle controls for performance.',
    },
    {
      id: 'backend-1',
      namespace: 'backend',
      text: 'API gateways also throttle traffic bursts.',
    },
    {
      id: 'none-1',
      text: 'General throttling information without explicit namespace.',
    },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const mobileHits = query(pack, 'throttle', { topK: 5, namespace: 'mobile' });
  assert.ok(
    mobileHits.length > 0,
    'expected namespace query to return results'
  );
  assert.ok(
    mobileHits.every((h) => h.namespace === 'mobile'),
    'expected only mobile namespace hits'
  );

  const multiHits = query(pack, 'throttle', {
    topK: 5,
    namespace: ['mobile', 'backend'],
  });
  const namespaces = new Set(multiHits.map((h) => h.namespace));
  assert.ok(
    namespaces.has('mobile') || namespaces.has('backend'),
    'expected namespaced hits in multi-namespace query'
  );
  assert.ok(
    !namespaces.has(undefined),
    'expected namespace filter to exclude unscoped docs'
  );
}

async function testQueryExpansionRecall() {
  const docs = [
    {
      id: 'seed',
      text: 'Throttling controls event bursts and smooths bridge pressure in React Native apps.',
    },
    {
      id: 'related',
      text: 'Rate limiting is used to cap request bursts and protect systems under load.',
    },
    {
      id: 'offtopic',
      text: 'Image caching accelerates rendering and reduces repeated network fetches.',
    },
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
    {
      id: 'hi',
      text: 'Throttle bridge events to keep UI smooth and responsive.',
    },
    {
      id: 'lo',
      text: 'Backend workers should throttle background jobs during peak load.',
    },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const baseline = query(pack, 'throttle bridge ui', { topK: 5 });
  assert.ok(
    baseline.length >= 1,
    'expected baseline query to return at least one hit'
  );

  const filtered = query(pack, 'throttle bridge ui', {
    topK: 5,
    minScore: baseline[0].score + 1,
  });
  assert.equal(
    filtered.length,
    0,
    'expected minScore to remove hits below the threshold'
  );
}

async function testSourceFiltering() {
  const docs = [
    {
      id: 'mobile-guide',
      namespace: 'mobile',
      text: 'Bridge throttling improves app responsiveness.',
    },
    {
      id: 'backend-guide',
      namespace: 'backend',
      text: 'Traffic throttling protects API availability.',
    },
    { text: 'Unnamed notes about throttling behavior.' },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });

  const singleSourceHits = query(pack, 'throttling', {
    topK: 5,
    source: 'mobile-guide',
  });
  assert.ok(
    singleSourceHits.length > 0,
    'expected single source filter to return hits'
  );
  assert.ok(
    singleSourceHits.every((h) => h.source === 'mobile-guide'),
    'expected only the requested source id'
  );

  const scopedSourcesHits = query(pack, 'throttling', {
    topK: 5,
    source: ['mobile-guide', 'backend-guide'],
  });
  const sources = new Set(scopedSourcesHits.map((h) => h.source));
  assert.ok(
    sources.has('mobile-guide') || sources.has('backend-guide'),
    'expected requested source ids in results'
  );
  assert.ok(
    !sources.has(undefined),
    'expected source filter to exclude blocks without source ids'
  );
}

async function testContextPatchSourcePropagation() {
  const docs = [
    {
      id: 'src-doc',
      text: 'Knowledge packs can carry source ids for citations.',
    },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  const hits = query(pack, 'source ids', { topK: 1 });
  const patch = makeContextPatch(hits, { budget: 'mini' });
  assert.equal(patch.snippets[0]?.source, 'src-doc');
}

async function testMountPackFromLocalPathAndFileUrl() {
  const docs = [
    {
      id: 'local-doc',
      text: 'local path loading should work in Node runtimes.',
    },
  ];
  const bytes = await buildPack(docs);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'knolo-pack-'));
  const packPath = path.join(tmpDir, 'knowledge.knolo');

  try {
    await writeFile(packPath, bytes);

    const fromPath = await mountPack({ src: packPath });
    const pathHits = query(fromPath, 'local path loading', { topK: 1 });
    assert.equal(
      pathHits[0]?.source,
      'local-doc',
      'expected mountPack to load plain filesystem paths'
    );

    const fromFileUrl = await mountPack({ src: pathToFileURL(packPath).href });
    const fileUrlHits = query(fromFileUrl, 'local path loading', { topK: 1 });
    assert.equal(
      fileUrlHits[0]?.source,
      'local-doc',
      'expected mountPack to load file:// URLs'
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testLexConfidenceDeterministic() {
  const high = lexConfidence([{ score: 4 }, { score: 1 }]);
  const low = lexConfidence([{ score: 1 }, { score: 0.95 }]);
  assert.ok(
    high > low,
    'expected larger top1/top2 gap to yield higher confidence'
  );
  assert.equal(
    lexConfidence([]),
    0,
    'expected empty hits to have zero confidence'
  );
  assert.equal(
    lexConfidence([{ score: 2 }, { score: 2 }]),
    lexConfidence([{ score: 2 }, { score: 2 }]),
    'expected determinism'
  );
}

async function testSemanticRerankLowConfidence() {
  const docs = [
    { id: 'lex-a', text: 'alpha beta river stone' },
    { id: 'lex-b', text: 'alpha beta solar wind' },
  ];
  const pack = await mountPack({
    src: await buildPack(docs, {
      semantic: {
        enabled: true,
        modelId: 'test-model',
        embeddings: [new Float32Array([1, 0]), new Float32Array([0, 1])],
        quantization: { type: 'int8_l2norm', perVectorScale: true },
      },
    }),
  });

  const lexical = query(pack, 'alpha beta', {
    topK: 2,
    queryExpansion: { enabled: false },
  });
  const preferB = lexical[0]?.source === 'lex-a';
  const reranked = query(pack, 'alpha beta', {
    topK: 2,
    queryExpansion: { enabled: false },
    semantic: {
      enabled: true,
      queryEmbedding: preferB
        ? new Float32Array([0, 1])
        : new Float32Array([1, 0]),
      minLexConfidence: 1,
      blend: { enabled: false },
    },
  });

  assert.ok(
    lexical.length === 2 && reranked.length === 2,
    'expected both lexical and reranked results'
  );
  assert.notEqual(
    reranked[0]?.source,
    lexical[0]?.source,
    'expected semantic rerank to change ordering under low confidence'
  );
}

async function testSemanticRerankRespectsConfidenceAndForce() {
  const docs = [
    { id: 'strong-lex', text: 'alpha omega alpha omega alpha omega' },
    { id: 'weak-lex', text: 'alpha' },
  ];
  const pack = await mountPack({
    src: await buildPack(docs, {
      semantic: {
        enabled: true,
        modelId: 'test-model',
        embeddings: [new Float32Array([1, 0]), new Float32Array([0, 1])],
        quantization: { type: 'int8_l2norm', perVectorScale: true },
      },
    }),
  });

  const lexical = query(pack, 'alpha omega', {
    topK: 2,
    queryExpansion: { enabled: false },
  });
  const gated = query(pack, 'alpha omega', {
    topK: 2,
    queryExpansion: { enabled: false },
    semantic: {
      enabled: true,
      queryEmbedding: new Float32Array([0, 1]),
      minLexConfidence: 0.01,
    },
  });
  const forced = query(pack, 'alpha omega', {
    topK: 2,
    queryExpansion: { enabled: false },
    semantic: {
      enabled: true,
      queryEmbedding: new Float32Array([0, 1]),
      force: true,
      blend: { enabled: false },
    },
  });

  assert.equal(
    lexical[0]?.source,
    'strong-lex',
    'expected lexical baseline to prefer stronger term frequency'
  );
  assert.equal(
    gated[0]?.source,
    'strong-lex',
    'expected confidence gate to skip semantic rerank'
  );
  assert.equal(
    forced[0]?.source,
    'weak-lex',
    'expected force=true to apply semantic rerank regardless of confidence'
  );
}

async function testSemanticRerankErrorAndDefaults() {
  const docs = [
    { id: 'a', text: 'alpha beta gamma' },
    { id: 'b', text: 'alpha beta delta' },
  ];
  const noSemanticPack = await mountPack({ src: await buildPack(docs) });
  const withSemanticPack = await mountPack({
    src: await buildPack(docs, {
      semantic: {
        enabled: true,
        modelId: 'test-model',
        embeddings: [new Float32Array([1, 0]), new Float32Array([0, 1])],
        quantization: { type: 'int8_l2norm', perVectorScale: true },
      },
    }),
  });

  const baseline = query(noSemanticPack, 'alpha beta', {
    topK: 2,
    queryExpansion: { enabled: false },
  });
  const semanticMissing = query(noSemanticPack, 'alpha beta', {
    topK: 2,
    queryExpansion: { enabled: false },
    semantic: { enabled: true, queryEmbedding: new Float32Array([1, 0]) },
  });
  assert.deepEqual(
    semanticMissing,
    baseline,
    'expected semantic-enabled query to no-op when pack.semantic is absent'
  );

  const defaultOpts = query(withSemanticPack, 'alpha beta', {
    topK: 2,
    queryExpansion: { enabled: false },
  });
  const explicitDisabled = query(withSemanticPack, 'alpha beta', {
    topK: 2,
    queryExpansion: { enabled: false },
    semantic: { enabled: false },
  });
  assert.deepEqual(
    explicitDisabled,
    defaultOpts,
    'expected default query behavior to remain unchanged'
  );

  assert.throws(
    () =>
      query(withSemanticPack, 'alpha beta', { semantic: { enabled: true } }),
    /semantic\.queryEmbedding/,
    'expected clear error when semantic rerank is enabled without a query embedding'
  );
}

async function testSemanticFixtureAndHelpers() {
  const pack = await buildSemanticFixturePack();
  assert.ok(
    hasSemantic(pack),
    'expected semantic-enabled fixture pack to report semantic availability'
  );

  const noSemantic = await mountPack({
    src: await buildPack([{ text: 'no semantic section' }]),
  });
  assert.equal(
    hasSemantic(noSemantic),
    false,
    'expected hasSemantic=false when semantic section is absent'
  );
}

async function testValidateSemanticQueryOptions() {
  assert.doesNotThrow(() =>
    validateSemanticQueryOptions({
      enabled: true,
      mode: 'rerank',
      topN: 5,
      queryEmbedding: new Float32Array([1, 2]),
    })
  );
  assert.throws(
    () => validateSemanticQueryOptions({ topN: 0 }),
    /semantic\.topN/
  );
  assert.throws(
    () => validateSemanticQueryOptions({ minLexConfidence: 2 }),
    /semantic\.minLexConfidence/
  );
  assert.throws(
    () => validateSemanticQueryOptions({ queryEmbedding: [1, 2] }),
    /Float32Array/
  );
}

async function testValidateQueryOptions() {
  assert.doesNotThrow(() =>
    validateQueryOptions({
      topK: 5,
      minScore: 0,
      requirePhrases: ['bridge throttling'],
      namespace: ['mobile', 'backend'],
      source: 'mobile-guide',
      queryExpansion: {
        enabled: true,
        docs: 3,
        terms: 4,
        weight: 0.2,
        minTermLength: 3,
      },
      semantic: { enabled: false },
    })
  );

  assert.throws(() => validateQueryOptions({ topK: 0 }), /topK/);
  assert.throws(() => validateQueryOptions({ minScore: -1 }), /minScore/);
  assert.throws(
    () => validateQueryOptions({ requirePhrases: [123] }),
    /requirePhrases/
  );
  assert.throws(
    () => validateQueryOptions({ namespace: ['mobile', 42] }),
    /namespace/
  );
  assert.throws(
    () => validateQueryOptions({ source: ['guide', 42] }),
    /source/
  );
  assert.throws(
    () => validateQueryOptions({ queryExpansion: { docs: 0 } }),
    /queryExpansion\.docs/
  );
}

async function testAgentsBackwardCompatibility() {
  const docs = [
    {
      id: 'mobile-doc',
      namespace: 'mobile',
      text: 'mobile bridge throttling notes',
    },
    {
      id: 'backend-doc',
      namespace: 'backend',
      text: 'backend throttle policy notes',
    },
  ];
  const pack = await mountPack({ src: await buildPack(docs) });
  assert.deepEqual(
    listAgents(pack),
    [],
    'expected packs without agents to expose no agents'
  );

  const hits = query(pack, 'throttling', {
    namespace: 'mobile',
    topK: 5,
    queryExpansion: { enabled: false },
  });
  assert.ok(
    hits.length > 0,
    'expected existing namespace query behavior unchanged without agents'
  );
  assert.ok(
    hits.every((h) => h.namespace === 'mobile'),
    'expected namespace filtering to remain unchanged'
  );
}

async function testAgentEmbeddingAndLookup() {
  const docs = [
    {
      id: 'mobile-doc',
      namespace: 'mobile',
      text: 'mobile bridge throttling notes',
    },
    {
      id: 'backend-doc',
      namespace: 'backend',
      text: 'backend throttle policy notes',
    },
  ];

  const agents = [
    {
      id: 'mobile.agent',
      version: 1,
      systemPrompt: [
        'You are the mobile support agent.',
        'Use only mobile knowledge.',
      ],
      retrievalDefaults: { namespace: ['mobile'], topK: 2 },
      toolPolicy: { mode: 'allow', tools: ['search_docs'] },
    },
    {
      id: 'backend.agent',
      version: 1,
      systemPrompt: {
        format: 'markdown',
        template: 'You are backend helper for {{team}}.',
      },
      retrievalDefaults: { namespace: ['backend'], topK: 3 },
      toolPolicy: { mode: 'deny', tools: ['delete_data'] },
    },
  ];

  const pack = await mountPack({ src: await buildPack(docs, { agents }) });
  assert.deepEqual(
    listAgents(pack),
    ['mobile.agent', 'backend.agent'],
    'expected stable registry order from listAgents'
  );

  const known = getAgent(pack, 'mobile.agent');
  assert.equal(known?.id, 'mobile.agent', 'expected known agent to resolve');
  assert.equal(
    getAgent(pack, 'missing.agent'),
    undefined,
    'expected unknown agent to return undefined'
  );
}

async function testResolveAgentDefaultsAndOverrides() {
  const docs = [
    {
      id: 'mobile-doc',
      namespace: 'mobile',
      text: 'mobile bridge throttling notes',
    },
    {
      id: 'backend-doc',
      namespace: 'backend',
      text: 'backend throttle policy notes',
    },
  ];

  const agents = [
    {
      id: 'mobile.agent',
      version: 1,
      systemPrompt: {
        format: 'markdown',
        template: 'You are the mobile support agent. Tone: {{tone}}',
      },
      retrievalDefaults: {
        namespace: ['mobile'],
        topK: 1,
        queryExpansion: { enabled: false },
      },
    },
  ];

  const pack = await mountPack({ src: await buildPack(docs, { agents }) });

  const resolvedDefaults = resolveAgent(pack, {
    agentId: 'mobile.agent',
    patch: { tone: 'calm' },
  });
  assert.equal(
    resolvedDefaults.systemPrompt,
    'You are the mobile support agent. Tone: calm',
    'expected resolveAgent to apply template patch values'
  );
  const defaultHits = query(
    pack,
    'throttling',
    resolvedDefaults.retrievalOptions
  );
  assert.ok(
    defaultHits.length > 0,
    'expected resolved defaults to produce hits'
  );
  assert.ok(
    defaultHits.every((h) => h.namespace === 'mobile'),
    'expected resolved defaults to enforce agent namespace'
  );

  const resolvedOverride = resolveAgent(pack, {
    agentId: 'mobile.agent',
    patch: { tone: 'direct' },
    query: { namespace: ['backend'], topK: 5 },
  });
  assert.deepEqual(
    resolvedOverride.retrievalOptions.namespace,
    ['mobile'],
    'expected agent namespace binding to remain strict even when caller passes namespace override'
  );
  assert.equal(
    resolvedOverride.retrievalOptions.topK,
    5,
    'expected caller topK override precedence'
  );
}

async function testToolPolicyHelpers() {
  const noPolicy = {
    id: 'no.policy.agent',
    version: 1,
    systemPrompt: ['No policy'],
    retrievalDefaults: { namespace: ['mobile'] },
  };
  assert.equal(
    isToolAllowed(noPolicy, 'delete_data'),
    true,
    'expected no policy to allow all tools'
  );

  const allowPolicy = {
    id: 'allow.policy.agent',
    version: 1,
    systemPrompt: ['Allow policy'],
    retrievalDefaults: { namespace: ['mobile'] },
    toolPolicy: { mode: 'allow', tools: ['read_data'] },
  };
  assert.equal(
    isToolAllowed(allowPolicy, 'read_data'),
    true,
    'expected allow policy listed tool to be allowed'
  );
  assert.equal(
    isToolAllowed(allowPolicy, 'delete_data'),
    false,
    'expected allow policy non-listed tool to be denied'
  );
  assert.throws(
    () => assertToolAllowed(allowPolicy, 'delete_data'),
    /agent allow\.policy\.agent does not allow tool: delete_data/,
    'expected deterministic tool assertion error for blocked tool'
  );

  const denyPolicy = {
    id: 'deny.policy.agent',
    version: 1,
    systemPrompt: ['Deny policy'],
    retrievalDefaults: { namespace: ['mobile'] },
    toolPolicy: { mode: 'deny', tools: ['delete_data'] },
  };
  assert.equal(
    isToolAllowed(denyPolicy, 'read_data'),
    true,
    'expected deny policy non-listed tool to be allowed'
  );
  assert.equal(
    isToolAllowed(denyPolicy, 'delete_data'),
    false,
    'expected deny policy listed tool to be denied'
  );
}

async function testMountTimeAgentValidationAndNoRevalidationOnResolve() {
  const enc = new TextEncoder();
  const invalidMeta = enc.encode(
    JSON.stringify({
      version: 3,
      stats: { docs: 1, blocks: 1, terms: 0 },
      agents: {
        version: 1,
        agents: [
          {
            id: 'bad.agent',
            version: 1,
            systemPrompt: ['Bad'],
            retrievalDefaults: { namespace: [] },
          },
        ],
      },
    })
  );
  const lexicon = enc.encode(JSON.stringify([]));
  const blocks = enc.encode(JSON.stringify(['fixture block']));
  const total =
    4 + invalidMeta.length + 4 + lexicon.length + 4 + 0 + 4 + blocks.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let offset = 0;
  dv.setUint32(offset, invalidMeta.length, true);
  offset += 4;
  out.set(invalidMeta, offset);
  offset += invalidMeta.length;
  dv.setUint32(offset, lexicon.length, true);
  offset += 4;
  out.set(lexicon, offset);
  offset += lexicon.length;
  dv.setUint32(offset, 0, true);
  offset += 4;
  dv.setUint32(offset, blocks.length, true);
  offset += 4;
  out.set(blocks, offset);

  await assert.rejects(
    () => mountPack({ src: out }),
    /retrievalDefaults\.namespace/,
    'expected invalid agent registries to fail at mount time'
  );

  const docs = [
    {
      id: 'mobile-doc',
      namespace: 'mobile',
      text: 'mobile bridge throttling notes',
    },
  ];
  const pack = await mountPack({
    src: await buildPack(docs, {
      agents: [
        {
          id: 'valid.agent',
          version: 1,
          systemPrompt: ['Valid'],
          retrievalDefaults: { namespace: ['mobile'], topK: 1 },
        },
      ],
    }),
  });

  const agent = getAgent(pack, 'valid.agent');
  assert.ok(agent, 'expected valid.agent to exist');
  agent.version = 99;

  const resolved = resolveAgent(pack, { agentId: 'valid.agent' });
  assert.equal(
    resolved.agent.version,
    99,
    'expected resolveAgent to not re-validate mounted agent definitions'
  );
}

async function testAgentValidationAndPromptDeterminism() {
  const docs = [
    {
      id: 'mobile-doc',
      namespace: 'mobile',
      text: 'mobile bridge throttling notes',
    },
  ];

  await assert.rejects(
    () =>
      buildPack(docs, {
        agents: [
          {
            id: 'invalid.agent',
            version: 1,
            systemPrompt: ['invalid topk'],
            retrievalDefaults: { namespace: ['mobile'], topK: 0 },
          },
        ],
      }),
    /topK/,
    'expected invalid retrievalDefaults.topK to fail via query validation'
  );

  const pack = await mountPack({
    src: await buildPack(docs, {
      agents: [
        {
          id: 'prompt.agent',
          version: 1,
          systemPrompt: ['Line 1', 'Line 2'],
          retrievalDefaults: { namespace: ['mobile'] },
        },
      ],
    }),
  });

  const promptAgent = getAgent(pack, 'prompt.agent');
  assert.ok(promptAgent, 'expected prompt.agent to be retrievable');
  assert.equal(
    buildSystemPrompt(promptAgent),
    'Line 1\nLine 2',
    'expected string[] system prompt joining to be deterministic'
  );

  const markdownAgent = {
    id: 'markdown.agent',
    version: 1,
    systemPrompt: {
      format: 'markdown',
      template: 'Hello {{name}} from {{team}}.',
    },
    retrievalDefaults: { namespace: ['mobile'] },
  };
  assert.equal(
    buildSystemPrompt(markdownAgent, { name: 'Ava', team: 'Ops' }),
    'Hello Ava from Ops.',
    'expected deterministic template replacement'
  );
  assert.throws(
    () => buildSystemPrompt(markdownAgent, { name: 'Ava' }),
    /missing patch value for placeholder: team/,
    'expected missing placeholder values to throw for auditability'
  );
}



async function testCliEmbedsAgentsFromDirectory() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'knolo-cli-agents-'));
  try {
    const docsPath = path.join(tmpDir, 'docs.json');
    const outPath = path.join(tmpDir, 'out.knolo');
    const agentsDir = path.join(tmpDir, 'agents');
    await writeFile(
      docsPath,
      JSON.stringify([
        { id: 'mobile-doc', namespace: 'mobile', text: 'mobile troubleshooting notes' },
        { id: 'backend-doc', namespace: 'backend', text: 'backend reliability notes' },
      ])
    );
    await mkdir(agentsDir);

    await writeFile(
      path.join(agentsDir, 'z-backend.json'),
      JSON.stringify({
        id: 'backend.agent',
        version: 1,
        systemPrompt: ['Backend helper'],
        retrievalDefaults: { namespace: ['backend'], topK: 1 },
      })
    );

    await writeFile(
      path.join(agentsDir, 'a-mobile.yaml'),
      [
        'id: mobile.agent',
        'version: 1',
        'name: Mobile Agent',
        'systemPrompt:',
        '  - Mobile helper line one',
        '  - Mobile helper line two',
        'retrievalDefaults:',
        '  namespace:',
        '    - mobile',
        '  topK: 2',
      ].join('\n')
    );

    await execFileAsync('node', [
      path.join(process.cwd(), 'bin/knolo.mjs'),
      docsPath,
      outPath,
      '--agents',
      agentsDir,
    ]);

    const pack = await mountPack({ src: outPath });
    assert.deepEqual(
      listAgents(pack),
      ['backend.agent', 'mobile.agent'],
      'expected CLI-loaded agents to be sorted deterministically by id'
    );
    const mobile = getAgent(pack, 'mobile.agent');
    assert.ok(mobile, 'expected YAML agent to be embedded and retrievable');
    assert.deepEqual(mobile?.retrievalDefaults.namespace, ['mobile']);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testSemanticTopNMicroBenchmark() {
  const docCount = 400;
  const dims = 32;
  const docs = Array.from({ length: docCount }, (_, i) => ({
    id: `bench-${i}`,
    text: `alpha beta benchmark block ${i}`,
  }));
  const embeddings = Array.from({ length: docCount }, (_, i) => {
    const vec = new Float32Array(dims);
    vec[i % dims] = 1;
    vec[(i * 7) % dims] += 0.5;
    return vec;
  });

  const pack = await mountPack({
    src: await buildPack(docs, {
      semantic: {
        enabled: true,
        modelId: 'bench-model',
        embeddings,
        quantization: { type: 'int8_l2norm', perVectorScale: true },
      },
    }),
  });

  const lexicalStart = Date.now();
  for (let i = 0; i < 20; i++) {
    query(pack, 'alpha beta benchmark', {
      topK: 20,
      queryExpansion: { enabled: false },
    });
  }
  const lexicalElapsedMs = Date.now() - lexicalStart;

  const semanticStart = Date.now();
  for (let i = 0; i < 20; i++) {
    const q = new Float32Array(dims);
    q[i % dims] = 1;
    const hits = query(pack, 'alpha beta benchmark', {
      topK: 20,
      queryExpansion: { enabled: false },
      semantic: { enabled: true, queryEmbedding: q, topN: 200 },
    });
    assert.ok(
      hits.length > 0,
      'expected semantic rerank benchmark query to return hits'
    );
  }
  const semanticElapsedMs = Date.now() - semanticStart;

  assert.ok(
    semanticElapsedMs < 20000,
    `semantic rerank benchmark exceeded expected runtime budget: ${semanticElapsedMs}ms`
  );
  assert.ok(
    semanticElapsedMs <= Math.max(lexicalElapsedMs * 8, 500),
    `semantic rerank benchmark regressed badly (lexical=${lexicalElapsedMs}ms, semantic=${semanticElapsedMs}ms)`
  );
}

await testLexConfidenceDeterministic();
await testSemanticRerankLowConfidence();
await testSemanticRerankRespectsConfidenceAndForce();
await testSemanticRerankErrorAndDefaults();
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
await testSemanticFixtureAndHelpers();
await testValidateSemanticQueryOptions();
await testValidateQueryOptions();
await testAgentsBackwardCompatibility();
await testAgentEmbeddingAndLookup();
await testResolveAgentDefaultsAndOverrides();
await testToolPolicyHelpers();
await testMountTimeAgentValidationAndNoRevalidationOnResolve();
await testAgentValidationAndPromptDeterminism();
await testCliEmbedsAgentsFromDirectory();
await testSemanticTopNMicroBenchmark();
await testPackWithSemanticTail();
await testMountLegacyPackWithoutSemanticTail();

console.log('All tests passed.');
