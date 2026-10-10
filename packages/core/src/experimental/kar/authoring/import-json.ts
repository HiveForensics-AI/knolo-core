import { CEG_IMPORT_MAP_FORMAT, CEG_SOURCE_VERSION } from './constants.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import { canonicalCegSource, type CegEvidenceSelector, type CegSourceV1 } from './model.js';

export function importJsonGraph(
  input: unknown,
  mappingInput: unknown,
): { ok: true; source: CegSourceV1; diagnostics: CegDiagnostic[] } | { ok: false; diagnostics: CegDiagnostic[] } {
  const mapping = interpretMapping(mappingInput);
  if (!mapping.ok) return mapping;
  const diagnostics: CegDiagnostic[] = [];
  const concepts: CegSourceV1['concepts'] = {};
  const evidence: CegSourceV1['evidence'] = {};
  const relations: CegSourceV1['relations'] = [];
  const bindings: CegSourceV1['bindings'] = [];
  if (mapping.value.concepts) {
    const rows = rowsAt(input, mapping.value.concepts.path, 'concepts', diagnostics);
    for (const row of rows ?? []) {
      const name = readString(row, mapping.value.concepts.name, 'concepts.name', diagnostics);
      if (!name) continue;
      if (Object.prototype.hasOwnProperty.call(concepts, name)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_CONCEPT', `concepts.${name}`, `Duplicate imported concept "${name}".`));
        continue;
      }
      const label = mapping.value.concepts.label ? readOptionalString(row, mapping.value.concepts.label) : undefined;
      concepts[name] = label === undefined ? {} : { label };
    }
  }
  if (mapping.value.relations) {
    const rows = rowsAt(input, mapping.value.relations.path, 'relations', diagnostics);
    for (const row of rows ?? []) {
      const from = readString(row, mapping.value.relations.from, 'relations.from', diagnostics);
      const type = readString(row, mapping.value.relations.type, 'relations.type', diagnostics);
      const to = readString(row, mapping.value.relations.to, 'relations.to', diagnostics);
      if (from && type && to) relations.push({ from, type, to });
    }
  }
  if (mapping.value.evidence) {
    const spec = mapping.value.evidence;
    const rows = rowsAt(input, spec.path, 'evidence', diagnostics);
    for (const row of rows ?? []) {
      const alias = readString(row, spec.alias, 'evidence.alias', diagnostics);
      if (!alias) continue;
      const selector = selectorFromRow(row, spec, diagnostics);
      if (!selector) continue;
      if (Object.prototype.hasOwnProperty.call(evidence, alias)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_EVIDENCE', `evidence.${alias}`, `Duplicate imported evidence "${alias}".`));
        continue;
      }
      evidence[alias] = selector;
    }
  }
  if (mapping.value.bindings) {
    const spec = mapping.value.bindings;
    const rows = rowsAt(input, spec.path, 'bindings', diagnostics);
    for (const row of rows ?? []) {
      const concept = readString(row, spec.concept, 'bindings.concept', diagnostics);
      const evidenceAlias = readString(row, spec.evidence, 'bindings.evidence', diagnostics);
      if (!concept || !evidenceAlias) continue;
      const requirements = spec.requirements ? readRequirements(row, spec.requirements, diagnostics) : [];
      const binding: CegSourceV1['bindings'][number] = { concept, evidence: evidenceAlias, requirements };
      if (spec.authority) {
        const authority = readOptionalNumber(row, spec.authority);
        if (authority !== undefined) binding.authority = authority;
      }
      if (spec.validFrom) {
        const validFrom = readOptionalString(row, spec.validFrom);
        if (validFrom !== undefined) binding.validFrom = validFrom;
      }
      if (spec.validUntil) {
        const validUntil = readOptionalString(row, spec.validUntil);
        if (validUntil !== undefined) binding.validUntil = validUntil;
      }
      if (spec.provenance) {
        const provenance = readOptionalString(row, spec.provenance);
        if (provenance !== undefined) binding.provenance = provenance;
      }
      bindings.push(binding);
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  return {
    ok: true,
    source: canonicalCegSource({
      format: CEG_SOURCE_VERSION,
      concepts,
      evidence,
      relations,
      bindings,
      requirements: [],
    }),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

type ImportMapping = {
  format: typeof CEG_IMPORT_MAP_FORMAT;
  concepts?: { path: string; name: string; label?: string };
  relations?: { path: string; from: string; type: string; to: string };
  evidence?: { path: string; alias: string; objectId?: string; source?: string; namespace?: string; locator?: string };
  bindings?: {
    path: string;
    concept: string;
    evidence: string;
    requirements?: string;
    authority?: string;
    validFrom?: string;
    validUntil?: string;
    provenance?: string;
  };
};

function interpretMapping(value: unknown): { ok: true; value: ImportMapping } | { ok: false; diagnostics: CegDiagnostic[] } {
  if (!value || typeof value !== 'object' || (value as { format?: string }).format !== CEG_IMPORT_MAP_FORMAT) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'mapping', 'Mapping format must be ceg-import-map-1.')] };
  }
  return { ok: true, value: value as ImportMapping };
}

function rowsAt(input: unknown, path: string, label: string, diagnostics: CegDiagnostic[]): Record<string, unknown>[] | null {
  const value = valueAt(input, path);
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_IMPORT_FIELD', path, `Mapping path "${path}" for ${label} is not an array.`));
    return null;
  }
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
}

function valueAt(input: unknown, path: string): unknown {
  if (path.length === 0) return input;
  let cursor = input;
  for (const part of path.split('.')) {
    if (part === '__proto__' || part === 'prototype' || part === 'constructor') return undefined;
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function readString(row: Record<string, unknown>, field: string, path: string, diagnostics: CegDiagnostic[]): string | null {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    diagnostics.push(diagnostic('error', 'CEG_IMPORT_FIELD', path, `Field "${field}" must be a non-empty string.`));
    return null;
  }
  return value;
}

function readOptionalString(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(row: Record<string, unknown>, field: string): number | undefined {
  const value = row[field];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function readRequirements(row: Record<string, unknown>, field: string, diagnostics: CegDiagnostic[]): string[] {
  const value = row[field];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return [...value];
  diagnostics.push(diagnostic('error', 'CEG_IMPORT_FIELD', field, `Field "${field}" must be a string or an array of strings.`));
  return [];
}

function selectorFromRow(
  row: Record<string, unknown>,
  spec: NonNullable<ImportMapping['evidence']>,
  diagnostics: CegDiagnostic[],
): CegEvidenceSelector | null {
  if (spec.objectId) {
    const objectId = readString(row, spec.objectId, 'evidence.objectId', diagnostics);
    return objectId ? { objectId } : null;
  }
  if (spec.locator) {
    const locator = readString(row, spec.locator, 'evidence.locator', diagnostics);
    return locator ? { locator } : null;
  }
  if (spec.source) {
    const source = readString(row, spec.source, 'evidence.source', diagnostics);
    if (!source) return null;
    if (!spec.namespace) return { source };
    const namespace = readOptionalString(row, spec.namespace);
    return namespace === undefined ? { source } : { source, namespace };
  }
  diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', 'evidence', 'Evidence mapping needs objectId, source, or locator.'));
  return null;
}
