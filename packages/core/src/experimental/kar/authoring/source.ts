import { canonicalize } from '../canonicalize.js';
import { CEG_SOURCE_VERSION } from './constants.js';
import { diagnostic, hasErrors, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import {
  canonicalCegSource,
  compareText,
  type CegBindingSource,
  type CegConcept,
  type CegEvidenceSelector,
  type CegRelationSource,
  type CegSourceFragment,
  type CegSourceV1,
} from './model.js';

type Draft = {
  concepts: { name: string; concept: CegConcept }[];
  evidence: { alias: string; selector: CegEvidenceSelector }[];
  relations: CegRelationSource[];
  bindings: CegBindingSource[];
  requirements: string[];
};

/** Immutable authoring builder. Method order does not affect canonical output. */
export class CegSourceBuilder {
  private constructor(private readonly draft: Draft) {}

  static empty(): CegSourceBuilder {
    return new CegSourceBuilder({ concepts: [], evidence: [], relations: [], bindings: [], requirements: [] });
  }

  concept(name: string, fields: CegConcept = {}): CegSourceBuilder {
    const concept: CegConcept = {};
    if (fields.label !== undefined) concept.label = fields.label;
    if (fields.note !== undefined) concept.note = fields.note;
    return new CegSourceBuilder({ ...this.draft, concepts: [...this.draft.concepts, { name, concept }] });
  }

  evidence(alias: string, selector: CegEvidenceSelector): CegSourceBuilder {
    return new CegSourceBuilder({ ...this.draft, evidence: [...this.draft.evidence, { alias, selector }] });
  }

  relation(from: string, type: string, to: string): CegSourceBuilder {
    return new CegSourceBuilder({ ...this.draft, relations: [...this.draft.relations, { from, type, to }] });
  }

  bind(concept: string, binding: {
    evidence: string;
    evidenceId?: string;
    requirements?: string[];
    authority?: number;
    unauthorized?: boolean;
    validFrom?: string;
    validUntil?: string;
    provenance?: string;
  }): CegSourceBuilder {
    const next: CegBindingSource = {
      concept,
      evidence: binding.evidence,
      requirements: [...(binding.requirements ?? [])],
    };
    if (binding.authority !== undefined) next.authority = binding.authority;
    if (binding.unauthorized === true) next.unauthorized = true;
    if (binding.validFrom !== undefined) next.validFrom = binding.validFrom;
    if (binding.validUntil !== undefined) next.validUntil = binding.validUntil;
    if (binding.provenance !== undefined) next.provenance = binding.provenance;
    return new CegSourceBuilder({ ...this.draft, bindings: [...this.draft.bindings, next] });
  }

  requirement(name: string): CegSourceBuilder {
    return new CegSourceBuilder({ ...this.draft, requirements: [...this.draft.requirements, name] });
  }

  buildFrom(base: CegSourceV1): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
    const built = this.build();
    const diagnostics = [...built.diagnostics];
    const concepts = { ...base.concepts };
    for (const [name, concept] of Object.entries(built.source.concepts)) {
      if (Object.prototype.hasOwnProperty.call(concepts, name)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_CONCEPT', `concepts.${name}`, `Duplicate concept "${name}".`));
        continue;
      }
      concepts[name] = concept;
    }
    const evidence = { ...base.evidence };
    for (const [alias, selector] of Object.entries(built.source.evidence)) {
      if (Object.prototype.hasOwnProperty.call(evidence, alias)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_EVIDENCE', `evidence.${alias}`, `Duplicate evidence alias "${alias}".`));
        continue;
      }
      evidence[alias] = selector;
    }
    if (hasErrors(diagnostics)) return { source: base, diagnostics: sortDiagnostics(diagnostics) };
    return {
      source: canonicalCegSource({
        format: CEG_SOURCE_VERSION,
        concepts,
        evidence,
        relations: [...base.relations, ...built.source.relations],
        bindings: [...base.bindings, ...built.source.bindings],
        requirements: [...base.requirements, ...built.source.requirements],
      }),
      diagnostics: [],
    };
  }

  build(): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
    const diagnostics: CegDiagnostic[] = [];
    const concepts: CegSourceV1['concepts'] = {};
    for (const entry of this.draft.concepts) {
      if (Object.prototype.hasOwnProperty.call(concepts, entry.name)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_CONCEPT', `concepts.${entry.name}`, `Duplicate concept "${entry.name}".`));
        continue;
      }
      concepts[entry.name] = entry.concept;
    }
    const evidence: CegSourceV1['evidence'] = {};
    for (const entry of this.draft.evidence) {
      if (Object.prototype.hasOwnProperty.call(evidence, entry.alias)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_EVIDENCE', `evidence.${entry.alias}`, `Duplicate evidence alias "${entry.alias}".`));
        continue;
      }
      evidence[entry.alias] = entry.selector;
    }
    const source = canonicalCegSource({
      format: CEG_SOURCE_VERSION,
      concepts,
      evidence,
      relations: this.draft.relations,
      bindings: this.draft.bindings,
      requirements: this.draft.requirements,
    });
    return { source, diagnostics: sortDiagnostics(diagnostics) };
  }
}

export function createCegSource(): CegSourceBuilder {
  return CegSourceBuilder.empty();
}

export function addCegConcept(source: CegSourceV1, name: string, fields: CegConcept = {}): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  return createCegSource().concept(name, fields).buildFrom(source);
}

export function addCegEvidence(source: CegSourceV1, alias: string, selector: CegEvidenceSelector): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  if (Object.prototype.hasOwnProperty.call(source.evidence, alias)) {
    return {
      source,
      diagnostics: [diagnostic('error', 'CEG_DUPLICATE_EVIDENCE', `evidence.${alias}`, `Duplicate evidence alias "${alias}".`)],
    };
  }
  return {
    source: canonicalCegSource({ ...source, evidence: { ...source.evidence, [alias]: selector } }),
    diagnostics: [],
  };
}

export function addCegRelation(source: CegSourceV1, from: string, type: string, to: string): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  return {
    source: canonicalCegSource({ ...source, relations: [...source.relations, { from, type, to }] }),
    diagnostics: [],
  };
}

export function addCegBinding(source: CegSourceV1, binding: CegBindingSource): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  return {
    source: canonicalCegSource({ ...source, bindings: [...source.bindings, binding] }),
    diagnostics: [],
  };
}

export function mergeCegSources(parts: Array<CegSourceV1 | CegSourceFragment>): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  let source: CegSourceV1 = {
    format: CEG_SOURCE_VERSION,
    concepts: {},
    evidence: {},
    relations: [],
    bindings: [],
    requirements: [],
  };
  const diagnostics: CegDiagnostic[] = [];
  for (const part of parts) {
    const concepts = part.concepts ?? {};
    for (const name of Object.keys(concepts).sort(compareText)) {
      if (Object.prototype.hasOwnProperty.call(source.concepts, name)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_CONCEPT', `concepts.${name}`, `Duplicate concept "${name}".`));
        continue;
      }
      const concept = concepts[name];
      if (concept) source = { ...source, concepts: { ...source.concepts, [name]: concept } };
    }
    const evidence = part.evidence ?? {};
    for (const alias of Object.keys(evidence).sort(compareText)) {
      if (Object.prototype.hasOwnProperty.call(source.evidence, alias)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_EVIDENCE', `evidence.${alias}`, `Duplicate evidence alias "${alias}".`));
        continue;
      }
      const selector = evidence[alias];
      if (selector) source = { ...source, evidence: { ...source.evidence, [alias]: selector } };
    }
    source = {
      ...source,
      relations: [...source.relations, ...(part.relations ?? [])],
      bindings: [...source.bindings, ...(part.bindings ?? [])],
      requirements: [...source.requirements, ...(part.requirements ?? [])],
    };
  }
  if (hasErrors(diagnostics)) {
    return { source: canonicalCegSource(source), diagnostics: sortDiagnostics(diagnostics) };
  }
  return { source: canonicalCegSource(source), diagnostics: [] };
}

export function emitCegSourceJson(source: CegSourceV1): string {
  return `${canonicalize(canonicalCegSource(source))}\n`;
}

export function emitCegSourceYaml(source: CegSourceV1): string {
  const canonical = canonicalCegSource(source);
  const lines = [`format: ${CEG_SOURCE_VERSION}`];
  const conceptNames = Object.keys(canonical.concepts);
  if (conceptNames.length > 0) lines.push('concepts:');
  for (const name of conceptNames) {
    const concept = canonical.concepts[name] ?? {};
    lines.push(`  ${yamlKey(name)}:`);
    if (concept.label !== undefined) lines.push(`    label: ${yamlScalar(concept.label)}`);
    if (concept.note !== undefined) lines.push(`    note: ${yamlScalar(concept.note)}`);
  }
  const aliases = Object.keys(canonical.evidence);
  if (aliases.length > 0) lines.push('evidence:');
  for (const alias of aliases) {
    const selector = canonical.evidence[alias];
    lines.push(`  ${yamlKey(alias)}:`);
    if (!selector) continue;
    if ('objectId' in selector) lines.push(`    objectId: ${yamlScalar(selector.objectId)}`);
    if ('source' in selector) {
      lines.push(`    source: ${yamlScalar(selector.source)}`);
      if (selector.namespace !== undefined) lines.push(`    namespace: ${yamlScalar(selector.namespace)}`);
    }
    if ('locator' in selector) lines.push(`    locator: ${yamlScalar(selector.locator)}`);
    if ('meta' in selector) {
      lines.push('    meta:');
      for (const key of Object.keys(selector.meta).sort(compareText)) {
        lines.push(`      ${yamlKey(key)}: ${yamlScalar(selector.meta[key] ?? '')}`);
      }
    }
  }
  if (canonical.relations.length > 0) lines.push('relations:');
  for (const relation of canonical.relations) {
    lines.push(`  - from: ${yamlScalar(relation.from)}`);
    lines.push(`    type: ${yamlScalar(relation.type)}`);
    lines.push(`    to: ${yamlScalar(relation.to)}`);
  }
  if (canonical.bindings.length > 0) lines.push('bindings:');
  for (const binding of canonical.bindings) {
    lines.push(`  - concept: ${yamlScalar(binding.concept)}`);
    lines.push(`    evidence: ${yamlScalar(binding.evidence)}`);
    if (binding.requirements.length > 0) lines.push('    requirements:');
    for (const requirement of binding.requirements) lines.push(`      - ${yamlScalar(requirement)}`);
    if (binding.authority !== undefined) lines.push(`    authority: ${binding.authority}`);
    if (binding.unauthorized === true) lines.push('    unauthorized: true');
    if (binding.validFrom !== undefined) lines.push(`    validFrom: ${yamlScalar(binding.validFrom)}`);
    if (binding.validUntil !== undefined) lines.push(`    validUntil: ${yamlScalar(binding.validUntil)}`);
    if (binding.provenance !== undefined) lines.push(`    provenance: ${yamlScalar(binding.provenance)}`);
  }
  if (canonical.requirements.length > 0) lines.push('requirements:');
  for (const requirement of canonical.requirements) lines.push(`  - ${yamlScalar(requirement)}`);
  return `${lines.join('\n')}\n`;
}

function yamlKey(value: string): string {
  return /^[A-Za-z0-9_.:/-]+$/u.test(value) ? value : yamlScalar(value);
}

function yamlScalar(value: string): string {
  if (value.length === 0) return '""';
  if (/^(true|false|null|~)$/iu.test(value) || /^-?(0|[1-9][0-9]*)$/.test(value)) return JSON.stringify(value);
  if (/[:#{}[\],&*!|>'"%@`]|^\s|\s$/u.test(value)) return JSON.stringify(value);
  return value;
}
