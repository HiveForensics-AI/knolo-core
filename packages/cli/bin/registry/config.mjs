export const DEFAULT_PRODUCTION_REGISTRY = 'https://hub.knolo.dev';
export const DEFAULT_DEVELOPMENT_REGISTRY = 'http://localhost:3000';

export function resolveRegistryUrl({ value, env = process.env } = {}) {
  const configured = value || env.KNOLO_HUB_URL;
  if (configured) return normalizeRegistryUrl(configured);

  const development = env.NODE_ENV === 'development' || env.KNOLO_ENV === 'development';
  return normalizeRegistryUrl(development ? DEFAULT_DEVELOPMENT_REGISTRY : DEFAULT_PRODUCTION_REGISTRY);
}

export function normalizeRegistryUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Registry URL must be a non-empty HTTP(S) URL.');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Invalid registry URL: ${value}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Registry URL must use http or https: ${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Registry URL must be an origin without credentials, query parameters, or fragments.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Registry URL must be an origin without a path.');
  }

  return url.origin;
}

export function registryApiUrl(registry, segments, searchParams) {
  const url = new URL(normalizeRegistryUrl(registry));
  url.pathname = `/api/v1/${segments.map((segment) => encodeURIComponent(String(segment))).join('/')}`;
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url;
}
