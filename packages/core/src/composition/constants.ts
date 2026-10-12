export const COMPOSITION_FORMAT = 'composition-record-1';
export const EXCERPT_FORMAT = 'composition-excerpt-1';
export const ATTESTATION_FORMAT = 'composition-attestation-1';
export const SIGNATURE_FORMAT = 'composition-signature-1';
export const BUNDLE_FORMAT = 'composition-bundle-1';
export const COMMERCE_FORMAT = 'composition-commerce-1';
export const MEMBERS_FORMAT = 'composition-members-1';

export const COMPOSITION_RECORD_DOMAIN = 'composition-record';
export const EXCERPT_DOMAIN = 'composition-excerpt';
export const ATTESTATION_DOMAIN = 'composition-attestation';
export const SIGNATURE_DOMAIN = 'composition-attestation-signature';
export const FILE_SET_DOMAIN = 'composition-file-set';

export const COMPOSITION_MAX_MEMBERS = 32;
export const COMPOSITION_MAX_DEPTH = 8;
export const EXCERPT_MAX_OBJECTS = 64;
export const COMPOSITION_MAX_ALIAS_LENGTH = 128;
export const COMPOSITION_MAX_FILES = 256;
export const COMPOSITION_MAX_PATH_LENGTH = 256;

export const MEMBER_KINDS = [
  'v5-image',
  'v4-pack',
  'kar-sidecar',
  'domain-pack',
  'excerpt',
  'composition',
] as const;

export const ROLES = ['dependency', 'evidence', 'vocabulary', 'excerpt', 'nested'] as const;

export const ROLE_FOR_KIND = {
  'v5-image': 'dependency',
  'v4-pack': 'dependency',
  'kar-sidecar': 'evidence',
  'domain-pack': 'vocabulary',
  excerpt: 'excerpt',
  composition: 'nested',
} as const;

export const STATEMENTS = ['mount', 'used', 'cited'] as const;
export const INCLUSIONS = ['included', 'digest-bound'] as const;
export const AVAILABILITIES = ['material', 'digest'] as const;
export const OBJECT_KINDS = ['source', 'chunk', 'claims', 'agents', 'metadata'] as const;
