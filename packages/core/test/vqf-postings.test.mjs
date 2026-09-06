import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPack, mountPack, query } from '../dist/index.js';
import { buildIndex } from '../dist/indexer.js';
import {
  createLegacyLexicalPostingsReader,
  encodeLegacyLexicalPostings,
} from '../dist/compression/vqf1/lexical_postings.js';

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
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

function hitKey(hit) {
  return {
    blockId: hit.blockId,
    score: hit.score,
    source: hit.source,
    namespace: hit.namespace,
    text: hit.text,
  };
}

test('legacy adapter reconstructs exact V4 sentinel streams and one-based block/position conventions', () => {
  const { postings } = buildIndex([
    { id: 0, text: 'alpha beta' },
    { id: 1, text: 'beta gamma' },
  ]);
  const reader = createLegacyLexicalPostingsReader(postings, {
    offsetBlockIds: true,
  });
  const expected = scanLegacy(postings, true);
  assert.deepEqual([...reader.termIds()], [...expected.keys()]);
  for (const [termId, documents] of expected) {
    assert.equal(reader.hasTerm(termId), true);
    assert.equal(reader.documentFrequency(termId), documents.length);
    assert.deepEqual(
      [...reader.read(termId)].map((posting) => ({
        blockId: posting.blockId,
        positions: posting.positions,
        termFrequency: posting.termFrequency,
      })),
      documents.map((document) => ({
        blockId: document.blockId,
        positions: document.positions,
        termFrequency: document.positions.length,
      }))
    );
  }
  const reconstructed = encodeLegacyLexicalPostings(
    [...expected].map(([termId, documents]) => ({ termId, documents })),
    { offsetBlockIds: true }
  );
  assert.deepEqual([...reconstructed], [...postings]);
  assert.equal(postings[1], 1);
  assert.equal(postings[2], 1);
});

test('legacy adapter preserves raw block ids for pre-v3 packs', () => {
  const postings = encodeLegacyLexicalPostings(
    [{ termId: 7, documents: [{ blockId: 4, positions: [0, 3] }] }],
    { offsetBlockIds: false }
  );
  assert.deepEqual([...postings], [7, 4, 1, 4, 0, 0]);
  const reader = createLegacyLexicalPostingsReader(postings, {
    offsetBlockIds: false,
  });
  assert.deepEqual(
    [...reader.read(7)],
    [{ blockId: 4, positions: [0, 3], termFrequency: 2 }]
  );
});

test('direct term reads do not visit unrelated posting lists', () => {
  const { postings } = buildIndex([
    { id: 0, text: 'alpha unique-term' },
    { id: 1, text: 'beta other-term extra-term' },
    { id: 2, text: 'gamma leftover-term' },
  ]);
  const reader = createLegacyLexicalPostingsReader(postings);
  const alpha = [...reader.termIds()][0];
  reader.resetQueryStats();
  assert.equal(reader.hasTerm(alpha), true);
  const documents = [...reader.read(alpha)];
  const stats = reader.stats();
  assert.equal(stats.postingListsRead, 1);
  assert.equal(stats.documentsVisited, documents.length);
  assert.ok(stats.termCount > 1);
  assert.ok(stats.constructionIntegers > stats.documentsVisited);
  assert.equal(stats.postingListsRead < stats.termCount, true);
});

test('legacy adapter rejects truncated, duplicate and empty-terminator-only malformed streams', () => {
  const wellFormed = encodeLegacyLexicalPostings([
    { termId: 1, documents: [{ blockId: 0, positions: [0] }] },
  ]);
  assert.throws(
    () => createLegacyLexicalPostingsReader(wellFormed.slice(0, 2)),
    /Truncated/
  );
  assert.throws(
    () => createLegacyLexicalPostingsReader(wellFormed.slice(0, 3)),
    /Truncated/
  );
  const duplicate = Uint32Array.from([...wellFormed, ...wellFormed]);
  assert.throws(
    () => createLegacyLexicalPostingsReader(duplicate),
    /Duplicate/
  );
  const empty = createLegacyLexicalPostingsReader(new Uint32Array());
  assert.equal(empty.hasTerm(1), false);
  assert.equal([...empty.termIds()].length, 0);
  const zeros = createLegacyLexicalPostingsReader(Uint32Array.from([0, 0]));
  assert.equal([...zeros.termIds()].length, 0);
});

test('1,000 seeded V4 indexes round-trip through the adapter with exact positions', () => {
  const rand = xorshift32(20260906);
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
    const reader = createLegacyLexicalPostingsReader(postings, {
      offsetBlockIds: true,
    });
    const expected = scanLegacy(postings, true);
    assert.equal(reader.stats().termCount, lexicon.length);
    assert.deepEqual([...reader.termIds()], [...expected.keys()]);
    for (const [termId, documents] of expected) {
      assert.equal(reader.documentFrequency(termId), documents.length);
      assert.deepEqual(
        [...reader.read(termId)].map((posting) => posting.positions),
        documents.map((document) => document.positions)
      );
    }
    reader.resetQueryStats();
    const first = [...expected.keys()][0];
    if (first !== undefined) [...reader.read(first)];
    assert.equal(reader.stats().postingListsRead, first === undefined ? 0 : 1);
  }
});

test('query scores, phrases, expansion and tie-order stay exact through the adapter', async () => {
  const phrasePack = await mountPack({
    src: await buildPack([
      {
        id: 'a',
        text: 'React native bridge throttling improves app stability.',
      },
      { id: 'b', text: 'Bridge patterns without phrase match.' },
    ]),
  });
  const phrase = query(phrasePack, '"react native bridge" throttling', {
    topK: 5,
  });
  assert.equal(phrase[0]?.source, 'a');
  assert.deepEqual(
    query(phrasePack, '"react native bridge" throttling', { topK: 5 }).map(
      hitKey
    ),
    phrase.map(hitKey)
  );

  const tiedPack = await mountPack({
    src: await buildPack([
      { id: 'first', text: 'alpha quartz velvet willow' },
      { id: 'second', text: 'alpha nutmeg orchid pepper' },
    ]),
  });
  const tied = query(tiedPack, 'alpha', {
    topK: 5,
    queryExpansion: { enabled: false },
  });
  assert.deepEqual(
    tied.map((hit) => hit.source),
    ['first', 'second']
  );
  assert.equal(tied[0].score, tied[1].score);
  assert.equal(tied[0].blockId < tied[1].blockId, true);

  const expansionPack = await mountPack({
    src: await buildPack([
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
    ]),
  });
  const expanded = query(expansionPack, 'throttling bridge pressure', {
    topK: 5,
    queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 0.4 },
  });
  const strict = query(expansionPack, 'throttling bridge pressure', {
    topK: 5,
    queryExpansion: { enabled: false },
  });
  assert.ok(expanded.some((hit) => hit.source === 'related'));
  assert.ok(!strict.some((hit) => hit.source === 'related'));
  const scoped = query(expansionPack, 'throttling bridge pressure', {
    topK: 5,
    namespace: 'public',
    queryExpansion: { enabled: true, docs: 2, terms: 4, weight: 1 },
  });
  assert.ok(scoped.every((hit) => hit.namespace === 'public'));
  assert.ok(!scoped.some((hit) => hit.source === 'blocked'));
});
