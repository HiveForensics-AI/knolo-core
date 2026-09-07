export const REFLEX_SCHEMA_VERSIONS = {
  manifest: 'knolo.reflex.manifest/v1',
  atom: 'knolo.reflex.atom/v1',
  bundle: 'knolo.reflex.bundle/v1',
} as const;

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
  requires: string[];
  conflicts: string[];
  sourceIds: string[];
  body: Record<string, unknown>;
};

export type ReflexBundleV1 = {
  schema: typeof REFLEX_SCHEMA_VERSIONS.bundle;
  key: string;
  namespace: string;
  atomIds: string[];
  optionalAtomIds?: string[];
  outputSchema: Record<string, unknown>;
  renderer: string;
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
  for (const key of ['requires', 'conflicts', 'sourceIds']) {
    assertDigestArray(value[key], `atom ${key}`);
  }
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
  assertDigestArray(value.atomIds, 'bundle atomIds');
  if (value.optionalAtomIds !== undefined)
    assertDigestArray(value.optionalAtomIds, 'bundle optionalAtomIds');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export { buildReflexImageV1 } from './compiler.js';
export type {
  ReflexBuildInput,
  ReflexBundleBuildInput,
  ReflexBuildResult,
  ReflexSourceInput,
} from './compiler.js';
export {
  openReflexSessionV1,
  selectReflexContextV1,
  validateReflexOutputV1,
  verifyReflexSelectionReceiptV1,
} from './runtime.js';
export type {
  ReflexOutputValidation,
  ReflexRuntimeConfig,
  ReflexSelectionReceiptV1,
  ReflexSelectionResult,
  ReflexSessionV1,
} from './runtime.js';
export { clopperPearsonUpper, evaluateReflexPolicyV1 } from './evaluation.js';
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
