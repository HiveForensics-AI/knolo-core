import {
  canonicalCbor,
  createKnowledgeImageV5,
  digestDomain,
  type Digest,
  type KnowledgeImageV5,
} from '@knolo/core';
import {
  REFLEX_SCHEMA_VERSIONS,
  type ReflexAtomV1,
  type ReflexBundleV1,
  type ReflexManifestV1,
  validateReflexAtomV1,
  validateReflexBundleV1,
} from './index.js';

export type ReflexSourceInput = {
  bytes: Uint8Array;
  meta?: Record<string, unknown>;
};

export type ReflexBundleBuildInput = Omit<
  ReflexBundleV1,
  'requiredAtomIds' | 'triggerAtomIds' | 'atomIds' | 'optionalAtomIds'
> & {
  requiredAtomIds?: string[];
  triggerAtomIds?: string[];
  atomIds?: string[];
  optionalAtomIds?: string[];
  requiredAtomKeys?: string[];
  triggerAtomKeys?: string[];
  atomKeys?: string[];
  optionalAtomKeys?: string[];
};

export type ReflexBuildInput = {
  namespace: string;
  atoms: ReflexAtomV1[];
  bundles: ReflexBundleBuildInput[];
  sources?: ReflexSourceInput[];
  actor?: string;
};

export type ReflexBuildResult = {
  image: KnowledgeImageV5;
  behaviorRoot: Digest;
  manifest: ReflexManifestV1;
};

export function buildReflexImageV1(input: ReflexBuildInput): ReflexBuildResult {
  if (
    !input ||
    typeof input.namespace !== 'string' ||
    !input.namespace.trim()
  ) {
    throw new Error('Reflex build namespace is required.');
  }
  if (!Array.isArray(input.atoms) || !Array.isArray(input.bundles)) {
    throw new Error('Reflex build atoms and bundles are required.');
  }

  input.atoms.forEach(validateReflexAtomV1);
  const atoms = uniqueByKey(input.atoms, 'atom');
  const sourceObjects = (input.sources ?? []).map((source) => ({
    kind: 'source' as const,
    bytes: new Uint8Array(source.bytes),
    meta: {
      ...(source.meta ?? {}),
      reflex_namespace: input.namespace,
      reflex_role: 'evidence',
    },
  }));
  const sourceIds = sourceObjects.map((source) =>
    objectId(source.kind, source.bytes, source.meta)
  );
  const sourceSet = new Set(sourceIds);

  for (const atom of atoms) {
    if (atom.scope.namespace !== input.namespace)
      throw new Error(`Atom outside build namespace: ${atom.key}`);
    for (const sourceId of atom.sourceIds) {
      if (!sourceSet.has(sourceId))
        throw new Error(`Atom references missing source: ${atom.key}`);
    }
  }

  const atomObjects = atoms.map((atom) => {
    const bytes = canonicalCbor(atom as never);
    const meta = {
      reflex_namespace: input.namespace,
      reflex_role: 'atom',
      reflex_schema: REFLEX_SCHEMA_VERSIONS.atom,
      reflex_type: atom.type,
    };
    return { atom, bytes, meta, id: objectId('metadata', bytes, meta) };
  });
  const atomIds = new Set(atomObjects.map((object) => object.id));
  validateAtomReferences(atoms, atomObjects, atomIds);
  const bundles = uniqueByKey(
    input.bundles.map((bundle) => normalizeBundle(bundle, atomObjects)),
    'bundle'
  );
  for (const bundle of bundles) {
    if (bundle.namespace !== input.namespace)
      throw new Error(`Bundle outside build namespace: ${bundle.key}`);
  }

  const bundleObjects = bundles.map((bundle) => {
    const bytes = canonicalCbor(bundle as never);
    const meta = {
      reflex_namespace: input.namespace,
      reflex_role: 'bundle',
      reflex_schema: REFLEX_SCHEMA_VERSIONS.bundle,
    };
    return { bundle, bytes, meta, id: objectId('metadata', bytes, meta) };
  });
  for (const { bundle } of bundleObjects) {
    for (const atomId of [
      ...(bundle.requiredAtomIds ?? []),
      ...(bundle.triggerAtomIds ?? []),
      ...(bundle.optionalAtomIds ?? []),
    ]) {
      if (!atomIds.has(atomId))
        throw new Error(`Bundle references missing atom: ${bundle.key}`);
    }
  }

  const projectionObjects = atomObjects.map(({ atom, id: atomId }) => {
    const bytes = new TextEncoder().encode(projectionText(atom));
    const meta = {
      reflex_atom: atomId,
      reflex_namespace: input.namespace,
      reflex_role: 'projection',
    };
    return {
      kind: 'chunk' as const,
      bytes,
      meta,
      id: objectId('chunk', bytes, meta),
    };
  });
  const manifest: ReflexManifestV1 = {
    schema: REFLEX_SCHEMA_VERSIONS.manifest,
    atomIds: atomObjects.map(({ id }) => id),
    bundleIds: bundleObjects.map(({ id }) => id),
    projectionIds: projectionObjects.map(({ id }) => id),
    sourceIds,
    profileIds: [],
    evaluationIds: [],
    behaviorRoot: '',
  };
  manifest.behaviorRoot = computeReflexBehaviorRootV1(manifest);
  const manifestBytes = canonicalCbor(manifest as never);
  const manifestMeta = {
    reflex_namespace: input.namespace,
    reflex_role: 'manifest',
    reflex_schema: REFLEX_SCHEMA_VERSIONS.manifest,
  };
  const objects = [
    ...sourceObjects,
    ...atomObjects.map(({ bytes, meta }) => ({
      kind: 'metadata' as const,
      bytes,
      meta,
    })),
    ...bundleObjects.map(({ bytes, meta }) => ({
      kind: 'metadata' as const,
      bytes,
      meta,
    })),
    ...projectionObjects.map(({ bytes, meta }) => ({
      kind: 'chunk' as const,
      bytes,
      meta,
    })),
    { kind: 'metadata' as const, bytes: manifestBytes, meta: manifestMeta },
  ];
  const image = createKnowledgeImageV5({
    actor: input.actor ?? 'knolo-reflex-compiler-v1',
    objects,
  });
  return { image, behaviorRoot: manifest.behaviorRoot, manifest };
}

export const REFLEX_COMPILER_CONTRACT_V1 = 'knolo-reflex-compiler-v1' as const;

export function computeReflexBehaviorRootV1(
  manifest: Pick<
    ReflexManifestV1,
    'atomIds' | 'bundleIds' | 'projectionIds' | 'sourceIds'
  >
): Digest {
  return digestDomain(
    'reflex-behavior',
    canonicalCbor({
      version: 1,
      atomIds: manifest.atomIds.slice().sort(),
      bundleIds: manifest.bundleIds.slice().sort(),
      projectionIds: manifest.projectionIds.slice().sort(),
      sourceIds: manifest.sourceIds.slice().sort(),
      compiler: REFLEX_COMPILER_CONTRACT_V1,
    } as never)
  );
}

function normalizeBundle(
  input: ReflexBundleBuildInput,
  atomObjects: Array<{ atom: ReflexAtomV1; id: Digest }>
): ReflexBundleV1 {
  const idByKey = new Map(atomObjects.map(({ atom, id }) => [atom.key, id]));
  const resolve = (
    ids: string[] | undefined,
    keys: string[] | undefined,
    label: string
  ): string[] => {
    const resolved = [...(ids ?? [])];
    for (const key of keys ?? []) {
      const id = idByKey.get(key);
      if (!id)
        throw new Error(`Bundle references missing atom ${label}: ${key}`);
      resolved.push(id);
    }
    return [...new Set(resolved)];
  };
  const bundle: ReflexBundleV1 = {
    schema: input.schema,
    key: input.key,
    namespace: input.namespace,
    requiredAtomIds: resolve(
      input.requiredAtomIds ?? input.atomIds,
      input.requiredAtomKeys ?? input.atomKeys,
      'key'
    ),
    outputSchema: input.outputSchema,
    renderer: input.renderer,
    triggerAtomIds: [],
  };
  const triggerWasSpecified =
    input.triggerAtomIds !== undefined || input.triggerAtomKeys !== undefined;
  const triggerAtomIds = resolve(
    input.triggerAtomIds,
    input.triggerAtomKeys,
    'trigger key'
  );
  bundle.triggerAtomIds = triggerWasSpecified
    ? triggerAtomIds
    : (bundle.requiredAtomIds ?? []).slice();
  const optionalAtomIds = resolve(
    input.optionalAtomIds,
    input.optionalAtomKeys,
    'optional key'
  );
  if (optionalAtomIds.length) bundle.optionalAtomIds = optionalAtomIds;
  validateReflexBundleV1(bundle);
  if (
    bundle.optionalAtomIds?.some((id) =>
      (bundle.requiredAtomIds ?? []).includes(id)
    )
  ) {
    throw new Error(
      `Reflex bundle optional atom is also required: ${bundle.key}`
    );
  }
  return bundle;
}

function objectId(
  kind: string,
  bytes: Uint8Array,
  meta: Record<string, unknown>
): Digest {
  return digestDomain('object', canonicalCbor({ kind, bytes, meta } as never));
}

function uniqueByKey<T extends { key: string }>(
  values: T[],
  label: string
): T[] {
  const keys = new Set<string>();
  for (const value of values) {
    if (keys.has(value.key))
      throw new Error(`Duplicate Reflex ${label} key: ${value.key}`);
    keys.add(value.key);
  }
  return values.slice();
}

function validateAtomReferences(
  atoms: ReflexAtomV1[],
  atomObjects: Array<{ atom: ReflexAtomV1; id: Digest }>,
  atomIds: Set<Digest>
): void {
  const idByKey = new Map(
    atomObjects.map(({ atom, id }) => [atom.key, id] as const)
  );
  const resolveRelation = (relation: string, owner: ReflexAtomV1): Digest => {
    if (isDigest(relation)) {
      if (!atomIds.has(relation))
        throw new Error(`Atom references missing relation: ${owner.key}`);
      return relation;
    }
    const id = idByKey.get(relation);
    if (!id)
      throw new Error(
        `Atom ${owner.key} references missing atom key: ${relation}`
      );
    return id;
  };
  const graph = new Map<Digest, Digest[]>();
  for (const { atom, id } of atomObjects) {
    graph.set(
      id,
      atom.requires.map((dependency) => resolveRelation(dependency, atom))
    );
    for (const conflict of atom.conflicts) resolveRelation(conflict, atom);
  }
  const visiting = new Set<Digest>();
  const visited = new Set<Digest>();
  const visit = (id: Digest): void => {
    if (visiting.has(id)) throw new Error('Reflex atom dependency cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const atom of atoms) {
    const id = atomObjects.find((object) => object.atom === atom)?.id;
    if (id) visit(id);
  }
}

function isDigest(value: string): value is Digest {
  return /^sha256-[0-9a-f]{64}$/.test(value);
}

function projectionText(atom: ReflexAtomV1): string {
  return [
    atom.key,
    atom.type,
    atom.scope.namespace,
    atom.scope.productVersion ?? '',
    atom.scope.locale ?? '',
    stableStringify(atom.body),
  ].join('\n');
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
