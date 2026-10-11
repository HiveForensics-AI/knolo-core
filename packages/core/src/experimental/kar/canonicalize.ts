import { sha256Hex } from '../../utils/sha256.js';
import { getTextEncoder } from '../../utils/utf8.js';

/**
 * Research JSON canonical form.
 * Object keys sort by UTF-16 code units. Arrays keep their order.
 * Solidus is not escaped. U+2028 and U+2029 follow JSON.stringify.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Frozen research digest. Not a V5 domain encoding. */
export function digest(value: unknown): string {
  return `sha256-${sha256Hex(getTextEncoder().encode(canonicalize(value)))}`;
}
