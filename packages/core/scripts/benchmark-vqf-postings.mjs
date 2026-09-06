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
    'Usage: node packages/core/scripts/benchmark-vqf-postings.mjs --output new-report.json'
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
    const encoded = encodeVqfLexicalIndexFromLegacy(lexicon, postings);
    const decoded = decodeVqfLexicalIndex(encoded.bytes);
    assert.equal(decoded.streams.length, lexicon.length);
    const reader = createVqfLexicalPostingsReader(encoded.bytes);
    reader.resetQueryStats();
    const first = [...reader.termIds()][0];
    if (first !== undefined) [...reader.read(first)];
    const unread = reader.stats();
    assert.equal(unread.postingListsRead, first === undefined ? 0 : 1);
    const pack = await mountPack({ src: await buildPack(documents) });
    const attached = attachVqfLexicalIndex(pack);
    const q =
      name === 'low-redundancy' ? documents[0].text.split(' ')[0] : 'alpha';
    const ordinaryHits = query(pack, q, {
      topK: 5,
      queryExpansion: { enabled: false },
    });
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
    const encodeSamplesMs = [];
    const decodeSamplesMs = [];
    const readSamplesMs = [];
    for (let i = 0; i < 3; i++) {
      encodeVqfLexicalIndexFromLegacy(lexicon, postings);
      decodeVqfLexicalIndex(encoded.bytes);
      if (first !== undefined) {
        const warm = createVqfLexicalPostingsReader(encoded.bytes);
        [...warm.read(first)];
      }
    }
    for (let i = 0; i < 100; i++) {
      let start = performance.now();
      encodeVqfLexicalIndexFromLegacy(lexicon, postings);
      encodeSamplesMs.push(performance.now() - start);
      start = performance.now();
      decodeVqfLexicalIndex(encoded.bytes);
      decodeSamplesMs.push(performance.now() - start);
      if (first !== undefined) {
        const timed = createVqfLexicalPostingsReader(encoded.bytes);
        timed.resetQueryStats();
        start = performance.now();
        [...timed.read(first)];
        readSamplesMs.push(performance.now() - start);
      }
    }
    const v4Bytes =
      encoded.statistics.v4PostingsBytes + encoded.statistics.v4LexiconBytes;
    cases.push({
      corpus: name,
      docs,
      termCount: encoded.statistics.termCount,
      documentPostingCount: encoded.statistics.documentPostingCount,
      positionCount: encoded.statistics.positionCount,
      pageCount: encoded.statistics.pageCount,
      microblockCount: encoded.statistics.microblockCount,
      v4PostingsBytes: encoded.statistics.v4PostingsBytes,
      v4LexiconBytes: encoded.statistics.v4LexiconBytes,
      v4LexicalBytes: v4Bytes,
      physicalBytes: encoded.statistics.physicalBytes,
      postingStreamBytes: encoded.statistics.postingStreamBytes,
      lexiconBytes: encoded.statistics.lexiconBytes,
      compressionRatio: v4Bytes / encoded.statistics.physicalBytes,
      reduction: 1 - encoded.statistics.physicalBytes / v4Bytes,
      bodyDigest: hash(encoded.bytes),
      unreadUnrelatedLists: unread.postingListsRead === 1,
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
      directRead: {
        p50: percentile(readSamplesMs, 0.5),
        p95: percentile(readSamplesMs, 0.95),
        p99: percentile(readSamplesMs, 0.99),
        samplesMs: readSamplesMs,
      },
    });
  }
}
const report = {
  phase: 8,
  generatedAt: new Date().toISOString(),
  node: process.version,
  harnessDigest: hash(readFileSync(script)),
  scope:
    'Internal VQF lexical index: front-coded lexicon pages, varint posting lists, posting directory and bounded microblocks. V4 pack serializers remain unchanged. Ratios compare complete VQF artifact bytes with V4 sentinel postings plus JSON lexicon bytes.',
  methodology:
    'Three warmups and 100 sequential encode/decode samples per corpus. Decode includes deterministic re-encoding validation. Direct-read samples decode one requested term stream after construction. Query scores are compared against the ordinary V4 adapter on the same pack.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
