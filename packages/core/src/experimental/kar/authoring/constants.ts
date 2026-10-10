/**
 * Frozen CEG authoring contract `ceg-source-1`.
 * This is not a KAR semantics version. KAR remains `kar-1-research-1`.
 */

export const CEG_SOURCE_VERSION = 'ceg-source-1' as const;
export const CEG_BUILD_FORMAT = 'ceg-build-1' as const;
export const CEG_IMPORT_MAP_FORMAT = 'ceg-import-map-1' as const;
export const KAR_DISTRIBUTION_FORMAT = 'kar-distribution-1' as const;
export const CEG_COMPILER_ID = 'knolo-ceg-compiler' as const;
export const CEG_COMPILER_PRODUCER = 'knolo-ceg-compiler/source-v1' as const;

/** Domain strings inside compiler identity digests. */
export const CEG_NODE_DOMAIN = 'ceg-node-v1' as const;
export const CEG_RELATION_DOMAIN = 'ceg-relation-v1' as const;
export const CEG_BINDING_DOMAIN = 'ceg-binding-v1' as const;

export type CegLimits = {
  maxSourceBytes: number;
  maxConcepts: number;
  maxRelations: number;
  maxBindings: number;
  maxRequirementsPerBinding: number;
  maxIdentifierLength: number;
  maxRelationNameLength: number;
  maxLabelLength: number;
  maxDepth: number;
  maxLines: number;
};

export const CEG_LIMITS: CegLimits = {
  maxSourceBytes: 32 * 1024 * 1024,
  maxConcepts: 200_000,
  maxRelations: 400_000,
  maxBindings: 400_000,
  maxRequirementsPerBinding: 64,
  maxIdentifierLength: 512,
  maxRelationNameLength: 256,
  maxLabelLength: 2_000,
  maxDepth: 32,
  maxLines: 2_000_000,
};

export function resolveLimits(override?: Partial<CegLimits>): CegLimits {
  return { ...CEG_LIMITS, ...override };
}
