import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { digestDomain, mountKnowledgeImageV5 } from '../dist/index.js';
import {
  decodeVqfObjectPayload,
  encodeVqfObjectPayload,
} from '../dist/compression/vqf1/object_codec.js';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '../../..');
if (process.argv.length !== 4 || process.argv[2] !== '--output') {
  throw new Error(
    'Usage: node packages/core/scripts/benchmark-vqf-objects.mjs --output new-report.json'
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
  const segment = image.segments.find((entry) => entry.kind === 1);
  assert.ok(segment);
  const logical = imageBytes.slice(
    segment.offset + 48,
    segment.offset + segment.length
  );
  const modes = [];
  for (const sourceSpans of [false, true]) {
    const encoded = encodeVqfObjectPayload(logical, { sourceSpans });
    assert.deepEqual(
      decodeVqfObjectPayload(encoded.bytes).logicalPayload,
      logical
    );
    assert.equal(
      digestDomain('segment', logical),
      digestDomain(
        'segment',
        decodeVqfObjectPayload(encoded.bytes).logicalPayload
      )
    );
    const encodeSamplesMs = [];
    const decodeSamplesMs = [];
    for (let i = 0; i < 3; i++) {
      encodeVqfObjectPayload(logical, { sourceSpans });
      decodeVqfObjectPayload(encoded.bytes);
    }
    for (let i = 0; i < 100; i++) {
      let start = performance.now();
      encodeVqfObjectPayload(logical, { sourceSpans });
      encodeSamplesMs.push(performance.now() - start);
      start = performance.now();
      decodeVqfObjectPayload(encoded.bytes);
      decodeSamplesMs.push(performance.now() - start);
    }
    modes.push({
      sourceSpans,
      bodyDigest: hash(encoded.bytes),
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
  cases.push({
    fixture,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    logicalSegmentDigest: segment.digest,
    logicalPayloadDigest: hash(logical),
    exactRoundTrip: true,
    modes,
  });
}
const report = {
  phase: 3,
  generatedAt: new Date().toISOString(),
  node: process.version,
  harnessDigest: hash(readFileSync(script)),
  scope:
    'Internal object-body codec on existing conformance fixtures; excludes the future 56-byte envelope and 48-byte outer segment header.',
  methodology:
    'Three warmups and 100 sequential encode/decode samples per fixture/mode. Decode includes canonical re-encoding validation.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
