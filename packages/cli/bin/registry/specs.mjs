const PACK_SPEC_PATTERN = /^(?<publisher>[a-z0-9-]+)\/(?<slug>[a-z0-9-]+)(?:@(?<version>[^@]+))?$/;

export function parsePackSpec(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Pack spec must be publisher/slug[@version].');
  const match = PACK_SPEC_PATTERN.exec(value.trim());
  if (!match) throw new Error(`Invalid pack spec: ${value}. Expected publisher/slug[@version].`);

  return {
    publisher: match.groups.publisher,
    slug: match.groups.slug,
    version: match.groups.version || 'latest',
    name: `${match.groups.publisher}/${match.groups.slug}`,
  };
}

export function parsePackName(value) {
  const parsed = parsePackSpec(value);
  if (value.includes('@')) throw new Error(`Pack name must not include a version: ${value}`);
  return parsed;
}
