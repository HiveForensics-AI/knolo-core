export const KITE_CODES = [
  'KITE_CONTRACT_INVALID',
  'KITE_IMAGE_INVALID',
  'KITE_OBLIGATION_UNBOUND',
  'KITE_RULES_INVALID',
  'KITE_GRAPH_INVALID',
  'KITE_CERTIFICATE_MISMATCH',
  'KITE_DELTA_INVALID',
  'BOUND_EXCEEDED',
] as const;

export type KiteCode = (typeof KITE_CODES)[number];

export class KiteError extends Error {
  readonly code: KiteCode;
  readonly path?: string;

  constructor(code: KiteCode, message: string, path?: string, cause?: unknown) {
    super(message);
    this.name = 'KiteError';
    this.code = code;
    this.path = path;
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
