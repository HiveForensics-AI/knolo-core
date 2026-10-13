import {
  canonicalCbor,
  digestDomain,
  type CborValue,
  type Digest,
} from '../knowledge_image_v5.js';
import { sha256Hex } from '../utils/sha256.js';
import {
  COMPOSITION_MAX_ALIAS_LENGTH,
  COMPOSITION_MAX_PATH_LENGTH,
} from './constants.js';
import { CompositionError, type CompositionCode } from './errors.js';

const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/;

export function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function requireDigest(value: unknown, path: string, code: CompositionCode = 'COMPOSITION_INVALID'): Digest {
  if (!isDigest(value)) throw new CompositionError(code, `${path} must be a sha256 digest.`, path);
  return value;
}

export function fileSha256(bytes: Uint8Array): Digest {
  return `sha256-${sha256Hex(bytes)}`;
}

export function rooted(domain: string, body: CborValue): Digest {
  return digestDomain(domain, canonicalCbor(body));
}

export function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, code: CompositionCode = 'COMPOSITION_INVALID'): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new CompositionError(code, `${path} has unexpected field ${key}.`, path);
  }
}

export function validToken(value: unknown, max = COMPOSITION_MAX_ALIAS_LENGTH): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return false;
  if (/\s/u.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function requireToken(value: unknown, path: string, reserved?: string): string {
  if (!validToken(value) || value === reserved) {
    throw new CompositionError('COMPOSITION_INVALID', `${path} must be a token of 1–${COMPOSITION_MAX_ALIAS_LENGTH} characters.`, path);
  }
  return value;
}

export function validRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > COMPOSITION_MAX_PATH_LENGTH) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function asBytes(value: unknown, path: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new CompositionError('COMPOSITION_INVALID', `${path} must be bytes.`, path);
}

export function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return btoa(text);
}

export function decodeBase64(value: unknown, path: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || /\s/u.test(value)) {
    throw new CompositionError('ATTESTATION_INVALID', `${path} must be base64.`, path);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new CompositionError('ATTESTATION_INVALID', `${path} must be base64.`, path);
  }
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
