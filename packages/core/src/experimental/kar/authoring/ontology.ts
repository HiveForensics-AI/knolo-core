import { canonicalize } from '../canonicalize.js';
import type { KarImageInput } from '../v5.js';
import { openEvidenceCatalog, resolveEvidenceSelector, type EvidenceCatalog } from './catalog.js';
import { CEG_IMPORT_MAP_FORMAT } from './constants.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import { CEG_ONTOLOGY_MAP_FORMAT, CEG_PRODUCER_RUN_FORMAT, ONTOLOGY_PRODUCER_ID, ONTOLOGY_PRODUCER_VERSION, domainPackRoot, type DomainPackV1 } from './domain.js';
import { importJsonGraph } from './import-json.js';
import type { CegEvidenceSelector, CegSourceV1 } from './model.js';
import {
  canonicalRun,
  emptySource,
  observationId,
  packProvenance,
  producerConfigRoot,
  producerInputRoot,
  proposalId,
  relationConflicts,
  textDigestOf,
  type CegObservation,
  type CegProducerRun,
  type CegProposal,
  type ProposalState,
} from './proposals.js';

export function createOntologyCegProducer(options: { ontology: unknown; mapping: unknown; auto?: boolean }): {
  id: string;
  version: string;
  produce(input: { image?: KarImageInput }): Promise<CegSourceV1>;
} {
  return {
    id: ONTOLOGY_PRODUCER_ID,
    version: ONTOLOGY_PRODUCER_VERSION,
    async produce(input) {
      const ran = runOntologyProducer({ ontology: options.ontology, mapping: options.mapping, image: input.image, auto: options.auto === true });
      if (!ran.ok) throw new Error(ran.diagnostics.map((item) => item.code).join(','));
      return ran.run.fragment;
    },
  };
}

export function runOntologyProducer(input: {
  ontology: unknown;
  mapping: unknown;
  image?: KarImageInput;
  catalog?: EvidenceCatalog;
  domainPack?: DomainPackV1;
  auto?: boolean;
}): { ok: true; run: CegProducerRun } | { ok: false; diagnostics: CegDiagnostic[] } {
  const mapping = normalizeMapping(input.mapping);
  if (!mapping.ok) return mapping;
  const imported = importJsonGraph(input.ontology, mapping.value);
  if (!imported.ok) return imported;
  const opened = input.catalog ? { ok: true as const, catalog: input.catalog } : input.image ? openEvidenceCatalog(input.image) : null;
  if (input.image && opened && !opened.ok) return opened;
  const diagnostics = [...imported.diagnostics];
  const source = imported.source;
  if (opened && opened.ok) {
    for (const [alias, selector] of Object.entries(source.evidence)) {
      const resolved = resolveEvidenceSelector(selector, opened.catalog, `evidence.${alias}`);
      if (!resolved.ok) diagnostics.push(resolved.diagnostic);
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  const state: ProposalState = input.auto === true ? 'ACCEPTED' : 'NEEDS_REVIEW';
  const observations: CegObservation[] = [];
  const proposals: CegProposal[] = [];
  for (const [alias, selector] of Object.entries(source.evidence).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const evidenceId = 'objectId' in selector ? selector.objectId : alias;
    const observation = baseObservation(evidenceId, `ontology.evidence.${alias}`, selector);
    observations.push(observation);
  }
  for (const name of Object.keys(source.concepts).sort()) {
    proposals.push(proposalFor({ concepts: { [name]: source.concepts[name] ?? {} } }, state, `ontology.concept.${name}`, undefined));
  }
  for (const relation of source.relations) {
    proposals.push(proposalFor({ relations: [relation] }, state, `ontology.relation.${relation.from}.${relation.type}.${relation.to}`, undefined));
  }
  for (const binding of source.bindings) {
    const selector = source.evidence[binding.evidence];
    const evidenceId = selector && 'objectId' in selector ? selector.objectId : binding.evidence;
    const observation = observations.find((item) => item.evidenceId === evidenceId) ?? baseObservation(evidenceId, `ontology.binding.${binding.concept}`, { objectId: evidenceId });
    if (!observations.includes(observation)) observations.push(observation);
    proposals.push(proposalFor({
      concepts: { [binding.concept]: source.concepts[binding.concept] ?? {} },
      evidence: { [binding.evidence]: source.evidence[binding.evidence] ?? { objectId: evidenceId } },
      bindings: [binding],
      requirements: [...binding.requirements],
    }, state, `ontology.binding.${binding.concept}`, observation.id, evidenceId));
  }
  diagnostics.push(...relationConflicts(source.relations));
  const accepted = state === 'ACCEPTED' ? source : emptySource();
  const root = input.domainPack ? domainPackRoot(input.domainPack) : undefined;
  const configRoot = producerConfigRoot({
    producerId: ONTOLOGY_PRODUCER_ID,
    producerVersion: ONTOLOGY_PRODUCER_VERSION,
    limits: { auto: input.auto === true },
  });
  const image = opened && opened.ok ? {
    stateRoot: opened.catalog.stateRoot,
    objectRoot: opened.catalog.objectRoot,
    commitDigest: opened.catalog.commitDigest,
    knowledgeRoot: opened.catalog.knowledgeRoot,
  } : undefined;
  const run: CegProducerRun = {
    format: CEG_PRODUCER_RUN_FORMAT,
    producer: { id: ONTOLOGY_PRODUCER_ID, version: ONTOLOGY_PRODUCER_VERSION },
    fragment: accepted,
    diagnostics: sortDiagnostics(diagnostics),
    observations: observations.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    proposals: proposals.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    provenance: {
      producerId: ONTOLOGY_PRODUCER_ID,
      producerVersion: ONTOLOGY_PRODUCER_VERSION,
      ...packProvenance(input.domainPack, root),
      ...(image ? { image } : {}),
      configRoot,
      inputRoot: producerInputRoot({ configRoot, domainPackRoot: root, image }),
    },
  };
  return { ok: true, run: canonicalRun(run) };
}

function proposalFor(fragment: CegProposal['fragment'], state: ProposalState, ruleId: string, observationId?: string, evidenceId?: string): CegProposal {
  const proposal: CegProposal = {
    id: '',
    state,
    producerId: ONTOLOGY_PRODUCER_ID,
    producerVersion: ONTOLOGY_PRODUCER_VERSION,
    ruleId,
    fragment,
  };
  if (observationId) proposal.observationId = observationId;
  if (evidenceId) proposal.evidenceId = evidenceId;
  proposal.id = proposalId(proposal);
  return proposal;
}

function baseObservation(evidenceId: string, ruleId: string, selector: CegEvidenceSelector): CegObservation {
  const excerpt = canonicalize(selector);
  const observation: CegObservation = {
    id: '',
    evidenceId,
    producerId: ONTOLOGY_PRODUCER_ID,
    producerVersion: ONTOLOGY_PRODUCER_VERSION,
    ruleId,
    textDigest: textDigestOf(excerpt),
    excerpt,
  };
  observation.id = observationId(observation);
  return observation;
}

function normalizeMapping(value: unknown): { ok: true; value: unknown } | { ok: false; diagnostics: CegDiagnostic[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', 'mapping', 'Ontology mapping must be an object.')] };
  }
  const record = value as Record<string, unknown>;
  if (record.format !== CEG_ONTOLOGY_MAP_FORMAT && record.format !== CEG_IMPORT_MAP_FORMAT) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_OUTPUT_INVALID', 'mapping.format', 'Mapping format must be ceg-ontology-map-1.')] };
  }
  return { ok: true, value: { ...record, format: CEG_IMPORT_MAP_FORMAT } };
}
