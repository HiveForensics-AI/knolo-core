export const REFLEX_SCHEMA_VERSIONS = {
  manifest: 'knolo.reflex.manifest/v1',
  atom: 'knolo.reflex.atom/v1',
  bundle: 'knolo.reflex.bundle/v1',
} as const;

export const REFLEX_RENDERER_V1 = 'reflex-renderer-v1' as const;

export type ReflexManifestV1 = {
  schema: typeof REFLEX_SCHEMA_VERSIONS.manifest;
  behaviorRoot: string;
  atomIds: string[];
  bundleIds: string[];
  projectionIds: string[];
  sourceIds: string[];
  profileIds: string[];
  evaluationIds: string[];
};

export type ReflexAtomType =
  | 'intent'
  | 'fact'
  | 'rule'
  | 'procedure'
  | 'constraint'
  | 'schema'
  | 'exemplar'
  | 'counterexample';

export type ReflexAtomV1 = {
  schema: typeof REFLEX_SCHEMA_VERSIONS.atom;
  type: ReflexAtomType;
  key: string;
  scope: {
    namespace: string;
    productVersion?: string;
    locale?: string;
    requiredInputs?: string[];
  };
  /**
   * Logical atom keys are preferred. Digest references remain accepted for
   * reading early 0.1 images, but are not needed for new content-addressed
   * relation graphs.
   */
  requires: string[];
  conflicts: string[];
  sourceIds: string[];
  body: Record<string, unknown>;
};

export type ReflexBundleV1 = {
  schema: typeof REFLEX_SCHEMA_VERSIONS.bundle;
  key: string;
  namespace: string;
  /** Atoms that must be delivered when this bundle is selected. */
  requiredAtomIds?: string[];
  /** Atoms used only to activate the bundle from lexical retrieval. */
  triggerAtomIds?: string[];
  /** Deprecated 0.1 spelling for requiredAtomIds. */
  atomIds?: string[];
  optionalAtomIds?: string[];
  outputSchema: Record<string, unknown>;
  renderer: typeof REFLEX_RENDERER_V1;
};

const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/;

export function validateReflexManifestV1(
  value: unknown
): asserts value is ReflexManifestV1 {
  if (!isRecord(value) || value.schema !== REFLEX_SCHEMA_VERSIONS.manifest) {
    throw new Error('Invalid Reflex manifest schema.');
  }
  const required = [
    'behaviorRoot',
    'atomIds',
    'bundleIds',
    'projectionIds',
    'sourceIds',
    'profileIds',
    'evaluationIds',
  ];
  const allowed = new Set(['schema', ...required]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new Error(`Unknown Reflex manifest field: ${key}`);
  }
  if (
    typeof value.behaviorRoot !== 'string' ||
    !DIGEST_PATTERN.test(value.behaviorRoot)
  ) {
    throw new Error('Invalid Reflex behavior root.');
  }
  for (const key of required.slice(1)) {
    const ids = value[key];
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string' || !DIGEST_PATTERN.test(id))
    ) {
      throw new Error(`Invalid Reflex manifest IDs: ${key}.`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Duplicate Reflex manifest ID: ${key}.`);
    }
  }
}

export function validateReflexAtomV1(
  value: unknown
): asserts value is ReflexAtomV1 {
  if (!isRecord(value) || value.schema !== REFLEX_SCHEMA_VERSIONS.atom) {
    throw new Error('Invalid Reflex atom schema.');
  }
  assertKnownFields(
    value,
    new Set([
      'schema',
      'type',
      'key',
      'scope',
      'requires',
      'conflicts',
      'sourceIds',
      'body',
    ]),
    'atom'
  );
  if (
    typeof value.type !== 'string' ||
    ![
      'intent',
      'fact',
      'rule',
      'procedure',
      'constraint',
      'schema',
      'exemplar',
      'counterexample',
    ].includes(value.type)
  ) {
    throw new Error('Invalid Reflex atom type.');
  }
  if (typeof value.key !== 'string' || !value.key.trim()) {
    throw new Error('Invalid Reflex atom key.');
  }
  if (
    !isRecord(value.scope) ||
    typeof value.scope.namespace !== 'string' ||
    !value.scope.namespace.trim()
  ) {
    throw new Error('Invalid Reflex atom scope.');
  }
  assertKnownFields(
    value.scope,
    new Set(['namespace', 'productVersion', 'locale', 'requiredInputs']),
    'atom scope'
  );
  for (const key of ['productVersion', 'locale']) {
    if (
      value.scope[key] !== undefined &&
      (typeof value.scope[key] !== 'string' || !value.scope[key].trim())
    )
      throw new Error(`Invalid Reflex atom scope ${key}.`);
  }
  if (value.scope.requiredInputs !== undefined) {
    if (
      !Array.isArray(value.scope.requiredInputs) ||
      value.scope.requiredInputs.some(
        (input) => typeof input !== 'string' || !input.trim()
      )
    )
      throw new Error('Invalid Reflex atom requiredInputs.');
    if (
      new Set(value.scope.requiredInputs).size !==
      value.scope.requiredInputs.length
    )
      throw new Error('Duplicate Reflex atom requiredInputs.');
  }
  assertRelationArray(value.requires, 'atom requires');
  assertRelationArray(value.conflicts, 'atom conflicts');
  assertDigestArray(value.sourceIds, 'atom sourceIds');
  if (!isRecord(value.body)) throw new Error('Invalid Reflex atom body.');
}

export function validateReflexBundleV1(
  value: unknown
): asserts value is ReflexBundleV1 {
  if (!isRecord(value) || value.schema !== REFLEX_SCHEMA_VERSIONS.bundle) {
    throw new Error('Invalid Reflex bundle schema.');
  }
  assertKnownFields(
    value,
    new Set([
      'schema',
      'key',
      'namespace',
      'requiredAtomIds',
      'triggerAtomIds',
      'atomIds',
      'optionalAtomIds',
      'outputSchema',
      'renderer',
    ]),
    'bundle'
  );
  for (const key of ['key', 'namespace', 'renderer']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) {
      throw new Error(`Invalid Reflex bundle ${key}.`);
    }
  }
  if (value.renderer !== REFLEX_RENDERER_V1)
    throw new Error(`Unsupported Reflex renderer: ${String(value.renderer)}.`);
  const requiredAtomIds = value.requiredAtomIds ?? value.atomIds;
  if (requiredAtomIds === undefined)
    throw new Error('Reflex bundle requiredAtomIds are required.');
  assertDigestArray(requiredAtomIds, 'bundle requiredAtomIds');
  if (value.requiredAtomIds !== undefined && value.atomIds !== undefined) {
    const canonicalRequiredAtomIds = value.requiredAtomIds;
    const legacyAtomIds = value.atomIds;
    assertDigestArray(canonicalRequiredAtomIds, 'bundle requiredAtomIds');
    assertDigestArray(legacyAtomIds, 'bundle atomIds');
    if (!sameStringArray(canonicalRequiredAtomIds, legacyAtomIds))
      throw new Error('Reflex bundle required atom aliases disagree.');
  }
  if (value.triggerAtomIds !== undefined)
    assertDigestArray(value.triggerAtomIds, 'bundle triggerAtomIds');
  if (value.atomIds !== undefined && value.requiredAtomIds === undefined)
    assertDigestArray(value.atomIds, 'bundle atomIds');
  if (value.optionalAtomIds !== undefined)
    assertDigestArray(value.optionalAtomIds, 'bundle optionalAtomIds');
  if (value.optionalAtomIds?.some((id) => requiredAtomIds.includes(id)))
    throw new Error('Reflex bundle optional atoms overlap required atoms.');
  if (
    value.triggerAtomIds !== undefined &&
    value.triggerAtomIds.some((id) => !requiredAtomIds.includes(id))
  ) {
    throw new Error('Reflex bundle trigger atoms must be required atoms.');
  }
  if (!isRecord(value.outputSchema))
    throw new Error('Invalid Reflex bundle output schema.');
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new Error(`Unknown Reflex ${label} field: ${key}`);
  }
}

function assertDigestArray(
  value: unknown,
  label: string
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== 'string' || !DIGEST_PATTERN.test(id))
  ) {
    throw new Error(`Invalid Reflex ${label}.`);
  }
  if (new Set(value).size !== value.length)
    throw new Error(`Duplicate Reflex ${label}.`);
}

function assertRelationArray(
  value: unknown,
  label: string
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (id) =>
        typeof id !== 'string' ||
        (!DIGEST_PATTERN.test(id) && !LOGICAL_KEY_PATTERN.test(id))
    )
  ) {
    throw new Error(`Invalid Reflex ${label}.`);
  }
  if (new Set(value).size !== value.length)
    throw new Error(`Duplicate Reflex ${label}.`);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

const LOGICAL_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export { buildReflexImageV1, computeReflexBehaviorRootV1 } from './compiler.js';
export type {
  ReflexBuildInput,
  ReflexBundleBuildInput,
  ReflexBuildResult,
  ReflexSourceInput,
} from './compiler.js';
export { distillReflexBehaviorV1 } from './distill.js';
export type {
  ReflexBehaviorExtractionV1,
  ReflexBehaviorExtractorV1,
  ReflexDistillationConfigV1,
  ReflexDistillationRejectV1,
  ReflexDistillationResultV1,
  ReflexTeacherRecordV1,
} from './distill.js';
export { optimizeMinimumReflexSetV1 } from './optimizer.js';
export type {
  ReflexMRSAtomV1,
  ReflexMRSInteractionV1,
  ReflexMRSProblemV1,
  ReflexMRSResultV1,
} from './optimizer.js';
export {
  openReflexSessionV1,
  selectReflexContextV1,
  validateReflexOutputV1,
  verifyReflexSelectionReceiptV1,
} from './runtime.js';
export type {
  ReflexOutputValidation,
  ReflexOutputSchemaV1,
  ReflexRuntimeConfig,
  ReflexSelectionDisposition,
  ReflexSelectionReceiptV1,
  ReflexSelectionResult,
  ReflexSessionV1,
} from './runtime.js';
export {
  clopperPearsonUpper,
  evaluateReflexPolicyV1,
  REFLEX_PROFILE_SCALE_V1,
} from './evaluation.js';
export type {
  ReflexEvaluationConfig,
  ReflexEvaluationReportV1,
  ReflexEvaluationTaskV1,
  ReflexTaskExpectationV1,
  ReflexModelAdapterV1,
  ReflexModelProfileV1,
} from './evaluation.js';
export { createOllamaReflexAdapterV1 } from './adapters/ollama.js';
export type { OllamaReflexAdapterOptions } from './adapters/ollama.js';
export { compareReflexVariantsV1 } from './baseline.js';
export type {
  ReflexComparisonReportV1,
  ReflexEvaluationVariantV1,
  ReflexVariantReportV1,
} from './baseline.js';
export { verifyReflexImageV1 } from './verify.js';
export type {
  ReflexVerificationLimits,
  ReflexVerificationResult,
} from './verify.js';
