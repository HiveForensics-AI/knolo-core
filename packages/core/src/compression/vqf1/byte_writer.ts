import { asU64, writeUVarint } from './varint.js';
import { checkBufferLimit, MAX_VQF_BUFFER_BYTES } from './byte_reader.js';

/** Bounded growable output; values and capacity are checked before mutation. */
export class VqfByteWriter {
  private bytes: Uint8Array;
  private cursor = 0;

  constructor(private readonly maxBytes = MAX_VQF_BUFFER_BYTES) {
    checkBufferLimit(maxBytes);
    this.bytes = new Uint8Array(Math.min(64, maxBytes));
  }

  get length(): number {
    return this.cursor;
  }

  private reserve(length: number): void {
    if (length > this.maxBytes - this.cursor) {
      throw new RangeError('VQF output exceeds the byte buffer limit.');
    }
    const required = this.cursor + length;
    if (required <= this.bytes.length) return;
    const next = new Uint8Array(
      Math.min(this.maxBytes, Math.max(required, this.bytes.length * 2))
    );
    next.set(this.bytes);
    this.bytes = next;
  }

  private checkInteger(value: number, maximum: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new RangeError('Invalid VQF fixed-width unsigned integer.');
    }
  }

  writeByte(value: number): void {
    this.checkInteger(value, 0xff);
    this.reserve(1);
    this.bytes[this.cursor++] = value;
  }

  writeBytes(bytes: Uint8Array): void {
    this.reserve(bytes.length);
    this.bytes.set(bytes, this.cursor);
    this.cursor += bytes.length;
  }

  writeUint16LE(value: number): void {
    this.checkInteger(value, 0xffff);
    this.reserve(2);
    new DataView(this.bytes.buffer).setUint16(this.cursor, value, true);
    this.cursor += 2;
  }

  writeUint32LE(value: number): void {
    this.checkInteger(value, 0xffffffff);
    this.reserve(4);
    new DataView(this.bytes.buffer).setUint32(this.cursor, value, true);
    this.cursor += 4;
  }

  writeUint64LE(value: number | bigint): void {
    const integer = asU64(value);
    this.reserve(8);
    new DataView(this.bytes.buffer).setBigUint64(this.cursor, integer, true);
    this.cursor += 8;
  }

  writeUVarint(value: number | bigint): void {
    const bytes: number[] = [];
    writeUVarint(value, bytes);
    this.reserve(bytes.length);
    this.bytes.set(bytes, this.cursor);
    this.cursor += bytes.length;
  }

  /** Returns an independent snapshot; subsequent writes cannot change it. */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.cursor);
  }
}
