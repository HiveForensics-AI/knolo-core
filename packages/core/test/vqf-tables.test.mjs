import assert from 'node:assert/strict';
import test from 'node:test';
import { VqfDigestTable } from '../dist/compression/vqf1/digest_table.js';
import { VqfStringTable } from '../dist/compression/vqf1/string_table.js';
import { VqfByteStore } from '../dist/compression/vqf1/byte_factor.js';
import { VqfByteWriter } from '../dist/compression/vqf1/byte_writer.js';
const digest = (n) => `sha256-${n.toString(16).padStart(64, '0')}`;

test('digest tables sort raw bytes, deduplicate and round-trip exact canonical identities', () => {
  const input = [digest(256), digest(0), digest(255), digest(256)];
  const table = VqfDigestTable.build(input);
  assert.equal(table.count, 3);
  assert.equal(table.encode().length, 97);
  assert.deepEqual(
    table.encode(),
    VqfDigestTable.build([...input].reverse()).encode()
  );
  const decoded = VqfDigestTable.decode(table.encode());
  for (const id of input)
    assert.equal(decoded.digestAt(decoded.ordinalOf(id)), id);
  assert.deepEqual(
    [0, 1, 2].map((i) => decoded.digestAt(i)),
    [digest(0), digest(255), digest(256)]
  );
  const copy = table.digests;
  copy.fill(255);
  assert.equal(table.digestAt(0), digest(0));
  assert.deepEqual(VqfDigestTable.build([]).encode(), Uint8Array.of(0));
  assert.equal(VqfDigestTable.decode(Uint8Array.of(0)).count, 0);
});

test('digest decoding rejects malformed tables, digests and ordinals', () => {
  const table = VqfDigestTable.build([digest(0), digest(1)]);
  for (const id of [
    digest(1) + '\n',
    digest(1).toUpperCase(),
    digest(1).slice(1),
    'sha256-' + '0g'.repeat(32),
    null,
  ]) {
    assert.throws(() => VqfDigestTable.build([id]), /digest/);
  }
  for (const bytes of [
    new Uint8Array(),
    Uint8Array.of(0, 1),
    Uint8Array.of(0x80, 0),
    table.encode().slice(0, -1),
    Uint8Array.of(2, ...new Uint8Array(64)),
  ]) {
    assert.throws(() => VqfDigestTable.decode(bytes));
  }
  const reversed = table.encode();
  reversed.set(table.digests.subarray(32), 1);
  reversed.set(table.digests.subarray(0, 32), 33);
  assert.throws(() => VqfDigestTable.decode(reversed), /sorted/);
  for (const ordinal of [-1, 2, 0.5, NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => table.digestAt(ordinal), /ordinal/);
  assert.throws(() => table.ordinalOf(digest(3)), /absent/);
  assert.throws(() => VqfDigestTable.decode(table.encode(), { maxEntries: 1 }));
  assert.throws(
    () => VqfDigestTable.build([digest(0)], { maxBytes: 32 }),
    /limit/
  );
  assert.throws(
    () => VqfDigestTable.build([digest(0), digest(0)], { maxEntries: 1 }),
    /limit/
  );
});

test('string dictionary selection uses positive total savings including count/ordinal boundaries', () => {
  const input = Array.from(
    { length: 140 },
    (_, i) => `repeated-value-${i.toString().padStart(3, '0')}`
  ).flatMap((s) => [s, s, s]);
  input.push('', 'x', 'unique', 'x');
  const table = VqfStringTable.build(input);
  assert.equal(table.count, 140);
  assert.equal(table.ordinalOf('x'), undefined);
  const plain = VqfStringTable.build([]);
  const inlineBytes =
    plain.encode().length +
    input.reduce((n, s) => n + plain.encodeValue(s).length, 0);
  const encodedBytes =
    table.encode().length +
    input.reduce((n, s) => n + table.encodeValue(s).length, 0);
  assert.ok(encodedBytes < inlineBytes);
  assert.equal(table.encodeValue('repeated-value-127').length, 2);
  assert.equal(table.encodeValue('repeated-value-128').length, 3);
  assert.deepEqual(
    table.encode(),
    VqfStringTable.build([...input].reverse()).encode()
  );
  const decoded = VqfStringTable.decode(table.encode());
  for (const s of input)
    assert.equal(decoded.decodeValue(table.encodeValue(s)), s);
  // At 128 entries the count grows by one byte. A marginal candidate must pay it.
  const boundary = Array.from(
    { length: 127 },
    (_, i) => `a${i.toString().padStart(3, '0')}`
  ).flatMap((s) => [s, s, s]);
  const selected = VqfStringTable.build([...boundary, 'zz', 'zz']);
  assert.equal(selected.count, 127);
  assert.equal(selected.ordinalOf('zz'), undefined);
});

test('Unicode is byte-exact including BOM and fallback runtime codecs', () => {
  const inputs = [
    '',
    '\ufeffsource',
    'café',
    'cafe\u0301',
    '東京',
    '😀',
    '\u0000',
    '\ufffd',
  ];
  const check = () => {
    const table = VqfStringTable.build(inputs.flatMap((s) => [s, s, s, s]));
    const restored = VqfStringTable.decode(table.encode());
    for (const s of inputs)
      assert.equal(restored.decodeValue(table.encodeValue(s)), s);
    assert.deepEqual(
      table.strings,
      [...table.strings].sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b))
      )
    );
    for (const value of ['\ud800', '\udc00', '\ud800x'])
      assert.throws(() => VqfStringTable.build([value]), /Unicode/);
    return table.encode();
  };
  const native = check();
  const encoder = globalThis.TextEncoder,
    decoder = globalThis.TextDecoder;
  try {
    globalThis.TextEncoder = undefined;
    globalThis.TextDecoder = undefined;
    assert.deepEqual(check(), native);
  } finally {
    globalThis.TextEncoder = encoder;
    globalThis.TextDecoder = decoder;
  }
});

test('string decoding fails closed for invalid UTF-8, tags, lengths, ordinals and alternate values', () => {
  const table = VqfStringTable.build(['source', 'source', 'source']);
  for (const bytes of [
    Uint8Array.of(2),
    Uint8Array.of(1, 1),
    Uint8Array.of(0, 255),
    Uint8Array.of(1, 0, 0),
    Uint8Array.of(0, 2, 0xc0, 0xaf),
    Uint8Array.of(0, 1, 0xff),
    Uint8Array.of(0, 3, 0xed, 0xa0, 0x80),
  ]) {
    assert.throws(() => table.decodeValue(bytes));
  }
  assert.throws(
    () => table.decodeValue(VqfStringTable.build([]).encodeValue('source')),
    /canonical/
  );
  for (const bytes of [
    Uint8Array.of(2, 1, 97, 1, 97),
    Uint8Array.of(2, 1, 98, 1, 97),
    Uint8Array.of(1, 1, 0xff),
    Uint8Array.of(0, 0),
  ]) {
    assert.throws(() => VqfStringTable.decode(bytes));
  }
  assert.throws(
    () => VqfStringTable.build(['source'], { maxBytes: 5 }),
    /limit/
  );
  assert.throws(
    () => VqfStringTable.build(['a', 'a'], { maxEntries: 1 }),
    /limit/
  );
  const oversized = new VqfByteWriter();
  oversized.writeUVarint(1_000_001);
  assert.throws(() => VqfStringTable.decode(oversized.finish()));
  assert.throws(() => VqfStringTable.decode(table.encode(), { maxEntries: 0 }));
});

test('byte factoring verifies equality even under forced collisions and owns its bytes', () => {
  const inputs = [
    Buffer.from('東京'),
    Buffer.from('aa'),
    Buffer.from('bb'),
    Buffer.from('aa'),
    Buffer.alloc(0),
  ];
  const store = VqfByteStore.build(inputs, {
    candidateHash: () => 'collision',
  });
  assert.equal(store.count, 4);
  assert.equal(store.duplicateBlobBytesSaved, 2);
  for (let i = 0; i < inputs.length; i++)
    assert.deepEqual(Buffer.from(store.blobAt(store.ordinals[i])), inputs[i]);
  const reversed = VqfByteStore.build([...inputs].reverse());
  assert.deepEqual(
    Array.from({ length: store.count }, (_, i) => store.blobAt(i)),
    Array.from({ length: reversed.count }, (_, i) => reversed.blobAt(i))
  );
  inputs[1].fill(0);
  const copy = store.blobAt(store.ordinals[1]);
  copy.fill(255);
  const ordinals = store.ordinals;
  ordinals[1] = -1;
  assert.equal(Buffer.from(store.blobAt(store.ordinals[1])).toString(), 'aa');
  assert.throws(() => store.blobAt(4), /ordinal/);
  assert.throws(
    () =>
      VqfByteStore.build([new Uint8Array(4), new Uint8Array(4)], {
        maxBytes: 7,
      }),
    /limit/
  );
  assert.throws(
    () =>
      VqfByteStore.build([new Uint8Array(), new Uint8Array()], {
        maxEntries: 1,
      }),
    /limit/
  );
  const guarded = VqfByteStore.build([Uint8Array.of(1, 2, 3)], {
    candidateHash: (candidate) => {
      candidate.fill(9);
      return 'mutating-test-double';
    },
  });
  assert.deepEqual(guarded.blobAt(0), Uint8Array.of(1, 2, 3));
  assert.equal(VqfByteStore.build([]).count, 0);
});

test('1,000 seeded table/factoring cases preserve every input and deterministic table bytes', () => {
  let seed = 20260905;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let i = 0; i < 1000; i++) {
    const ids = Array.from({ length: random() % 12 }, () =>
      digest(random() % 100)
    );
    const digests = VqfDigestTable.decode(VqfDigestTable.build(ids).encode());
    for (const id of ids)
      assert.equal(digests.digestAt(digests.ordinalOf(id)), id);
    const strings = ids.map((id) => `東京-${id.slice(-2)}`);
    const dictionary = VqfStringTable.build([...strings, ...strings]);
    assert.deepEqual(
      dictionary.encode(),
      VqfStringTable.build([...strings, ...strings].reverse()).encode()
    );
    const decoded = VqfStringTable.decode(dictionary.encode());
    for (const value of strings)
      assert.equal(decoded.decodeValue(dictionary.encodeValue(value)), value);
    const bytes = strings.map((s) => Buffer.from(s));
    const store = VqfByteStore.build(bytes, {
      candidateHash: () => 'collision',
    });
    for (let j = 0; j < bytes.length; j++)
      assert.deepEqual(Buffer.from(store.blobAt(store.ordinals[j])), bytes[j]);
  }
});
