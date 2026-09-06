import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildPack, mountPack, query } from '../dist/index.js';
import { buildIndex } from '../dist/indexer.js';
import {
  attachVqfLexicalIndex,
  createVqfLexicalPostingsReader,
  decodeVqfLexicalIndex,
  encodeVqfLexicalIndexFromLegacy,
} from '../dist/compression/vqf1/postings.js';

const script = fileURLToPath(import.meta.url);
if (process.argv.length !== 4 || process.argv[2] !== '--output') {
  throw new Error(
    'Usage: node packages/core/scripts/benchmark-vqf-phrases.mjs --output new-report.json'
  );
}
const hash = (bytes) =>
  `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const percentile = (samples, rank) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(rank * sorted.length) - 1];
};

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function corpus(name, count, seed) {
  const random = xorshift32(seed);
  return Array.from({ length: count }, (_, i) => {
    let text;
    if (name === 'low-redundancy') {
      text = Array.from({ length: 96 }, () => `w${random().toString(36)}`).join(
        ' '
      );
    } else if (name === 'enterprise') {
      text = `Policy ${i} requires throttling of request bursts and bridge pressure controls in React Native apps. Rate limiting protects systems under load.`;
    } else if (name === 'repetitive') {
      text =
        'alpha beta gamma delta epsilon alpha beta gamma delta epsilon alpha beta';
    } else {
      text = `export function token${i}() { return 'alpha beta gamma ${i}'; }`;
    }
    return { id: `doc-${i}`, text };
  });
}

const cases = [];
for (const name of [
  'low-redundancy',
  'enterprise',
  'repetitive',
  'repository',
]) {
  for (const docs of [32, 128]) {
    const documents = corpus(name, docs, 20260908 + docs);
    const blocks = documents.map((document, index) => ({
      id: index,
      text: document.text,
    }));
    const { lexicon, postings } = buildIndex(blocks);
    const fast = encodeVqfLexicalIndexFromLegacy(lexicon, postings, {
      profile: 'fast',
    });
    const balanced = encodeVqfLexicalIndexFromLegacy(lexicon, postings, {
      profile: 'balanced',
    });
    const max = encodeVqfLexicalIndexFromLegacy(lexicon, postings, {
      profile: 'max',
    });
    const decodedMax = decodeVqfLexicalIndex(max.bytes);
    const decodedFast = decodeVqfLexicalIndex(fast.bytes);
    assert.equal(decodedMax.streams.length, decodedFast.streams.length);
    for (let i = 0; i < decodedFast.streams.length; i++) {
      assert.deepEqual(
        decodedMax.streams[i].documents,
        decodedFast.streams[i].documents
      );
    }
    const pack = await mountPack({ src: await buildPack(documents) });
    const q =
      name === 'low-redundancy' ? documents[0].text.split(' ')[0] : 'alpha';
    const ordinaryHits = query(pack, q, {
      topK: 5,
      queryExpansion: { enabled: false },
    });
    for (const profile of ['fast', 'balanced', 'max']) {
      const attached = attachVqfLexicalIndex(pack, { profile });
      const nativeHits = query(attached, q, {
        topK: 5,
        queryExpansion: { enabled: false },
      });
      assert.deepEqual(
        nativeHits.map((hit) => ({
          blockId: hit.blockId,
          score: hit.score,
          source: hit.source,
        })),
        ordinaryHits.map((hit) => ({
          blockId: hit.blockId,
          score: hit.score,
          source: hit.source,
        }))
      );
    }
    const reader = createVqfLexicalPostingsReader(max.bytes);
    reader.resetQueryStats();
    const first = [...reader.termIds()][0];
    if (first !== undefined) [...reader.read(first)];
    const unread = reader.stats();
    const encodeSamplesMs = [];
    const decodeSamplesMs = [];
    for (let i = 0; i < 3; i++) {
      encodeVqfLexicalIndexFromLegacy(lexicon, postings, { profile: 'max' });
      decodeVqfLexicalIndex(max.bytes);
    }
    for (let i = 0; i < 100; i++) {
      let start = performance.now();
      encodeVqfLexicalIndexFromLegacy(lexicon, postings, { profile: 'max' });
      encodeSamplesMs.push(performance.now() - start);
      start = performance.now();
      decodeVqfLexicalIndex(max.bytes);
      decodeSamplesMs.push(performance.now() - start);
    }
    cases.push({
      corpus: name,
      docs,
      termCount: fast.statistics.termCount,
      positionCount: fast.statistics.positionCount,
      fastBytes: fast.statistics.physicalBytes,
      balancedBytes: balanced.statistics.physicalBytes,
      maxBytes: max.statistics.physicalBytes,
      balancedPhraseCount: balanced.statistics.phraseCount,
      maxPhraseCount: max.statistics.phraseCount,
      balancedPhraseBytesSaved: balanced.statistics.phraseBytesSaved,
      maxPhraseBytesSaved: max.statistics.phraseBytesSaved,
      balancedRatio:
        fast.statistics.physicalBytes / balanced.statistics.physicalBytes,
      maxRatio: fast.statistics.physicalBytes / max.statistics.physicalBytes,
      bodyDigestFast: hash(fast.bytes),
      bodyDigestBalanced: hash(balanced.bytes),
      bodyDigestMax: hash(max.bytes),
      unreadUnrelatedLists:
        unread.postingListsRead === (first === undefined ? 0 : 1),
      exactQuery: true,
      encode: {
        p50: percentile(encodeSamplesMs, 0.5),
        p95: percentile(encodeSamplesMs, 0.95),
        p99: percentile(encodeSamplesMs, 0.99),
        samplesMs: encodeSamplesMs,
      },
      decode: {
        p50: percentile(decodeSamplesMs, 0.5),
        p95: percentile(decodeSamplesMs, 0.95),
        p99: percentile(decodeSamplesMs, 0.99),
        samplesMs: decodeSamplesMs,
      },
    });
  }
}
const report = {
  phase: 9,
  generatedAt: new Date().toISOString(),
  node: process.version,
  harnessDigest: hash(readFileSync(script)),
  scope:
    'Optional VQF phrase factoring on the native lexical-index artifact. Fast remains the unfactored Phase 8 layout. Balanced and max may emit flag 0x01 phrase streams when they strictly reduce the complete artifact. Ratios compare factored artifact bytes with the unfactored fast artifact.',
  methodology:
    'Three warmups and 100 sequential max-profile encode/decode samples per corpus. Decode includes deterministic re-encoding validation. Query scores for fast, balanced and max are compared against ordinary V4 on the same pack.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
