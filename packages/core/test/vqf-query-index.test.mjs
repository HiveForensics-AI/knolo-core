import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  candidateObjectIdsForKnowledgeQueryIndexV1,
  compressKnowledgeImageV5,
  createKnowledgeImageV5,
  createKnowledgeQueryIndexV5,
  deserializeKnowledgeQueryIndexV1,
  digestDomain,
  mountKnowledgeImageV5,
  parseKnowledgeQueryV5,
  queryIndexFromKnowledgeImageV5,
  queryKnowledgeImageV5,
  serializeCompressedKnowledgeQueryIndexV1,
  serializeKnowledgeQueryIndexV1,
  V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX,
  V5_SEGMENT_FLAG_VQF1,
  verifyKnowledgeQueryIndexV5,
} from '../dist/index.js';
import { VqfByteReader } from '../dist/compression/vqf1/byte_reader.js';
import { VqfByteWriter } from '../dist/compression/vqf1/byte_writer.js';
import {
  decodeVqfEnvelope,
  encodeVqfEnvelope,
  VQF_ENVELOPE_HEADER_SIZE,
  VQF_QUERY_INDEX_CODEC_KIND,
} from '../dist/compression/vqf1/envelope.js';
import {
  readIncreasingUIntList,
  writeIncreasingUIntList,
} from '../dist/compression/vqf1/integer_list.js';
import {
  decodeVqfQueryIndexPayload,
  encodeVqfQueryIndexPayload,
} from '../dist/compression/vqf1/query_index_codec.js';

const fixtures = [
  'knowledge-image-v5',
  'migrated-legacy-v3',
  'migrated-v4-claims-agents',
  'transaction-snapshot',
];

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

function payload(bytes, segment) {
  return bytes.slice(segment.offset + 48, segment.offset + segment.length);
}

function digestBytes(digest) {
  return Uint8Array.from(Buffer.from(digest.slice(7), 'hex'));
}

function encodeList(values) {
  const writer = new VqfByteWriter();
  writeIncreasingUIntList(values, writer);
  return writer.finish();
}

function sampleImage() {
  return createKnowledgeImageV5({
    objects: [
      {
        kind: 'source',
        bytes: new TextEncoder().encode('Alpha source'),
        meta: { owner: 'Team A', rank: 1 },
      },
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('Beta chunk'),
        meta: { owner: 'Team B', rank: 2 },
      },
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('Runtime metadata'),
        meta: { owner: 'Team A', rank: 3 },
      },
    ],
  });
}

test('strictly increasing integer lists use first-value-plus-one then positive deltas', () => {
  const encoded = encodeList([3, 10, 11, 35]);
  assert.deepEqual(encoded, Uint8Array.of(4, 4, 7, 1, 24));
  const reader = new VqfByteReader(encoded);
  assert.deepEqual(
    readIncreasingUIntList(reader, { maxCount: 8, maxValue: 35 }),
    [3, 10, 11, 35]
  );
  reader.assertFinished();
  assert.deepEqual(encodeList([]), Uint8Array.of(0));
  assert.deepEqual(encodeList([0]), Uint8Array.of(1, 1));
  assert.throws(() => encodeList([1, 1]), /increasing/);
  assert.throws(() => encodeList([-1]), /Invalid VQF integer list value/);
  const overflow = new VqfByteReader(Uint8Array.of(1, 0));
  assert.throws(
    () => readIncreasingUIntList(overflow, { maxCount: 1, maxValue: 10 }),
    /delta/
  );
  const tooLarge = new VqfByteReader(encodeList([8]));
  assert.throws(
    () => readIncreasingUIntList(tooLarge, { maxCount: 1, maxValue: 7 }),
    /limit/
  );
});

test('VQF query-index codec reproduces every current fixture index exactly', () => {
  for (const name of fixtures) {
    const image = mountKnowledgeImageV5(fixture(name));
    const index = createKnowledgeQueryIndexV5(image);
    const logical = serializeKnowledgeQueryIndexV1(index);
    const first = encodeVqfQueryIndexPayload(logical);
    assert.deepEqual(encodeVqfQueryIndexPayload(logical), first);
    const decoded = decodeVqfQueryIndexPayload(first.bytes);
    assert.deepEqual(decoded.logicalPayload, logical);
    assert.deepEqual(
      deserializeKnowledgeQueryIndexV1(decoded.logicalPayload),
      index
    );
    assert.deepEqual(decoded.statistics, first.statistics);
  }
});

test('compressed sidecars preserve indexRoot, candidates and query roots', () => {
  const image = sampleImage();
  const index = createKnowledgeQueryIndexV5(image);
  const ordinary = serializeKnowledgeQueryIndexV1(index);
  const compressed = serializeCompressedKnowledgeQueryIndexV1(index);
  assert.ok(compressed.length < ordinary.length);
  assert.deepEqual(deserializeKnowledgeQueryIndexV1(compressed), index);
  assert.deepEqual(deserializeKnowledgeQueryIndexV1(ordinary), index);
  const expression =
    'FROM * WHERE meta.owner = "team a" ORDER BY meta.rank ASC LIMIT 10';
  const plan = parseKnowledgeQueryV5(expression);
  const restored = deserializeKnowledgeQueryIndexV1(compressed);
  assert.deepEqual(
    [...candidateObjectIdsForKnowledgeQueryIndexV1(restored, plan)].sort(),
    [...candidateObjectIdsForKnowledgeQueryIndexV1(index, plan)].sort()
  );
  const scanned = queryKnowledgeImageV5(image, expression);
  const indexed = queryKnowledgeImageV5(image, expression, restored);
  assert.deepEqual(indexed.hits, scanned.hits);
  assert.equal(indexed.resultRoot, scanned.resultRoot);
  assert.equal(indexed.planRoot, scanned.planRoot);
});

test('opt-in kind 129 is skip-compatible and verified before query use', () => {
  const ordinary = sampleImage();
  const compressed = compressKnowledgeImageV5(ordinary.bytes, {
    objects: false,
    events: false,
    index: true,
  });
  assert.equal(compressed.stateRoot, ordinary.stateRoot);
  assert.equal(compressed.commitDigest, ordinary.commitDigest);
  const segment = compressed.segments.find(
    (entry) => entry.kind === V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX
  );
  assert.ok(segment);
  assert.equal(segment.flags, 0);
  assert.equal(
    segment.digest,
    digestDomain('segment', payload(compressed.bytes, segment))
  );
  assert.equal(queryIndexFromKnowledgeImageV5(ordinary.bytes), undefined);
  const mounted = mountKnowledgeImageV5(compressed.bytes);
  assert.equal(mounted.stateRoot, ordinary.stateRoot);
  const index = queryIndexFromKnowledgeImageV5(mounted);
  verifyKnowledgeQueryIndexV5(ordinary, index);
  const expression = 'FROM metadata LIMIT 10';
  assert.deepEqual(
    queryKnowledgeImageV5(mounted, expression, index).hits,
    queryKnowledgeImageV5(ordinary, expression).hits
  );
});

test('kind 129 can sit beside compressed required segments', () => {
  const ordinary = fixture('migrated-legacy-v3');
  const mountedOrdinary = mountKnowledgeImageV5(ordinary);
  const compressed = compressKnowledgeImageV5(ordinary, { index: true });
  assert.equal(compressed.stateRoot, mountedOrdinary.stateRoot);
  assert.equal(
    compressed.segments.find((segment) => segment.kind === 1)?.flags,
    V5_SEGMENT_FLAG_VQF1
  );
  const index = queryIndexFromKnowledgeImageV5(compressed);
  assert.ok(index);
  const expression = 'FROM source LIMIT 10';
  assert.deepEqual(
    queryKnowledgeImageV5(compressed, expression, index).resultRoot,
    queryKnowledgeImageV5(mountedOrdinary, expression).resultRoot
  );
});

test('query-index envelopes reject malformed bodies, unused tables and inner corruption', () => {
  const index = createKnowledgeQueryIndexV5(sampleImage());
  const logical = serializeKnowledgeQueryIndexV1(index);
  const encoded = encodeVqfQueryIndexPayload(logical);
  for (const bytes of [
    new Uint8Array(),
    encoded.bytes.slice(0, -1),
    Uint8Array.of(2, ...encoded.bytes.slice(1)),
    Uint8Array.of(encoded.bytes[0], 1, ...encoded.bytes.slice(2)),
    Uint8Array.of(...encoded.bytes, 0),
  ]) {
    assert.throws(() => decodeVqfQueryIndexPayload(bytes));
  }
  const envelope = encodeVqfEnvelope(VQF_QUERY_INDEX_CODEC_KIND, logical);
  const bodyOffset = VQF_ENVELOPE_HEADER_SIZE;
  const physical = envelope.bytes.slice();
  physical[bodyOffset] ^= 1;
  assert.throws(
    () => decodeVqfEnvelope(physical, VQF_QUERY_INDEX_CODEC_KIND),
    /physical body digest/
  );
  const rehashed = envelope.bytes.slice();
  rehashed[bodyOffset] ^= 1;
  const body = rehashed.slice(VQF_ENVELOPE_HEADER_SIZE);
  rehashed.set(digestBytes(digestDomain('vqf-physical', body)), 24);
  assert.throws(
    () => decodeVqfEnvelope(rehashed, VQF_QUERY_INDEX_CODEC_KIND),
    /VQF|canonical|index|ordinal|table/i
  );
  assert.throws(() => encodeVqfQueryIndexPayload(canonicalCborWrong()));
  function canonicalCborWrong() {
    return Uint8Array.of(0xa0);
  }
});

test('empty indexes still factor digest strings and attach only when the envelope is smaller', () => {
  const empty = createKnowledgeImageV5({ objects: [] });
  const index = createKnowledgeQueryIndexV5(empty);
  const ordinary = serializeKnowledgeQueryIndexV1(index);
  const compressed = serializeCompressedKnowledgeQueryIndexV1(index);
  assert.ok(compressed.length < ordinary.length);
  assert.deepEqual(deserializeKnowledgeQueryIndexV1(compressed), index);
  const image = compressKnowledgeImageV5(empty.bytes, {
    objects: false,
    events: false,
    index: true,
  });
  const segment = image.segments.find(
    (entry) => entry.kind === V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX
  );
  assert.ok(segment);
  assert.ok(segment.payloadLength < ordinary.length);
  assert.equal(
    queryIndexFromKnowledgeImageV5(image)?.indexRoot,
    index.indexRoot
  );
});

test('compressor preserves unknown optional payloads while replacing a valid kind 129', () => {
  const image = sampleImage();
  const withIndex = compressKnowledgeImageV5(image.bytes, {
    objects: false,
    events: false,
    index: true,
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
  const extended = new Uint8Array(withIndex.bytes.length + optional.length);
  extended.set(withIndex.bytes);
  extended.set(optional, withIndex.bytes.length);
  const compressed = compressKnowledgeImageV5(extended, {
    objects: false,
    events: false,
    index: true,
  });
  const kind128 = compressed.segments.find((entry) => entry.kind === 128);
  assert.ok(kind128);
  assert.deepEqual(payload(compressed.bytes, kind128), optionalPayload);
  assert.ok(queryIndexFromKnowledgeImageV5(compressed));
});

test('unsupported existing kind 129 bytes fail closed when attaching an index', () => {
  const image = sampleImage();
  const bogus = new Uint8Array(48 + 4);
  bogus.set(new TextEncoder().encode('KSEG'));
  const view = new DataView(bogus.buffer);
  view.setUint8(4, V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX);
  view.setUint8(5, 1);
  view.setBigUint64(8, 4n, true);
  const payloadBytes = new TextEncoder().encode('nope');
  bogus.set(digestBytes(digestDomain('segment', payloadBytes)), 16);
  bogus.set(payloadBytes, 48);
  const extended = new Uint8Array(image.bytes.length + bogus.length);
  extended.set(image.bytes);
  extended.set(bogus, image.bytes.length);
  assert.throws(
    () =>
      compressKnowledgeImageV5(extended, {
        objects: false,
        events: false,
        index: true,
      }),
    /query-index/
  );
  const preserved = compressKnowledgeImageV5(extended, {
    objects: false,
    events: false,
  });
  assert.equal(
    preserved.segments.at(-1)?.kind,
    V5_OPTIONAL_SEGMENT_VQF_QUERY_INDEX
  );
});

test('1,000 seeded query indexes round-trip with exact roots and candidates', () => {
  let seed = 20260906;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const kinds = ['source', 'chunk', 'metadata', 'claims', 'agents'];
  for (let caseIndex = 0; caseIndex < 1000; caseIndex++) {
    const count = 1 + (random() % 5);
    const objects = [];
    for (let i = 0; i < count; i++) {
      objects.push({
        kind: kinds[random() % kinds.length],
        bytes: new TextEncoder().encode(
          `doc-${caseIndex}-${i}-${random() % 7}`
        ),
        meta: {
          owner: `team-${random() % 3}`,
          rank: random() % 11,
          unicode: `東京-${random() % 4}`,
        },
      });
    }
    const image = createKnowledgeImageV5({ objects });
    const index = createKnowledgeQueryIndexV5(image);
    const logical = serializeKnowledgeQueryIndexV1(index);
    const encoded = encodeVqfQueryIndexPayload(logical);
    assert.deepEqual(encodeVqfQueryIndexPayload(logical), encoded);
    const decoded = decodeVqfQueryIndexPayload(encoded.bytes);
    assert.deepEqual(decoded.logicalPayload, logical);
    const restored = deserializeKnowledgeQueryIndexV1(
      serializeCompressedKnowledgeQueryIndexV1(index)
    );
    assert.equal(restored.indexRoot, index.indexRoot);
    const plan = parseKnowledgeQueryV5(
      `FROM ${objects[0].kind} WHERE meta.owner = "team-0" LIMIT 10`
    );
    assert.deepEqual(
      [...candidateObjectIdsForKnowledgeQueryIndexV1(restored, plan)].sort(),
      [...candidateObjectIdsForKnowledgeQueryIndexV1(index, plan)].sort()
    );
  }
});
