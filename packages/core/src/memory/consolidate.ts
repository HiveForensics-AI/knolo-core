import type { BuildInputDoc } from '../builder.js';
import type { CortexV1 } from './cortex.js';
import type { MemoryEngramV1 } from './engram.js';
import { matchesMemoryLabels, validateMemoryLabels } from './label.js';
import { normalizeMemoryLabel } from './label.js';
import { normalize } from '../tokenize.js';

export type ConsolidateMemoriesOptionsV1 = {
  namespacePrefix?: string;
  kind?: string | readonly string[];
  labels?: string | readonly string[];
  namespace?: string | readonly string[];
  minImportance?: number;
  minConfidence?: number;
  minAgeMs?: number;
  maxAgeMs?: number;
  now?: number;
};

export function consolidateMemories(
  cortexOrMemories: CortexV1 | readonly MemoryEngramV1[],
  opts: ConsolidateMemoriesOptionsV1 = {}
): BuildInputDoc[] {
  const memories = isCortex(cortexOrMemories)
    ? cortexOrMemories.memories
    : cortexOrMemories;
  const now = opts.now ?? (isCortex(cortexOrMemories) ? cortexOrMemories.now() : Date.now());
  const namespacePrefix = normalizeNamespacePrefix(opts.namespacePrefix);
  const kindFilters = normalizeKindFilters(opts.kind);
  const labelsFilter = validateMemoryLabels(opts.labels);
  const namespaceFilters = normalizeNamespaceFilters(opts.namespace);

  return memories
    .filter((memory) => {
      if (kindFilters.length > 0 && !kindFilters.includes(normalizeKind(memory.kind))) return false;
      if (labelsFilter.length > 0 && !matchesMemoryLabels(memory.labels, labelsFilter)) return false;
      if (namespaceFilters.length > 0 && !matchesNamespace(memory.namespace, namespaceFilters)) return false;
      if (opts.minImportance !== undefined && valueOrDefault(memory.importance, 0.5) < opts.minImportance) return false;
      if (opts.minConfidence !== undefined && valueOrDefault(memory.confidence, 0.5) < opts.minConfidence) return false;
      const ageMs = now - memory.ts;
      if (opts.minAgeMs !== undefined && ageMs < opts.minAgeMs) return false;
      if (opts.maxAgeMs !== undefined && ageMs > opts.maxAgeMs) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .map((memory) => ({
      id: memory.id,
      heading: `${memory.kind}: ${memory.labels.join('/')}`,
      namespace: `${namespacePrefix}.${memory.kind}`,
      text: memory.text,
    }));
}

function isCortex(
  input: CortexV1 | readonly MemoryEngramV1[]
): input is CortexV1 {
  return !Array.isArray(input) && typeof input === 'object' && input !== null && 'memories' in input;
}

function normalizeNamespacePrefix(value?: string): string {
  const normalized = normalizeMemoryLabel(value ?? 'memory');
  return normalized || 'memory';
}

function normalizeKindFilters(kind?: string | readonly string[]): string[] {
  if (kind === undefined) return [];
  const values = Array.isArray(kind) ? kind : [kind];
  return [...new Set(values.map(normalizeKind).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeNamespaceFilters(value?: string | readonly string[]): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => normalizeMemoryLabel(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeKind(kind: string): string {
  return normalize(kind).replace(/\s+/g, ' ').trim();
}

function matchesNamespace(value: string | undefined, filters: string[]): boolean {
  if (!value) return false;
  const normalized = normalizeMemoryLabel(value);
  return filters.some((filter) => normalized === filter || normalized.startsWith(`${filter}.`));
}

function valueOrDefault(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}
