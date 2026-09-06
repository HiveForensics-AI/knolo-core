import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  canonicalCbor,
  createKnowledgeImageV5,
  decodeCanonicalCbor,
  digestDomain,
  mountKnowledgeImageV5,
} from '../dist/index.js';
import {
  decodeVqfObjectPayload,
  encodeVqfObjectPayload,
} from '../dist/compression/vqf1/object_codec.js';
import { findLowestByteOffset } from '../dist/compression/vqf1/byte_factor.js';
import { VqfByteReader } from '../dist/compression/vqf1/byte_reader.js';
import { VqfStringTable } from '../dist/compression/vqf1/string_table.js';

const encoder = new TextEncoder();
const fixtures = [
  'knowledge-image-v5',
  'migrated-legacy-v3',
  'migrated-v4-claims-agents',
  'transaction-snapshot',
];

function objectPayload(imageBytes) {
  const image = mountKnowledgeImageV5(imageBytes);
  const segment = image.segments.find((entry) => entry.kind === 1);
  assert.ok(segment);
  return imageBytes.slice(segment.offset + 48, segment.offset + segment.length);
}

function objectRecord(kind, bytes, meta, extra = {}) {
  const id = digestDomain('object', canonicalCbor({ kind, bytes, meta }));
  return { ...extra, id, kind, bytes, meta };
}

test('VQF object codec reproduces every current fixture payload exactly in both modes', () => {
  for (const fixture of fixtures) {
    const imageBytes = Uint8Array.from(
      Buffer.from(
        readFileSync(
          new URL(
            `../../../conformance/v5/${fixture}.fixture.base64`,
            import.meta.url
          ),
          'utf8'
        ).trim(),
        'base64'
      )
    );
    const payload = objectPayload(imageBytes);
    for (const sourceSpans of [false, true]) {
      const first = encodeVqfObjectPayload(payload, { sourceSpans });
      const second = encodeVqfObjectPayload(payload, { sourceSpans });
      assert.deepEqual(first, second);
      const decoded = decodeVqfObjectPayload(first.bytes);
      assert.deepEqual(decoded.logicalPayload, payload);
      assert.equal(
        digestDomain('segment', decoded.logicalPayload),
        digestDomain('segment', payload)
      );
      assert.deepEqual(decoded.statistics, first.statistics);
    }
  }
});

test('source spans use exact UTF-8 bytes and the lowest matching offset', () => {
  const sourceBytes = encoder.encode('préface 東京 / 東京 / fin');
  const source = objectRecord('source', sourceBytes, { docId: 'unicode' });
  const repeated = encoder.encode('東京');
  const full = objectRecord('chunk', sourceBytes, {
    sourceObject: source.id,
    span: { start: 999, end: 1000 },
  });
  const later = objectRecord('chunk', repeated, {
    sourceObject: source.id,
    // Logical metadata is deliberately in characters and deliberately wrong.
    span: { start: 0, end: 1 },
  });
  const empty = objectRecord('chunk', new Uint8Array(), {
    sourceObject: source.id,
  });
  const absent = objectRecord('chunk', encoder.encode('absent'), {
    sourceObject: source.id,
  });
  const payload = canonicalCbor([source, full, later, empty, absent]);
  const plain = encodeVqfObjectPayload(payload);
  const spanned = encodeVqfObjectPayload(payload, { sourceSpans: true });
  assert.equal(plain.statistics.sourceSpanCount, 0);
  assert.equal(spanned.statistics.sourceSpanCount, 1);
  assert.equal(spanned.statistics.sourceSpanBytesSaved, repeated.length);
  assert.ok(spanned.bytes.length < plain.bytes.length);
  assert.ok(spanned.statistics.blobCount < plain.statistics.blobCount);
  assert.deepEqual(
    decodeVqfObjectPayload(spanned.bytes).logicalPayload,
    payload
  );
  assert.equal(
    findLowestByteOffset(sourceBytes, repeated),
    Buffer.from(sourceBytes).indexOf(repeated)
  );
  assert.equal(findLowestByteOffset(sourceBytes, new Uint8Array()), 0);
  assert.equal(
    findLowestByteOffset(sourceBytes, encoder.encode('missing')),
    undefined
  );
});

test('duplicate blobs, complete records and object order are preserved', () => {
  const bytes = encoder.encode('same evidence');
  const records = [
    objectRecord(
      'metadata',
      bytes,
      { n: 2 },
      { future: { enabled: true }, revision: 9 }
    ),
    objectRecord(
      'metadata',
      bytes,
      { n: 1 },
      { future: ['x', 3], note: 'kept' }
    ),
  ];
  const payload = canonicalCbor(records);
  const encoded = encodeVqfObjectPayload(payload, { sourceSpans: true });
  assert.equal(encoded.statistics.blobCount, 1);
  assert.equal(encoded.statistics.duplicateBlobBytesSaved, bytes.length);
  const decoded = decodeVqfObjectPayload(encoded.bytes).logicalPayload;
  assert.deepEqual(decoded, payload);
  assert.deepEqual(decodeCanonicalCbor(decoded), decodeCanonicalCbor(payload));
});

test('source references require an identified source and exact byte equality', () => {
  const sourceBytes = encoder.encode('abc abc');
  const source = objectRecord('source', sourceBytes, {});
  const wrongId = `sha256-${'0'.repeat(64)}`;
  const records = [
    source,
    objectRecord('chunk', encoder.encode('abc'), { sourceObject: wrongId }),
    objectRecord('chunk', encoder.encode('abd'), { sourceObject: source.id }),
    objectRecord('chunk', encoder.encode('abc'), {
      sourceObject: source.id.toUpperCase(),
    }),
  ];
  const encoded = encodeVqfObjectPayload(canonicalCbor(records), {
    sourceSpans: true,
  });
  assert.equal(encoded.statistics.sourceSpanCount, 0);
  assert.deepEqual(
    decodeVqfObjectPayload(encoded.bytes).logicalPayload,
    canonicalCbor(records)
  );
});

test('object codec rejects malformed inputs, corruption, limits and hostile CBOR counts', () => {
  const record = objectRecord('metadata', encoder.encode('payload'), {
    version: 1,
  });
  const payload = canonicalCbor([record]);
  const encoded = encodeVqfObjectPayload(payload, { sourceSpans: true });
  for (const bytes of [
    new Uint8Array(),
    encoded.bytes.slice(0, -1),
    Uint8Array.of(2, ...encoded.bytes.slice(1)),
    Uint8Array.of(encoded.bytes[0], 0x80, ...encoded.bytes.slice(2)),
    Uint8Array.of(...encoded.bytes, 0),
  ]) {
    assert.throws(() => decodeVqfObjectPayload(bytes));
  }
  assert.throws(() => encodeVqfObjectPayload(canonicalCbor({})), /payload/);
  assert.throws(
    () => encodeVqfObjectPayload(payload, { limits: { maxObjects: 0 } }),
    /count/
  );
  assert.throws(
    () => decodeVqfObjectPayload(encoded.bytes, { limits: { maxObjects: 0 } }),
    /bound|count/
  );
  assert.throws(
    () =>
      encodeVqfObjectPayload(payload, {
        limits: { maxLogicalBytes: payload.length - 1 },
      }),
    /logical/
  );
  assert.throws(
    () =>
      decodeVqfObjectPayload(encoded.bytes, {
        limits: { maxPhysicalBytes: encoded.bytes.length - 1 },
      }),
    /limit/
  );
  const badId = { ...record, id: `sha256-${'1'.repeat(64)}` };
  assert.throws(
    () => encodeVqfObjectPayload(canonicalCbor([badId])),
    /identity/
  );
  const badFields = [
    { ...record, id: 1 },
    { ...record, kind: 1 },
    { ...record, bytes: 'payload' },
    { ...record, meta: [] },
  ];
  for (const bad of badFields)
    assert.throws(() => encodeVqfObjectPayload(canonicalCbor([bad])));
  // These inputs previously invited huge eager Array.from allocations.
  for (const hostile of [
    Uint8Array.of(0x9b, ...new Uint8Array(8).fill(0xff)),
    Uint8Array.of(0xbb, ...new Uint8Array(8).fill(0xff)),
  ]) {
    assert.throws(() => decodeCanonicalCbor(hostile), /collection/);
  }
  const prototypeKey = decodeCanonicalCbor(
    Uint8Array.of(0xa1, 0x69, ...encoder.encode('__proto__'), 0xf6)
  );
  assert.equal(Object.getPrototypeOf(prototypeKey), Object.prototype);
  assert.equal(Object.hasOwn(prototypeKey, '__proto__'), true);
  assert.throws(
    () =>
      decodeCanonicalCbor(
        Uint8Array.of(0xa2, 0x61, 0x61, 0xf6, 0x61, 0x61, 0xf6)
      ),
    /Duplicate/
  );

  const source = objectRecord(
    'source',
    encoder.encode('prefix-a-long-exact-substring-suffix'),
    {}
  );
  const chunk = objectRecord(
    'chunk',
    encoder.encode('a-long-exact-substring'),
    {
      sourceObject: source.id,
    }
  );
  const spanBody = encodeVqfObjectPayload(canonicalCbor([source, chunk]), {
    sourceSpans: true,
  }).bytes;
  const corruptedSpan = spanBody.slice();
  const bodyReader = new VqfByteReader(corruptedSpan);
  bodyReader.readByte();
  bodyReader.readByte();
  bodyReader.readBytes(bodyReader.readUVarintNumber(bodyReader.remaining));
  const stringBytes = bodyReader.readBytes(
    bodyReader.readUVarintNumber(bodyReader.remaining)
  );
  const strings = VqfStringTable.decode(stringBytes);
  const blobCount = bodyReader.readUVarintNumber();
  for (let i = 0; i < blobCount; i++)
    bodyReader.readBytes(bodyReader.readUVarintNumber(bodyReader.remaining));
  const objectCount = bodyReader.readUVarintNumber();
  let spanOffsetPosition;
  for (let i = 0; i < objectCount; i++) {
    bodyReader.readUVarint();
    strings.readValue(bodyReader);
    const mode = bodyReader.readByte();
    bodyReader.readUVarint();
    if (mode === 1) {
      spanOffsetPosition = bodyReader.offset;
      break;
    }
    bodyReader.readBytes(bodyReader.readUVarintNumber(bodyReader.remaining));
    bodyReader.readBytes(bodyReader.readUVarintNumber(bodyReader.remaining));
  }
  assert.notEqual(spanOffsetPosition, undefined);
  corruptedSpan[spanOffsetPosition] = 0x7f;
  assert.throws(
    () => decodeVqfObjectPayload(corruptedSpan),
    /bound|range|truncated/
  );
});

test('1,000 seeded object payloads round-trip with exact identities and bytes', () => {
  let seed = 20260905;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let caseIndex = 0; caseIndex < 1000; caseIndex++) {
    const sourceBytes = encoder.encode(
      `α-${random()}-shared-${random()}-shared-${caseIndex}`
    );
    const source = objectRecord('source', sourceBytes, {
      caseIndex,
      seed: random(),
    });
    const minimumLength = 12;
    const start = random() % (sourceBytes.length - minimumLength + 1);
    const end =
      start +
      minimumLength +
      (random() % (sourceBytes.length - start - minimumLength + 1));
    const exact = sourceBytes.slice(start, end);
    const chunk = objectRecord(
      'chunk',
      exact,
      {
        sourceObject: source.id,
        span: { start: random() % 50, end: random() % 50 },
      },
      { extension: caseIndex % 3 }
    );
    const duplicate = objectRecord(
      'metadata',
      encoder.encode(`other-${caseIndex % 7}`),
      {
        caseIndex,
        duplicate: true,
      }
    );
    const payload = canonicalCbor(
      caseIndex % 2 ? [source, chunk, duplicate] : [chunk, duplicate, source]
    );
    const encoded = encodeVqfObjectPayload(payload, { sourceSpans: true });
    assert.deepEqual(
      encodeVqfObjectPayload(payload, { sourceSpans: true }),
      encoded
    );
    const decoded = decodeVqfObjectPayload(encoded.bytes);
    assert.deepEqual(decoded.logicalPayload, payload);
    assert.equal(
      digestDomain('segment', decoded.logicalPayload),
      digestDomain('segment', payload)
    );
    assert.equal(decoded.statistics.sourceSpanCount, 1);
  }
});
