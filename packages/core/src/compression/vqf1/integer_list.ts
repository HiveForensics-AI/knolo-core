import type { VqfByteReader } from './byte_reader.js';
import type { VqfByteWriter } from './byte_writer.js';

/**
 * Strictly increasing unsigned integers: first value plus one, then positive
 * deltas, with an explicit count. Bounds are checked before arithmetic.
 */
export function writeIncreasingUIntList(
  values: number[],
  writer: VqfByteWriter
): void {
  if (!Array.isArray(values)) throw new Error('Expected VQF integer list.');
  writer.writeUVarint(values.length);
  let previous = -1;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Invalid VQF integer list value.');
    }
    if (i === 0) {
      if (value === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('VQF integer list first value overflows.');
      }
      writer.writeUVarint(value + 1);
    } else {
      if (value <= previous) {
        throw new Error('VQF integer list is not strictly increasing.');
      }
      writer.writeUVarint(value - previous);
    }
    previous = value;
  }
}

export function readIncreasingUIntList(
  reader: VqfByteReader,
  options: { maxCount: number; maxValue: number }
): number[] {
  const maxCount = options.maxCount;
  const maxValue = options.maxValue;
  if (!Number.isSafeInteger(maxCount) || maxCount < 0) {
    throw new RangeError('Invalid VQF integer list count limit.');
  }
  if (!Number.isSafeInteger(maxValue) || maxValue < 0) {
    throw new RangeError('Invalid VQF integer list value limit.');
  }
  const count = reader.readUVarintNumber(maxCount);
  if (count > reader.remaining) throw new Error('Truncated VQF integer list.');
  const values: number[] = [];
  let previous = -1;
  for (let i = 0; i < count; i++) {
    const delta = reader.readUVarintNumber();
    if (delta < 1) throw new Error('Invalid VQF integer list delta.');
    let value: number;
    if (i === 0) value = delta - 1;
    else {
      if (previous > Number.MAX_SAFE_INTEGER - delta) {
        throw new RangeError('VQF integer list value overflows.');
      }
      value = previous + delta;
    }
    if (value > maxValue) {
      throw new RangeError('VQF integer list value exceeds its limit.');
    }
    values.push(value);
    previous = value;
  }
  return values;
}
