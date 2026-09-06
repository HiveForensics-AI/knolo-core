/** Internal VQF-1 unsigned integer primitives; no container integration yet. */
export const MAX_U64 = (1n << 64n) - 1n;

export function asU64(value: number | bigint): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('VQF integer must be an unsigned safe integer.');
    }
    value = BigInt(value);
  }
  if (typeof value !== 'bigint' || value < 0n || value > MAX_U64) {
    throw new RangeError('VQF integer exceeds the unsigned 64-bit range.');
  }
  return value;
}

/** Appends a shortest-form unsigned LEB128; invalid values leave output intact. */
export function writeUVarint(value: number | bigint, output: number[]): void {
  let remaining = asU64(value);
  do {
    const byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    output.push(remaining === 0n ? byte : byte | 0x80);
  } while (remaining !== 0n);
}

/** Reads at most ten bytes and rejects overflow and alternate representations. */
export function readUVarint(
  bytes: Uint8Array,
  offset: number
): { value: bigint; nextOffset: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length) {
    throw new RangeError('Invalid VQF varint offset.');
  }
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    if (offset + i >= bytes.length) throw new Error('Truncated VQF varint.');
    const byte = bytes[offset + i];
    if (i === 9 && byte > 1) {
      throw new RangeError('VQF varint exceeds the unsigned 64-bit range.');
    }
    value |= BigInt(byte & 0x7f) << BigInt(7 * i);
    if ((byte & 0x80) === 0) {
      if (i > 0 && byte === 0) throw new Error('Non-canonical VQF varint.');
      return { value, nextOffset: offset + i + 1 };
    }
  }
  // The tenth-byte check above rejects every continuing ten-byte encoding.
  throw new RangeError('VQF varint exceeds the unsigned 64-bit range.');
}

export function u64ToNumber(
  value: bigint,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError('Invalid VQF numeric bound.');
  }
  if (value < 0n || value > BigInt(maximum)) {
    throw new RangeError('VQF integer exceeds the numeric bound.');
  }
  return Number(value);
}
