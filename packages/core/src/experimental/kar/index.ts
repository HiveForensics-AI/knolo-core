/**
 * Experimental KAR API for `@knolo/core/experimental/kar`.
 *
 * Semantics are frozen at `kar-1-research-1`. This module is not exported
 * from the `@knolo/core` root. A normal import of `@knolo/core` does not
 * load it.
 *
 * Knowledge Image bytes are the evidence. The Committed Evidence Graph (CEG)
 * is a sidecar of relationships over that evidence. KAR retrieves a minimum
 * evidence set for the declared frontiers. `stateRoot` is the V5 identity.
 * `knowledgeRoot` is the frozen research projection root. They are not the
 * same digest.
 */

export { KAR_API, KAR_VERSION, KarError, karStatusCode } from './types.js';
export type {
  Bounds,
  CommittedEvidenceGraph,
  Decision,
  EvidenceBinding,
  EvidenceChoice,
  Frontier,
  Graph,
  Image,
  KarEvaluation,
  KarImageIdentity,
  KarIndexes,
  KarIssue,
  KarResult,
  KarSelectedEvidence,
  KarSidecarV1,
  PathStep,
  Plan,
  Profile,
  Relation,
  Roots,
  Status,
  Witness,
} from './types.js';

export { createKarProjectionSession, createKarSession, evaluateKar } from './session.js';
export type { KarSession } from './session.js';
export { evaluateKarProjection } from './evaluate.js';
export { verifyKar, verifyKarProjection } from './verify.js';
export type { KarVerification } from './verify.js';
export { explainKarCertificate, explainKarResult, renderKarEvaluation, renderKarExplanation } from './explain.js';
export type { KarExplanation, KarExplanationEvidence } from './explain.js';
export { inspectKarComplexity } from './complexity.js';
export type { KarComplexity, KarComplexityRisk } from './complexity.js';
export { validateKarPlan, validateKarResult, validateKarSidecar } from './validate.js';
export type { Validation } from './validate.js';
