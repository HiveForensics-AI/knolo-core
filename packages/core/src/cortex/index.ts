/**
 * Knolo Cortex for `@knolo/core/cortex`.
 *
 * Reasoned evidence retrieval over a mounted pack or Knowledge Image.
 * The host owns any model. This entry does not call a network and it does
 * not decide that an answer is true. The root `@knolo/core` memory helper
 * `createCortex` is a different API and stays on the root export.
 */

export { CORTEX_CODES, CortexError } from './errors.js';
export type { CortexCode } from './errors.js';
export { CORTEX_DEFAULT_POLICY, CORTEX_LIMITS, resolveCortexPolicy, validateCortexPolicy } from './policy.js';
export {
  CORTEX_ANSWER_STATUSES,
  CORTEX_DOSSIER_FORMAT,
  CORTEX_MODES,
  CORTEX_TRACE_FORMAT,
} from './types.js';
export type {
  CortexAnswerStatus,
  CortexAnswerV1,
  CortexCitationV1,
  CortexClaimV1,
  CortexDossier,
  CortexEvidenceRefV1,
  CortexExplanation,
  CortexGapV1,
  CortexImageIdentity,
  CortexMode,
  CortexPolicyV1,
  CortexQueryReceiptV1,
  CortexRoundV1,
  CortexTraceV1,
  CortexVerification,
  KarResultRefV1,
} from './types.js';
export { cortexAnswerRoot, cortexEvidenceRoot, cortexQuestionDigest, cortexTraceRoot } from './roots.js';
export { validateCortexTrace } from './validate.js';
export { explainCortexAnswer, explainCortexTrace } from './explain.js';
export { createCortexSession } from './session.js';
export type { CortexModelAdapter, CortexSession } from './session.js';
export type { CortexRetriever } from './retrieve.js';
export { askCortex, runCortexRetrievalRound } from './loop.js';
export { verifyCortexAnswer } from './verify.js';
export { createCortexDossier, verifyCortexDossier } from './dossier.js';
