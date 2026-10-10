import { canonicalize } from '../canonicalize.js';
import type { EvidenceCatalog } from './catalog.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import {
  CEG_MODEL_PROPOSALS_FORMAT,
  CEG_PRODUCER_RUN_FORMAT,
  MODEL_PRODUCER_ID,
  MODEL_PRODUCER_VERSION,
  compareText,
  domainPackRoot,
  type DomainPackV1,
} from './domain.js';
import { isRealDate } from './model.js';
import {
  canonicalRun,
  emptySource,
  observationId,
  packProvenance,
  producerConfigRoot,
  producerInputRoot,
  proposalId,
  textDigestOf,
  type CegAliasProposal,
  type CegObservation,
  type CegProducerRun,
  type CegProposal,
} from './proposals.js';

/**
 * Validates model proposal JSON. This module does not call a model.
 * Every proposal stays PROPOSED. autoAcceptModelOutput is false in this phase.
 */

export function validateModelProposals(input: {
  output: unknown;
  catalog?: EvidenceCatalog;
  domainPack?: DomainPackV1;
  model?: { id: string; version: string };
}): { ok: true; run: CegProducerRun } | { ok: false; diagnostics: CegDiagnostic[] } {
  const diagnostics: CegDiagnostic[] = [];
  if (!isRecord(input.output) || input.output.format !== CEG_MODEL_PROPOSALS_FORMAT) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', '', 'Model output must be ceg-model-proposals-1.')] };
  }
  const model = isRecord(input.output.model) && typeof input.output.model.id === 'string' && typeof input.output.model.version === 'string'
    ? { id: input.output.model.id, version: input.output.model.version }
    : input.model;
  if (!model) diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', 'model', 'Model output needs a model id and version.'));
  const concepts = arrayOf(input.output.concepts, 'concepts', diagnostics);
  const relations = arrayOf(input.output.relations, 'relations', diagnostics);
  const bindings = arrayOf(input.output.bindings, 'bindings', diagnostics);
  const aliasesIn = arrayOf(input.output.aliases ?? [], 'aliases', diagnostics);
  if (diagnostics.some((item) => item.severity === 'error') || !model || !concepts || !relations || !bindings || !aliasesIn) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  const vocabulary = new Set(input.domainPack?.relations ?? []);
  const knownConcepts = new Set<string>();
  const proposals: CegProposal[] = [];
  const observations: CegObservation[] = [];
  const aliases: CegAliasProposal[] = [];
  for (const [index, item] of concepts.entries()) {
    const name = readString(item, 'name');
    const evidenceId = readString(item, 'evidenceId');
    if (!name || !evidenceId) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_UNGROUNDED', `concepts[${index}]`, 'A model concept needs a name and an evidence id.'));
      continue;
    }
    if (!grounded(evidenceId, item, input.catalog, diagnostics, `concepts[${index}]`)) continue;
    knownConcepts.add(name);
    const observation = observe(evidenceId, item, `model.concept.${name}`);
    observations.push(observation);
    proposals.push(propose({ concepts: { [name]: {} } }, observation, evidenceId, undefined));
  }
  for (const [index, item] of relations.entries()) {
    const from = readString(item, 'from');
    const type = readString(item, 'type');
    const to = readString(item, 'to');
    const evidenceId = readString(item, 'evidenceId');
    if (!from || !type || !to || !evidenceId) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_UNGROUNDED', `relations[${index}]`, 'A model relation needs endpoints, a type, and an evidence id.'));
      continue;
    }
    if (input.domainPack && !vocabulary.has(type)) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RELATION_UNKNOWN', `relations[${index}]`, `Relation "${type}" is outside the domain vocabulary.`));
      continue;
    }
    if (!grounded(evidenceId, item, input.catalog, diagnostics, `relations[${index}]`)) continue;
    knownConcepts.add(from);
    knownConcepts.add(to);
    const observation = observe(evidenceId, item, `model.relation.${from}.${type}.${to}`);
    observations.push(observation);
    proposals.push(propose({
      concepts: { [from]: {}, [to]: {} },
      relations: [{ from, type, to }],
      evidence: { [evidenceId]: { objectId: evidenceId } },
    }, observation, evidenceId, confidenceOf(item)));
  }
  for (const [index, item] of bindings.entries()) {
    const concept = readString(item, 'concept');
    const evidenceId = readString(item, 'evidenceId');
    const requirements = stringList(item, 'requirements');
    if (!concept || !evidenceId || !requirements) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_UNGROUNDED', `bindings[${index}]`, 'A model binding needs a concept, evidence id, and requirements.'));
      continue;
    }
    if (!grounded(evidenceId, item, input.catalog, diagnostics, `bindings[${index}]`)) continue;
    const binding: { concept: string; evidence: string; requirements: string[]; validFrom?: string; validUntil?: string } = {
      concept,
      evidence: evidenceId,
      requirements,
    };
    const quote = quoteText(item, input.catalog, evidenceId);
    if (typeof item.validFrom === 'string') {
      if (!isRealDate(item.validFrom) || !quote.includes(item.validFrom)) {
        diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_INCOMPLETE_REFERENCE', `bindings[${index}].validFrom`, 'A model date was not present in the quoted evidence.'));
      } else binding.validFrom = item.validFrom;
    }
    if (typeof item.validUntil === 'string') {
      if (!isRealDate(item.validUntil) || !quote.includes(item.validUntil)) {
        diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_INCOMPLETE_REFERENCE', `bindings[${index}].validUntil`, 'A model date was not present in the quoted evidence.'));
      } else binding.validUntil = item.validUntil;
    }
    if (item.authority !== undefined) {
      const authorityText = String(item.authority);
      if (!quote.includes(authorityText)) {
        diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_AUTHORITY_UNGROUNDED', `bindings[${index}].authority`, 'Model authority was not copied. It is not evidence authority.'));
      }
    }
    const observation = observe(evidenceId, item, `model.binding.${concept}`);
    observations.push(observation);
    proposals.push(propose({
      concepts: { [concept]: {} },
      evidence: { [evidenceId]: { objectId: evidenceId } },
      bindings: [binding],
      requirements,
    }, observation, evidenceId, confidenceOf(item)));
  }
  for (const [index, item] of aliasesIn.entries()) {
    const phrase = readString(item, 'phrase');
    const concept = readString(item, 'concept');
    if (!phrase || !concept) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', `aliases[${index}]`, 'An alias proposal needs a phrase and a concept.'));
      continue;
    }
    const alias: CegAliasProposal = { phrase, concept };
    const evidenceId = readString(item, 'evidenceId');
    if (evidenceId) alias.evidenceId = evidenceId;
    aliases.push(alias);
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  const root = input.domainPack ? domainPackRoot(input.domainPack) : undefined;
  const configRoot = producerConfigRoot({
    producerId: MODEL_PRODUCER_ID,
    producerVersion: MODEL_PRODUCER_VERSION,
    limits: { autoAcceptModelOutput: false, modelId: model.id, modelVersion: model.version },
  });
  const image = input.catalog ? {
    stateRoot: input.catalog.stateRoot,
    objectRoot: input.catalog.objectRoot,
    commitDigest: input.catalog.commitDigest,
    knowledgeRoot: input.catalog.knowledgeRoot,
  } : undefined;
  const run: CegProducerRun = {
    format: CEG_PRODUCER_RUN_FORMAT,
    producer: { id: MODEL_PRODUCER_ID, version: MODEL_PRODUCER_VERSION },
    fragment: emptySource(),
    diagnostics: sortDiagnostics(diagnostics),
    observations: observations.sort((left, right) => compareText(left.id, right.id)),
    proposals: proposals.sort((left, right) => compareText(left.id, right.id)),
    aliases,
    provenance: {
      producerId: MODEL_PRODUCER_ID,
      producerVersion: MODEL_PRODUCER_VERSION,
      ...packProvenance(input.domainPack, root),
      ...(image ? { image } : {}),
      configRoot,
      inputRoot: producerInputRoot({ configRoot, domainPackRoot: root, image }),
    },
  };
  return { ok: true, run: canonicalRun(run) };
}

function propose(fragment: CegProposal['fragment'], observation: CegObservation, evidenceId: string, confidence: number | undefined): CegProposal {
  const proposal: CegProposal = {
    id: '',
    state: 'PROPOSED',
    producerId: MODEL_PRODUCER_ID,
    producerVersion: MODEL_PRODUCER_VERSION,
    ruleId: observation.ruleId,
    evidenceId,
    observationId: observation.id,
    fragment,
  };
  if (confidence !== undefined) proposal.confidence = confidence;
  proposal.id = proposalId(proposal);
  return proposal;
}

function observe(evidenceId: string, item: Record<string, unknown>, ruleId: string): CegObservation {
  const span = spanOf(item);
  const excerpt = typeof item.quote === 'string' ? item.quote : '';
  const observation: CegObservation = {
    id: '',
    evidenceId,
    producerId: MODEL_PRODUCER_ID,
    producerVersion: MODEL_PRODUCER_VERSION,
    ruleId,
    textDigest: textDigestOf(excerpt),
    excerpt,
    proposedConcepts: [],
    proposedRelations: [],
  };
  if (span) observation.span = span;
  observation.id = observationId(observation);
  return observation;
}

function grounded(evidenceId: string, item: Record<string, unknown>, catalog: EvidenceCatalog | undefined, diagnostics: CegDiagnostic[], path: string): boolean {
  if (!catalog) return true;
  const object = catalog.objects.find((candidate) => candidate.id === evidenceId);
  if (!object) {
    diagnostics.push(diagnostic('error', 'CEG_EVIDENCE_NOT_FOUND', path, 'Model output names evidence that is not in the image.'));
    return false;
  }
  const span = spanOf(item);
  if (span && (span.start < 0 || span.end < span.start || span.end > object.text.length)) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', path, 'The evidence span does not fit the object text.'));
    return false;
  }
  if (typeof item.quote === 'string') {
    const slice = span ? object.text.slice(span.start, span.end) : '';
    if (span && slice !== item.quote) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', path, 'The quoted evidence does not match the span.'));
      return false;
    }
    if (!span && !object.text.includes(item.quote)) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_UNGROUNDED', path, 'The quote was not found in the evidence text.'));
      return false;
    }
    if (item.quoteDigest !== undefined && item.quoteDigest !== textDigestOf(item.quote)) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', path, 'quoteDigest does not match the quote.'));
      return false;
    }
  }
  return true;
}

function quoteText(item: Record<string, unknown>, catalog: EvidenceCatalog | undefined, evidenceId: string): string {
  if (typeof item.quote === 'string') return item.quote;
  const object = catalog?.objects.find((candidate) => candidate.id === evidenceId);
  const span = spanOf(item);
  if (object && span) return object.text.slice(span.start, span.end);
  return '';
}

function spanOf(item: Record<string, unknown>): { start: number; end: number } | null {
  if (!isRecord(item.span) || typeof item.span.start !== 'number' || typeof item.span.end !== 'number') return null;
  if (!Number.isInteger(item.span.start) || !Number.isInteger(item.span.end)) return null;
  return { start: item.span.start, end: item.span.end };
}

function confidenceOf(item: Record<string, unknown>): number | undefined {
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) return undefined;
  return item.confidence;
}

function arrayOf(value: unknown, path: string, diagnostics: CegDiagnostic[]): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', path, `${path} must be an array.`));
    return null;
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', `${path}[${index}]`, 'Expected an object.'));
      continue;
    }
    rows.push(item);
  }
  return rows;
}

function readString(item: Record<string, unknown> | null, key: string): string | null {
  if (!item) return null;
  const value = item[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringList(item: Record<string, unknown> | null, key: string): string[] | null {
  if (!item || !Array.isArray(item[key])) return null;
  const values = item[key] as unknown[];
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) return null;
  return values as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
