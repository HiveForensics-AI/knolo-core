import { normalize } from '../tokenize.js';
import { normalizeMemoryLabel, validateMemoryLabels } from './label.js';

export type MemoryKind = string;

export type MemoryLinkV1 = {
  version: 1;
  id: string;
  from: string;
  to: string;
  relation: string;
  ts: number;
  actor: string;
  confidence?: number;
};

export type MemoryEngramV1 = {
  version: 1;
  id: string;
  kind: MemoryKind;
  text: string;
  labels: string[];
  namespace?: string;
  source?: string;
  importance?: number;
  confidence?: number;
  ts: number;
  actor: string;
  links: MemoryLinkV1[];
};

export type MemoryInputV1 = {
  kind: MemoryKind;
  text: string;
  labels?: string | readonly string[];
  namespace?: string;
  source?: string;
  importance?: number;
  confidence?: number;
  ts?: number;
  actor?: string;
};

export type MemoryProvenanceV1 = {
  ts?: number;
  actor?: string;
};

export function createMemoryId(
  input: Pick<MemoryEngramV1, 'kind' | 'text' | 'ts' | 'actor'>
): string {
  const payload = [
    normalizeMemoryKind(input.kind),
    normalizeMemoryTextForId(input.text),
    normalizeMemoryTimestamp(input.ts),
    normalizeMemoryActor(input.actor),
  ].join('\u0001');
  return `mem_${hash64Hex(payload)}`;
}

export function normalizeMemoryInput(
  input: MemoryInputV1,
  provenance: MemoryProvenanceV1 = {}
): MemoryEngramV1 {
  const kind = normalizeMemoryKind(input.kind);
  if (!kind) {
    throw new Error('Memory kind must be a non-empty string.');
  }

  const text = normalizeMemoryText(input.text);
  if (!text) {
    throw new Error('Memory text must be a non-empty string.');
  }

  const ts = normalizeMemoryTimestamp(input.ts ?? provenance.ts ?? 0);
  const actor = normalizeMemoryActor(input.actor ?? provenance.actor ?? 'cortex');
  const labels = validateMemoryLabels(input.labels);
  const namespace = normalizeMemoryNamespace(input.namespace);
  const source = normalizeMemorySource(input.source);
  const importance = normalizeMemoryRatio(input.importance, 'importance');
  const confidence = normalizeMemoryRatio(input.confidence, 'confidence');

  return {
    version: 1,
    id: createMemoryId({ kind, text, ts, actor }),
    kind,
    text,
    labels,
    namespace,
    source,
    importance,
    confidence,
    ts,
    actor,
    links: [],
  };
}

export function normalizeMemoryKind(kind: string): string {
  return normalize(String(kind ?? '')).replace(/\s+/g, ' ').trim();
}

export function normalizeMemoryText(text: string): string {
  return String(text ?? '').trim();
}

export function normalizeMemoryNamespace(namespace?: string): string | undefined {
  const normalized = normalizeMemoryLabel(namespace ?? '');
  return normalized || undefined;
}

export function normalizeMemorySource(source?: string): string | undefined {
  const normalized = normalize(String(source ?? '')).replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

export function normalizeMemoryActor(actor: string): string {
  return String(actor ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeMemoryTimestamp(ts: number): number {
  const value = Number(ts);
  if (!Number.isFinite(value)) {
    throw new Error('Memory timestamp must be a finite number.');
  }
  return value;
}

function normalizeMemoryRatio(value: number | undefined, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`Memory ${name} must be a finite number.`);
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeMemoryTextForId(text: string): string {
  return normalize(String(text ?? '')).replace(/\s+/g, ' ').trim();
}

function hash64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const char of input) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
