import { tokenize, normalize } from '../tokenize.js';
import type { CortexV1 } from './cortex.js';
import type { MemoryEngramV1 } from './engram.js';
import { matchesMemoryLabels, validateMemoryLabels } from './label.js';
import { normalizeMemoryLabel } from './label.js';

export type RecallOptionsV1 = {
  topK?: number;
  kind?: string | readonly string[];
  labels?: string | readonly string[];
  namespace?: string | readonly string[];
  source?: string | readonly string[];
  since?: number;
  until?: number;
  minImportance?: number;
  minConfidence?: number;
};

export type MemoryRecallHitV1 = MemoryEngramV1 & {
  score: number;
  lexicalScore: number;
  metadataScore: number;
  kindScore: number;
  labelScore: number;
  namespaceScore: number;
  sourceScore: number;
};

export function recall(
  cortexOrMemories: CortexV1 | readonly MemoryEngramV1[],
  query: string,
  opts: RecallOptionsV1 = {}
): MemoryRecallHitV1[] {
  const memories = isCortex(cortexOrMemories)
    ? cortexOrMemories.memories
    : cortexOrMemories;
  const queryTerms = tokenize(query).map((token) => token.term);
  const hasQuery = queryTerms.length > 0;
  const hasFilters = Boolean(
    opts.kind ||
      opts.labels ||
      opts.namespace ||
      opts.source ||
      opts.since !== undefined ||
      opts.until !== undefined ||
      opts.minImportance !== undefined ||
      opts.minConfidence !== undefined
  );

  if (!hasQuery && !hasFilters) return [];

  const kindFilters = normalizeKinds(opts.kind);
  const namespaceFilters = normalizeHierarchicalFilters(opts.namespace);
  const sourceFilters = normalizeSourceFilters(opts.source);
  const labelFilters = validateMemoryLabels(opts.labels);

  const hits = memories
    .filter((memory) =>
      passesFilters(memory, {
        kindFilters,
        labelFilters,
        namespaceFilters,
        sourceFilters,
        since: opts.since,
        until: opts.until,
        minImportance: opts.minImportance,
        minConfidence: opts.minConfidence,
      })
    )
    .map((memory) =>
      scoreMemory(memory, queryTerms, {
        kindFilters,
        labelFilters,
        namespaceFilters,
        sourceFilters,
      })
    )
    .sort((a, b) => b.score - a.score || b.ts - a.ts || a.id.localeCompare(b.id));

  const topK = Number.isInteger(opts.topK) && (opts.topK as number) > 0 ? (opts.topK as number) : 10;
  const visibleHits = hasQuery ? hits.filter((hit) => hit.score > 0) : hits;
  return visibleHits.slice(0, topK);
}

function passesFilters(
  memory: MemoryEngramV1,
  filters: {
    kindFilters: string[];
    labelFilters: string[];
    namespaceFilters: string[];
    sourceFilters: string[];
    since?: number;
    until?: number;
    minImportance?: number;
    minConfidence?: number;
  }
): boolean {
  if (filters.kindFilters.length > 0 && !filters.kindFilters.includes(normalizeKind(memory.kind))) {
    return false;
  }
  if (filters.labelFilters.length > 0 && !matchesMemoryLabels(memory.labels, filters.labelFilters)) {
    return false;
  }
  if (filters.namespaceFilters.length > 0 && !matchesHierarchicalValue(memory.namespace, filters.namespaceFilters)) {
    return false;
  }
  if (filters.sourceFilters.length > 0 && !matchesSource(memory.source, filters.sourceFilters)) {
    return false;
  }
  if (filters.since !== undefined && memory.ts < filters.since) return false;
  if (filters.until !== undefined && memory.ts > filters.until) return false;
  if (filters.minImportance !== undefined && valueOrDefault(memory.importance, 0.5) < filters.minImportance) return false;
  if (filters.minConfidence !== undefined && valueOrDefault(memory.confidence, 0.5) < filters.minConfidence) return false;
  return true;
}

function scoreMemory(
  memory: MemoryEngramV1,
  queryTerms: string[],
  filters: {
    kindFilters: string[];
    labelFilters: string[];
    namespaceFilters: string[];
    sourceFilters: string[];
  }
): MemoryRecallHitV1 {
  const lexicalScore = scoreTokenOverlap(queryTerms, tokenize(memory.text).map((token) => token.term));
  const kindScore = scoreKind(memory, queryTerms, filters.kindFilters);
  const labelScore = scoreLabelSignal(memory, queryTerms, filters.labelFilters);
  const namespaceScore = scoreNamespaceSignal(memory, queryTerms, filters.namespaceFilters);
  const sourceScore = scoreSourceSignal(memory, queryTerms, filters.sourceFilters);
  const metadataScore = kindScore * 0.2 + labelScore * 0.1 + namespaceScore * 0.15 + sourceScore * 0.1;
  const score = lexicalScore * 0.45 + metadataScore;

  return {
    ...memory,
    score,
    lexicalScore,
    metadataScore,
    kindScore,
    labelScore,
    namespaceScore,
    sourceScore,
  };
}

function scoreKind(
  memory: MemoryEngramV1,
  queryTerms: string[],
  kindFilters: string[]
): number {
  const kind = normalizeKind(memory.kind);
  if (kindFilters.length > 0) {
    return kindFilters.includes(kind) ? 1 : 0;
  }
  return scoreTokenOverlap(queryTerms, tokenize(kind).map((token) => token.term));
}

function scoreLabelSignal(
  memory: MemoryEngramV1,
  queryTerms: string[],
  labelFilters: string[]
): number {
  if (labelFilters.length > 0) {
    const matched = labelFilters.filter((filter) =>
      memory.labels.some((label) => label === filter || label.startsWith(`${filter}.`))
    );
    return matched.length / labelFilters.length;
  }
  return scoreTokenOverlap(queryTerms, tokenize(memory.labels.join(' ')).map((token) => token.term));
}

function scoreNamespaceSignal(
  memory: MemoryEngramV1,
  queryTerms: string[],
  namespaceFilters: string[]
): number {
  if (namespaceFilters.length > 0) {
    return matchesHierarchicalValue(memory.namespace, namespaceFilters) ? 1 : 0;
  }
  return scoreTokenOverlap(queryTerms, tokenize(String(memory.namespace ?? '')).map((token) => token.term));
}

function scoreSourceSignal(
  memory: MemoryEngramV1,
  queryTerms: string[],
  sourceFilters: string[]
): number {
  if (sourceFilters.length > 0) {
    return matchesSource(memory.source, sourceFilters) ? 1 : 0;
  }
  return scoreTokenOverlap(queryTerms, tokenize(String(memory.source ?? '')).map((token) => token.term));
}

function scoreTokenOverlap(queryTerms: string[], fieldTerms: string[]): number {
  const q = new Set(queryTerms.filter(Boolean));
  const f = new Set(fieldTerms.filter(Boolean));
  if (q.size === 0 || f.size === 0) return 0;
  let matched = 0;
  for (const term of q) {
    if (f.has(term)) matched++;
  }
  return matched / q.size;
}

function normalizeKinds(kind?: string | readonly string[]): string[] {
  if (kind === undefined) return [];
  return uniqueSorted((Array.isArray(kind) ? kind : [kind]).map(normalizeKind).filter(Boolean));
}

function normalizeHierarchicalFilters(value?: string | readonly string[]): string[] {
  if (value === undefined) return [];
  return uniqueSorted((Array.isArray(value) ? value : [value]).map(normalizeMemoryLabel).filter(Boolean));
}

function normalizeSourceFilters(value?: string | readonly string[]): string[] {
  if (value === undefined) return [];
  return uniqueSorted((Array.isArray(value) ? value : [value]).map(normalizeSource).filter(Boolean));
}

function normalizeKind(kind: string): string {
  return normalize(kind).replace(/\s+/g, ' ').trim();
}

function normalizeSource(source?: string): string {
  return normalize(String(source ?? '')).replace(/\s+/g, ' ').trim();
}

function matchesHierarchicalValue(
  value: string | undefined,
  filters: string[]
): boolean {
  if (!value) return false;
  const normalized = normalizeMemoryLabel(value);
  return filters.some((filter) => normalized === filter || normalized.startsWith(`${filter}.`));
}

function matchesSource(value: string | undefined, filters: string[]): boolean {
  if (!value) return false;
  const normalized = normalizeSource(value);
  return filters.includes(normalized);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function valueOrDefault(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function isCortex(
  input: CortexV1 | readonly MemoryEngramV1[]
): input is CortexV1 {
  return !Array.isArray(input) && typeof input === 'object' && input !== null && 'memories' in input;
}
