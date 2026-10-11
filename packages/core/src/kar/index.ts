/**
 * Knolo Adversarial Retrieval (KAR) for `@knolo/core/kar`.
 *
 * KAR retrieves a minimum evidence set under a declared plan. It is not a
 * ranked-passage search. Semantics stay `kar-1-research-1`.
 *
 * The `@knolo/core` root does not load this module. CEG authoring is a
 * separate entry. The experimental KAR entry remains available for the V6 cycle.
 */

export { KAR_VERSION, KarError, karStatusCode } from '../experimental/kar/index.js';
export type {
  Bounds,
  CommittedEvidenceGraph,
  Decision,
  EvidenceBinding,
  Frontier,
  KarEvaluation,
  KarImageIdentity,
  KarResult,
  KarSelectedEvidence,
  KarSidecarV1,
  Plan,
  Roots,
  Status,
  Witness,
} from '../experimental/kar/index.js';
export { createKarSession, evaluateKar } from '../experimental/kar/index.js';
export type { KarSession } from '../experimental/kar/index.js';
export { verifyKar } from '../experimental/kar/index.js';
export type { KarVerification } from '../experimental/kar/index.js';
export {
  explainKarCertificate,
  explainKarResult,
  renderKarEvaluation,
  renderKarExplanation,
} from '../experimental/kar/index.js';
export type { KarExplanation } from '../experimental/kar/index.js';
export { inspectKarComplexity } from '../experimental/kar/index.js';
export type { KarComplexity, KarComplexityRisk } from '../experimental/kar/index.js';
export {
  createKarDossier,
  karDossierStatusStatement,
  renderKarDossier,
  verifyKarDossier,
} from '../experimental/kar/index.js';
export type { KarDossier } from '../experimental/kar/index.js';
