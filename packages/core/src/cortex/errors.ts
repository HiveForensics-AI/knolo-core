export const CORTEX_CODES = [
  'CORTEX_POLICY_INVALID',
  'CORTEX_TRACE_INVALID',
  'CORTEX_EVIDENCE_UNBOUND',
  'CORTEX_RECEIPT_MISMATCH',
  'CORTEX_MODEL_UNBOUND',
  'CORTEX_MODEL_REQUIRED',
  'CORTEX_KAR_UNBOUND',
  'CORTEX_ROOT_MISMATCH',
  'CORTEX_IMAGE_INVALID',
] as const;

export type CortexCode = (typeof CORTEX_CODES)[number];

export class CortexError extends Error {
  readonly code: CortexCode;
  readonly path?: string;

  constructor(code: CortexCode, message: string, path?: string, cause?: unknown) {
    super(message);
    this.name = 'CortexError';
    this.code = code;
    this.path = path;
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
  }
}
