import { VqfByteReader } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import {
  checkOrdinal,
  compareBytes,
  decodeString,
  encodeString,
  tableLimits,
  varintSize,
  type VqfTableLimits,
} from './table_utils.js';

/** Prototype table: count, then (UTF-8 byte length, bytes). Value tags: 0 inline, 1 ordinal. */
export class VqfStringTable {
  private readonly ordinals: Map<string, number>;
  private constructor(
    private readonly values: string[],
    private readonly encoded: Uint8Array[],
    private readonly maxBytes: number
  ) {
    this.ordinals = new Map(values.map((value, i) => [value, i]));
  }

  get count(): number {
    return this.values.length;
  }
  get strings(): string[] {
    return [...this.values];
  }

  static build(
    input: Iterable<string>,
    options: VqfTableLimits = {}
  ): VqfStringTable {
    const limits = tableLimits(options);
    const candidates = new Map<
      string,
      { value: string; bytes: Uint8Array; count: number }
    >();
    let count = 0,
      total = 0;
    for (const value of input) {
      if (++count > limits.maxEntries)
        throw new RangeError('VQF string input exceeds the entry limit.');
      const bytes = encodeString(value, limits.maxBytes - total);
      total += bytes.length;
      const existing = candidates.get(value);
      if (existing) existing.count++;
      else candidates.set(value, { value, bytes, count: 1 });
    }
    const values: string[] = [],
      encoded: Uint8Array[] = [];
    let tableBytes = 1;
    for (const entry of [...candidates.values()].sort((a, b) =>
      compareBytes(a.bytes, b.bytes)
    )) {
      const payloadCost = varintSize(entry.bytes.length) + entry.bytes.length;
      const countGrowth =
        varintSize(values.length + 1) - varintSize(values.length);
      const gain =
        entry.count * (1 + payloadCost - (1 + varintSize(values.length))) -
        payloadCost -
        countGrowth;
      if (gain <= 0) continue;
      tableBytes += payloadCost + countGrowth;
      if (tableBytes > limits.maxBytes)
        throw new RangeError('VQF string table exceeds the byte limit.');
      values.push(entry.value);
      encoded.push(entry.bytes);
    }
    if (tableBytes > limits.maxBytes)
      throw new RangeError('VQF string table exceeds the byte limit.');
    return new VqfStringTable(values, encoded, limits.maxBytes);
  }

  static decode(
    bytes: Uint8Array,
    options: VqfTableLimits = {}
  ): VqfStringTable {
    const limits = tableLimits(options);
    const reader = new VqfByteReader(bytes, limits.maxBytes);
    const count = reader.readUVarintNumber(limits.maxEntries);
    if (count > reader.remaining)
      throw new Error('Truncated VQF string table.');
    const values: string[] = [],
      encoded: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const length = reader.readUVarintNumber(reader.remaining);
      const raw = reader.readBytes(length);
      if (i > 0 && compareBytes(encoded[i - 1], raw) >= 0)
        throw new Error('VQF string table is not strictly sorted.');
      values.push(decodeString(raw));
      encoded.push(raw);
    }
    reader.assertFinished();
    return new VqfStringTable(values, encoded, limits.maxBytes);
  }

  encode(): Uint8Array {
    const writer = new VqfByteWriter(this.maxBytes);
    writer.writeUVarint(this.count);
    for (const bytes of this.encoded) {
      writer.writeUVarint(bytes.length);
      writer.writeBytes(bytes);
    }
    return writer.finish();
  }

  stringAt(ordinal: number): string {
    checkOrdinal(ordinal, this.count);
    return this.values[ordinal];
  }
  ordinalOf(value: string): number | undefined {
    return this.ordinals.get(value);
  }

  encodeValue(value: string): Uint8Array {
    const writer = new VqfByteWriter(this.maxBytes);
    this.writeValue(value, writer);
    return writer.finish();
  }

  writeValue(value: string, writer: VqfByteWriter): void {
    const ordinal = this.ordinalOf(value);
    const bytes = encodeString(value, this.maxBytes);
    if (
      ordinal !== undefined &&
      1 + varintSize(ordinal) < 1 + varintSize(bytes.length) + bytes.length
    ) {
      writer.writeByte(1);
      writer.writeUVarint(ordinal);
    } else {
      writer.writeByte(0);
      writer.writeUVarint(bytes.length);
      writer.writeBytes(bytes);
    }
  }

  decodeValue(bytes: Uint8Array): string {
    const reader = new VqfByteReader(bytes, this.maxBytes);
    const value = this.readValue(reader);
    reader.assertFinished();
    return value;
  }

  readValue(reader: VqfByteReader): string {
    const tag = reader.readByte();
    let value: string;
    if (tag === 0)
      value = decodeString(
        reader.readBytes(reader.readUVarintNumber(reader.remaining))
      );
    else if (tag === 1) value = this.stringAt(reader.readUVarintNumber());
    else throw new Error('Unknown VQF string tag.');
    const ordinal = this.ordinalOf(value);
    const raw = encodeString(value, this.maxBytes);
    const shouldReference =
      ordinal !== undefined &&
      1 + varintSize(ordinal) < 1 + varintSize(raw.length) + raw.length;
    if ((tag === 1) !== shouldReference)
      throw new Error('Non-canonical VQF string reference.');
    return value;
  }
}
