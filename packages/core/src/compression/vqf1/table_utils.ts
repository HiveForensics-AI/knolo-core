import { checkBufferLimit } from './byte_reader.js';
import { getTextDecoder, getTextEncoder } from '../../utils/utf8.js';

export type VqfTableLimits = { maxEntries?: number; maxBytes?: number };

export function tableLimits(
  options: VqfTableLimits = {}
): Required<VqfTableLimits> {
  const maxEntries = options.maxEntries ?? 1_000_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  checkBufferLimit(maxBytes);
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 0 ||
    maxEntries > 1_000_000
  ) {
    throw new RangeError('Invalid VQF table entry limit.');
  }
  return { maxEntries, maxBytes };
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function varintSize(value: number): number {
  let size = 1;
  while (value >= 128) {
    value = Math.floor(value / 128);
    size++;
  }
  return size;
}

export function checkOrdinal(ordinal: number, count: number): void {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= count) {
    throw new RangeError('Invalid VQF table ordinal.');
  }
}

/** Validate scalars and count bytes before allocating; never replace surrogates. */
export function encodeString(value: string, maxBytes: number): Uint8Array {
  if (typeof value !== 'string') throw new Error('Expected VQF string.');
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    const cp = value.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error('Invalid VQF Unicode scalar.');
      length += 4;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      throw new Error('Invalid VQF Unicode scalar.');
    } else length += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
    if (length > maxBytes)
      throw new RangeError('VQF strings exceed the byte limit.');
  }
  return getTextEncoder().encode(value);
}

export function decodeString(bytes: Uint8Array): string {
  // A prefix prevents native decoders from stripping an initial UTF-8 BOM.
  const prefixed = new Uint8Array(bytes.length + 1);
  prefixed[0] = 0x61;
  prefixed.set(bytes, 1);
  const value = getTextDecoder().decode(prefixed).slice(1);
  if (compareBytes(encodeString(value, bytes.length), bytes) !== 0) {
    throw new Error('Invalid VQF UTF-8 encoding.');
  }
  return value;
}
