export const COMPOSITION_CODES = [
  'COMPOSITION_INVALID',
  'COMPOSITION_MEMBER_MISSING',
  'COMPOSITION_DIGEST_MISMATCH',
  'COMPOSITION_ROOT_MISMATCH',
  'COMPOSITION_CYCLE',
  'COMPOSITION_DEPTH_EXCEEDED',
  'COMPOSITION_DUPLICATE',
  'COMPOSITION_POLICY_DENIED',
  'COMPOSITION_POLICY_INVALID',
  'COMPOSITION_UNSUPPORTED',
  'COMPOSITION_DOMAIN_PACK_UNVERIFIED',
  'COMPOSITION_KAR_UNBOUND',
  'COMPOSITION_NOT_QUERYABLE',
  'EXCERPT_INVALID',
  'EXCERPT_PARENT_MISSING',
  'EXCERPT_NOT_INCLUDED',
  'EXCERPT_INCLUSION_MISMATCH',
  'ATTESTATION_INVALID',
  'ATTESTATION_MISMATCH',
  'ATTESTATION_SIGNATURE_INVALID',
  'ATTESTATION_EXPIRED',
  'ATTESTATION_KEY_MISMATCH',
] as const;

export type CompositionCode = (typeof COMPOSITION_CODES)[number];

export class CompositionError extends Error {
  readonly code: CompositionCode;
  readonly path?: string;

  constructor(code: CompositionCode, message: string, path?: string, cause?: unknown) {
    super(message);
    this.name = 'CompositionError';
    this.code = code;
    this.path = path;
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
  }
}
