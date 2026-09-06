import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compressKnowledgeImageV5,
  createKnowledgeImageV5,
  digestDomain,
  mountKnowledgeImageV5,
  V5_SEGMENT_FLAG_VQF1,
} from '../dist/index.js';
import {
  decodeVqfEnvelope,
  encodeVqfEnvelope,
  VQF_ENVELOPE_HEADER_SIZE,
  VQF_EVENT_CODEC_KIND,
  VQF_OBJECT_CODEC_KIND,
} from '../dist/compression/vqf1/envelope.js';

function payload(bytes, segment) {
  return bytes.slice(segment.offset + 48, segment.offset + segment.length);
}

function digestBytes(digest) {
  return Uint8Array.from(Buffer.from(digest.slice(7), 'hex'));
}

function fixture(name) {
  return Uint8Array.from(
    Buffer.from(
      readFileSync(
        new URL(
          `../../../conformance/v5/${name}.fixture.base64`,
          import.meta.url
        ),
        'utf8'
      ).trim(),
      'base64'
    )
  );
}

test('VQF envelopes retain exact logical payloads and reject malformed headers', () => {
  const image = createKnowledgeImageV5({
    actor: 'fixture',
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('hello'),
        meta: { version: 1 },
      },
    ],
  });
  const event = image.segments.find((segment) => segment.kind === 2);
  assert.ok(event);
  const logical = payload(image.bytes, event);
  const encoded = encodeVqfEnvelope(VQF_EVENT_CODEC_KIND, logical);
  assert.equal(
    encoded.bytes.length,
    encoded.body.length + VQF_ENVELOPE_HEADER_SIZE
  );
  assert.deepEqual(
    decodeVqfEnvelope(encoded.bytes, VQF_EVENT_CODEC_KIND).logicalPayload,
    logical
  );
  assert.throws(
    () => decodeVqfEnvelope(encoded.bytes, VQF_OBJECT_CODEC_KIND),
    /kind/
  );
  for (const malformed of [
    encoded.bytes.slice(0, -1),
    Uint8Array.of(
      ...new TextEncoder().encode('bad!'),
      ...encoded.bytes.slice(4)
    ),
    Uint8Array.of(...encoded.bytes.slice(0, 4), 2, ...encoded.bytes.slice(5)),
  ]) {
    assert.throws(() => decodeVqfEnvelope(malformed, VQF_EVENT_CODEC_KIND));
  }
});

test('opt-in compression preserves all V5 logical identities with mixed segments', () => {
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
  const compressed = compressKnowledgeImageV5(ordinary.bytes);
  assert.equal(compressed.stateRoot, ordinary.stateRoot);
  assert.equal(compressed.commitDigest, ordinary.commitDigest);
  assert.deepEqual(compressed.commit, ordinary.commit);
  assert.deepEqual(compressed.objects, ordinary.objects);
  assert.deepEqual(compressed.events, ordinary.events);
  assert.equal(
    compressed.segments.find((segment) => segment.kind === 1)?.flags,
    0
  );
  assert.equal(
    compressed.segments.find((segment) => segment.kind === 2)?.flags,
    V5_SEGMENT_FLAG_VQF1
  );
  assert.deepEqual(
    compressKnowledgeImageV5(ordinary.bytes).bytes,
    compressed.bytes
  );
  assert.deepEqual(
    compressKnowledgeImageV5(compressed.bytes).bytes,
    compressed.bytes
  );
  assert.equal(
    mountKnowledgeImageV5(compressed.bytes).stateRoot,
    ordinary.stateRoot
  );
});

test('the compressor applies no-growth fallback and can compress both required payload kinds', () => {
  const empty = createKnowledgeImageV5({ objects: [] });
  assert.deepEqual(compressKnowledgeImageV5(empty.bytes).bytes, empty.bytes);

  const ordinary = fixture('migrated-legacy-v3');
  const compressed = compressKnowledgeImageV5(ordinary);
  assert.equal(compressed.stateRoot, mountKnowledgeImageV5(ordinary).stateRoot);
  assert.equal(
    compressed.segments.find((segment) => segment.kind === 1)?.flags,
    V5_SEGMENT_FLAG_VQF1
  );
  assert.equal(
    compressed.segments.find((segment) => segment.kind === 2)?.flags,
    V5_SEGMENT_FLAG_VQF1
  );
});

test('compressed segments reject physical corruption and inner corruption after rehashing', () => {
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
  const compressed = compressKnowledgeImageV5(ordinary.bytes);
  const event = compressed.segments.find((segment) => segment.kind === 2);
  assert.ok(event);
  const physical = compressed.bytes.slice();
  const bodyOffset = event.offset + 48 + VQF_ENVELOPE_HEADER_SIZE;
  physical[bodyOffset] ^= 1;
  assert.throws(() => mountKnowledgeImageV5(physical), /physical body digest/);

  const rehashed = compressed.bytes.slice();
  rehashed[bodyOffset] ^= 1;
  const body = payload(rehashed, event).slice(VQF_ENVELOPE_HEADER_SIZE);
  rehashed.set(
    digestBytes(digestDomain('vqf-physical', body)),
    event.offset + 48 + 24
  );
  assert.throws(
    () => mountKnowledgeImageV5(rehashed),
    /VQF|event|canonical|identity|table|ordinal/i
  );
});

test('unsupported VQF flags and compressed commits fail closed', () => {
  const image = createKnowledgeImageV5({ objects: [] });
  const changed = image.bytes.slice();
  const commit = image.segments.find((segment) => segment.kind === 3);
  assert.ok(commit);
  new DataView(changed.buffer).setUint16(
    commit.offset + 6,
    V5_SEGMENT_FLAG_VQF1,
    true
  );
  assert.throws(
    () => mountKnowledgeImageV5(changed),
    /Unsupported V5 segment encoding/
  );
});

test('compression preserves torn-superblock fallback while relocating the valid slot', () => {
  const image = createKnowledgeImageV5({
    actor: 'fixture',
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('hello'),
        meta: { version: 1 },
      },
    ],
  });
  const torn = image.bytes.slice();
  const newer = torn.slice(16, 144);
  const view = new DataView(newer.buffer);
  view.setBigUint64(8, 2n, true);
  view.setBigUint64(16, 0n, true);
  newer.set(digestBytes(digestDomain('superblock', newer.slice(0, 96))), 96);
  torn.set(newer, 144);
  const compressed = compressKnowledgeImageV5(torn);
  assert.equal(compressed.activeSuperblock, 'A');
  assert.equal(compressed.stateRoot, image.stateRoot);
  assert.deepEqual(compressed.bytes.slice(144, 272), newer);
});

test('compression preserves unknown optional payload bytes', () => {
  const image = createKnowledgeImageV5({
    actor: 'fixture',
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('hello'),
        meta: { version: 1 },
      },
    ],
  });
  const optionalPayload = new TextEncoder().encode('future optional payload');
  const optional = new Uint8Array(48 + optionalPayload.length);
  optional.set(new TextEncoder().encode('KSEG'));
  const optionalView = new DataView(optional.buffer);
  optionalView.setUint8(4, 128);
  optionalView.setUint8(5, 1);
  optionalView.setBigUint64(8, BigInt(optionalPayload.length), true);
  optional.set(digestBytes(digestDomain('segment', optionalPayload)), 16);
  optional.set(optionalPayload, 48);
  const extended = new Uint8Array(image.bytes.length + optional.length);
  extended.set(image.bytes);
  extended.set(optional, image.bytes.length);
  const compressed = compressKnowledgeImageV5(extended);
  const segment = compressed.segments.find((entry) => entry.kind === 128);
  assert.ok(segment);
  assert.deepEqual(payload(compressed.bytes, segment), optionalPayload);
  assert.equal(compressed.stateRoot, image.stateRoot);
});
