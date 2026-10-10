import { canonicalize, digest } from '../canonicalize.js';
import { validatePlan } from '../plan.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import { cegNodeId } from './ids.js';

/**
 * `ceg-domain-1` is reusable semantic production data.
 * It is not a Knowledge Image and it is not a Committed Evidence Graph.
 */

export const CEG_DOMAIN_FORMAT = 'ceg-domain-1' as const;
export const CEG_PRODUCER_RUN_FORMAT = 'ceg-producer-run-1' as const;
export const CEG_DECISIONS_FORMAT = 'ceg-decisions-1' as const;
export const CEG_ONTOLOGY_MAP_FORMAT = 'ceg-ontology-map-1' as const;
export const CEG_MODEL_PROPOSALS_FORMAT = 'ceg-model-proposals-1' as const;
export const RULE_PRODUCER_ID = 'knolo-ceg-rule-producer' as const;
export const RULE_PRODUCER_VERSION = 'ceg-rules-1' as const;
export const ONTOLOGY_PRODUCER_ID = 'knolo-ceg-ontology-producer' as const;
export const ONTOLOGY_PRODUCER_VERSION = 'ceg-ontology-1' as const;
export const MODEL_PRODUCER_ID = 'knolo-ceg-model-producer' as const;
export const MODEL_PRODUCER_VERSION = 'ceg-model-proposals-1' as const;

export const PRODUCER_LIMITS = {
  maxEvidenceObjects: 100_000,
  maxRules: 10_000,
  maxMatchesPerRule: 100,
  maxGeneratedConcepts: 100_000,
  maxGeneratedRelations: 200_000,
  maxGeneratedBindings: 200_000,
  maxSpanLength: 2_000,
  maxPackBytes: 2 * 1024 * 1024,
  maxConceptKinds: 1_000,
  maxRelationVocabulary: 1_000,
  maxPlanTemplates: 100,
  maxPatternLength: 256,
  maxRulesPerEvidence: 1_000,
  maxRegexSteps: 10_000,
  maxConcepts: 20_000,
} as const;

export type ProducerLimits = { -readonly [K in keyof typeof PRODUCER_LIMITS]: number };

export type DomainConceptKind = { id: string; label?: string };

export type DomainConcept = {
  name: string;
  kind?: string;
  label?: string;
  phrases?: string[];
};

export type DomainRelationRef = { from: string; type: string; to: string };

export type DomainBindingRule = {
  concept: string;
  requirements: string[];
};

export type DomainRule = {
  id: string;
  autoAccept: boolean;
  kind: 'metadata' | 'heading' | 'phrase' | 'cue' | 'date' | 'authority' | 'section' | 'incomplete';
  pattern?: string;
  patternMode?: 'exact' | 'regex';
  ignoreCase?: boolean;
  excludePattern?: string;
  metadata?: Record<string, string>;
  metadataExists?: string;
  concept?: string;
  relation?: DomainRelationRef;
  binding?: DomainBindingRule;
  dateField?: 'validFrom' | 'validUntil';
  authorityMetadata?: string;
  targetPattern?: string;
  maxMatches?: number;
};

export type DomainPackV1 = {
  format: typeof CEG_DOMAIN_FORMAT;
  id: string;
  version: string;
  description?: string;
  conceptKinds: DomainConceptKind[];
  concepts: DomainConcept[];
  relations: string[];
  rules: DomainRule[];
  planTemplates: Record<string, unknown>;
  limits?: Partial<ProducerLimits>;
  fixtures?: unknown[];
};

export type InterpretedDomain =
  | { ok: true; pack: DomainPackV1; diagnostics: CegDiagnostic[] }
  | { ok: false; diagnostics: CegDiagnostic[] };

const RULE_KINDS = ['metadata', 'heading', 'phrase', 'cue', 'date', 'authority', 'section', 'incomplete'] as const;
const PACK_KEYS = ['format', 'id', 'version', 'description', 'conceptKinds', 'concepts', 'relations', 'rules', 'planTemplates', 'limits', 'fixtures'] as const;
const RULE_KEYS = ['id', 'autoAccept', 'kind', 'pattern', 'patternMode', 'ignoreCase', 'excludePattern', 'metadata', 'metadataExists', 'concept', 'relation', 'binding', 'dateField', 'authorityMetadata', 'targetPattern', 'maxMatches'] as const;

export function resolveProducerLimits(override?: Partial<ProducerLimits>): ProducerLimits | CegDiagnostic {
  const limits: ProducerLimits = { ...PRODUCER_LIMITS };
  if (!override) return limits;
  for (const key of Object.keys(override) as Array<keyof ProducerLimits>) {
    if (!(key in PRODUCER_LIMITS)) {
      return diagnostic('error', 'CEG_UNKNOWN_FIELD', `limits.${key}`, `Unknown producer limit "${key}".`);
    }
    const value = override[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return diagnostic('error', 'CEG_PRODUCER_LIMIT', `limits.${key}`, `${key} must be a non-negative integer.`);
    }
    if (value > PRODUCER_LIMITS[key]) {
      return diagnostic('error', 'CEG_PRODUCER_LIMIT', `limits.${key}`, `${key} cannot exceed ${PRODUCER_LIMITS[key]}.`);
    }
    limits[key] = value;
  }
  return limits;
}

export function interpretDomainPack(value: unknown): InterpretedDomain {
  const diagnostics: CegDiagnostic[] = [];
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_DOMAIN_INVALID', '', 'A domain pack must be an object.')] };
  }
  unknownKeys(value, PACK_KEYS, '', diagnostics);
  if (value.format !== CEG_DOMAIN_FORMAT) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'format', 'format must be ceg-domain-1.'));
  }
  const id = token(value.id, 'id', diagnostics);
  const version = versionOf(value.version, diagnostics);
  const description = optionalText(value.description, 'description', 2_000, diagnostics);
  const limits = value.limits === undefined ? undefined : limitsOf(value.limits, diagnostics);
  const conceptKinds = conceptKindsOf(value.conceptKinds, diagnostics);
  const concepts = conceptsOf(value.concepts, conceptKinds, diagnostics);
  const relations = vocabularyOf(value.relations, diagnostics);
  const rules = rulesOf(value.rules, concepts, relations, diagnostics);
  const planTemplates = plansOf(value.planTemplates, concepts, diagnostics);
  const fixtures = value.fixtures === undefined ? undefined : fixturesOf(value.fixtures, diagnostics);
  if (diagnostics.some((item) => item.severity === 'error') || !id || !version || !conceptKinds || !concepts || !relations || !rules || !planTemplates) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  const pack: DomainPackV1 = {
    format: CEG_DOMAIN_FORMAT,
    id,
    version,
    conceptKinds,
    concepts,
    relations,
    rules,
    planTemplates,
  };
  if (description !== undefined) pack.description = description;
  if (limits) pack.limits = limits;
  if (fixtures) pack.fixtures = fixtures;
  return { ok: true, pack, diagnostics: sortDiagnostics(diagnostics) };
}

export function canonicalDomainBody(pack: DomainPackV1): unknown {
  const limits = pack.limits ? sortRecord(pack.limits) : null;
  return {
    format: pack.format,
    id: pack.id,
    version: pack.version,
    description: pack.description ?? null,
    conceptKinds: [...pack.conceptKinds].sort((left, right) => compareText(left.id, right.id)).map((kind) => ({
      id: kind.id,
      label: kind.label ?? null,
    })),
    concepts: [...pack.concepts].sort((left, right) => compareText(left.name, right.name)).map((concept) => ({
      name: concept.name,
      kind: concept.kind ?? null,
      label: concept.label ?? null,
      phrases: [...(concept.phrases ?? [])].sort(compareText),
    })),
    relations: [...pack.relations].sort(compareText),
    rules: [...pack.rules].sort((left, right) => compareText(left.id, right.id)).map(canonicalRule),
    planTemplates: sortRecord(pack.planTemplates),
    limits,
  };
}

export function domainPackRoot(pack: DomainPackV1): string {
  return digest({ domain: 'ceg-domain-pack-v1', pack: canonicalDomainBody(pack) });
}

export function instantiatePlanTemplate(pack: DomainPackV1, name: string): { ok: true; plan: NonNullable<ReturnType<typeof validatePlan>> } | { ok: false; diagnostics: CegDiagnostic[] } {
  const template = pack.planTemplates[name];
  if (!isRecord(template)) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `planTemplates.${name}`, `Plan template "${name}" is missing.`)] };
  }
  const plan = planFromTemplate(template, `planTemplates.${name}`);
  if (!plan) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `planTemplates.${name}`, `Plan template "${name}" is not a frozen KAR plan.`)] };
  }
  return { ok: true, plan };
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalRule(rule: DomainRule): unknown {
  return {
    id: rule.id,
    autoAccept: rule.autoAccept,
    kind: rule.kind,
    pattern: rule.pattern ?? null,
    patternMode: rule.patternMode ?? null,
    ignoreCase: rule.ignoreCase === true,
    excludePattern: rule.excludePattern ?? null,
    metadata: rule.metadata ? sortRecord(rule.metadata) : null,
    metadataExists: rule.metadataExists ?? null,
    concept: rule.concept ?? null,
    relation: rule.relation ?? null,
    binding: rule.binding ? { concept: rule.binding.concept, requirements: [...rule.binding.requirements].sort(compareText) } : null,
    dateField: rule.dateField ?? null,
    authorityMetadata: rule.authorityMetadata ?? null,
    targetPattern: rule.targetPattern ?? null,
    maxMatches: rule.maxMatches ?? null,
  };
}

function planFromTemplate(template: Record<string, unknown>, _path: string): ReturnType<typeof validatePlan> {
  if (!isRecord(template.anchor)) return null;
  let anchor: unknown;
  if (template.anchor.mode === 'recompute') {
    anchor = { mode: 'recompute', procedure: template.anchor.procedure };
  } else if (template.anchor.mode === 'supplied' && typeof template.anchor.concept === 'string') {
    const witness: { nodeId: string; queryTerm?: string } = { nodeId: cegNodeId(template.anchor.concept) };
    if (typeof template.anchor.queryTerm === 'string') witness.queryTerm = template.anchor.queryTerm;
    anchor = { mode: 'supplied', witness: [witness] };
  } else {
    return null;
  }
  return validatePlan({ ...template, anchor });
}

function conceptKindsOf(value: unknown, diagnostics: CegDiagnostic[]): DomainConceptKind[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'conceptKinds', 'conceptKinds must be an array.'));
    return null;
  }
  if (value.length > PRODUCER_LIMITS.maxConceptKinds) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_LIMIT', 'conceptKinds', 'Too many concept kinds.'));
    return null;
  }
  const kinds: DomainConceptKind[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string' || !isToken(item.id)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `conceptKinds[${index}]`, 'Concept kind id is invalid.'));
      continue;
    }
    if (seen.has(item.id)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_DUPLICATE', `conceptKinds.${item.id}`, `Duplicate concept kind "${item.id}".`));
      continue;
    }
    seen.add(item.id);
    const kind: DomainConceptKind = { id: item.id };
    if (item.label !== undefined) {
      if (typeof item.label !== 'string' || item.label.length > 2_000) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `conceptKinds[${index}].label`, 'Concept kind label is invalid.'));
      } else kind.label = item.label;
    }
    kinds.push(kind);
  }
  return kinds;
}

function conceptsOf(value: unknown, kinds: DomainConceptKind[] | null, diagnostics: CegDiagnostic[]): DomainConcept[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'concepts', 'concepts must be an array.'));
    return null;
  }
  if (value.length > PRODUCER_LIMITS.maxConcepts) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_LIMIT', 'concepts', 'Too many concepts.'));
    return null;
  }
  const kindIds = new Set((kinds ?? []).map((kind) => kind.id));
  const concepts: DomainConcept[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.name !== 'string' || !isToken(item.name) || portableString(item.name)) {
      diagnostics.push(diagnostic('error', portableString(typeof item.name === 'string' ? item.name : '') ? 'CEG_DOMAIN_PATH' : 'CEG_DOMAIN_INVALID', `concepts[${index}]`, 'Concept name is invalid.'));
      continue;
    }
    if (seen.has(item.name)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_DUPLICATE', `concepts.${item.name}`, `Duplicate concept "${item.name}".`));
      continue;
    }
    seen.add(item.name);
    const concept: DomainConcept = { name: item.name };
    if (item.kind !== undefined) {
      if (typeof item.kind !== 'string' || !kindIds.has(item.kind)) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `concepts.${item.name}.kind`, 'Concept kind is not declared.'));
      } else concept.kind = item.kind;
    }
    if (item.label !== undefined) {
      if (typeof item.label !== 'string' || item.label.length > 2_000) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `concepts.${item.name}.label`, 'Concept label is invalid.'));
      } else concept.label = item.label;
    }
    if (item.phrases !== undefined) {
      if (!Array.isArray(item.phrases) || item.phrases.some((phrase) => typeof phrase !== 'string' || phrase.length === 0 || phrase.length > PRODUCER_LIMITS.maxPatternLength)) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `concepts.${item.name}.phrases`, 'Concept phrases must be short strings.'));
      } else if (item.phrases.some((phrase) => typeof phrase === 'string' && portableString(phrase))) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PATH', `concepts.${item.name}.phrases`, 'Concept phrases contain a path, URL, or credential-like value.'));
      } else concept.phrases = [...item.phrases];
    }
    concepts.push(concept);
  }
  return concepts;
}

function vocabularyOf(value: unknown, diagnostics: CegDiagnostic[]): string[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'relations', 'relations must be an array.'));
    return null;
  }
  if (value.length > PRODUCER_LIMITS.maxRelationVocabulary) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_LIMIT', 'relations', 'Relation vocabulary is too large.'));
    return null;
  }
  const relations: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !isToken(item) || portableString(item)) {
      diagnostics.push(diagnostic('error', typeof item === 'string' && portableString(item) ? 'CEG_DOMAIN_PATH' : 'CEG_DOMAIN_INVALID', `relations[${index}]`, 'Relation symbol is invalid.'));
      continue;
    }
    if (seen.has(item)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_DUPLICATE', `relations.${item}`, `Duplicate relation "${item}".`));
      continue;
    }
    seen.add(item);
    relations.push(item);
  }
  return relations;
}

function rulesOf(value: unknown, concepts: DomainConcept[] | null, relations: string[] | null, diagnostics: CegDiagnostic[]): DomainRule[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'rules', 'rules must be an array.'));
    return null;
  }
  if (value.length > PRODUCER_LIMITS.maxRules) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_LIMIT', 'rules', 'Too many rules.'));
    return null;
  }
  const names = new Set((concepts ?? []).map((concept) => concept.name));
  const symbols = new Set(relations ?? []);
  const rules: DomainRule[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const rule = ruleOf(item, index, names, symbols, diagnostics);
    if (!rule) continue;
    if (seen.has(rule.id)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_DUPLICATE_RULE', `rules.${rule.id}`, `Duplicate rule "${rule.id}".`));
      continue;
    }
    seen.add(rule.id);
    if (portableString(JSON.stringify(rule)) !== null) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PATH', `rules.${rule.id}`, 'Rule text contains a path, URL, or credential-like value.'));
    }
    rules.push(rule);
  }
  return rules;
}

function ruleOf(value: unknown, index: number, names: Set<string>, symbols: Set<string>, diagnostics: CegDiagnostic[]): DomainRule | null {
  const path = `rules[${index}]`;
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', path, 'A rule must be an object.'));
    return null;
  }
  unknownKeys(value, RULE_KEYS, path, diagnostics);
  if (typeof value.id !== 'string' || !isToken(value.id) || value.id.length > 200) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.id`, 'Rule id is invalid.'));
    return null;
  }
  if (typeof value.kind !== 'string' || !(RULE_KINDS as readonly string[]).includes(value.kind)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.kind`, 'Rule kind is not supported.'));
    return null;
  }
  const rule: DomainRule = {
    id: value.id,
    autoAccept: value.autoAccept === true,
    kind: value.kind as DomainRule['kind'],
  };
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== 'string' || value.pattern.length === 0 || value.pattern.length > PRODUCER_LIMITS.maxPatternLength) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.pattern`, 'Rule pattern is empty or too long.'));
    } else rule.pattern = value.pattern;
  }
  if (value.patternMode !== undefined) {
    if (value.patternMode !== 'exact' && value.patternMode !== 'regex') {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.patternMode`, 'patternMode must be exact or regex.'));
    } else rule.patternMode = value.patternMode;
  }
  if (value.ignoreCase !== undefined) {
    if (typeof value.ignoreCase !== 'boolean') diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.ignoreCase`, 'ignoreCase must be boolean.'));
    else rule.ignoreCase = value.ignoreCase;
  }
  if (value.excludePattern !== undefined) {
    if (typeof value.excludePattern !== 'string' || value.excludePattern.length === 0 || value.excludePattern.length > PRODUCER_LIMITS.maxPatternLength) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.excludePattern`, 'excludePattern is invalid.'));
    } else rule.excludePattern = value.excludePattern;
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata) || Object.entries(value.metadata).some(([key, item]) => !isToken(key) || typeof item !== 'string' || item.length > 2_000)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.metadata`, 'metadata must be a string map.'));
    } else rule.metadata = { ...value.metadata } as Record<string, string>;
  }
  if (value.metadataExists !== undefined) {
    if (typeof value.metadataExists !== 'string' || !isToken(value.metadataExists)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.metadataExists`, 'metadataExists must name a metadata key.'));
    } else rule.metadataExists = value.metadataExists;
  }
  if (value.concept !== undefined) {
    if (typeof value.concept !== 'string' || !names.has(value.concept)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.concept`, 'Rule concept is not in the domain registry.'));
    } else rule.concept = value.concept;
  }
  if (value.relation !== undefined) {
    const relation = relationOf(value.relation, names, symbols, `${path}.relation`, diagnostics);
    if (relation) rule.relation = relation;
  }
  if (value.binding !== undefined) {
    const binding = bindingOf(value.binding, names, `${path}.binding`, diagnostics);
    if (binding) rule.binding = binding;
  }
  if (value.dateField !== undefined) {
    if (value.dateField !== 'validFrom' && value.dateField !== 'validUntil') {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.dateField`, 'dateField must be validFrom or validUntil.'));
    } else rule.dateField = value.dateField;
  }
  if (value.authorityMetadata !== undefined) {
    if (typeof value.authorityMetadata !== 'string' || !isToken(value.authorityMetadata)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.authorityMetadata`, 'authorityMetadata must name a metadata key.'));
    } else rule.authorityMetadata = value.authorityMetadata;
  }
  if (value.targetPattern !== undefined) {
    if (typeof value.targetPattern !== 'string' || value.targetPattern.length === 0 || value.targetPattern.length > PRODUCER_LIMITS.maxPatternLength) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.targetPattern`, 'targetPattern is invalid.'));
    } else rule.targetPattern = value.targetPattern;
  }
  if (value.maxMatches !== undefined) {
    if (typeof value.maxMatches !== 'number' || !Number.isInteger(value.maxMatches) || value.maxMatches < 1 || value.maxMatches > PRODUCER_LIMITS.maxMatchesPerRule) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_LIMIT', `${path}.maxMatches`, 'maxMatches is outside the supported range.'));
    } else rule.maxMatches = value.maxMatches;
  }
  if ((rule.kind === 'phrase' || rule.kind === 'cue' || rule.kind === 'heading' || rule.kind === 'date' || rule.kind === 'incomplete' || rule.kind === 'section') && !rule.pattern) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.pattern`, `${rule.kind} rules require a pattern.`));
  }
  if (rule.kind === 'section' && !rule.targetPattern) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.targetPattern`, 'section rules require targetPattern.'));
  }
  if (rule.kind === 'regex' as string) return rule;
  if (rule.patternMode === 'regex' && rule.pattern && !regexIsSafe(rule.pattern)) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RULE_INVALID', `${path}.pattern`, 'Regex is empty, too long, or uses an unsupported construct.'));
  }
  return rule;
}

function relationOf(value: unknown, names: Set<string>, symbols: Set<string>, path: string, diagnostics: CegDiagnostic[]): DomainRelationRef | null {
  if (!isRecord(value) || typeof value.from !== 'string' || typeof value.type !== 'string' || typeof value.to !== 'string') {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', path, 'A relation needs from, type, and to.'));
    return null;
  }
  if (!names.has(value.from) || !names.has(value.to)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', path, 'Relation endpoints must be registry concepts.'));
    return null;
  }
  if (!symbols.has(value.type)) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RELATION_UNKNOWN', path, `Relation "${value.type}" is not in the domain vocabulary.`));
    return null;
  }
  return { from: value.from, type: value.type, to: value.to };
}

function bindingOf(value: unknown, names: Set<string>, path: string, diagnostics: CegDiagnostic[]): DomainBindingRule | null {
  if (!isRecord(value) || typeof value.concept !== 'string' || !Array.isArray(value.requirements)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', path, 'A binding needs a concept and requirements.'));
    return null;
  }
  if (!names.has(value.concept)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.concept`, 'Binding concept is not in the registry.'));
    return null;
  }
  if (value.requirements.some((item) => typeof item !== 'string' || !isToken(item))) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `${path}.requirements`, 'Requirements must be identifiers.'));
    return null;
  }
  return { concept: value.concept, requirements: [...value.requirements] };
}

function plansOf(value: unknown, concepts: DomainConcept[] | null, diagnostics: CegDiagnostic[]): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'planTemplates', 'planTemplates must be an object.'));
    return null;
  }
  const names = Object.keys(value);
  if (names.length > PRODUCER_LIMITS.maxPlanTemplates) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_LIMIT', 'planTemplates', 'Too many plan templates.'));
    return null;
  }
  const conceptNames = new Set((concepts ?? []).map((concept) => concept.name));
  const templates: Record<string, unknown> = {};
  for (const name of names) {
    if (!isToken(name)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', `planTemplates.${name}`, 'Plan template name is invalid.'));
      continue;
    }
    const template = value[name];
    if (!isRecord(template) || !isRecord(template.anchor)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `planTemplates.${name}`, 'Plan template anchor is missing.'));
      continue;
    }
    if (template.anchor.mode === 'supplied' && (typeof template.anchor.concept !== 'string' || !conceptNames.has(template.anchor.concept))) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `planTemplates.${name}.anchor`, 'Supplied anchor concept is not in the registry.'));
      continue;
    }
    if (!planFromTemplate(template, `planTemplates.${name}`)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `planTemplates.${name}`, 'Plan template does not instantiate a frozen KAR plan.'));
      continue;
    }
    templates[name] = template;
  }
  return templates;
}

function fixturesOf(value: unknown, diagnostics: CegDiagnostic[]): unknown[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'fixtures', 'fixtures must be an array.'));
    return null;
  }
  return value;
}

function limitsOf(value: unknown, diagnostics: CegDiagnostic[]): Partial<ProducerLimits> | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'limits', 'limits must be an object.'));
    return undefined;
  }
  const resolved = resolveProducerLimits(value as Partial<ProducerLimits>);
  if ('severity' in resolved) {
    diagnostics.push(resolved);
    return undefined;
  }
  return value as Partial<ProducerLimits>;
}

function versionOf(value: unknown, diagnostics: CegDiagnostic[]): string | null {
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(text)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', 'version', 'version must be a short token.'));
    return null;
  }
  return text;
}

function token(value: unknown, path: string, diagnostics: CegDiagnostic[]): string | null {
  if (typeof value !== 'string' || !isToken(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', path, `${path} must be an identifier.`));
    return null;
  }
  if (portableString(value)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PATH', path, `${path} contains a path, URL, or credential-like value.`));
    return null;
  }
  return value;
}

function optionalText(value: unknown, path: string, max: number, diagnostics: CegDiagnostic[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max || portableString(value) !== null) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_INVALID', path, `${path} is empty, too long, or not portable.`));
    return undefined;
  }
  return value;
}

export function regexIsSafe(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > PRODUCER_LIMITS.maxPatternLength) return false;
  if (/\\[1-9]/.test(pattern) || /\(\?[=<!]/.test(pattern)) return false;
  const groups = matchGroups(pattern);
  if (!groups) return false;
  for (const group of groups) {
    const after = pattern[group.end + 1];
    const quantified = after === '*' || after === '+' || after === '?' || after === '{';
    if (quantified && hasQuantifier(group.body)) return false;
  }
  return true;
}

function matchGroups(pattern: string): Array<{ end: number; body: string }> | null {
  const groups: Array<{ end: number; body: string }> = [];
  const stack: number[] = [];
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const ch = pattern[index];
    if (ch === '\\') {
      index += 1;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    else if (!inClass && ch === '(') stack.push(index);
    else if (!inClass && ch === ')') {
      const start = stack.pop();
      if (start === undefined) return null;
      groups.push({ end: index, body: pattern.slice(start + 1, index) });
    }
  }
  return stack.length === 0 ? groups : null;
}

function hasQuantifier(body: string): boolean {
  let inClass = false;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if (ch === '\\') {
      index += 1;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    else if (!inClass && (ch === '*' || ch === '+' || ch === '?' || ch === '{')) return true;
  }
  return false;
}

function portableString(value: string): string | null {
  if (/(^|[\s"'`(])(\/|[A-Za-z]:\\)/.test(value)) return value;
  if (/[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return value;
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(value)) return value;
  return null;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, diagnostics: CegDiagnostic[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      diagnostics.push(diagnostic('error', 'CEG_UNKNOWN_FIELD', path ? `${path}.${key}` : key, `Unknown field "${key}".`));
    }
  }
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(value).sort(compareText)) out[key] = value[key] as T;
  return out;
}

function isToken(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/\s/u.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function inspectDomainPack(pack: DomainPackV1, fixtureCount = pack.fixtures?.length ?? 0): string {
  const lines = [
    'CEG DOMAIN',
    `id               ${pack.id}`,
    `version          ${pack.version}`,
    `root             ${domainPackRoot(pack)}`,
    `concept kinds    ${pack.conceptKinds.length}`,
    `concepts         ${pack.concepts.length}`,
    `relations        ${[...pack.relations].sort(compareText).join(', ')}`,
    `rules            ${pack.rules.length}`,
    `plan templates   ${Object.keys(pack.planTemplates).sort(compareText).join(', ') || '(none)'}`,
    `fixtures         ${fixtureCount}`,
  ];
  if (pack.description) lines.push(`description      ${pack.description}`);
  return lines.join('\n');
}

export function domainCanonicalJson(pack: DomainPackV1): string {
  return canonicalize(canonicalDomainBody(pack));
}
