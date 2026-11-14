/**
 * KITE-1 phase 1 for `@knolo/core/kite`.
 *
 * Names the typed obligations a question still has open. Each unmet
 * obligation gets one V5 chunk retrieval, and that retrieval names the
 * obligation. This entry does not call a model, does not write a
 * certificate, and does not change Cortex or KAR.
 * The root `@knolo/core` entry does not load this module.
 */

export { KITE_CODES, KiteError } from './errors.js';
export type { KiteCode } from './errors.js';
export { parseKiteContract, resolveKiteBounds } from './contract.js';
export { namedRetrieval } from './discover.js';
export { evaluateKite } from './obligations.js';
export {
  KITE_BOUNDS,
  KITE_CONDITION_KINDS,
  KITE_CONTRACT_FORMAT,
  KITE_EVALUATION_FORMAT,
} from './types.js';
export type {
  KiteBounds,
  KiteConditionKind,
  KiteContract,
  KiteEvaluation,
  KiteObligation,
  KiteObligationResult,
  KiteRetrieval,
} from './types.js';
