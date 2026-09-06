import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  compressKnowledgeImageV5,
  createKnowledgeQueryIndexV5,
  deserializeKnowledgeQueryIndexV1,
  mountKnowledgeImageV5,
  queryIndexFromKnowledgeImageV5,
  serializeCompressedKnowledgeQueryIndexV1,
  serializeKnowledgeQueryIndexV1,
  V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX,
} from '../dist/index.js';
import {
  decodeVqfQueryIndexPayload,
  encodeVqfQueryIndexPayload,
} from '../dist/compression/vqf1/query_index_codec.js';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '../../..');
if (process.argv.length !== 4 || process.argv[2] !== '--output') {
  throw new Error(
    'Usage: node packages/core/scripts/benchmark-vqf-index.mjs --output new-report.json'
  );
}
const hash = (bytes) =>
  `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const percentile = (samples, rank) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(rank * sorted.length) - 1];
};
const cases = [];
for (const fixture of [
  'knowledge-image-v5',
  'migrated-legacy-v3',
  'migrated-v4-claims-agents',
  'transaction-snapshot',
]) {
  const imageBytes = Uint8Array.from(
    Buffer.from(
      readFileSync(
        path.join(root, `conformance/v5/${fixture}.fixture.base64`),
        'utf8'
      ).trim(),
      'base64'
    )
  );
  const image = mountKnowledgeImageV5(imageBytes);
  const index = createKnowledgeQueryIndexV5(image);
  const logical = serializeKnowledgeQueryIndexV1(index);
  const encoded = encodeVqfQueryIndexPayload(logical);
  const decoded = decodeVqfQueryIndexPayload(encoded.bytes);
  assert.deepEqual(decoded.logicalPayload, logical);
  assert.equal(
    deserializeKnowledgeQueryIndexV1(decoded.logicalPayload).indexRoot,
    index.indexRoot
  );
  const sidecar = serializeCompressedKnowledgeQueryIndexV1(index);
  assert.deepEqual(deserializeKnowledgeQueryIndexV1(sidecar), index);
  const withIndex = compressKnowledgeImageV5(imageBytes, {
    objects: false,
    events: false,
    index: true,
  });
  const embedded = queryIndexFromKnowledgeImageV5(withIndex);
  assert.equal(embedded?.indexRoot, index.indexRoot);
  const segment = withIndex.segments.find(
    (entry) => entry.kind === V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX
  );
  const encodeSamplesMs = [];
  const decodeSamplesMs = [];
  for (let i = 0; i < 3; i++) {
    encodeVqfQueryIndexPayload(logical);
    decodeVqfQueryIndexPayload(encoded.bytes);
  }
  for (let i = 0; i < 100; i++) {
    let start = performance.now();
    encodeVqfQueryIndexPayload(logical);
    encodeSamplesMs.push(performance.now() - start);
    start = performance.now();
    decodeVqfQueryIndexPayload(encoded.bytes);
    decodeSamplesMs.push(performance.now() - start);
  }
  cases.push({
    fixture,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    indexRoot: index.indexRoot,
    logicalPayloadDigest: hash(logical),
    bodyDigest: hash(encoded.bytes),
    exactRoundTrip: true,
    ...encoded.statistics,
    sidecarBytes: sidecar.length,
    envelopeOrSidecarSmaller: sidecar.length < logical.length,
    embeddedSegmentBytes: segment?.payloadLength ?? null,
    ordinaryImageBytes: imageBytes.length,
    imageWithIndexBytes: withIndex.bytes.length,
    compressionRatio: logical.length / encoded.bytes.length,
    reduction: 1 - encoded.bytes.length / logical.length,
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
const report = {
  phase: 6,
  generatedAt: new Date().toISOString(),
  node: process.version,
  harnessDigest: hash(readFileSync(script)),
  scope:
    'Internal query-index codec on derived V5 indexes; body sizes exclude the 56-byte envelope. Sidecar and optional kind-129 sizes include it.',
  methodology:
    'Three warmups and 100 sequential encode/decode samples per fixture. Decode includes canonical re-encoding validation and indexRoot identity.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
