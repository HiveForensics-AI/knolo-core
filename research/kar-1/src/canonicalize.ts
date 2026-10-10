import { createHash } from 'node:crypto';

/** Research JSON digest. Not a V5 domain encoding. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function digest(value: unknown): string {
  return `sha256-${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}
