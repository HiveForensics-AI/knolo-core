export class BoxError extends Error {
  constructor(
    readonly code: 'BOX_CONFIG' | 'BOX_MCP_MISSING' | 'BOX_SECRET',
    message: string
  ) {
    super(message);
    this.name = 'BoxError';
  }
}
