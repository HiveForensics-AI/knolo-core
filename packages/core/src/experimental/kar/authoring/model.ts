import { CEG_SOURCE_VERSION, type CegLimits } from './constants.js';
import { diagnostic, hasErrors, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';

export type CegEvidenceSelector =
  | { objectId: string }
  | { source: string; namespace?: string }
  | { locator: string }
  | { meta: Record<string, string> };

export type CegConcept = {
  label?: string;
  note?: string;
};

export type CegRelationSource = {
  from: string;
  type: string;
  to: string;
};

export type CegBindingSource = {
  concept: string;
  evidence: string;
  requirements: string[];
  authority?: number;
  unauthorized?: boolean;
  validFrom?: string;
  validUntil?: string;
  provenance?: string;
};

/** Normative authoring object. YAML and JSON are surfaces over this value. */
export type CegSourceV1 = {
  format: typeof CEG_SOURCE_VERSION;
  concepts: Record<string, CegConcept>;
  evidence: Record<string, CegEvidenceSelector>;
  relations: CegRelationSource[];
  bindings: CegBindingSource[];
  requirements: string[];
};

export type CegSourceFragment = {
  concepts?: Record<string, CegConcept>;
  evidence?: Record<string, CegEvidenceSelector>;
  relations?: CegRelationSource[];
  bindings?: CegBindingSource[];
  requirements?: string[];
};

export type InterpretedSource =
  | { ok: true; source: CegSourceV1; diagnostics: CegDiagnostic[] }
  | { ok: false; diagnostics: CegDiagnostic[] };

const TOP_KEYS = ['format', 'concepts', 'evidence', 'relations', 'bindings', 'requirements'] as const;
const CONCEPT_KEYS = ['label', 'note'] as const;
const RELATION_KEYS = ['from', 'type', 'to'] as const;
const BINDING_KEYS = ['concept', 'evidence', 'requirements', 'authority', 'unauthorized', 'validFrom', 'validUntil', 'provenance'] as const;
const SELECTOR_KEYS = ['objectId', 'source', 'namespace', 'locator', 'meta'] as const;

export function interpretCegSource(value: unknown, limits: CegLimits): InterpretedSource {
  const diagnostics: CegDiagnostic[] = [];
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', '', 'CEG Source must be an object.')] };
  }
  unknownKeys(value, TOP_KEYS, '', diagnostics);
  if (value.format !== CEG_SOURCE_VERSION) {
    diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'format', 'format must be ceg-source-1.'));
  }
  const concepts = interpretConcepts(value.concepts, limits, diagnostics);
  const evidence = interpretEvidence(value.evidence, limits, diagnostics);
  const relations = interpretRelations(value.relations, limits, diagnostics);
  const bindings = interpretBindings(value.bindings, limits, diagnostics);
  const requirements = interpretNameList(value.requirements, 'requirements', limits, diagnostics);
  if (hasErrors(diagnostics) || !concepts || !evidence || !relations || !bindings || !requirements) {
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
      requirements,
    }),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function canonicalCegSource(source: CegSourceV1): CegSourceV1 {
  const concepts: CegSourceV1['concepts'] = {};
  for (const name of sortedKeys(source.concepts)) {
    const concept = source.concepts[name];
    if (!concept) continue;
    const next: CegConcept = {};
    if (concept.label !== undefined) next.label = concept.label;
    if (concept.note !== undefined) next.note = concept.note;
    concepts[name] = next;
  }
  const evidence: CegSourceV1['evidence'] = {};
  for (const alias of sortedKeys(source.evidence)) {
    const selector = source.evidence[alias];
    if (selector) evidence[alias] = canonicalSelector(selector);
  }
  const relations = [...source.relations].sort(compareRelations);
  const bindings = source.bindings.map((binding) => ({
    ...binding,
    requirements: [...binding.requirements].sort(compareText),
  })).sort(compareBindings);
  return {
    format: CEG_SOURCE_VERSION,
    concepts,
    evidence,
    relations,
    bindings,
    requirements: [...source.requirements].sort(compareText),
  };
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function interpretConcepts(
  value: unknown,
  limits: CegLimits,
  diagnostics: CegDiagnostic[],
): Record<string, CegConcept> | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'concepts', 'concepts must be an object.'));
    return null;
  }
  const names = Object.keys(value);
  if (names.length > limits.maxConcepts) {
    diagnostics.push(diagnostic('error', 'CEG_LIMIT_EXCEEDED', 'concepts', `concepts exceed ${limits.maxConcepts}.`));
    return null;
  }
  const concepts: Record<string, CegConcept> = {};
  for (const name of names) {
    if (!validIdentifier(name, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', `concepts.${name}`, 'Concept name is empty, too long, or contains controls.'));
      continue;
    }
    const raw = value[name];
    if (raw === null) {
      concepts[name] = {};
      continue;
    }
    if (!isRecord(raw)) {
      diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', `concepts.${name}`, 'A concept must be an object.'));
      continue;
    }
    unknownKeys(raw, CONCEPT_KEYS, `concepts.${name}`, diagnostics);
    const concept: CegConcept = {};
    if (raw.label !== undefined) {
      if (!validLabel(raw.label, limits.maxLabelLength)) {
        diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', `concepts.${name}.label`, 'Concept label is not a supported string.'));
      } else concept.label = raw.label;
    }
    if (raw.note !== undefined) {
      if (!validLabel(raw.note, limits.maxLabelLength)) {
        diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', `concepts.${name}.note`, 'Concept note is not a supported string.'));
      } else concept.note = raw.note;
    }
    concepts[name] = concept;
  }
  return concepts;
}

function interpretEvidence(
  value: unknown,
  limits: CegLimits,
  diagnostics: CegDiagnostic[],
): Record<string, CegEvidenceSelector> | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'evidence', 'evidence must be an object.'));
    return null;
  }
  const aliases = Object.keys(value);
  if (aliases.length > limits.maxBindings) {
    diagnostics.push(diagnostic('error', 'CEG_LIMIT_EXCEEDED', 'evidence', `evidence aliases exceed ${limits.maxBindings}.`));
    return null;
  }
  const evidence: Record<string, CegEvidenceSelector> = {};
  for (const alias of aliases) {
    if (!validIdentifier(alias, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', `evidence.${alias}`, 'Evidence alias is empty, too long, or contains controls.'));
      continue;
    }
    const selector = interpretSelector(value[alias], `evidence.${alias}`, limits, diagnostics);
    if (selector) evidence[alias] = selector;
  }
  return evidence;
}

function interpretSelector(
  value: unknown,
  path: string,
  limits: CegLimits,
  diagnostics: CegDiagnostic[],
): CegEvidenceSelector | null {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', path, 'An evidence selector must be an object.'));
    return null;
  }
  unknownKeys(value, SELECTOR_KEYS, path, diagnostics);
  const hasObject = value.objectId !== undefined;
  const hasSource = value.source !== undefined;
  const hasLocator = value.locator !== undefined;
  const hasMeta = value.meta !== undefined;
  const strategies = [hasObject, hasSource, hasLocator, hasMeta].filter(Boolean).length;
  if (strategies !== 1) {
    diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', path, 'Use exactly one of objectId, source, locator, or meta.'));
    return null;
  }
  if (value.namespace !== undefined && !hasSource) {
    diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.namespace`, 'namespace is only valid together with source.'));
    return null;
  }
  if (hasObject) {
    if (typeof value.objectId !== 'string' || !validIdentifier(value.objectId, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.objectId`, 'objectId must be a non-empty identifier.'));
      return null;
    }
    return { objectId: value.objectId };
  }
  if (hasSource) {
    if (typeof value.source !== 'string' || !validText(value.source, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.source`, 'source must be a non-empty string without control characters.'));
      return null;
    }
    const selector: CegEvidenceSelector = { source: value.source };
    if (value.namespace !== undefined) {
      if (typeof value.namespace !== 'string' || !validIdentifier(value.namespace, limits.maxIdentifierLength)) {
        diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.namespace`, 'namespace must be a non-empty identifier.'));
        return null;
      }
      selector.namespace = value.namespace;
    }
    return selector;
  }
  if (hasLocator) {
    if (typeof value.locator !== 'string' || !validText(value.locator, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.locator`, 'locator must be a non-empty string without control characters.'));
      return null;
    }
    return { locator: value.locator };
  }
  if (!isRecord(value.meta)) {
    diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.meta`, 'meta must be an object of strings.'));
    return null;
  }
  const meta: Record<string, string> = {};
  const keys = Object.keys(value.meta);
  if (keys.length === 0) {
    diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.meta`, 'meta selector must name at least one field.'));
    return null;
  }
  for (const key of keys) {
    if (!validIdentifier(key, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', `${path}.meta.${key}`, 'Metadata key is not a supported identifier.'));
      continue;
    }
    const field = value.meta[key];
    if (typeof field !== 'string' || field.length > limits.maxLabelLength || hasControl(field)) {
      diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_SELECTOR', `${path}.meta.${key}`, 'Metadata values must be strings without control characters.'));
      continue;
    }
    meta[key] = field;
  }
  return { meta };
}

function interpretRelations(
  value: unknown,
  limits: CegLimits,
  diagnostics: CegDiagnostic[],
): CegRelationSource[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'relations', 'relations must be an array.'));
    return null;
  }
  if (value.length > limits.maxRelations) {
    diagnostics.push(diagnostic('error', 'CEG_LIMIT_EXCEEDED', 'relations', `relations exceed ${limits.maxRelations}.`));
    return null;
  }
  const relations: CegRelationSource[] = [];
  value.forEach((item, index) => {
    const path = `relations[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', path, 'A relation must be an object.'));
      return;
    }
    unknownKeys(item, RELATION_KEYS, path, diagnostics);
    const from = item.from;
    const type = item.type;
    const to = item.to;
    if (typeof from !== 'string' || !validIdentifier(from, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_DANGLING_RELATION', `${path}.from`, 'Relation from must name a concept.'));
    }
    if (typeof to !== 'string' || !validIdentifier(to, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_DANGLING_RELATION', `${path}.to`, 'Relation to must name a concept.'));
    }
    if (typeof type !== 'string' || type.length === 0 || type.length > limits.maxRelationNameLength || hasControl(type) || /\s/u.test(type)) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_RELATION', `${path}.type`, 'Relation type must be a non-empty token without spaces.'));
    }
    if (typeof from === 'string' && typeof to === 'string' && typeof type === 'string') {
      relations.push({ from, type, to });
    }
  });
  return relations;
}

function interpretBindings(
  value: unknown,
  limits: CegLimits,
  diagnostics: CegDiagnostic[],
): CegBindingSource[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'bindings', 'bindings must be an array.'));
    return null;
  }
  if (value.length > limits.maxBindings) {
    diagnostics.push(diagnostic('error', 'CEG_LIMIT_EXCEEDED', 'bindings', `bindings exceed ${limits.maxBindings}.`));
    return null;
  }
  const bindings: CegBindingSource[] = [];
  value.forEach((item, index) => {
    const path = `bindings[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', path, 'A binding must be an object.'));
      return;
    }
    unknownKeys(item, BINDING_KEYS, path, diagnostics);
    if (typeof item.concept !== 'string' || !validIdentifier(item.concept, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_UNKNOWN_CONCEPT', `${path}.concept`, 'Binding concept must name a concept.'));
      return;
    }
    if (typeof item.evidence !== 'string' || !validIdentifier(item.evidence, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_UNKNOWN_EVIDENCE', `${path}.evidence`, 'Binding evidence must name an evidence alias.'));
      return;
    }
    const requirements = interpretNameList(item.requirements ?? [], `${path}.requirements`, limits, diagnostics);
    if (!requirements) return;
    if (requirements.length > limits.maxRequirementsPerBinding) {
      diagnostics.push(diagnostic('error', 'CEG_LIMIT_EXCEEDED', `${path}.requirements`, `A binding exceeds ${limits.maxRequirementsPerBinding} requirements.`));
      return;
    }
    const binding: CegBindingSource = { concept: item.concept, evidence: item.evidence, requirements };
    if (item.authority !== undefined) {
      if (typeof item.authority !== 'number' || !Number.isSafeInteger(item.authority)) {
        diagnostics.push(diagnostic('error', 'CEG_INVALID_AUTHORITY', `${path}.authority`, 'authority must be a safe integer.'));
      } else binding.authority = item.authority;
    }
    if (item.unauthorized !== undefined) {
      if (typeof item.unauthorized !== 'boolean') {
        diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', `${path}.unauthorized`, 'unauthorized must be boolean.'));
      } else if (item.unauthorized) binding.unauthorized = true;
    }
    for (const field of ['validFrom', 'validUntil'] as const) {
      if (item[field] === undefined) continue;
      if (typeof item[field] !== 'string' || !isRealDate(item[field])) {
        diagnostics.push(diagnostic('error', 'CEG_INVALID_VALIDITY', `${path}.${field}`, `${field} must be a real YYYY-MM-DD date.`));
      } else binding[field] = item[field];
    }
    if (binding.validFrom && binding.validUntil && binding.validFrom >= binding.validUntil) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_VALIDITY', path, 'validFrom must be earlier than validUntil.'));
    }
    if (item.provenance !== undefined) {
      if (typeof item.provenance !== 'string' || !validLabel(item.provenance, limits.maxLabelLength)) {
        diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', `${path}.provenance`, 'provenance must be a short string without control characters.'));
      } else binding.provenance = item.provenance;
    }
    bindings.push(binding);
  });
  return bindings;
}

function interpretNameList(
  value: unknown,
  path: string,
  limits: CegLimits,
  diagnostics: CegDiagnostic[],
): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', path, 'Expected an array of strings.'));
    return null;
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !validIdentifier(item, limits.maxIdentifierLength)) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', path, 'Requirement names must be non-empty identifiers.'));
      continue;
    }
    if (seen.has(item)) {
      diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_REQUIREMENT', path, `Duplicate requirement "${item}".`));
      continue;
    }
    seen.add(item);
    names.push(item);
  }
  return names;
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: CegDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(diagnostic('error', 'CEG_UNKNOWN_FIELD', path ? `${path}.${key}` : key, `Unknown field "${key}".`));
    }
  }
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validIdentifier(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !hasControl(value) && !/\s/u.test(value);
}

function validText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !hasControl(value);
}

function validLabel(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !hasControl(value);
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function canonicalSelector(selector: CegEvidenceSelector): CegEvidenceSelector {
  if ('objectId' in selector) return { objectId: selector.objectId };
  if ('locator' in selector) return { locator: selector.locator };
  if ('source' in selector) {
    return selector.namespace === undefined
      ? { source: selector.source }
      : { source: selector.source, namespace: selector.namespace };
  }
  const meta: Record<string, string> = {};
  for (const key of sortedKeys(selector.meta)) meta[key] = selector.meta[key] ?? '';
  return { meta };
}

function compareRelations(left: CegRelationSource, right: CegRelationSource): number {
  return compareText(left.from, right.from) || compareText(left.type, right.type) || compareText(left.to, right.to);
}

function compareBindings(left: CegBindingSource, right: CegBindingSource): number {
  return compareText(left.concept, right.concept)
    || compareText(left.evidence, right.evidence)
    || compareText(left.requirements.join('\0'), right.requirements.join('\0'))
    || compareOptionalNumber(left.authority, right.authority)
    || compareBool(left.unauthorized === true, right.unauthorized === true)
    || compareText(left.validFrom ?? '', right.validFrom ?? '')
    || compareText(left.validUntil ?? '', right.validUntil ?? '')
    || compareText(left.provenance ?? '', right.provenance ?? '');
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left - right;
}

function compareBool(left: boolean, right: boolean): number {
  return Number(left) - Number(right);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort(compareText);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
