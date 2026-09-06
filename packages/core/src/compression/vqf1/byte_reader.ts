import { readUVarint, u64ToNumber } from './varint.js';

/** Existing V5 physical segment ceiling; this is not a logical decode budget. */
export const MAX_VQF_BUFFER_BYTES = 512 * 1024 * 1024;

export function checkBufferLimit(maxBytes: number): void {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > MAX_VQF_BUFFER_BYTES
  ) {
    throw new RangeError('Invalid VQF byte buffer limit.');
  }
}

/**
 * Bounded sequential reader. Input is borrowed and must remain unchanged while
 * reading. Returned byte ranges are copies. Failed reads never move the cursor.
 */
export class VqfByteReader {
  private cursor = 0;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    maxBytes = MAX_VQF_BUFFER_BYTES
  ) {
    checkBufferLimit(maxBytes);
    if (bytes.length > maxBytes) {
      throw new RangeError('VQF input exceeds the byte buffer limit.');
    }
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.bytes.length - this.cursor;
  }

  private require(length: number): void {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > this.remaining
    ) {
      throw new RangeError('Invalid or truncated VQF byte range.');
    }
  }

  readByte(): number {
    this.require(1);
    return this.bytes[this.cursor++];
  }

  readBytes(length: number): Uint8Array {
    this.require(length);
    const result = Uint8Array.from(
      this.bytes.subarray(this.cursor, this.cursor + length)
    );
    this.cursor += length;
    return result;
  }

  readUint16LE(): number {
    this.require(2);
    const value = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return value;
  }

  readUint32LE(): number {
    this.require(4);
    const value = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  readUint64LE(): bigint {
    this.require(8);
    const value = this.view.getBigUint64(this.cursor, true);
    this.cursor += 8;
    return value;
  }

  readUVarint(): bigint {
    const result = readUVarint(this.bytes, this.cursor);
    this.cursor = result.nextOffset;
    return result.value;
  }

  readUVarintNumber(maximum = Number.MAX_SAFE_INTEGER): number {
    const result = readUVarint(this.bytes, this.cursor);
    const value = u64ToNumber(result.value, maximum);
    this.cursor = result.nextOffset;
    return value;
  }

  assertFinished(): void {
    if (this.remaining !== 0) throw new Error('Trailing VQF bytes.');
  }
}
