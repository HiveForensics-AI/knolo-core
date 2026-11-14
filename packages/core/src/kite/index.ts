/**
 * KITE-1 for `@knolo/core/kite`.
 *
 * Phase 1 names unmet obligations on one V5 chunk retrieval.
 * Later phases apply typed rules, enumerate declared changes, and
 * commit an InvarianceRoot beside stateRoot. A certificate is an
 * integrity check of that derivation. It does not mean a claim is true.
 * The root `@knolo/core` entry does not load this module.
 */

export { KITE_CODES, KiteError } from './errors.js';
export type { KiteCode } from './errors.js';
export { parseKiteContract, resolveKiteBounds } from './contract.js';
export { namedRetrieval } from './discover.js';
export { evaluateKite } from './obligations.js';
export { deriveKiteWorld, labelKiteWorld } from './derivation.js';
export { invarianceRoot } from './invariance.js';
export {
  parseKiteChanges,
  parseKiteCompleteness,
  parseKiteDelta,
  parseKiteRules,
} from './rules.js';
export { createKiteSession, evaluateKiteSession } from './session.js';
export type { KiteSession } from './session.js';
export { parseKiteCertificate } from './certificate.js';
export { verifyKiteCertificate } from './verify.js';
export type { KiteVerification } from './verify.js';
export { reviewKiteDelta } from './delta.js';
export {
  KITE_BOUNDS,
  KITE_CERTIFICATE_FORMAT,
  KITE_CHANGES_FORMAT,
  KITE_COMPLETENESS_FORMAT,
  KITE_CONDITION_KINDS,
  KITE_CONTRACT_FORMAT,
  KITE_DELTA_FORMAT,
  KITE_EVALUATION_FORMAT,
  KITE_RESULT_FORMAT,
  KITE_RULES_FORMAT,
  KITE_VERDICTS,
  KITE_WORLD_FORMAT,
  KITE_WORLD_LABELS,
} from './types.js';
export type {
  KiteBounds,
  KiteCertificate,
  KiteChange,
  KiteChangeSet,
  KiteCompleteness,
  KiteConditionKind,
  KiteContract,
  KiteDelta,
  KiteDependencies,
  KiteDerivation,
  KiteEvaluation,
  KiteObligation,
  KiteObligationResult,
  KiteRetrieval,
  KiteRules,
  KiteSessionResult,
  KiteVerdict,
  KiteWorld,
  KiteWorldLabel,
} from './types.js';
