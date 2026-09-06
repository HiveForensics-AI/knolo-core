import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPack, mountPack, query } from '../dist/index.js';
import { buildIndex } from '../dist/indexer.js';
import { VqfByteReader } from '../dist/compression/vqf1/byte_reader.js';
import { VqfByteWriter } from '../dist/compression/vqf1/byte_writer.js';
import {
  createLegacyLexicalPostingsReader,
  encodeLegacyLexicalPostings,
} from '../dist/compression/vqf1/lexical_postings.js';
import {
  decodeFrontCodedPage,
  encodeFrontCodedPage,
  encodeLexiconPages,
  lookupLexiconTerm,
  sharedPrefixLength,
} from '../dist/compression/vqf1/lexicon.js';
import {
  attachVqfLexicalIndex,
  createVqfLexicalPostingsReader,
  decodeVqfLexicalIndex,
  encodeVqfLexicalIndex,
  encodeVqfLexicalIndexFromLegacy,
} from '../dist/compression/vqf1/postings.js';

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

function scanLegacy(postings, offsetBlockIds) {
  const terms = new Map();
  let i = 0;
  while (i < postings.length) {
    const tid = postings[i++];
    if (tid === 0) continue;
    const documents = [];
    let encodedBid = postings[i++];
    while (encodedBid !== 0) {
      const blockId = offsetBlockIds ? encodedBid - 1 : encodedBid;
      const positions = [];
      let pos = postings[i++];
      while (pos !== 0) {
        positions.push(pos - 1);
        pos = postings[i++];
      }
      documents.push({ blockId, positions });
      encodedBid = postings[i++];
    }
    terms.set(tid, documents);
  }
  return terms;
}

function sortedDocuments(documents) {
  return [...documents]
    .map((document) => ({
      blockId: document.blockId,
      positions: [...document.positions],
    }))
    .sort((a, b) => a.blockId - b.blockId);
}

test('front-coded lexicon pages round-trip sorted UTF-8 terms and look up one page', () => {
  const terms = ['alpha', 'alphabet', 'beta', 'café', 'cafés', 'zebra'];
  const encoded = encodeLexiconPages(terms, { pageSize: 2 });
  assert.equal(encoded.directory.length, 3);
  assert.equal(lookupLexiconTerm(encoded, 'alpha'), 0);
  assert.equal(lookupLexiconTerm(encoded, 'alphabet'), 1);
  assert.equal(lookupLexiconTerm(encoded, 'cafés'), 4);
  assert.equal(lookupLexiconTerm(encoded, 'missing'), undefined);
  const page = decodeFrontCodedPage(
    encoded.pages.subarray(
      encoded.directory[0].offset,
      encoded.directory[0].offset + encoded.directory[0].length
    ),
    { pageSize: 2 }
  );
  assert.deepEqual(page, ['alpha', 'alphabet']);
  const alpha = new TextEncoder().encode('alpha');
  const alphabet = new TextEncoder().encode('alphabet');
  assert.equal(sharedPrefixLength(alpha, alphabet), 5);
  const rebuilt = encodeFrontCodedPage(['alpha', 'alphabet'], 1024);
  assert.deepEqual(decodeFrontCodedPage(rebuilt, { pageSize: 2 }), [
    'alpha',
    'alphabet',
  ]);
});

test('front-coded pages preserve empty terms, BOMs and supplementary characters', () => {
  const encoder = new TextEncoder();
  const terms = ['', '\uFEFFlead', 'a\u0000b', 'emoji😀', 'emoji😁'].sort(
    (left, right) => {
      const a = encoder.encode(left);
      const b = encoder.encode(right);
      const length = Math.min(a.length, b.length);
      for (let i = 0; i < length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return a.length - b.length;
    }
  );
  const encoded = encodeLexiconPages(terms, { pageSize: 128 });
  for (const [index, term] of terms.entries()) {
    assert.equal(lookupLexiconTerm(encoded, term), index);
  }
  assert.throws(
    () => encodeLexiconPages(['beta', 'alpha']),
    /not strictly sorted/
  );
  assert.throws(() => encodeFrontCodedPage([], 1024), /at least one term/);
});

test('varint posting lists match the documented document/position delta example', () => {
  const encoded = encodeVqfLexicalIndex([
    {
      termId: 7,
      term: 'example',
      documents: [
        { blockId: 2, positions: [4, 6, 20] },
        { blockId: 5, positions: [1, 8] },
      ],
    },
  ]);
  const decoded = decodeVqfLexicalIndex(encoded.bytes);
  assert.deepEqual(decoded.streams[0].documents, [
    { blockId: 2, positions: [4, 6, 20] },
    { blockId: 5, positions: [1, 8] },
  ]);
  const reader = createVqfLexicalPostingsReader(encoded.bytes);
  assert.deepEqual(
    [...reader.read(7)],
    [
      { blockId: 2, positions: [4, 6, 20], termFrequency: 3 },
      { blockId: 5, positions: [1, 8], termFrequency: 2 },
    ]
  );
});

test('native index reconstructs exact V4 positions, tf, df and stream order', () => {
  const { lexicon, postings } = buildIndex([
    { id: 2, text: 'gamma alpha' },
    { id: 0, text: 'alpha beta' },
    { id: 1, text: 'beta gamma extra' },
  ]);
  const encoded = encodeVqfLexicalIndexFromLegacy(lexicon, postings);
  const decoded = decodeVqfLexicalIndex(encoded.bytes);
  const legacy = createLegacyLexicalPostingsReader(postings);
  const expected = scanLegacy(postings, true);
  assert.deepEqual(
    decoded.streams.map((stream) => stream.termId),
    [...legacy.termIds()]
  );
  const reader = createVqfLexicalPostingsReader(encoded.bytes);
  assert.deepEqual([...reader.termIds()], [...legacy.termIds()]);
  for (const [termId, documents] of expected) {
    assert.equal(reader.hasTerm(termId), true);
    assert.equal(reader.documentFrequency(termId), documents.length);
    assert.equal(reader.termOrder(termId), legacy.termOrder(termId));
    assert.deepEqual(
      [...reader.read(termId)].map((posting) => ({
        blockId: posting.blockId,
        positions: posting.positions,
        termFrequency: posting.termFrequency,
      })),
      sortedDocuments(documents).map((document) => ({
        blockId: document.blockId,
        positions: document.positions,
        termFrequency: document.positions.length,
      }))
    );
  }
  assert.equal(encoded.statistics.termCount, lexicon.length);
  assert.ok(encoded.statistics.microblockCount >= 1);
  assert.ok(encoded.statistics.physicalBytes > 0);
});

test('query-time reads do not scan unrelated posting lists or microblocks', () => {
  const streams = [];
  for (let i = 0; i < 40; i++) {
    streams.push({
      termId: i + 1,
      term: `term-${String(i).padStart(3, '0')}`,
      documents: [{ blockId: i, positions: [0, 2, 4] }],
    });
  }
  const encoded = encodeVqfLexicalIndex(streams, {
    pageSize: 8,
    microblockTargetBytes: 24,
  });
  assert.ok(encoded.statistics.microblockCount > 1);
  const reader = createVqfLexicalPostingsReader(encoded.bytes);
  const first = streams[0].termId;
  reader.resetQueryStats();
  assert.equal(reader.hasTerm(first), true);
  const documents = [...reader.read(first)];
  const stats = reader.stats();
  assert.equal(documents.length, 1);
  assert.equal(stats.postingListsRead, 1);
  assert.equal(stats.documentsVisited, 1);
  assert.equal(stats.microblocksRead, 1);
  assert.ok(stats.postingBytesRead > 0);
  assert.ok(stats.microblockCount > 1);
  assert.equal(stats.postingListsRead < stats.termCount, true);
  assert.equal(stats.microblocksRead < stats.microblockCount, true);
});

test('microblock digest mismatches and truncated bodies fail closed', () => {
  const encoded = encodeVqfLexicalIndex([
    {
      termId: 1,
      term: 'alpha',
      documents: [{ blockId: 0, positions: [0] }],
    },
    {
      termId: 2,
      term: 'beta',
      documents: [{ blockId: 1, positions: [1, 3] }],
    },
  ]);
  const corrupted = encoded.bytes.slice();
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(
    () => decodeVqfLexicalIndex(corrupted),
    /digest|Non-canonical|Trailing|exceeds/
  );
  assert.throws(
    () => decodeVqfLexicalIndex(encoded.bytes.subarray(0, 4)),
    /truncated|Invalid or truncated|Unsupported/i
  );
  assert.throws(
    () =>
      encodeVqfLexicalIndex([
        {
          termId: 1,
          term: 'dup',
          documents: [{ blockId: 0, positions: [0] }],
        },
        {
          termId: 1,
          term: 'other',
          documents: [{ blockId: 1, positions: [0] }],
        },
      ]),
    /Duplicate/
  );
  const empty = encodeVqfLexicalIndex([]);
  assert.equal(decodeVqfLexicalIndex(empty.bytes).streams.length, 0);
  const emptyReader = createVqfLexicalPostingsReader(empty.bytes);
  assert.equal([...emptyReader.termIds()].length, 0);
  assert.equal(emptyReader.hasTerm(1), false);
});

test('1,000 seeded indexes round-trip through varint postings and lexicon pages', () => {
  const rand = xorshift32(20260908);
  for (let n = 0; n < 1000; n++) {
    const blockCount = 1 + Math.floor(rand() * 8);
    const blocks = [];
    for (let b = 0; b < blockCount; b++) {
      const terms = [];
      const termCount = 1 + Math.floor(rand() * 6);
      for (let t = 0; t < termCount; t++) {
        terms.push(`t${Math.floor(rand() * 12)}x${t}`);
      }
      blocks.push({ id: b, text: terms.join(' ') });
    }
    const { lexicon, postings } = buildIndex(blocks);
    const pageSize = [2, 8, 128][Math.floor(rand() * 3)];
    const encoded = encodeVqfLexicalIndexFromLegacy(lexicon, postings, {
      pageSize,
      microblockTargetBytes: 16 + Math.floor(rand() * 64),
    });
    const decoded = decodeVqfLexicalIndex(encoded.bytes);
    const legacy = scanLegacy(postings, true);
    const reader = createVqfLexicalPostingsReader(encoded.bytes);
    assert.equal(decoded.streams.length, lexicon.length);
    assert.deepEqual(
      decoded.streams.map((stream) => stream.termId),
      [...legacy.keys()]
    );
    for (const [termId, documents] of legacy) {
      assert.equal(reader.documentFrequency(termId), documents.length);
      assert.deepEqual(
        [...reader.read(termId)].map((posting) => posting.positions),
        sortedDocuments(documents).map((document) => document.positions)
      );
    }
    reader.resetQueryStats();
    const first = [...legacy.keys()][0];
    if (first !== undefined) [...reader.read(first)];
    assert.equal(reader.stats().postingListsRead, first === undefined ? 0 : 1);
    const rebuilt = encodeLegacyLexicalPostings(
      decoded.streams.map((stream) => ({
        termId: stream.termId,
        documents: stream.documents,
      }))
    );
    const rebuiltLegacy = scanLegacy(rebuilt, true);
    for (const [termId, documents] of legacy) {
      assert.deepEqual(rebuiltLegacy.get(termId), sortedDocuments(documents));
    }
  }
});

test('query scores, phrases, expansion and tie-order stay exact through the native index', async () => {
  const phrasePack = attachVqfLexicalIndex(
    await mountPack({
      src: await buildPack([
        {
          id: 'a',
          text: 'React native bridge throttling improves app stability.',
        },
        { id: 'b', text: 'Bridge patterns without phrase match.' },
      ]),
    })
  );
  const ordinaryPhrase = query(
    await mountPack({
      src: await buildPack([
        {
          id: 'a',
          text: 'React native bridge throttling improves app stability.',
        },
        { id: 'b', text: 'Bridge patterns without phrase match.' },
      ]),
    }),
    '"react native bridge" throttling',
    { topK: 5 }
  );
  assert.deepEqual(
    query(phrasePack, '"react native bridge" throttling', { topK: 5 }).map(
      hitKey
    ),
    ordinaryPhrase.map(hitKey)
  );

  const tiedDocs = [
    { id: 'first', text: 'alpha quartz velvet willow' },
    { id: 'second', text: 'alpha nutmeg orchid pepper' },
  ];
  const tied = query(
    attachVqfLexicalIndex(await mountPack({ src: await buildPack(tiedDocs) })),
    'alpha',
    {
      topK: 5,
      queryExpansion: { enabled: false },
    }
  );
  const ordinaryTied = query(
    await mountPack({ src: await buildPack(tiedDocs) }),
    'alpha',
    { topK: 5, queryExpansion: { enabled: false } }
  );
  assert.deepEqual(tied.map(hitKey), ordinaryTied.map(hitKey));
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
  const expansionPack = attachVqfLexicalIndex(
    await mountPack({ src: await buildPack(expansionDocs) })
  );
  const ordinaryExpansion = await mountPack({
    src: await buildPack(expansionDocs),
  });
  const expanded = query(expansionPack, 'throttling bridge pressure', {
    topK: 5,
    queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 0.4 },
  });
  assert.deepEqual(
    expanded.map(hitKey),
    query(ordinaryExpansion, 'throttling bridge pressure', {
      topK: 5,
      queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 0.4 },
    }).map(hitKey)
  );
  const scoped = query(expansionPack, 'throttling bridge pressure', {
    topK: 5,
    namespace: 'public',
    queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 1 },
  });
  assert.ok(scoped.every((hit) => hit.namespace === 'public'));
  assert.ok(!scoped.some((hit) => hit.source === 'blocked'));
});

test('bounded writers still reject oversized lexical indexes', () => {
  assert.throws(
    () =>
      encodeVqfLexicalIndex(
        [
          {
            termId: 1,
            term: 'alpha',
            documents: [{ blockId: 0, positions: [0] }],
          },
        ],
        { limits: { maxBytes: 8 } }
      ),
    /exceeds the byte buffer limit|exceeds the byte limit/
  );
  const writer = new VqfByteWriter(16);
  writer.writeByte(1);
  const reader = new VqfByteReader(writer.finish());
  assert.equal(reader.readByte(), 1);
});
