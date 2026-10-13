/**
 * Verifiable composition and attestation for `@knolo/core/composition`.
 *
 * A composition record cites Knowledge Images, packs, KAR sidecars, Domain
 * Packs, and bounded excerpts. It does not change a V5 state root or a KAR
 * root, and it is not a truth verdict. `used` means a query or evaluation ran.
 */

export {
  ATTESTATION_FORMAT,
  BUNDLE_FORMAT,
  COMMERCE_FORMAT,
  COMPOSITION_FORMAT,
  COMPOSITION_MAX_ALIAS_LENGTH,
  COMPOSITION_MAX_DEPTH,
  COMPOSITION_MAX_FILES,
  COMPOSITION_MAX_MEMBERS,
  COMPOSITION_MAX_PATH_LENGTH,
  EXCERPT_FORMAT,
  EXCERPT_MAX_OBJECTS,
  MEMBERS_FORMAT,
  SIGNATURE_FORMAT,
} from './constants.js';
export { COMPOSITION_CODES, CompositionError } from './errors.js';
export type { CompositionCode } from './errors.js';
export {
  assertCompositionRoot,
  compositionFileSetRoot,
  createCompositionRecord,
  parseCompositionRecord,
  verifyCompositionRecord,
} from './record.js';
export type {
  Availability,
  CompositionCreateInput,
  CompositionHost,
  CompositionMember,
  CompositionPolicy,
  CompositionRecord,
  CompositionVerification,
  CompositionVerifyOptions,
  DomainPackIdentity,
  KarBinding,
  MemberKind,
  MemberMaterial,
} from './record.js';
export { createBoundedExcerpt, parseExcerpt, verifyBoundedExcerpt } from './excerpt.js';
export type { ExcerptRecord, ExcerptVerification } from './excerpt.js';
export {
  attestationSignaturePayload,
  createCompositionAttestation,
  parseAttestation,
  verifyCompositionAttestation,
  withCompositionSignature,
} from './attestation.js';
export type {
  AttestationStatement,
  AttestationSubject,
  AttestationVerification,
  CompositionAttestation,
  SignatureInput,
} from './attestation.js';
export {
  evaluateComposedKar,
  karCompositionBinder,
  openComposedSession,
  queryComposedSession,
} from './session.js';
export type { ComposedQueryResult, ComposedSession } from './session.js';
