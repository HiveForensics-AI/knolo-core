import { normalize } from '../tokenize.js';

export function normalizeMemoryLabel(label: string): string {
  if (typeof label !== 'string') return '';

  const lowered = label.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().trim();
  if (!lowered) return '';

  const dotted = lowered
    .replace(/\s+/g, '.')
    .replace(/[\u2010-\u2015/\\:;|>]+/gu, '.')
    .replace(/[^\p{L}\p{N}._-]+/gu, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '');

  return dotted
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('.');
}

export function validateMemoryLabels(
  labels?: string | readonly string[] | null
): string[] {
  if (labels === undefined || labels === null) return [];

  const values = typeof labels === 'string' ? [labels] : labels;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const label of values) {
    if (typeof label !== 'string') {
      throw new Error('Memory labels must be strings.');
    }
    const normalized = normalizeMemoryLabel(label);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function matchesMemoryLabels(
  memoryLabels?: string[] | string | null,
  requestedLabels?: string | readonly string[] | null
): boolean {
  const filters = validateMemoryLabels(requestedLabels);
  if (filters.length === 0) return true;

  const labels = validateMemoryLabels(memoryLabels);
  if (labels.length === 0) return false;

  return filters.some((filter) =>
    labels.some((label) => label === filter || label.startsWith(`${filter}.`))
  );
}

export function normalizeMemoryLabelTokens(label: string): string[] {
  return normalizeMemoryLabel(label)
    .split('.')
    .map((part) => normalize(part).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
