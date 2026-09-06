import { VqfByteReader } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import {
  checkOrdinal,
  compareBytes,
  tableLimits,
  varintSize,
  type VqfTableLimits,
} from './table_utils.js';

function digestBytes(digest: string): Uint8Array {
  if (
    typeof digest !== 'string' ||
    digest.length !== 71 ||
    !/^sha256-[0-9a-f]{64}$/.test(digest)
  ) {
    throw new Error('Invalid canonical VQF SHA-256 digest.');
  }
  return Uint8Array.from({ length: 32 }, (_, i) =>
    Number.parseInt(digest.slice(7 + i * 2, 9 + i * 2), 16)
  );
}

export class VqfDigestTable {
  private constructor(private readonly raw: Uint8Array) {}

  get count(): number {
    return this.raw.length / 32;
  }
  get digests(): Uint8Array {
    return this.raw.slice();
  }

  static build(
    digests: Iterable<string>,
    options: VqfTableLimits = {}
  ): VqfDigestTable {
    const limits = tableLimits(options);
    const unique = new Map<string, Uint8Array>();
    let count = 0;
    for (const digest of digests) {
      if (++count > limits.maxEntries)
        throw new RangeError('VQF digest input exceeds the entry limit.');
      const bytes = digestBytes(digest);
      if (!unique.has(digest)) {
        const next = unique.size + 1;
        if (varintSize(next) + next * 32 > limits.maxBytes)
          throw new RangeError('VQF digest table exceeds the byte limit.');
        unique.set(digest, bytes);
      }
    }
    const values = [...unique.values()].sort(compareBytes);
    if (varintSize(values.length) + values.length * 32 > limits.maxBytes)
      throw new RangeError('VQF digest table exceeds the byte limit.');
    const raw = new Uint8Array(values.length * 32);
    values.forEach((value, i) => raw.set(value, i * 32));
    return new VqfDigestTable(raw);
  }

  static decode(
    bytes: Uint8Array,
    options: VqfTableLimits = {}
  ): VqfDigestTable {
    const limits = tableLimits(options);
    const reader = new VqfByteReader(bytes, limits.maxBytes);
    const count = reader.readUVarintNumber(limits.maxEntries);
    if (count * 32 !== reader.remaining)
      throw new Error('Invalid VQF digest table length.');
    const raw = reader.readBytes(count * 32);
    for (let i = 1; i < count; i++) {
      if (
        compareBytes(
          raw.subarray((i - 1) * 32, i * 32),
          raw.subarray(i * 32, (i + 1) * 32)
        ) >= 0
      ) {
        throw new Error('VQF digest table is not strictly sorted.');
      }
    }
    reader.assertFinished();
    return new VqfDigestTable(raw);
  }

  encode(): Uint8Array {
    const writer = new VqfByteWriter(varintSize(this.count) + this.raw.length);
    writer.writeUVarint(this.count);
    writer.writeBytes(this.raw);
    return writer.finish();
  }

  digestAt(ordinal: number): string {
    checkOrdinal(ordinal, this.count);
    return `sha256-${Array.from(this.raw.subarray(ordinal * 32, (ordinal + 1) * 32), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  ordinalOf(digest: string): number {
    const bytes = digestBytes(digest);
    let low = 0,
      high = this.count;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const order = compareBytes(
        this.raw.subarray(mid * 32, (mid + 1) * 32),
        bytes
      );
      if (order === 0) return mid;
      if (order < 0) low = mid + 1;
      else high = mid;
    }
    throw new Error('Digest is absent from VQF table.');
  }
}
