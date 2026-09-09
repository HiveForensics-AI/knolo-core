import {
  buildPack,
  canonicalCbor,
  decodeCanonicalCbor,
  digestDomain,
  mountPackFromBuffer,
  openKnowledgeImageV5,
  queryWithPlan,
  type KnowledgeImageReaderV5,
} from '@knolo/core';
import {
  REFLEX_RENDERER_V1,
  type ReflexAtomV1,
  type ReflexBundleV1,
  type ReflexManifestV1,
  validateReflexAtomV1,
  validateReflexBundleV1,
  validateReflexManifestV1,
} from './index.js';
import { optimizeMinimumReflexSetV1 } from './optimizer.js';
import type { ReflexMRSProblemV1 } from './optimizer.js';
import {
  computeReflexMRSFrontierEntryDigestV1,
  computeReflexMRSProblemDigestV1,
  lookupReflexMRSFrontierV1,
  validateReflexMRSFrontierV1,
  type ReflexMRSFrontierV1,
} from './frontier.js';
import { verifyReflexImageV1 } from './verify.js';

export type ReflexRuntimeMRSConfigV1 = {
  contributionByAtomKey: Record<string, number>;
  successThreshold: number;
  intercept?: number;
  maxSearchAtoms?: number;
};

export type ReflexRuntimeConfig = {
  namespace: string;
  productVersion?: string;
  locale?: string;
  availableInputs?: string[];
  topK?: number;
  maxContextAtoms?: number;
  maxInputTokens?: number;
  tokenizerId?: string;
  countTokens?: (text: string) => number;
  mrs?: ReflexRuntimeMRSConfigV1;
  mrsFrontier?: ReflexMRSFrontierV1;
};

export type ReflexSelectionReceiptV1 = {
  schema: 'knolo.reflex.selection-receipt/v1';
  behaviorRoot: string;
  stateRoot: string;
  commitDigest: string;
  queryCommitment: string;
  candidateProjectionIds: string[];
  selectedBundleId: string | null;
  /** Atom IDs actually delivered to the caller. */
  selectedAtomIds: string[];
  attemptedAtomIds: string[];
  deliveredAtomIds: string[];
  attemptedContextDigest: string;
  renderedContextDigest: string;
  inputTokens: number;
  tokenizerId: string;
  renderer: string;
  selectionPolicyDigest: string;
  mrsFrontierDigest: string | null;
  mrsFrontierEntryDigest: string | null;
  disposition: ReflexSelectionDisposition;
};

export type ReflexSelectionDisposition =
  'ready' | 'no_applicable_bundle' | 'conflict_detected' | 'budget_exceeded';

export type ReflexSelectionResult =
  | {
      disposition: 'ready';
      context: string;
      selectedBundleId: string;
      selectedAtomIds: string[];
      outputSchema: Record<string, unknown>;
      receipt: ReflexSelectionReceiptV1;
    }
  | {
      disposition:
        'no_applicable_bundle' | 'conflict_detected' | 'budget_exceeded';
      context: '';
      selectedBundleId: string | null;
      selectedAtomIds: [];
      outputSchema: null;
      receipt: ReflexSelectionReceiptV1;
    };

export type ReflexOutputValidation = {
  valid: boolean;
  errors: string[];
};

export type ReflexOutputSchemaV1 = Record<string, unknown>;

export type ReflexSessionV1 = {
  reader: KnowledgeImageReaderV5;
  manifest: ReflexManifestV1;
  atoms: Map<string, ReflexAtomV1>;
  bundles: Map<string, ReflexBundleV1>;
  projections: Map<string, { atomId: string; text: string }>;
  lexicalPack: ReturnType<typeof mountPackFromBuffer>;
  config: Required<
    Pick<
      ReflexRuntimeConfig,
      | 'namespace'
      | 'topK'
      | 'maxContextAtoms'
      | 'maxInputTokens'
      | 'tokenizerId'
    >
  > &
    Pick<
      ReflexRuntimeConfig,
      | 'productVersion'
      | 'locale'
      | 'availableInputs'
      | 'countTokens'
      | 'mrs'
      | 'mrsFrontier'
    >;
};

export async function openReflexSessionV1(
  imageBytes: Uint8Array,
  config: ReflexRuntimeConfig
): Promise<ReflexSessionV1> {
  if (
    !config ||
    typeof config.namespace !== 'string' ||
    !config.namespace.trim()
  )
    throw new Error('Reflex runtime namespace is required.');
  for (const [name, value] of [
    ['topK', config.topK],
    ['maxContextAtoms', config.maxContextAtoms],
    ['maxInputTokens', config.maxInputTokens],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0))
      throw new Error(`Reflex runtime ${name} must be a non-negative integer.`);
  }
  if (config.mrsFrontier !== undefined) {
    if (!config.mrs)
      throw new Error('Reflex runtime mrs is required with mrsFrontier.');
    validateReflexMRSFrontierV1(config.mrsFrontier);
  }

  // Verify the behavior root before any untrusted object is used to construct
  // the lexical runtime.
  verifyReflexImageV1(imageBytes);
  const reader = openKnowledgeImageV5(imageBytes);
  const image = reader.materialize();
  const manifestObject = image.objects.find(
    (object) => object.meta.reflex_role === 'manifest'
  );
  if (!manifestObject) throw new Error('Reflex manifest object is missing.');
  const manifestValue = decodeCanonicalCbor(manifestObject.bytes);
  validateReflexManifestV1(manifestValue);

  const atoms = new Map<string, ReflexAtomV1>();
  for (const atomId of manifestValue.atomIds) {
    const object = image.objects.find((candidate) => candidate.id === atomId);
    if (!object) throw new Error('Reflex manifest references a missing atom.');
    const atomValue = decodeCanonicalCbor(object.bytes);
    validateReflexAtomV1(atomValue);
    if (atomValue.scope.namespace !== config.namespace)
      throw new Error(
        `Reflex atom outside runtime namespace: ${atomValue.key}`
      );
    atoms.set(atomId, atomValue);
  }

  const bundles = new Map<string, ReflexBundleV1>();
  for (const bundleId of manifestValue.bundleIds) {
    const object = image.objects.find((candidate) => candidate.id === bundleId);
    if (!object)
      throw new Error('Reflex manifest references a missing bundle.');
    const decoded = decodeCanonicalCbor(object.bytes);
    validateReflexBundleV1(decoded);
    const bundleValue = normalizeLoadedBundle(decoded);
    if (bundleValue.namespace !== config.namespace)
      throw new Error(
        `Reflex bundle outside runtime namespace: ${bundleValue.key}`
      );
    validateBundleAtomReferences(bundleValue, atoms);
    bundles.set(bundleId, bundleValue);
  }

  const projections = new Map<string, { atomId: string; text: string }>();
  const projectionDocs: Array<{ id: string; namespace: string; text: string }> =
    [];
  for (const projectionId of manifestValue.projectionIds) {
    const object = image.objects.find(
      (candidate) => candidate.id === projectionId
    );
    if (!object || typeof object.meta.reflex_atom !== 'string') {
      throw new Error('Reflex manifest contains an invalid projection.');
    }
    const atomId = object.meta.reflex_atom;
    if (!atoms.has(atomId))
      throw new Error('Reflex projection references an unknown atom.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(object.bytes);
    projections.set(projectionId, { atomId, text });
    projectionDocs.push({
      id: projectionId,
      namespace: config.namespace,
      text,
    });
  }
  const lexicalBytes = await buildPack(projectionDocs, {
    format: 4,
    graph: { enabled: false },
  });
  const lexicalPack = mountPackFromBuffer(lexicalBytes.slice().buffer);
  return {
    reader,
    manifest: manifestValue,
    atoms,
    bundles,
    projections,
    lexicalPack,
    config: {
      namespace: config.namespace,
      productVersion: config.productVersion,
      locale: config.locale,
      availableInputs: config.availableInputs,
      topK: config.topK ?? 8,
      maxContextAtoms: config.maxContextAtoms ?? 8,
      maxInputTokens: config.maxInputTokens ?? 512,
      tokenizerId: config.tokenizerId ?? 'reflex-whitespace-tokenizer-v1',
      countTokens: config.countTokens,
      mrs: config.mrs,
      mrsFrontier: config.mrsFrontier,
    },
  };
}

export function selectReflexContextV1(
  session: ReflexSessionV1,
  query: string
): ReflexSelectionResult {
  if (typeof query !== 'string' || !query.trim())
    throw new Error('Reflex query is required.');
  const result = queryWithPlan(session.lexicalPack, query, {
    topK: session.config.topK,
    namespace: session.config.namespace,
    queryExpansion: { enabled: false },
    graph: { expand: false },
  });
  const candidateProjectionIds = result.hits
    .map((hit) => hit.source)
    .filter(
      (id): id is string =>
        typeof id === 'string' && session.projections.has(id)
    );
  const candidateAtomIds: string[] = [];
  for (const projectionId of candidateProjectionIds) {
    const atomId = session.projections.get(projectionId)?.atomId;
    if (
      !atomId ||
      !session.atoms.has(atomId) ||
      !isApplicable(session, atomId) ||
      candidateAtomIds.includes(atomId)
    )
      continue;
    candidateAtomIds.push(atomId);
  }
  const candidateSet = new Set(candidateAtomIds);
  let selectedBundleId: string | null = null;
  let selectedBundle: ReflexBundleV1 | null = null;
  let attemptedAtomIds: string[] = [];
  let conflictDetected = false;
  let selectedFrontierEntryDigest: string | null = null;

  for (const [bundleId, bundle] of [...session.bundles.entries()].sort(
    (left, right) =>
      compareBytes(left[1].key, right[1].key) || compareBytes(left[0], right[0])
  )) {
    const requiredAtomIds = getRequiredAtomIds(bundle);
    const triggerAtomIds = getTriggerAtomIds(bundle);
    const triggerMatched =
      bundle.triggerMode === 'any'
        ? triggerAtomIds.some((atomId) => candidateSet.has(atomId))
        : triggerAtomIds.every((atomId) => candidateSet.has(atomId));
    if (
      !triggerMatched ||
      !requiredAtomIds.every((atomId) => isApplicable(session, atomId))
    )
      continue;
    const selected: string[] = [];
    let frontierEntryDigest: string | null = null;
    try {
      for (const atomId of requiredAtomIds)
        addWithClosure(session, atomId, selected);
      for (const projectionId of candidateProjectionIds) {
        const atomId = session.projections.get(projectionId)?.atomId;
        if (
          !atomId ||
          !bundle.optionalAtomIds?.includes(atomId) ||
          !isApplicable(session, atomId) ||
          selected.length >= session.config.maxContextAtoms
        )
          continue;
        const candidate = selected.slice();
        addWithClosure(session, atomId, candidate);
        if (candidate.length <= session.config.maxContextAtoms)
          selected.splice(0, selected.length, ...candidate);
      }
      if (session.config.mrs) {
        const candidateIds = [
          ...new Set([
            ...selected,
            ...(bundle.optionalAtomIds ?? []).filter((atomId) =>
              isApplicable(session, atomId)
            ),
          ]),
        ];
        const mrs = session.config.mrs;
        const problem = buildRuntimeMRSProblem(
          session,
          candidateIds,
          requiredAtomIds
        );
        if (session.config.mrsFrontier) {
          if (
            computeReflexMRSProblemDigestV1(problem) !==
              session.config.mrsFrontier.problemDigest ||
            session.config.mrsFrontier.threshold !== problem.successThreshold ||
            !sameStringSet(
              session.config.mrsFrontier.candidateAtomIds,
              candidateIds
            ) ||
            !sameStringSet(
              session.config.mrsFrontier.requiredAtomIds,
              requiredAtomIds
            )
          )
            continue;
          const frontierEntry = lookupReflexMRSFrontierV1(
            session.config.mrsFrontier,
            candidateIds,
            {
              maxContextAtoms: session.config.maxContextAtoms,
              maxInputTokens: session.config.maxInputTokens,
            }
          );
          if (!frontierEntry) continue;
          selected.splice(0, selected.length, ...frontierEntry.selectedAtomIds);
          frontierEntryDigest =
            computeReflexMRSFrontierEntryDigestV1(frontierEntry);
        } else {
          const optimized = optimizeMinimumReflexSetV1({
            ...problem,
            maxTokenCost: session.config.maxInputTokens,
          });
          if (optimized.status === 'infeasible') continue;
          if (optimized.status === 'search_limit') continue;
          selected.splice(0, selected.length, ...optimized.selectedAtomIds);
        }
      }
      assertClosedSelection(session, selected);
      assertNoConflicts(session, selected);
    } catch (error) {
      if (error instanceof ReflexConflictError) {
        conflictDetected = true;
        continue;
      }
      throw error;
    }
    selectedBundleId = bundleId;
    selectedBundle = bundle;
    attemptedAtomIds = selected;
    selectedFrontierEntryDigest = frontierEntryDigest;
    break;
  }

  const renderer = selectedBundle?.renderer ?? REFLEX_RENDERER_V1;
  const attemptedContext = renderAtoms(session, attemptedAtomIds, renderer);
  const countTokens = session.config.countTokens ?? defaultCountTokens;
  const inputTokens = countTokens(`${query}\n\n${attemptedContext}`);
  const disposition: ReflexSelectionDisposition = selectedBundleId
    ? attemptedAtomIds.length > session.config.maxContextAtoms ||
      inputTokens > session.config.maxInputTokens
      ? 'budget_exceeded'
      : 'ready'
    : conflictDetected
      ? 'conflict_detected'
      : 'no_applicable_bundle';
  const deliveredAtomIds = disposition === 'ready' ? attemptedAtomIds : [];
  const deliveredContext = renderAtoms(session, deliveredAtomIds, renderer);
  const receipt: ReflexSelectionReceiptV1 = {
    schema: 'knolo.reflex.selection-receipt/v1',
    behaviorRoot: session.manifest.behaviorRoot,
    stateRoot: session.reader.stateRoot,
    commitDigest: session.reader.commitDigest,
    queryCommitment: digestDomain(
      'reflex-query',
      canonicalCbor({ query } as never)
    ),
    candidateProjectionIds,
    selectedBundleId,
    selectedAtomIds: deliveredAtomIds,
    attemptedAtomIds,
    deliveredAtomIds,
    attemptedContextDigest: contextDigest(attemptedContext),
    renderedContextDigest: contextDigest(deliveredContext),
    inputTokens,
    tokenizerId: session.config.tokenizerId,
    renderer,
    selectionPolicyDigest: computeReflexSelectionPolicyDigestV1(session),
    mrsFrontierDigest: session.config.mrsFrontier?.frontierDigest ?? null,
    mrsFrontierEntryDigest: selectedFrontierEntryDigest,
    disposition,
  };
  if (disposition === 'ready') {
    return {
      disposition,
      context: deliveredContext,
      selectedBundleId: selectedBundleId as string,
      selectedAtomIds: deliveredAtomIds,
      outputSchema: selectedBundle?.outputSchema as Record<string, unknown>,
      receipt,
    };
  }
  return {
    disposition,
    context: '',
    selectedBundleId,
    selectedAtomIds: [],
    outputSchema: null,
    receipt,
  };
}

export function verifyReflexSelectionReceiptV1(
  session: ReflexSessionV1,
  receipt: ReflexSelectionReceiptV1,
  query: string
): void;
/** @deprecated Pass the session to replay the complete selection decision. */
export function verifyReflexSelectionReceiptV1(
  receipt: ReflexSelectionReceiptV1,
  query: string,
  context: string
): void;
export function verifyReflexSelectionReceiptV1(
  first: ReflexSessionV1 | ReflexSelectionReceiptV1,
  second: ReflexSelectionReceiptV1 | string,
  third: string
): void {
  if (isSession(first)) {
    const expected = selectReflexContextV1(first, third);
    if (!sameReceipt(expected.receipt, second as ReflexSelectionReceiptV1))
      throw new Error('Reflex selection receipt replay mismatch.');
    return;
  }
  const receipt = first;
  const query = second as string;
  if (receipt.schema !== 'knolo.reflex.selection-receipt/v1')
    throw new Error('Unsupported Reflex receipt schema.');
  const queryCommitment = digestDomain(
    'reflex-query',
    canonicalCbor({ query } as never)
  );
  if (receipt.queryCommitment !== queryCommitment)
    throw new Error('Reflex receipt query commitment mismatch.');
  if (receipt.renderedContextDigest !== contextDigest(third))
    throw new Error('Reflex receipt context digest mismatch.');
}

export function validateReflexOutputV1(
  output: unknown,
  options: {
    schema?: ReflexOutputSchemaV1;
    requiredFields?: string[];
  } = {}
): ReflexOutputValidation {
  const errors: string[] = [];
  const schema = options.schema ?? {
    type: 'object',
    required: options.requiredFields ?? [],
  };
  validateAgainstSchema(output, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

function normalizeLoadedBundle(bundle: ReflexBundleV1): ReflexBundleV1 {
  const requiredAtomIds = getRequiredAtomIds(bundle);
  const triggerAtomIds = getTriggerAtomIds(bundle);
  return {
    schema: bundle.schema,
    key: bundle.key,
    namespace: bundle.namespace,
    requiredAtomIds,
    triggerAtomIds,
    ...(bundle.optionalAtomIds
      ? { optionalAtomIds: bundle.optionalAtomIds.slice() }
      : {}),
    ...(bundle.triggerMode ? { triggerMode: bundle.triggerMode } : {}),
    outputSchema: bundle.outputSchema,
    renderer: bundle.renderer,
  };
}

function getRequiredAtomIds(bundle: ReflexBundleV1): string[] {
  return (bundle.requiredAtomIds ?? bundle.atomIds ?? []).slice();
}

function getTriggerAtomIds(bundle: ReflexBundleV1): string[] {
  return (bundle.triggerAtomIds ?? getRequiredAtomIds(bundle)).slice();
}

function validateBundleAtomReferences(
  bundle: ReflexBundleV1,
  atoms: Map<string, ReflexAtomV1>
): void {
  for (const atomId of [
    ...getRequiredAtomIds(bundle),
    ...getTriggerAtomIds(bundle),
    ...(bundle.optionalAtomIds ?? []),
  ]) {
    if (!atoms.has(atomId))
      throw new Error(`Reflex bundle references a missing atom: ${bundle.key}`);
  }
}

function isApplicable(session: ReflexSessionV1, atomId: string): boolean {
  const atom = session.atoms.get(atomId);
  if (!atom) return false;
  if (
    atom.scope.productVersion !== undefined &&
    atom.scope.productVersion !== session.config.productVersion
  )
    return false;
  if (
    atom.scope.locale !== undefined &&
    atom.scope.locale !== session.config.locale
  )
    return false;
  const available = new Set(session.config.availableInputs ?? []);
  return (atom.scope.requiredInputs ?? []).every((input) =>
    available.has(input)
  );
}

function addWithClosure(
  session: ReflexSessionV1,
  atomId: string,
  selected: string[],
  visiting = new Set<string>()
): void {
  if (selected.includes(atomId)) return;
  if (visiting.has(atomId))
    throw new Error('Reflex atom dependency cycle at runtime.');
  const atom = session.atoms.get(atomId);
  if (!atom) throw new Error('Reflex bundle references a missing atom.');
  if (!isApplicable(session, atomId))
    throw new ReflexConflictError('Reflex atom is outside the active scope.');
  visiting.add(atomId);
  for (const dependency of resolveRelations(session, atom.requires, atom))
    addWithClosure(session, dependency, selected, visiting);
  visiting.delete(atomId);
  if (!selected.includes(atomId)) selected.push(atomId);
}

function buildRuntimeMRSProblem(
  session: ReflexSessionV1,
  candidateIds: string[],
  requiredAtomIds: string[]
): ReflexMRSProblemV1 {
  const count = session.config.countTokens ?? defaultCountTokens;
  const mrs = session.config.mrs as ReflexRuntimeMRSConfigV1;
  return {
    atoms: candidateIds.map((atomId) => {
      const atom = session.atoms.get(atomId) as ReflexAtomV1;
      return {
        id: atomId,
        tokenCost: count(renderAtom(atom)),
        contribution: mrs.contributionByAtomKey[atom.key] ?? 0,
        requires: resolveRelations(session, atom.requires, atom),
        conflicts: resolveRelations(session, atom.conflicts, atom),
      };
    }),
    requiredAtomIds,
    intercept: mrs.intercept ?? 0,
    successThreshold: mrs.successThreshold,
    maxTokenCost: session.config.maxInputTokens,
    maxSearchAtoms: mrs.maxSearchAtoms,
  };
}

function assertClosedSelection(
  session: ReflexSessionV1,
  selected: string[]
): void {
  const selectedSet = new Set(selected);
  for (const atomId of selected) {
    const atom = session.atoms.get(atomId);
    if (!atom) throw new Error('Reflex selection references a missing atom.');
    if (!isApplicable(session, atomId))
      throw new ReflexConflictError('Reflex atom is outside the active scope.');
    for (const dependency of resolveRelations(session, atom.requires, atom)) {
      if (!selectedSet.has(dependency))
        throw new ReflexConflictError(
          `Missing dependency for selected atom: ${atom.key}`
        );
    }
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function assertNoConflicts(session: ReflexSessionV1, selected: string[]): void {
  const selectedSet = new Set(selected);
  for (const atomId of selected) {
    const atom = session.atoms.get(atomId);
    if (!atom) throw new Error('Reflex selection references a missing atom.');
    for (const conflictId of resolveRelations(session, atom.conflicts, atom)) {
      if (selectedSet.has(conflictId))
        throw new ReflexConflictError(`Conflicting atom selected: ${atom.key}`);
    }
  }
}

function resolveRelations(
  session: ReflexSessionV1,
  relations: string[],
  owner: ReflexAtomV1
): string[] {
  const idByKey = new Map(
    [...session.atoms.entries()].map(([id, atom]) => [atom.key, id] as const)
  );
  return relations.map((relation) => {
    if (session.atoms.has(relation)) return relation;
    const id = idByKey.get(relation);
    if (!id)
      throw new Error(
        `Atom ${owner.key} references missing relation: ${relation}`
      );
    return id;
  });
}

function renderAtoms(
  session: ReflexSessionV1,
  atomIds: string[],
  renderer: string
): string {
  if (renderer !== REFLEX_RENDERER_V1)
    throw new Error(`Unsupported Reflex renderer: ${renderer}.`);
  return atomIds
    .map((atomId) => renderAtom(session.atoms.get(atomId) as ReflexAtomV1))
    .join('\n\n');
}

function renderAtom(atom: ReflexAtomV1): string {
  return `${atom.type}: ${atom.key}\n${stableStringify(atom.body)}`;
}

function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => Object.is(item, value))
  )
    errors.push(`${path} must match one of the declared values.`);
  if ('const' in schema && !Object.is(schema.const, value))
    errors.push(`${path} must match the declared constant.`);
  if (typeof schema.type === 'string' && !matchesType(value, schema.type)) {
    errors.push(`${path} must be a ${schema.type}.`);
    return;
  }
  if (schema.type === 'object' && isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const field of required) {
      if (typeof field === 'string' && !(field in value))
        errors.push(`${path}.${field} is required.`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isRecord(childSchema))
        validateAgainstSchema(
          value[key],
          childSchema,
          `${path}.${key}`,
          errors
        );
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed.`);
      }
    }
  }
  if (
    schema.type === 'array' &&
    Array.isArray(value) &&
    isRecord(schema.items)
  ) {
    value.forEach((item, index) =>
      validateAgainstSchema(
        item,
        schema.items as Record<string, unknown>,
        `${path}[${index}]`,
        errors
      )
    );
  }
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'object') return isRecord(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function contextDigest(context: string): string {
  return digestDomain(
    'reflex-rendered-context',
    new TextEncoder().encode(context)
  );
}

export function computeReflexSelectionPolicyDigestV1(
  session: ReflexSessionV1
): string {
  const mrs = session.config.mrs;
  return digestDomain(
    'reflex-selection-policy',
    canonicalCbor({
      version: 1,
      namespace: session.config.namespace,
      locale: session.config.locale ?? null,
      productVersion: session.config.productVersion ?? null,
      availableInputs: [...(session.config.availableInputs ?? [])].sort(),
      topK: session.config.topK,
      maxContextAtoms: session.config.maxContextAtoms,
      maxInputTokens: session.config.maxInputTokens,
      tokenizerId: session.config.tokenizerId,
      renderer: REFLEX_RENDERER_V1,
      mrsFrontierDigest: session.config.mrsFrontier?.frontierDigest ?? null,
      mrs: mrs
        ? {
            successThreshold: String(mrs.successThreshold),
            intercept: String(mrs.intercept ?? 0),
            maxSearchAtoms: mrs.maxSearchAtoms ?? 20,
            coefficientDigest: digestDomain(
              'reflex-mrs-coefficients',
              canonicalCbor(
                Object.fromEntries(
                  Object.entries(mrs.contributionByAtomKey)
                    .sort(([a], [b]) => compareBytes(a, b))
                    .map(([key, value]) => [key, String(value)])
                ) as never
              )
            ),
          }
        : null,
    } as never)
  );
}

function sameReceipt(
  left: ReflexSelectionReceiptV1,
  right: ReflexSelectionReceiptV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSession(value: unknown): value is ReflexSessionV1 {
  return (
    isRecord(value) &&
    'lexicalPack' in value &&
    'manifest' in value &&
    'reader' in value
  );
}

function defaultCountTokens(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function compareBytes(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    if (leftBytes[index] !== rightBytes[index])
      return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class ReflexConflictError extends Error {}
