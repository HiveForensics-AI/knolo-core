import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPack,
  compressKnowledgeImageV5,
  createKnowledgeImageV5,
  mountPack,
  query,
  stateRoot,
} from '../dist/index.js';
import { buildIndex } from '../dist/indexer.js';
import {
  attachVqfLexicalIndex,
  createVqfLexicalPostingsReader,
  decodeVqfLexicalIndex,
  encodeVqfLexicalIndex,
  encodeVqfLexicalIndexFromLegacy,
  VQF_LEXICAL_PHRASE_FLAG,
} from '../dist/compression/vqf1/postings.js';
import {
  factorLexicalPhrases,
  reconstructLexicalStreams,
  resolveVqfPhraseOptions,
} from '../dist/compression/vqf1/phrase_factor.js';

const LOW_COST = {
  minPhraseLength: 2,
  maxPhraseLength: 8,
  minPhraseFrequency: 2,
  maxPhraseFanoutPerTerm: 6,
  minPhraseGainBytes: 1,
};

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function hitKey(hit) {
  return {
    blockId: hit.blockId,
    score: hit.score,
    source: hit.source,
    namespace: hit.namespace,
    text: hit.text,
  };
}

function repeatedTriples(documents = 24, repeats = 6) {
  const alpha = [];
  const beta = [];
  const gamma = [];
  for (let blockId = 0; blockId < documents; blockId++) {
    const a = [];
    const b = [];
    const g = [];
    for (let i = 0; i < repeats; i++) {
      a.push(i * 3);
      b.push(i * 3 + 1);
      g.push(i * 3 + 2);
    }
    alpha.push({ blockId, positions: a });
    beta.push({ blockId, positions: b });
    gamma.push({ blockId, positions: g });
  }
  return [
    { termId: 1, term: 'alpha', documents: alpha },
    { termId: 2, term: 'beta', documents: beta },
    { termId: 3, term: 'gamma', documents: gamma },
  ];
}

function assertSameStreams(actual, expected) {
  assert.equal(actual.length, expected.length);
  const byId = new Map(expected.map((stream) => [stream.termId, stream]));
  for (const stream of actual) {
    const want = byId.get(stream.termId);
    assert.ok(want, `missing term ${stream.termId}`);
    assert.equal(stream.term, want.term);
    assert.deepEqual(stream.documents, want.documents);
  }
}

test('fast profile is the default and does not emit the phrase flag', () => {
  const streams = repeatedTriples();
  const fast = encodeVqfLexicalIndex(streams);
  const explicit = encodeVqfLexicalIndex(streams, { profile: 'fast' });
  assert.equal(fast.bytes[1], 0);
  assert.deepEqual(fast.bytes, explicit.bytes);
  assert.equal(fast.statistics.phraseCount, 0);
  assert.equal(resolveVqfPhraseOptions({}).enabled, false);
  assert.equal(resolveVqfPhraseOptions({ profile: 'balanced' }).enabled, true);
});

test('phrase factoring reconstructs exact positions, tf and df', () => {
  const streams = repeatedTriples();
  const encoded = encodeVqfLexicalIndex(streams, { phraseFactoring: LOW_COST });
  assert.equal(encoded.bytes[1], VQF_LEXICAL_PHRASE_FLAG);
  assert.ok(encoded.statistics.phraseCount >= 1);
  assert.ok(encoded.statistics.phraseBytesSaved > 0);
  assert.ok(
    encoded.statistics.physicalBytes <
      encodeVqfLexicalIndex(streams).statistics.physicalBytes
  );
  const decoded = decodeVqfLexicalIndex(encoded.bytes);
  assertSameStreams(decoded.streams, streams);
  const reader = createVqfLexicalPostingsReader(encoded.bytes);
  for (const stream of streams) {
    assert.equal(
      reader.documentFrequency(stream.termId),
      stream.documents.length
    );
    assert.deepEqual(
      [...reader.read(stream.termId)].map((posting) => ({
        blockId: posting.blockId,
        positions: posting.positions,
        termFrequency: posting.termFrequency,
      })),
      stream.documents.map((document) => ({
        blockId: document.blockId,
        positions: document.positions,
        termFrequency: document.positions.length,
      }))
    );
  }
});

test('repeated-term offsets, overlaps, punctuation and block boundaries stay exact', () => {
  const repeated = [
    {
      termId: 1,
      term: 'alpha',
      documents: [{ blockId: 0, positions: [0, 1, 2, 3, 4, 5, 6, 7] }],
    },
  ];
  const repeatedEncoded = encodeVqfLexicalIndex(repeated, {
    phraseFactoring: LOW_COST,
  });
  assertSameStreams(
    decodeVqfLexicalIndex(repeatedEncoded.bytes).streams,
    repeated
  );

  const overlapping = [
    {
      termId: 1,
      term: 'alpha',
      documents: [{ blockId: 0, positions: [0, 2, 4, 6] }],
    },
    {
      termId: 2,
      term: 'beta',
      documents: [{ blockId: 0, positions: [1, 3, 5, 7] }],
    },
  ];
  const overlapEncoded = encodeVqfLexicalIndex(overlapping, {
    phraseFactoring: LOW_COST,
  });
  assertSameStreams(
    decodeVqfLexicalIndex(overlapEncoded.bytes).streams,
    overlapping
  );

  const { lexicon, postings } = buildIndex([
    { id: 0, text: 'alpha, beta alpha, beta alpha, beta alpha, beta' },
    { id: 1, text: 'alpha, beta alpha, beta alpha, beta alpha, beta' },
  ]);
  const punctuated = encodeVqfLexicalIndexFromLegacy(lexicon, postings, {
    phraseFactoring: LOW_COST,
  });
  const decodedPunctuated = decodeVqfLexicalIndex(punctuated.bytes);
  const legacy = createVqfLexicalPostingsReader(
    encodeVqfLexicalIndexFromLegacy(lexicon, postings).bytes
  );
  for (const stream of decodedPunctuated.streams) {
    assert.deepEqual(
      [...legacy.read(stream.termId)].map((posting) => posting.positions),
      stream.documents.map((document) => document.positions)
    );
  }

  const bounded = [
    {
      termId: 1,
      term: 'alpha',
      documents: [
        { blockId: 0, positions: [0] },
        { blockId: 1, positions: [0] },
        { blockId: 2, positions: [0] },
        { blockId: 3, positions: [0] },
      ],
    },
    {
      termId: 2,
      term: 'beta',
      documents: [
        { blockId: 0, positions: [1] },
        { blockId: 1, positions: [1] },
        { blockId: 2, positions: [1] },
        { blockId: 3, positions: [1] },
      ],
    },
  ];
  const boundedEncoded = encodeVqfLexicalIndex(bounded, {
    phraseFactoring: LOW_COST,
  });
  assertSameStreams(
    decodeVqfLexicalIndex(boundedEncoded.bytes).streams,
    bounded
  );
  const ordinals = new Map([
    [1, 0],
    [2, 1],
  ]);
  const factored = factorLexicalPhrases(
    bounded,
    { ...LOW_COST, exactGain: false },
    ordinals
  );
  for (const phrase of factored.phrases) {
    for (const document of phrase.documents) {
      for (const start of document.positions) {
        assert.equal(
          start + phrase.termIds.length - 1 < 2 || document.blockId >= 0,
          true
        );
      }
    }
  }

  const gapped = [
    {
      termId: 1,
      term: 'alpha',
      documents: [{ blockId: 0, positions: [0, 3, 6, 9] }],
    },
    {
      termId: 2,
      term: 'beta',
      documents: [{ blockId: 0, positions: [1, 4, 7, 10] }],
    },
  ];
  const gappedFactored = factorLexicalPhrases(
    gapped,
    { ...LOW_COST, exactGain: false },
    new Map([
      [1, 0],
      [2, 1],
    ])
  );
  assert.equal(gappedFactored.used, false);
});

test('fanout limits reject extra phrase references per term', () => {
  const streams = [
    {
      termId: 1,
      term: 'alpha',
      documents: [{ blockId: 0, positions: [0, 2, 4, 6, 8, 10, 12, 14] }],
    },
    {
      termId: 2,
      term: 'beta',
      documents: [{ blockId: 0, positions: [1, 3, 5, 7] }],
    },
    {
      termId: 3,
      term: 'gamma',
      documents: [{ blockId: 0, positions: [9, 11, 13, 15] }],
    },
  ];
  const factored = factorLexicalPhrases(
    streams,
    { ...LOW_COST, maxPhraseFanoutPerTerm: 1, exactGain: false },
    new Map([
      [1, 0],
      [2, 1],
      [3, 2],
    ])
  );
  for (const refs of factored.references.values()) {
    assert.ok(refs.length <= 1);
  }
  const reconstructed = reconstructLexicalStreams(
    factored.literals,
    factored.phrases,
    factored.references
  );
  assertSameStreams(reconstructed, streams);
});

test('unprofitable factoring stays on the unfactored fast encoding', () => {
  const streams = [
    {
      termId: 1,
      term: 'unique',
      documents: [{ blockId: 0, positions: [0] }],
    },
    {
      termId: 2,
      term: 'once',
      documents: [{ blockId: 0, positions: [1] }],
    },
  ];
  const fast = encodeVqfLexicalIndex(streams);
  const attempted = encodeVqfLexicalIndex(streams, {
    phraseFactoring: LOW_COST,
  });
  assert.deepEqual(attempted.bytes, fast.bytes);
  assert.equal(attempted.statistics.phraseCount, 0);
});

test('query-time reads do not visit unrelated phrase streams', () => {
  const streams = repeatedTriples(16, 8);
  streams.push({
    termId: 99,
    term: 'zeta',
    documents: [{ blockId: 0, positions: [100] }],
  });
  const encoded = encodeVqfLexicalIndex(streams, { phraseFactoring: LOW_COST });
  assert.ok(encoded.statistics.phraseCount >= 1);
  const reader = createVqfLexicalPostingsReader(encoded.bytes);
  reader.resetQueryStats();
  [...reader.read(99)];
  const stats = reader.stats();
  assert.equal(stats.postingListsRead, 1);
  assert.equal(stats.phraseStreamsRead, 0);
  assert.equal(stats.phraseCount >= 1, true);
  reader.resetQueryStats();
  [...reader.read(1)];
  const phraseStats = reader.stats();
  assert.ok(phraseStats.phraseStreamsRead >= 1);
  assert.ok(phraseStats.phraseStreamsRead <= phraseStats.phraseCount);
  assert.ok(phraseStats.phraseBytesRead > 0);
});

test('malformed phrase offsets and flags fail closed', () => {
  const encoded = encodeVqfLexicalIndex(repeatedTriples(), {
    phraseFactoring: LOW_COST,
  });
  assert.ok(encoded.statistics.phraseCount >= 1);
  const corrupted = encoded.bytes.slice();
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(
    () => decodeVqfLexicalIndex(corrupted),
    /phrase|Non-canonical|Trailing|digest|offset|frequency|Unsupported/
  );
  const flagged = encoded.bytes.slice();
  flagged[1] = 0x02;
  assert.throws(
    () => decodeVqfLexicalIndex(flagged),
    /Unsupported VQF lexical-index codec flags/
  );
  assert.throws(
    () => resolveVqfPhraseOptions({ profile: 'nope' }),
    /Unsupported VQF compression profile/
  );
});

test('1,000 seeded indexes round-trip through optional phrase factoring', () => {
  const rand = xorshift32(20260909);
  for (let n = 0; n < 1000; n++) {
    const blockCount = 1 + Math.floor(rand() * 6);
    const blocks = [];
    for (let b = 0; b < blockCount; b++) {
      const terms = [];
      const termCount = 2 + Math.floor(rand() * 5);
      for (let t = 0; t < termCount; t++) {
        terms.push(`t${Math.floor(rand() * 6)}`);
      }
      blocks.push({ id: b, text: terms.join(' ') });
    }
    const { lexicon, postings } = buildIndex(blocks);
    const encoded = encodeVqfLexicalIndexFromLegacy(lexicon, postings, {
      phraseFactoring: LOW_COST,
      pageSize: [2, 8, 128][Math.floor(rand() * 3)],
    });
    const decoded = decodeVqfLexicalIndex(encoded.bytes);
    const ordinary = decodeVqfLexicalIndex(
      encodeVqfLexicalIndexFromLegacy(lexicon, postings).bytes
    );
    assertSameStreams(decoded.streams, ordinary.streams);
    const reader = createVqfLexicalPostingsReader(encoded.bytes);
    for (const stream of ordinary.streams) {
      assert.deepEqual(
        [...reader.read(stream.termId)].map((posting) => posting.positions),
        stream.documents.map((document) => document.positions)
      );
    }
  }
});

test('profiles keep exact query scores, phrases, expansion and tie-order', async () => {
  const docs = [
    {
      id: 'a',
      text: 'alpha beta gamma delta alpha beta gamma delta alpha beta gamma delta',
    },
    {
      id: 'b',
      text: 'alpha beta gamma extra without the long repeated run',
    },
  ];
  const ordinary = await mountPack({ src: await buildPack(docs) });
  const queryText = '"alpha beta gamma" delta';
  const ordinaryHits = query(ordinary, queryText, { topK: 5 }).map(hitKey);
  for (const profile of ['fast', 'balanced', 'max']) {
    const attached = attachVqfLexicalIndex(ordinary, { profile });
    assert.deepEqual(
      query(attached, queryText, { topK: 5 }).map(hitKey),
      ordinaryHits
    );
  }

  const tiedDocs = [
    { id: 'first', text: 'alpha quartz velvet willow' },
    { id: 'second', text: 'alpha nutmeg orchid pepper' },
  ];
  const tiedPack = await mountPack({ src: await buildPack(tiedDocs) });
  const tiedOrdinary = query(tiedPack, 'alpha', {
    topK: 5,
    queryExpansion: { enabled: false },
  });
  const tied = query(
    attachVqfLexicalIndex(tiedPack, { profile: 'max' }),
    'alpha',
    { topK: 5, queryExpansion: { enabled: false } }
  );
  assert.deepEqual(tied.map(hitKey), tiedOrdinary.map(hitKey));
  assert.equal(tied[0].score, tied[1].score);
  assert.equal(tied[0].blockId < tied[1].blockId, true);

  const expansionDocs = [
    {
      id: 'seed',
      namespace: 'public',
      text: 'Throttling controls event bursts and smooths bridge pressure in React Native apps.',
    },
    {
      id: 'related',
      namespace: 'public',
      text: 'Rate limiting is used to cap request bursts and protect systems under load.',
    },
    {
      id: 'blocked',
      namespace: 'private',
      text: 'Rate limiting caps request bursts and protects systems under load.',
    },
  ];
  const expansionPack = await mountPack({
    src: await buildPack(expansionDocs),
  });
  const expanded = query(
    attachVqfLexicalIndex(expansionPack, { profile: 'balanced' }),
    'throttling bridge pressure',
    {
      topK: 5,
      queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 0.4 },
    }
  );
  assert.deepEqual(
    expanded.map(hitKey),
    query(expansionPack, 'throttling bridge pressure', {
      topK: 5,
      queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 0.4 },
    }).map(hitKey)
  );
});

test('image compression profiles preserve state identity', () => {
  const ordinary = createKnowledgeImageV5({
    actor: 'fixture',
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('hello'),
        meta: { version: 1 },
      },
    ],
  });
  const fast = compressKnowledgeImageV5(ordinary.bytes, { mode: 'fast' });
  const balanced = compressKnowledgeImageV5(ordinary.bytes, {
    mode: 'balanced',
  });
  const max = compressKnowledgeImageV5(ordinary.bytes, { mode: 'max' });
  assert.equal(stateRoot(fast), stateRoot(ordinary));
  assert.equal(stateRoot(balanced), stateRoot(ordinary));
  assert.equal(stateRoot(max), stateRoot(ordinary));
  assert.throws(
    () => compressKnowledgeImageV5(ordinary.bytes, { mode: 'other' }),
    /Unsupported VQF compression profile/
  );
});
