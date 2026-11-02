export class CodeImageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CodeImageError';
    this.code = code;
  }
}

export function asCodeImageError(error: unknown): CodeImageError {
  if (error instanceof CodeImageError) return error;
  return new CodeImageError(
    'CODE_IMAGE_FAILED',
    'The code image request failed.'
  );
}
