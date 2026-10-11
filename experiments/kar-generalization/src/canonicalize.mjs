import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Research-only digest. This does not modify V5 state roots. */
export function semanticArtifactRoot(artifact) {
  const canonical = canonicalize(artifact);
  const root = `sha256-${createHash('sha256').update(canonical).digest('hex')}`;
  return { root, canonical };
}

export function sha256Text(text) {
  return `sha256-${createHash('sha256').update(text).digest('hex')}`;
}
