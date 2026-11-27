import { sha256Hex } from './utils/sha256.js';
import { getTextDecoder, getTextEncoder } from './utils/utf8.js';

const SHA256_PREFIX = 'sha256-';

export type Digest = string;

type CborPrimitive = null | boolean | number | bigint | string | Uint8Array;
export type CborValue =
  CborPrimitive | CborValue[] | { [key: string]: CborValue };

export function canonicalCbor(value: CborValue): Uint8Array {
  const out: number[] = [];
  encodeCbor(value, out);
  return Uint8Array.from(out);
}

export function digestDomain(domain: string, payload: Uint8Array): Digest {
  return `${SHA256_PREFIX}${sha256Hex(concat(getTextEncoder().encode(`knolo:${domain}:v1\0`), payload))}`;
}

export function digestBytes(digest: Digest): Uint8Array {
  if (
    !digest.startsWith(SHA256_PREFIX) ||
    digest.length !== SHA256_PREFIX.length + 64
  ) {
    throw new Error(`Invalid digest: ${digest}`);
  }
  const hex = digest.slice(SHA256_PREFIX.length);
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(byte)) throw new Error(`Invalid digest: ${digest}`);
    out[i] = byte;
  }
  return out;
}

function encodeCbor(value: CborValue, out: number[]): void {
  if (value === null) {
    out.push(0xf6);
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 0xf5 : 0xf4);
    return;
  }
  if (typeof value === 'string') {
    const bytes = getTextEncoder().encode(value);
    encodeLength(3, bytes.length, out);
    appendBytes(out, bytes);
    return;
  }
  if (value instanceof Uint8Array) {
    encodeLength(2, value.length, out);
    appendBytes(out, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new Error('V5 CBOR numbers must be safe integers.');
    const n = typeof value === 'number' ? BigInt(value) : value;
    if (n >= 0n) encodeLength(0, n, out);
    else encodeLength(1, -1n - n, out);
    return;
  }
  if (Array.isArray(value)) {
    encodeLength(4, value.length, out);
    for (const item of value) encodeCbor(item, out);
    return;
  }
  const entries = Object.entries(value).sort(([a], [b]) => compareUtf8(a, b));
  encodeLength(5, entries.length, out);
  for (const [key, item] of entries) {
    encodeCbor(key, out);
    encodeCbor(item, out);
  }
}

// Spreading into push() passes one argument per byte and overflows the call
// stack for large payloads.
function appendBytes(out: number[], bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
}

function encodeLength(
  major: number,
  length: number | bigint,
  out: number[]
): void {
  const n = BigInt(length);
  if (n < 24n) {
    out.push((major << 5) | Number(n));
  } else if (n <= 0xffn) {
    out.push((major << 5) | 24, Number(n));
  } else if (n <= 0xffffn) {
    out.push((major << 5) | 25, Number(n >> 8n), Number(n & 0xffn));
  } else if (n <= 0xffffffffn) {
    out.push(
      (major << 5) | 26,
      Number((n >> 24n) & 0xffn),
      Number((n >> 16n) & 0xffn),
      Number((n >> 8n) & 0xffn),
      Number(n & 0xffn)
    );
  } else {
    out.push((major << 5) | 27);
    for (let shift = 56n; shift >= 0n; shift -= 8n)
      out.push(Number((n >> shift) & 0xffn));
  }
}
export function compareUtf8(a: string, b: string): number {
  const aa = getTextEncoder().encode(a),
    bb = getTextEncoder().encode(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++)
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}

export function decodeCanonicalCbor(bytes: Uint8Array): CborValue {
  const reader = new CborReader(bytes);
  const value = reader.read();
  if (!reader.done) throw new Error('Trailing bytes in V5 CBOR payload.');
  if (!bytesEqual(canonicalCbor(value), bytes))
    throw new Error('Non-canonical V5 CBOR payload.');
  return value;
}
export function decodeCbor(bytes: Uint8Array): CborValue {
  return decodeCanonicalCbor(bytes);
}
class CborReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done(): boolean {
    return this.offset === this.bytes.length;
  }
  read(): CborValue {
    const initial = this.readByte();
    const major = initial >> 5;
    const ai = initial & 31;
    if (major === 0) return this.readLength(ai);
    if (major === 1) return -1n - this.readLength(ai);
    if (major === 2) return this.readBytes(this.readLength(ai));
    if (major === 3)
      return getTextDecoder().decode(this.readBytes(this.readLength(ai)));
    if (major === 4) {
      const length = this.readCollectionLength(ai, 1);
      const out: CborValue[] = [];
      for (let i = 0; i < length; i++) out.push(this.read());
      return out;
    }
    if (major === 5) {
      const length = this.readCollectionLength(ai, 2);
      const out: Record<string, CborValue> = {};
      for (let i = 0; i < length; i++) {
        const key = this.read();
        if (typeof key !== 'string')
          throw new Error('V5 CBOR map key must be text.');
        if (Object.prototype.hasOwnProperty.call(out, key))
          throw new Error('Duplicate V5 CBOR map key.');
        Object.defineProperty(out, key, {
          value: this.read(),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    if (major === 7 && ai === 20) return false;
    if (major === 7 && ai === 21) return true;
    if (major === 7 && ai === 22) return null;
    throw new Error('Unsupported V5 CBOR value.');
  }
  private readCollectionLength(
    ai: number,
    minimumBytesPerEntry: number
  ): number {
    const length = this.readLength(ai);
    if (
      length >
      BigInt(
        Math.floor((this.bytes.length - this.offset) / minimumBytesPerEntry)
      )
    )
      throw new Error('Truncated V5 CBOR collection.');
    return Number(length);
  }
  private readByte(): number {
    if (this.offset >= this.bytes.length)
      throw new Error('Truncated V5 CBOR value.');
    return this.bytes[this.offset++];
  }
  private readLength(ai: number): bigint {
    if (ai < 24) return BigInt(ai);
    if (ai === 24) return BigInt(this.readByte());
    if (ai === 25) return BigInt(this.readByte() * 256 + this.readByte());
    if (ai === 26)
      return BigInt(
        this.readByte() * 0x1000000 +
          this.readByte() * 0x10000 +
          this.readByte() * 0x100 +
          this.readByte()
      );
    if (ai === 27) {
      let value = 0n;
      for (let i = 0; i < 8; i++)
        value = (value << 8n) | BigInt(this.readByte());
      return value;
    }
    throw new Error('Indefinite-length V5 CBOR is not allowed.');
  }
  private readBytes(length: bigint): Uint8Array {
    if (length > BigInt(this.bytes.length - this.offset))
      throw new Error('Truncated V5 CBOR byte string.');
    const n = Number(length);
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

export function bytesToDigest(bytes: Uint8Array): Digest {
  return `${SHA256_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
