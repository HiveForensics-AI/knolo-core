import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VqfByteReader,
  MAX_VQF_BUFFER_BYTES,
} from '../dist/compression/vqf1/byte_reader.js';
import { VqfByteWriter } from '../dist/compression/vqf1/byte_writer.js';

test('VQF byte I/O preserves little-endian values, unaligned views and UTF-8 bytes', () => {
  const writer = new VqfByteWriter(64);
  writer.writeByte(0x42);
  writer.writeUint16LE(0x1234);
  writer.writeUint32LE(0x89abcdef);
  writer.writeUint64LE(0x0123456789abcdefn);
  writer.writeUVarint(300);
  const text = new TextEncoder().encode('café 東京');
  writer.writeBytes(text);
  const bytes = writer.finish();
  assert.equal(
    Buffer.from(bytes.subarray(0, 17)).toString('hex'),
    '423412efcdab89efcdab8967452301ac02'
  );
  const framed = Uint8Array.of(0xff, ...bytes, 0xff);
  const reader = new VqfByteReader(framed.subarray(1, -1));
  assert.equal(reader.readByte(), 0x42);
  assert.equal(reader.readUint16LE(), 0x1234);
  assert.equal(reader.readUint32LE(), 0x89abcdef);
  assert.equal(reader.readUint64LE(), 0x0123456789abcdefn);
  assert.equal(reader.readUVarint(), 300n);
  assert.deepEqual(reader.readBytes(text.length), text);
  assert.equal(reader.offset, writer.length);
  assert.equal(reader.remaining, 0);
  reader.assertFinished();
});

test('VQF reader rejects unsafe ranges and numeric conversions without advancing', () => {
  const reader = new VqfByteReader(Uint8Array.of(0xff, 0x01));
  for (const length of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 3]) {
    assert.throws(() => reader.readBytes(length), /range/);
    assert.equal(reader.offset, 0);
  }
  assert.throws(() => reader.readUint32LE(), /range/);
  assert.throws(() => reader.readUint64LE(), /range/);
  assert.throws(() => reader.assertFinished(), /Trailing/);
  assert.throws(() => reader.readUVarintNumber(254), /bound/);
  assert.equal(reader.offset, 0);
  assert.equal(reader.readUVarintNumber(255), 255);
  assert.throws(() => reader.readByte(), /range/);
  assert.equal(reader.offset, 2);
  for (const bytes of [Uint8Array.of(0x80), Uint8Array.of(0x80, 0)]) {
    const malformed = new VqfByteReader(bytes);
    assert.throws(() => malformed.readUVarint());
    assert.equal(malformed.offset, 0);
  }
  const writer = new VqfByteWriter();
  writer.writeUVarint(1n << 53n);
  const unsafe = new VqfByteReader(writer.finish());
  assert.throws(() => unsafe.readUVarintNumber(), /bound/);
  assert.equal(unsafe.offset, 0);
  assert.equal(unsafe.readUVarint(), 1n << 53n);
});

test('VQF output limit and invalid writes are atomic, including varint expansion', () => {
  const writer = new VqfByteWriter(3);
  writer.writeByte(42);
  for (const write of [
    () => writer.writeBytes(Uint8Array.of(1, 2, 3)),
    () => writer.writeUint32LE(1),
    () => writer.writeUint64LE(1n),
    () => writer.writeUVarint(16384),
    () => writer.writeByte(256),
    () => writer.writeUint16LE(65536),
    () => writer.writeUint32LE(2 ** 32),
    () => writer.writeUint64LE(1n << 64n),
    () => writer.writeUVarint(-1),
  ]) {
    assert.throws(write, RangeError);
    assert.equal(writer.length, 1);
    assert.deepEqual(writer.finish(), Uint8Array.of(42));
  }
  writer.writeUVarint(128);
  assert.deepEqual(writer.finish(), Uint8Array.of(42, 0x80, 1));
  assert.throws(() => writer.writeByte(0), /limit/);
});

test('VQF buffers enforce limits before allocation and return independent copies', () => {
  for (const limit of [-1, 0.5, NaN, Infinity, MAX_VQF_BUFFER_BYTES + 1]) {
    assert.throws(() => new VqfByteWriter(limit), /limit/);
    assert.throws(() => new VqfByteReader(new Uint8Array(), limit), /limit/);
  }
  assert.throws(() => new VqfByteReader(Uint8Array.of(1), 0), /limit/);
  new VqfByteReader(new Uint8Array(), 0).assertFinished();
  const empty = new VqfByteWriter(0);
  empty.writeBytes(new Uint8Array());
  assert.equal(empty.finish().length, 0);
  assert.throws(() => empty.writeByte(0), /limit/);
  const writer = new VqfByteWriter(200);
  const input = Uint8Array.from({ length: 100 }, (_, i) => i);
  writer.writeBytes(input);
  input[0] = 255;
  const snapshot = writer.finish();
  writer.writeBytes(Uint8Array.of(100));
  snapshot[1] = 255;
  assert.equal(writer.finish()[0], 0);
  assert.equal(writer.finish()[1], 1);
  assert.equal(writer.finish()[100], 100);
  // Buffer.slice is a view; readBytes must still copy Node Buffer inputs.
  const source = Buffer.from([1, 2]);
  const reader = new VqfByteReader(source);
  const copy = reader.readBytes(2);
  copy[0] = 255;
  assert.equal(source[0], 1);
});
