import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  compressKnowledgeImageV5,
  mountKnowledgeImageV5,
  V5_SEGMENT_FLAG_VQF1,
} from '../dist/index.js';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '../../..');
if (process.argv.length !== 4 || process.argv[2] !== '--output') {
  throw new Error(
    'Usage: node packages/core/scripts/benchmark-vqf-images.mjs --output new-report.json'
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
  const ordinaryBytes = Uint8Array.from(
    Buffer.from(
      readFileSync(
        path.join(root, `conformance/v5/${fixture}.fixture.base64`),
        'utf8'
      ).trim(),
      'base64'
    )
  );
  const ordinary = mountKnowledgeImageV5(ordinaryBytes);
  const compressed = compressKnowledgeImageV5(ordinaryBytes);
  assert.equal(compressed.stateRoot, ordinary.stateRoot);
  assert.equal(compressed.commitDigest, ordinary.commitDigest);
  assert.deepEqual(compressed.commit, ordinary.commit);
  assert.deepEqual(compressed.objects, ordinary.objects);
  assert.deepEqual(compressed.events, ordinary.events);
  assert.deepEqual(
    compressKnowledgeImageV5(ordinaryBytes).bytes,
    compressed.bytes
  );
  const compressionSamplesMs = [];
  const mountSamplesMs = [];
  for (let i = 0; i < 3; i++) {
    compressKnowledgeImageV5(ordinaryBytes);
    mountKnowledgeImageV5(compressed.bytes);
  }
  for (let i = 0; i < 100; i++) {
    let start = performance.now();
    compressKnowledgeImageV5(ordinaryBytes);
    compressionSamplesMs.push(performance.now() - start);
    start = performance.now();
    mountKnowledgeImageV5(compressed.bytes);
    mountSamplesMs.push(performance.now() - start);
  }
  const segment = (image, kind) =>
    image.segments.find((entry) => entry.kind === kind);
  const ordinaryObject = segment(ordinary, 1);
  const ordinaryEvent = segment(ordinary, 2);
  const compressedObject = segment(compressed, 1);
  const compressedEvent = segment(compressed, 2);
  cases.push({
    fixture,
    stateRoot: ordinary.stateRoot,
    commitDigest: ordinary.commitDigest,
    ordinaryImageDigest: hash(ordinaryBytes),
    compressedImageDigest: hash(compressed.bytes),
    exactLogicalIdentity: true,
    ordinaryImageBytes: ordinaryBytes.length,
    compressedImageBytes: compressed.bytes.length,
    compressionRatio: ordinaryBytes.length / compressed.bytes.length,
    reduction: 1 - compressed.bytes.length / ordinaryBytes.length,
    object: {
      logicalPayloadBytes: ordinaryObject.payloadLength,
      physicalPayloadBytes: compressedObject.payloadLength,
      compressed: compressedObject.flags === V5_SEGMENT_FLAG_VQF1,
      logicalDigest: ordinaryObject.digest,
    },
    event: {
      logicalPayloadBytes: ordinaryEvent.payloadLength,
      physicalPayloadBytes: compressedEvent.payloadLength,
      compressed: compressedEvent.flags === V5_SEGMENT_FLAG_VQF1,
      logicalDigest: ordinaryEvent.digest,
    },
    compress: {
      p50: percentile(compressionSamplesMs, 0.5),
      p95: percentile(compressionSamplesMs, 0.95),
      p99: percentile(compressionSamplesMs, 0.99),
      samplesMs: compressionSamplesMs,
    },
    mount: {
      p50: percentile(mountSamplesMs, 0.5),
      p95: percentile(mountSamplesMs, 0.95),
      p99: percentile(mountSamplesMs, 0.99),
      samplesMs: mountSamplesMs,
    },
  });
}
const report = {
  phase: 5,
  generatedAt: new Date().toISOString(),
  node: process.version,
  harnessDigest: hash(readFileSync(script)),
  scope:
    'Whole-image opt-in VQF transcode of existing V5 conformance fixtures, including the 56-byte envelope and unchanged segment headers/superblocks.',
  methodology:
    'Three warmups and 100 sequential compression/mount samples per fixture. Mount fully verifies each physical envelope and reconstructed logical payload.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
