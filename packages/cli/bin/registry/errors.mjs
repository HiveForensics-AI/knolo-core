export class RegistryError extends Error {
  constructor(message, { status, code, url, body, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RegistryError';
    this.status = status;
    this.code = code;
    this.url = url;
    this.body = body;
  }
}

export class RegistryNetworkError extends Error {
  constructor(message, { url, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RegistryNetworkError';
    this.url = url;
  }
}

export function registryErrorMessage({ status, code, body, url }) {
  if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  if (status === 401 || code === 'unauthenticated') return 'Registry authentication is required.';
  if (status === 404 || code === 'not_found') return 'Registry resource not found.';
  if (status === 410 || code === 'yanked') return 'Registry version is yanked.';
  if (status === 413 || code === 'too_large') return 'Registry artifact is too large.';
  if (status === 503 || code === 'unconfigured') return 'Registry is not configured.';
  return `Registry request failed${status ? ` with HTTP ${status}` : ''}${url ? `: ${url}` : '.'}`;
}
