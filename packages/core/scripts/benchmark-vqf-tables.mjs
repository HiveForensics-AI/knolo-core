import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mountKnowledgeImageV5 } from '../dist/index.js';
import { VqfDigestTable } from '../dist/compression/vqf1/digest_table.js';
import { VqfStringTable } from '../dist/compression/vqf1/string_table.js';
import { VqfByteStore } from '../dist/compression/vqf1/byte_factor.js';
import { VqfByteWriter } from '../dist/compression/vqf1/byte_writer.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
if (process.argv.length !== 4 || process.argv[2] !== '--output') {
  throw new Error(
    'Usage: node packages/core/scripts/benchmark-vqf-tables.mjs --output new-report.json'
  );
}
const cases = [];
for (const fixture of [
  'knowledge-image-v5',
  'migrated-legacy-v3',
  'migrated-v4-claims-agents',
  'transaction-snapshot',
]) {
  const bytes = Buffer.from(
    readFileSync(
      path.join(root, `conformance/v5/${fixture}.fixture.base64`),
      'utf8'
    ).trim(),
    'base64'
  );
  const image = mountKnowledgeImageV5(bytes);
  const digests = [
    ...image.objects.map((o) => o.id),
    ...image.events.flatMap((e) => [
      e.id,
      e.transactionId,
      ...e.parents,
      e.target,
      e.payload,
    ]),
  ];
  const strings = [
    ...image.objects.map((o) => o.kind),
    ...image.events.flatMap((e) => [e.actor, e.kind]),
  ];
  const payloads = image.objects.map((o) => o.bytes);
  const build = () => ({
    digestTable: VqfDigestTable.build(digests),
    stringTable: VqfStringTable.build(strings),
    blobs: VqfByteStore.build(payloads),
  });
  for (let i = 0; i < 3; i++) build();
  const samplesMs = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    build();
    samplesMs.push(performance.now() - start);
  }
  const { digestTable, stringTable, blobs } = build();
  const decodedDigests = VqfDigestTable.decode(digestTable.encode());
  const decodedStrings = VqfStringTable.decode(stringTable.encode());
  const refs = new VqfByteWriter();
  for (const id of digests) {
    const ordinal = digestTable.ordinalOf(id);
    refs.writeUVarint(ordinal);
    assert.equal(decodedDigests.digestAt(ordinal), id);
  }
  for (const s of strings)
    assert.equal(decodedStrings.decodeValue(stringTable.encodeValue(s)), s);
  for (let i = 0; i < payloads.length; i++)
    assert.deepEqual(
      blobs.blobAt(blobs.ordinals[i]),
      Uint8Array.from(payloads[i])
    );
  const plain = VqfStringTable.build([]);
  const repeated = build();
  assert.deepEqual(repeated.digestTable.encode(), digestTable.encode());
  assert.deepEqual(repeated.stringTable.encode(), stringTable.encode());
  assert.deepEqual(repeated.blobs.ordinals, blobs.ordinals);
  const sorted = [...samplesMs].sort((a, b) => a - b);
  cases.push({
    fixture,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    digestOccurrences: digests.length,
    digestCount: digestTable.count,
    digestAsciiBytes: digests.length * 71,
    digestTableAndOrdinalBytes: digestTable.encode().length + refs.length,
    stringOccurrences: strings.length,
    stringCount: stringTable.count,
    stringInlineBytes:
      plain.encode().length +
      strings.reduce((sum, s) => sum + plain.encodeValue(s).length, 0),
    stringTableAndValueBytes:
      stringTable.encode().length +
      strings.reduce((sum, s) => sum + stringTable.encodeValue(s).length, 0),
    blobOccurrences: payloads.length,
    blobCount: blobs.count,
    logicalBlobBytes: blobs.logicalBytes,
    uniqueBlobPayloadBytes: blobs.physicalBlobBytes,
    duplicateBlobPayloadBytesSaved: blobs.duplicateBlobBytesSaved,
    build: { p50: sorted[49], p95: sorted[94], p99: sorted[98], samplesMs },
    exactRoundTrip: true,
  });
}
const report = {
  phase: 2,
  node: process.version,
  harnessDigest: `sha256-${createHash('sha256')
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex')}`,
  scope:
    'Internal primitives on four small existing conformance fixtures; not compressed image size or a container performance claim.',
  accounting:
    'Digest comparison uses raw 71-byte strings versus table+varint ordinals. Strings include table counts, entry lengths, tags and ordinals. Blobs measure payload-only savings, excluding reference/table/envelope overhead.',
  cases,
};
writeFileSync(
  path.resolve(process.argv[3]),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' }
);
console.log(`Saved ${process.argv[3]}`);
