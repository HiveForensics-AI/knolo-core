import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_U64,
  readUVarint,
  writeUVarint,
  u64ToNumber,
} from '../dist/compression/vqf1/varint.js';

const encode = (value) => {
  const output = [];
  writeUVarint(value, output);
  return Uint8Array.from(output);
};

test('VQF varints match canonical boundary vectors and preserve surrounding bytes', () => {
  const vectors = [
    [0n, '00'],
    [1n, '01'],
    [2n, '02'],
    [126n, '7e'],
    [127n, '7f'],
    [128n, '8001'],
    [129n, '8101'],
    [255n, 'ff01'],
    [256n, '8002'],
    [300n, 'ac02'],
    [16383n, 'ff7f'],
    [16384n, '808001'],
    [0xffffffffn, 'ffffffff0f'],
    [BigInt(Number.MAX_SAFE_INTEGER), 'ffffffffffffff0f'],
    [1n << 63n, '80808080808080808001'],
    [MAX_U64, 'ffffffffffffffffff01'],
  ];
  for (const [value, hex] of vectors) {
    const bytes = encode(value);
    assert.equal(Buffer.from(bytes).toString('hex'), hex);
    assert.deepEqual(readUVarint(bytes, 0), {
      value,
      nextOffset: bytes.length,
    });
    const framed = Uint8Array.of(42, ...bytes, 73);
    assert.deepEqual(readUVarint(framed, 1), {
      value,
      nextOffset: bytes.length + 1,
    });
    if (value <= BigInt(Number.MAX_SAFE_INTEGER))
      assert.deepEqual(encode(Number(value)), bytes);
  }
});

test('VQF rejects every truncated prefix, nonminimal encodings, overflow and invalid offsets', () => {
  for (const value of [128n, 16384n, 1n << 32n, MAX_U64]) {
    const bytes = encode(value);
    for (let length = 0; length < bytes.length; length++) {
      assert.throws(
        () => readUVarint(bytes.subarray(0, length), 0),
        /Truncated/
      );
    }
  }
  for (const bytes of [
    [0x80, 0],
    [0x81, 0],
    [0xff, 0],
    [...Array(9).fill(0x80), 0],
  ]) {
    assert.throws(
      () => readUVarint(Uint8Array.from(bytes), 0),
      /Non-canonical/
    );
  }
  for (const finalByte of [2, 0x7f, 0x80, 0x81, 0xff]) {
    assert.throws(
      () => readUVarint(Uint8Array.of(...Array(9).fill(0xff), finalByte, 0), 0),
      /64-bit/
    );
  }
  for (const offset of [
    -1,
    0.5,
    NaN,
    Infinity,
    2,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => readUVarint(Uint8Array.of(1), offset), /offset/);
  }
  assert.throws(() => readUVarint(Uint8Array.of(1), 1), /Truncated/);
});

test('VQF numeric validation rejects unsafe inputs before touching output', () => {
  for (const value of [
    -1,
    -1n,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    MAX_U64 + 1n,
    '1',
    null,
  ]) {
    const output = [42];
    assert.throws(() => writeUVarint(value, output), RangeError);
    assert.deepEqual(output, [42]);
  }
  assert.equal(
    u64ToNumber(BigInt(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER
  );
  assert.equal(u64ToNumber(0n, 0), 0);
  assert.throws(() => u64ToNumber(1n, 0), /bound/);
  assert.throws(() => u64ToNumber(-1n), /bound/);
  assert.throws(() => u64ToNumber(1n << 53n), /bound/);
  for (const bound of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => u64ToNumber(0n, bound), /bound/);
  }
});

test('VQF round-trips 1,000 seeded u64 values and rejects alternate encodings', () => {
  let seed = 20260905;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let i = 0; i < 1000; i++) {
    const value = (BigInt(random()) << 32n) | BigInt(random());
    const bytes = encode(value);
    assert.equal(
      bytes.length,
      Math.ceil(Math.max(1, value.toString(2).length) / 7)
    );
    assert.deepEqual(readUVarint(bytes, 0), {
      value,
      nextOffset: bytes.length,
    });
    assert.deepEqual(encode(value), bytes);
    const alternate = Uint8Array.of(...bytes, 0);
    alternate[bytes.length - 1] |= 0x80;
    assert.throws(() => readUVarint(alternate, 0), /Non-canonical|64-bit/);
  }
});
