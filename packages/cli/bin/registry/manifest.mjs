const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function validatePackManifest(value, { expectedName, requestedVersion } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Registry returned an invalid pack manifest.');
  }
  if (typeof value.name !== 'string' || !value.name) throw new Error('Registry manifest is missing name.');
  if (expectedName && value.name !== expectedName) throw new Error(`Registry manifest name mismatch: expected ${expectedName}, got ${value.name}.`);
  if (typeof value.version !== 'string' || !value.version) throw new Error('Registry manifest is missing version.');
  if (requestedVersion && requestedVersion !== 'latest' && value.version !== requestedVersion) {
    throw new Error(`Registry manifest version mismatch: expected ${requestedVersion}, got ${value.version}.`);
  }
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error('Registry manifest sha256 must be 64 lowercase hexadecimal characters.');
  }
  if (typeof value.url !== 'string') throw new Error('Registry manifest is missing url.');
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) {
    throw new Error('Registry manifest sizeBytes must be a non-negative integer.');
  }
  if (value.stateRoot !== undefined && typeof value.stateRoot !== 'string') {
    throw new Error('Registry manifest stateRoot must be a string when present.');
  }
  if (value.format !== undefined && !['V4', 'V5'].includes(value.format)) {
    throw new Error('Registry manifest format must be V4 or V5 when present.');
  }
  if (value.format === 'V5' && (!value.stateRoot || typeof value.stateRoot !== 'string')) {
    throw new Error('Registry manifest stateRoot is required for V5 manifests.');
  }
  if (value.license !== undefined && typeof value.license !== 'string') {
    throw new Error('Registry manifest license must be a string when present.');
  }
  if (value.yanked !== undefined && typeof value.yanked !== 'boolean') {
    throw new Error('Registry manifest yanked must be a boolean when present.');
  }

  return {
    name: value.name,
    version: value.version,
    sha256: value.sha256,
    ...(value.stateRoot !== undefined ? { stateRoot: value.stateRoot } : {}),
    url: value.url,
    ...(value.license !== undefined ? { license: value.license } : {}),
    sizeBytes: value.sizeBytes,
    yanked: value.yanked === true,
    ...(value.format !== undefined ? { format: value.format } : {}),
  };
}
