import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { digestDomain, mountKnowledgeImageV5 } from '../dist/index.js';
import {
  decodeVqfEventPayload,
  encodeVqfEventPayload,
} from '../dist/compression/vqf1/event_codec.js';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '../../..');
if (process.argv.length !== 4 || process.argv[2] !== '--output') {
  throw new Error(
    'Usage: node packages/core/scripts/benchmark-vqf-events.mjs --output new-report.json'
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
  const segment = image.segments.find((entry) => entry.kind === 2);
  assert.ok(segment);
  const logical = imageBytes.slice(
    segment.offset + 48,
    segment.offset + segment.length
  );
  const encoded = encodeVqfEventPayload(logical);
  const decoded = decodeVqfEventPayload(encoded.bytes);
  assert.deepEqual(decoded.logicalPayload, logical);
  assert.equal(
    digestDomain('segment', decoded.logicalPayload),
    digestDomain('segment', logical)
  );
  const encodeSamplesMs = [];
  const decodeSamplesMs = [];
  for (let i = 0; i < 3; i++) {
    encodeVqfEventPayload(logical);
    decodeVqfEventPayload(encoded.bytes);
  }
  for (let i = 0; i < 100; i++) {
    let start = performance.now();
    encodeVqfEventPayload(logical);
    encodeSamplesMs.push(performance.now() - start);
    start = performance.now();
    decodeVqfEventPayload(encoded.bytes);
    decodeSamplesMs.push(performance.now() - start);
  }
  cases.push({
    fixture,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    logicalSegmentDigest: segment.digest,
    logicalPayloadDigest: hash(logical),
    bodyDigest: hash(encoded.bytes),
    exactRoundTrip: true,
    ...encoded.statistics,
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
  phase: 4,
  generatedAt: new Date().toISOString(),
  node: process.version,
  harnessDigest: hash(readFileSync(script)),
  scope:
    'Internal event-body codec on existing conformance fixtures; excludes the future 56-byte envelope and 48-byte outer segment header.',
  methodology:
    'Three warmups and 100 sequential encode/decode samples per fixture. Decode includes canonical re-encoding validation.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
