/**
 * Experimental CEG authoring for `@knolo/core/experimental/kar/authoring`.
 *
 * This module compiles human source into the frozen KarSidecarV1 consumed by
 * `kar-1-research-1`. It does not change KAR retrieval. It does not call a model.
 */

import type { KarImageInput } from '../v5.js';
import { compileCegSource, type CegCompilation } from './compile.js';
import { CEG_SOURCE_VERSION } from './constants.js';
import { diffCegGraphs } from './diff.js';
import { canonicalCegSource, type CegSourceFragment, type CegSourceV1 } from './model.js';
import type { DomainPackV1 } from './domain.js';
import { mergeCegSources } from './source.js';

export { CEG_BUILD_FORMAT, CEG_COMPILER_ID, CEG_COMPILER_PRODUCER, CEG_IMPORT_MAP_FORMAT, CEG_LIMITS, CEG_SOURCE_VERSION, KAR_DISTRIBUTION_FORMAT } from './constants.js';
export type { CegLimits } from './constants.js';
export type { CegDiagnostic, CegSeverity } from './diagnostics.js';
export type { CegBindingSource, CegConcept, CegEvidenceSelector, CegRelationSource, CegSourceFragment, CegSourceV1 } from './model.js';
export { canonicalCegSource, interpretCegSource } from './model.js';
export { parseCegSource } from './parse.js';
export { CegSourceBuilder, addCegBinding, addCegConcept, addCegEvidence, addCegRelation, createCegSource, emitCegSourceJson, emitCegSourceYaml, mergeCegSources } from './source.js';
export { lintCegSource } from './lint.js';
export { compileCegSource, serializeCegBuild } from './compile.js';
export type { CegBuildRecord, CegCompilation } from './compile.js';
export { diffCegGraphs } from './diff.js';
export type { CegDiff } from './diff.js';
export { inspectCegQuality, inspectKarReadiness } from './quality.js';
export type { CegQuality, KarReadiness } from './quality.js';
export { buildDistributionFiles, checkCegFreshness, hashBytes, loadKarBundle, validateCegBuild } from './distribution.js';
export type { KarDistributionManifest } from './distribution.js';
export { importClaimGraph, readImageClaimGraph } from './import-claim.js';
export { importJsonGraph } from './import-json.js';
export { renderCegReview, reviewCegSource } from './review.js';
export type { CegReview } from './review.js';
export { cegBindingId, cegNodeId, cegRelationId } from './ids.js';
export { parseAuthoringDocument } from './parse.js';
export {
  CEG_DECISIONS_FORMAT,
  CEG_DOMAIN_FORMAT,
  CEG_MODEL_PROPOSALS_FORMAT,
  CEG_ONTOLOGY_MAP_FORMAT,
  CEG_PRODUCER_RUN_FORMAT,
  MODEL_PRODUCER_ID,
  MODEL_PRODUCER_VERSION,
  ONTOLOGY_PRODUCER_ID,
  ONTOLOGY_PRODUCER_VERSION,
  PRODUCER_LIMITS,
  RULE_PRODUCER_ID,
  RULE_PRODUCER_VERSION,
  domainPackRoot,
  inspectDomainPack,
  instantiatePlanTemplate,
  interpretDomainPack,
  regexIsSafe,
} from './domain.js';
export type { DomainPackV1, DomainRule, ProducerLimits } from './domain.js';
export { createRuleCegProducer, runRuleProducer } from './rules.js';
export type { ProducerCache } from './rules.js';
export { createOntologyCegProducer, runOntologyProducer } from './ontology.js';
export { validateModelProposals } from './model-proposals.js';
export {
  applyProducerDecisions,
  explainCegProposal,
  mergeProducerFragments,
  renderProducerReview,
} from './proposals.js';
export type { CegObservation, CegProducerProvenance, CegProducerRun, CegProposal, ProposalState } from './proposals.js';
export { renderDomainTest, testDomainFixtures } from './domain-test.js';
export type { DomainFixture, DomainTestReport } from './domain-test.js';

export type CegProducerInput = {
  image?: KarImageInput;
  notes?: string;
  domainPack?: DomainPackV1;
};

export interface CegProducer {
  id: string;
  version: string;
  produce(input: CegProducerInput): Promise<CegSourceV1 | CegSourceFragment>;
}

export async function produceCegSource(
  producer: CegProducer,
  input: CegProducerInput = {},
): Promise<{ source: CegSourceV1; diagnostics: CegCompilation['diagnostics'] }> {
  const produced = await producer.produce(input);
  if ('format' in produced && produced.format === CEG_SOURCE_VERSION) {
    return { source: canonicalCegSource(produced), diagnostics: [] };
  }
  return mergeCegSources([produced]);
}

export function rebuildCegSource(input: {
  source: CegSourceV1;
  image: KarImageInput;
  previous?: unknown;
  plan?: unknown;
}): { compilation: CegCompilation; diff: ReturnType<typeof diffCegGraphs> | null } {
  const compilation = compileCegSource({ source: input.source, image: input.image, plan: input.plan });
  if (!compilation.ok || input.previous === undefined) return { compilation, diff: null };
  return { compilation, diff: diffCegGraphs(input.previous, compilation.sidecar) };
}

