import { canonicalize, digest } from '../canonicalize.js';
import { CEG_SOURCE_VERSION } from './constants.js';
import {
  CEG_DECISIONS_FORMAT,
  CEG_PRODUCER_RUN_FORMAT,
  compareText,
  type DomainPackV1,
} from './domain.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import {
  canonicalCegSource,
  type CegBindingSource,
  type CegEvidenceSelector,
  type CegRelationSource,
  type CegSourceFragment,
  type CegSourceV1,
} from './model.js';

export const PROPOSAL_STATES = ['PROPOSED', 'ACCEPTED', 'REJECTED', 'NEEDS_REVIEW'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export type CegObservation = {
  id: string;
  evidenceId: string;
  producerId: string;
  producerVersion: string;
  ruleId?: string;
  span?: { start: number; end: number };
  textDigest?: string;
  excerpt?: string;
  proposedConcepts?: string[];
  proposedRelations?: CegRelationSource[];
};

export type CegAliasProposal = {
  phrase: string;
  concept: string;
  evidenceId?: string;
};

export type CegProposal = {
  id: string;
  state: ProposalState;
  producerId: string;
  producerVersion: string;
  ruleId?: string;
  evidenceId?: string;
  observationId?: string;
  /** Model confidence stays here. It is not EvidenceBinding.authority. */
  confidence?: number;
  fragment: CegSourceFragment;
};

export type CegProducerProvenance = {
  producerId: string;
  producerVersion: string;
  domainPackId?: string;
  domainPackVersion?: string;
  domainPackRoot?: string;
  image?: {
    stateRoot: string;
    objectRoot: string;
    commitDigest: string;
    knowledgeRoot: string;
  };
  configRoot: string;
  inputRoot: string;
};

export type CegProducerRun = {
  format: typeof CEG_PRODUCER_RUN_FORMAT;
  producer: { id: string; version: string };
  fragment: CegSourceV1;
  diagnostics: CegDiagnostic[];
  observations: CegObservation[];
  proposals: CegProposal[];
  aliases?: CegAliasProposal[];
  provenance: CegProducerProvenance;
};

const SUPPORT = new Set(['permits', 'requires', 'supports']);
const OPPOSITION = new Set(['prohibits', 'contradicts']);

export function observationId(parts: {
  evidenceId: string;
  producerId: string;
  producerVersion: string;
  ruleId?: string;
  span?: { start: number; end: number };
  textDigest?: string;
}): string {
  return digest({
    domain: 'ceg-observation-v1',
    evidenceId: parts.evidenceId,
    producerId: parts.producerId,
    producerVersion: parts.producerVersion,
    ruleId: parts.ruleId ?? null,
    start: parts.span?.start ?? null,
    end: parts.span?.end ?? null,
    textDigest: parts.textDigest ?? null,
  });
}

export function textDigestOf(text: string): string {
  return digest({ domain: 'ceg-span-v1', text });
}

export function proposalId(parts: {
  producerId: string;
  producerVersion: string;
  ruleId?: string;
  evidenceId?: string;
  observationId?: string;
  fragment: CegSourceFragment;
}): string {
  return digest({
    domain: 'ceg-proposal-v1',
    producerId: parts.producerId,
    producerVersion: parts.producerVersion,
    ruleId: parts.ruleId ?? null,
    evidenceId: parts.evidenceId ?? null,
    observationId: parts.observationId ?? null,
    fragment: canonicalFragment(parts.fragment),
  });
}

export function producerConfigRoot(parts: { producerId: string; producerVersion: string; limits: unknown }): string {
  return digest({
    format: 'ceg-producer-config-1',
    producer: parts.producerId,
    version: parts.producerVersion,
    limits: parts.limits,
  });
}

export function producerInputRoot(parts: {
  configRoot: string;
  domainPackRoot?: string;
  image?: CegProducerProvenance['image'];
}): string {
  return digest({
    format: 'ceg-producer-input-1',
    configRoot: parts.configRoot,
    domainPackRoot: parts.domainPackRoot ?? null,
    stateRoot: parts.image?.stateRoot ?? null,
    objectRoot: parts.image?.objectRoot ?? null,
    commitDigest: parts.image?.commitDigest ?? null,
    knowledgeRoot: parts.image?.knowledgeRoot ?? null,
  });
}

export function emptySource(): CegSourceV1 {
  return canonicalCegSource({
    format: CEG_SOURCE_VERSION,
    concepts: {},
    evidence: {},
    relations: [],
    bindings: [],
    requirements: [],
  });
}

export function mergeProducerFragments(parts: readonly CegSourceFragment[]): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  const diagnostics: CegDiagnostic[] = [];
  const concepts: CegSourceV1['concepts'] = {};
  const evidence: CegSourceV1['evidence'] = {};
  const relations: CegRelationSource[] = [];
  const bindings: CegBindingSource[] = [];
  const requirements: string[] = [];
  const relationKeys = new Set<string>();
  const bindingKeys = new Set<string>();
  const ordered = [...parts].sort((left, right) => compareText(canonicalize(canonicalFragment(left)), canonicalize(canonicalFragment(right))));
  for (const part of ordered) {
    for (const name of Object.keys(part.concepts ?? {}).sort(compareText)) {
      const incoming = part.concepts?.[name] ?? {};
      const current = concepts[name];
      if (!current) {
        concepts[name] = { ...incoming };
        continue;
      }
      if ((current.label ?? '') !== (incoming.label ?? '') || (current.note ?? '') !== (incoming.note ?? '')) {
        diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_CONCEPT_DIVERGENCE', `concepts.${name}`, `Concept "${name}" arrived with different authoring text.`));
        const label = [current.label, incoming.label].filter((item): item is string => item !== undefined).sort(compareText)[0];
        const note = [current.note, incoming.note].filter((item): item is string => item !== undefined).sort(compareText)[0];
        const next: CegSourceV1['concepts'][string] = {};
        if (label !== undefined) next.label = label;
        if (note !== undefined) next.note = note;
        concepts[name] = next;
      }
    }
    for (const alias of Object.keys(part.evidence ?? {}).sort(compareText)) {
      const selector = part.evidence?.[alias];
      if (!selector) continue;
      const current = evidence[alias];
      if (!current) {
        evidence[alias] = selector;
        continue;
      }
      if (canonicalize(current) !== canonicalize(selector)) {
        diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_EVIDENCE', `evidence.${alias}`, `Evidence alias "${alias}" has two selectors.`));
      }
    }
    for (const relation of part.relations ?? []) {
      const key = `${relation.from}\0${relation.type}\0${relation.to}`;
      if (relationKeys.has(key)) continue;
      relationKeys.add(key);
      relations.push({ from: relation.from, type: relation.type, to: relation.to });
    }
    for (const binding of part.bindings ?? []) {
      const key = bindingKey(binding);
      if (bindingKeys.has(key)) continue;
      bindingKeys.add(key);
      bindings.push({
        concept: binding.concept,
        evidence: binding.evidence,
        requirements: [...binding.requirements],
        ...(binding.authority !== undefined ? { authority: binding.authority } : {}),
        ...(binding.unauthorized !== undefined ? { unauthorized: binding.unauthorized } : {}),
        ...(binding.validFrom !== undefined ? { validFrom: binding.validFrom } : {}),
        ...(binding.validUntil !== undefined ? { validUntil: binding.validUntil } : {}),
        ...(binding.provenance !== undefined ? { provenance: binding.provenance } : {}),
      });
    }
    for (const requirement of part.requirements ?? []) {
      if (!requirements.includes(requirement)) requirements.push(requirement);
    }
  }
  const source = canonicalCegSource({
    format: CEG_SOURCE_VERSION,
    concepts,
    evidence,
    relations,
    bindings,
    requirements,
  });
  return { source, diagnostics: sortDiagnostics(diagnostics) };
}

export function relationConflicts(relations: readonly CegRelationSource[]): CegDiagnostic[] {
  const types = new Map<string, Set<string>>();
  for (const relation of relations) {
    const key = `${relation.from}\0${relation.to}`;
    const set = types.get(key) ?? new Set<string>();
    set.add(relation.type);
    types.set(key, set);
  }
  const diagnostics: CegDiagnostic[] = [];
  for (const [key, set] of [...types.entries()].sort((left, right) => compareText(left[0], right[0]))) {
    const support = [...set].some((type) => SUPPORT.has(type));
    const opposition = [...set].some((type) => OPPOSITION.has(type));
    if (support && opposition) {
      const [from, to] = key.split('\0');
      diagnostics.push(diagnostic(
        'warning',
        'CEG_PRODUCER_RELATION_CONFLICT',
        'relations',
        `Both support and opposition relate ${from} to ${to}. Both are kept.`,
      ));
    }
  }
  return diagnostics;
}

export function acceptedFragment(proposals: readonly CegProposal[]): { source: CegSourceV1; diagnostics: CegDiagnostic[] } {
  const accepted = proposals.filter((proposal) => proposal.state === 'ACCEPTED');
  return mergeProducerFragments(accepted.map((proposal) => proposal.fragment));
}

export function applyProducerDecisions(runInput: unknown, decisionsInput: unknown): { ok: true; source: CegSourceV1; diagnostics: CegDiagnostic[] } | { ok: false; diagnostics: CegDiagnostic[] } {
  const run = interpretRun(runInput);
  if (!run) return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', '', 'Producer run must be ceg-producer-run-1.')] };
  const decisions = interpretDecisions(decisionsInput);
  if (!decisions.ok) return decisions;
  const byId = new Map(run.proposals.map((proposal) => [proposal.id, proposal]));
  const diagnostics: CegDiagnostic[] = [];
  const chosen: CegProposal[] = [];
  for (const decision of decisions.decisions) {
    const proposal = byId.get(decision.id);
    if (!proposal) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', `decisions.${decision.id}`, 'Decision names an unknown proposal.'));
      continue;
    }
    chosen.push({ ...proposal, state: decision.state });
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  const decided = new Set(decisions.decisions.map((decision) => decision.id));
  for (const proposal of run.proposals) {
    if (!decided.has(proposal.id) && proposal.state === 'ACCEPTED') chosen.push(proposal);
  }
  const merged = mergeProducerFragments(chosen.filter((proposal) => proposal.state === 'ACCEPTED').map((proposal) => proposal.fragment));
  return { ok: true, source: merged.source, diagnostics: sortDiagnostics([...merged.diagnostics, ...diagnostics]) };
}

export function explainCegProposal(runInput: unknown, proposalId: string): { ok: true; explanation: Record<string, unknown> } | { ok: false; diagnostics: CegDiagnostic[] } {
  const run = interpretRun(runInput);
  if (!run) return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', '', 'Producer run must be ceg-producer-run-1.')] };
  const proposal = run.proposals.find((item) => item.id === proposalId);
  if (!proposal) return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', proposalId, 'Proposal was not found.')] };
  const observation = run.observations.find((item) => item.id === proposal.observationId);
  return {
    ok: true,
    explanation: {
      proposalId: proposal.id,
      state: proposal.state,
      producerId: proposal.producerId,
      producerVersion: proposal.producerVersion,
      domainPackId: run.provenance.domainPackId ?? null,
      domainPackRoot: run.provenance.domainPackRoot ?? null,
      ruleId: proposal.ruleId ?? null,
      evidenceId: proposal.evidenceId ?? null,
      span: observation?.span ?? null,
      excerpt: observation?.excerpt ?? null,
      textDigest: observation?.textDigest ?? null,
      confidence: proposal.confidence ?? null,
      fragment: canonicalFragment(proposal.fragment),
      aliases: run.aliases ?? [],
    },
  };
}

export function renderProducerReview(runInput: unknown): string {
  const run = interpretRun(runInput);
  if (!run) return 'CEG PRODUCER REVIEW\ninvalid producer run';
  const lines = [
    'CEG PRODUCER REVIEW',
    `producer   ${run.producer.id} ${run.producer.version}`,
    `domain     ${run.provenance.domainPackId ?? '(none)'} ${run.provenance.domainPackRoot ?? ''}`,
    `proposals  ${run.proposals.length}`,
  ];
  for (const proposal of run.proposals) {
    const observation = run.observations.find((item) => item.id === proposal.observationId);
    const relation = proposal.fragment.relations?.[0];
    lines.push('');
    lines.push('PROPOSAL');
    lines.push(proposal.id);
    lines.push(`state      ${proposal.state}`);
    if (relation) lines.push(`relation   ${relation.from} ${relation.type} ${relation.to}`);
    const concepts = Object.keys(proposal.fragment.concepts ?? {});
    if (concepts.length > 0) lines.push(`concepts   ${concepts.join(', ')}`);
    if (proposal.evidenceId) lines.push(`evidence   ${proposal.evidenceId}`);
    if (observation?.excerpt) lines.push(`text       ${observation.excerpt}`);
    lines.push(`producer   ${proposal.producerId}`);
    lines.push(`reason     ${proposal.ruleId ?? '(none)'}`);
    if (proposal.confidence !== undefined) lines.push(`confidence ${proposal.confidence}`);
    lines.push('decision   ACCEPTED or REJECTED in a ceg-decisions-1 file');
  }
  const covered = new Set(run.proposals.map((proposal) => proposal.observationId));
  for (const observation of run.observations) {
    if (covered.has(observation.id)) continue;
    lines.push('');
    lines.push('OBSERVATION');
    lines.push(observation.id);
    lines.push(`evidence   ${observation.evidenceId}`);
    lines.push(`reason     ${observation.ruleId ?? '(none)'}`);
    if (observation.excerpt) lines.push(`text       ${observation.excerpt}`);
  }
  if (run.aliases && run.aliases.length > 0) {
    lines.push('');
    lines.push('ALIAS PROPOSALS');
    for (const alias of run.aliases) lines.push(`${alias.phrase} -> ${alias.concept}`);
  }
  return lines.join('\n');
}

export function canonicalRun(run: CegProducerRun): CegProducerRun {
  const parsed = JSON.parse(canonicalize(run)) as CegProducerRun;
  return parsed;
}

export function interpretRun(value: unknown): CegProducerRun | null {
  if (!isRecord(value) || value.format !== CEG_PRODUCER_RUN_FORMAT) return null;
  if (!isRecord(value.producer) || typeof value.producer.id !== 'string' || typeof value.producer.version !== 'string') return null;
  if (!isRecord(value.fragment) || !Array.isArray(value.diagnostics) || !Array.isArray(value.observations) || !Array.isArray(value.proposals)) return null;
  if (!isRecord(value.provenance)) return null;
  return value as unknown as CegProducerRun;
}

export function packProvenance(pack: DomainPackV1 | undefined, root: string | undefined): Pick<CegProducerProvenance, 'domainPackId' | 'domainPackVersion' | 'domainPackRoot'> {
  if (!pack || !root) return {};
  return { domainPackId: pack.id, domainPackVersion: pack.version, domainPackRoot: root };
}

function interpretDecisions(value: unknown): { ok: true; decisions: Array<{ id: string; state: ProposalState }> } | { ok: false; diagnostics: CegDiagnostic[] } {
  if (!isRecord(value) || value.format !== CEG_DECISIONS_FORMAT || !Array.isArray(value.decisions)) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', 'decisions', 'Decisions must be ceg-decisions-1.')] };
  }
  const decisions: Array<{ id: string; state: ProposalState }> = [];
  const seen = new Set<string>();
  const diagnostics: CegDiagnostic[] = [];
  for (const [index, item] of value.decisions.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.state !== 'string' || !(PROPOSAL_STATES as readonly string[]).includes(item.state)) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', `decisions[${index}]`, 'A decision needs a proposal id and a state.'));
      continue;
    }
    if (seen.has(item.id)) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', `decisions.${item.id}`, 'Duplicate decision.'));
      continue;
    }
    seen.add(item.id);
    decisions.push({ id: item.id, state: item.state as ProposalState });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, decisions };
}

function canonicalFragment(fragment: CegSourceFragment): CegSourceV1 {
  return canonicalCegSource({
    format: CEG_SOURCE_VERSION,
    concepts: fragment.concepts ?? {},
    evidence: fragment.evidence ?? {},
    relations: fragment.relations ?? [],
    bindings: fragment.bindings ?? [],
    requirements: fragment.requirements ?? [],
  });
}

function bindingKey(binding: CegBindingSource): string {
  return [
    binding.concept,
    binding.evidence,
    [...binding.requirements].sort(compareText).join('\0'),
    binding.authority ?? '',
    binding.unauthorized === true ? '1' : '0',
    binding.validFrom ?? '',
    binding.validUntil ?? '',
    binding.provenance ?? '',
  ].join('\u001f');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function selectorObject(selector: CegEvidenceSelector): CegEvidenceSelector {
  return selector;
}
