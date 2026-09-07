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
  type ReflexAtomV1,
  type ReflexBundleV1,
  type ReflexManifestV1,
  validateReflexAtomV1,
  validateReflexBundleV1,
  validateReflexManifestV1,
} from './index.js';

export type ReflexRuntimeConfig = {
  namespace: string;
  topK?: number;
  maxContextAtoms?: number;
  maxInputTokens?: number;
  tokenizerId?: string;
  countTokens?: (text: string) => number;
};

export type ReflexSelectionReceiptV1 = {
  schema: 'knolo.reflex.selection-receipt/v1';
  behaviorRoot: string;
  stateRoot: string;
  commitDigest: string;
  queryCommitment: string;
  candidateProjectionIds: string[];
  selectedAtomIds: string[];
  renderedContextDigest: string;
  inputTokens: number;
  tokenizerId: string;
  renderer: string;
  disposition: ReflexSelectionDisposition;
};

export type ReflexSelectionDisposition =
  'ready' | 'no_applicable_bundle' | 'budget_exceeded';

export type ReflexSelectionResult =
  | {
      disposition: 'ready';
      context: string;
      selectedAtomIds: string[];
      receipt: ReflexSelectionReceiptV1;
    }
  | {
      disposition: 'no_applicable_bundle' | 'budget_exceeded';
      context: '';
      selectedAtomIds: [];
      receipt: ReflexSelectionReceiptV1;
    };

export type ReflexOutputValidation = {
  valid: boolean;
  errors: string[];
};

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
    Pick<ReflexRuntimeConfig, 'countTokens'>;
};

export async function openReflexSessionV1(
  imageBytes: Uint8Array,
  config: ReflexRuntimeConfig
): Promise<ReflexSessionV1> {
  const reader = openKnowledgeImageV5(imageBytes);
  const image = reader.materialize();
  const manifestObject = image.objects.find(
    (object) => object.meta.reflex_role === 'manifest'
  );
  if (!manifestObject) throw new Error('Reflex manifest object is missing.');
  const manifestValue = decodeCanonicalCbor(manifestObject.bytes);
  validateReflexManifestV1(manifestValue);
  if (
    manifestValue.sourceIds.some(
      (id) => !image.objects.some((object) => object.id === id)
    )
  ) {
    throw new Error('Reflex manifest references a missing source.');
  }

  const atoms = new Map<string, ReflexAtomV1>();
  for (const atomId of manifestValue.atomIds) {
    const object = image.objects.find((candidate) => candidate.id === atomId);
    if (!object) throw new Error('Reflex manifest references a missing atom.');
    const atomValue = decodeCanonicalCbor(object.bytes);
    validateReflexAtomV1(atomValue);
    atoms.set(atomId, atomValue);
  }
  const bundles = new Map<string, ReflexBundleV1>();
  for (const bundleId of manifestValue.bundleIds) {
    const object = image.objects.find((candidate) => candidate.id === bundleId);
    if (!object)
      throw new Error('Reflex manifest references a missing bundle.');
    const bundleValue = decodeCanonicalCbor(object.bytes);
    validateReflexBundleV1(bundleValue);
    if (bundleValue.namespace !== config.namespace)
      throw new Error(
        `Reflex bundle outside runtime namespace: ${bundleValue.key}`
      );
    bundles.set(bundleId, bundleValue);
  }
  const projections = new Map<string, { atomId: string; text: string }>();
  const projectionDocs = [];
  for (const projectionId of manifestValue.projectionIds) {
    const object = image.objects.find(
      (candidate) => candidate.id === projectionId
    );
    if (!object || typeof object.meta.reflex_atom !== 'string') {
      throw new Error('Reflex manifest contains an invalid projection.');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(object.bytes);
    projections.set(projectionId, { atomId: object.meta.reflex_atom, text });
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
      topK: config.topK ?? 8,
      maxContextAtoms: config.maxContextAtoms ?? 8,
      maxInputTokens: config.maxInputTokens ?? 512,
      tokenizerId: config.tokenizerId ?? 'reflex-whitespace-tokenizer-v1',
      countTokens: config.countTokens,
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
      candidateAtomIds.includes(atomId)
    )
      continue;
    candidateAtomIds.push(atomId);
  }
  const candidateSet = new Set(candidateAtomIds);
  const bundleEntry = [...session.bundles.entries()]
    .sort(
      (left, right) =>
        left[1].key.localeCompare(right[1].key) ||
        left[0].localeCompare(right[0])
    )
    .find(([, bundle]) =>
      bundle.atomIds.every((atomId) => candidateSet.has(atomId))
    );
  const selectedAtomIds: string[] = [];
  if (bundleEntry) {
    const [, bundle] = bundleEntry;
    const addWithClosure = (
      atomId: string,
      visiting = new Set<string>()
    ): void => {
      if (selectedAtomIds.includes(atomId)) return;
      if (visiting.has(atomId))
        throw new Error('Reflex atom dependency cycle at runtime.');
      const atom = session.atoms.get(atomId);
      if (!atom) throw new Error('Reflex bundle references a missing atom.');
      visiting.add(atomId);
      for (const dependency of atom.requires)
        addWithClosure(dependency, visiting);
      visiting.delete(atomId);
      if (!selectedAtomIds.includes(atomId)) selectedAtomIds.push(atomId);
    };
    for (const atomId of bundle.atomIds) addWithClosure(atomId);
    for (const projectionId of candidateProjectionIds) {
      const atomId = session.projections.get(projectionId)?.atomId;
      if (!atomId || !bundle.optionalAtomIds?.includes(atomId)) continue;
      if (selectedAtomIds.length >= session.config.maxContextAtoms) break;
      addWithClosure(atomId);
    }
  }
  const context = selectedAtomIds
    .map((atomId) => renderAtom(session.atoms.get(atomId) as ReflexAtomV1))
    .join('\n\n');
  const countTokens = session.config.countTokens ?? defaultCountTokens;
  const inputTokens = countTokens(`${query}\n\n${context}`);
  const disposition: ReflexSelectionDisposition =
    selectedAtomIds.length === 0
      ? 'no_applicable_bundle'
      : inputTokens > session.config.maxInputTokens
        ? 'budget_exceeded'
        : 'ready';
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
    selectedAtomIds,
    renderedContextDigest: digestDomain(
      'reflex-rendered-context',
      new TextEncoder().encode(context)
    ),
    inputTokens,
    tokenizerId: session.config.tokenizerId,
    renderer: 'reflex-renderer-v1',
    disposition,
  };
  return disposition === 'ready'
    ? { disposition, context, selectedAtomIds, receipt }
    : { disposition, context: '', selectedAtomIds: [], receipt };
}

export function verifyReflexSelectionReceiptV1(
  receipt: ReflexSelectionReceiptV1,
  query: string,
  context: string
): void {
  if (receipt.schema !== 'knolo.reflex.selection-receipt/v1')
    throw new Error('Unsupported Reflex receipt schema.');
  const queryCommitment = digestDomain(
    'reflex-query',
    canonicalCbor({ query } as never)
  );
  const contextDigest = digestDomain(
    'reflex-rendered-context',
    new TextEncoder().encode(context)
  );
  if (receipt.queryCommitment !== queryCommitment)
    throw new Error('Reflex receipt query commitment mismatch.');
  if (receipt.renderedContextDigest !== contextDigest)
    throw new Error('Reflex receipt context digest mismatch.');
}

export function validateReflexOutputV1(
  output: unknown,
  options: { requiredFields?: string[] } = {}
): ReflexOutputValidation {
  const errors: string[] = [];
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    errors.push('Output must be an object.');
  } else {
    const record = output as Record<string, unknown>;
    for (const field of options.requiredFields ?? []) {
      if (!(field in record))
        errors.push(`Missing required output field: ${field}.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function renderAtom(atom: ReflexAtomV1): string {
  return `${atom.type}: ${atom.key}\n${stableStringify(atom.body)}`;
}

function defaultCountTokens(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
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
