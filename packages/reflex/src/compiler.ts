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
  'atomIds' | 'optionalAtomIds'
> & {
  atomIds?: string[];
  optionalAtomIds?: string[];
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
      ...bundle.atomIds,
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
  const behaviorRoot = digestDomain(
    'reflex-behavior',
    canonicalCbor({
      version: 1,
      atomIds: atomObjects.map(({ id }) => id).sort(),
      bundleIds: bundleObjects.map(({ id }) => id).sort(),
      projectionIds: projectionObjects.map(({ id }) => id).sort(),
      sourceIds: [...sourceIds].sort(),
      compiler: 'knolo-reflex-compiler-v1',
    } as never)
  );
  const manifest: ReflexManifestV1 = {
    schema: REFLEX_SCHEMA_VERSIONS.manifest,
    behaviorRoot,
    atomIds: atomObjects.map(({ id }) => id),
    bundleIds: bundleObjects.map(({ id }) => id),
    projectionIds: projectionObjects.map(({ id }) => id),
    sourceIds,
    profileIds: [],
    evaluationIds: [],
  };
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
  return { image, behaviorRoot, manifest };
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
    atomIds: resolve(input.atomIds, input.atomKeys, 'key'),
    outputSchema: input.outputSchema,
    renderer: input.renderer,
  };
  const optionalAtomIds = resolve(
    input.optionalAtomIds,
    input.optionalAtomKeys,
    'optional key'
  );
  if (optionalAtomIds.length) bundle.optionalAtomIds = optionalAtomIds;
  validateReflexBundleV1(bundle);
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
  const graph = new Map<Digest, Digest[]>();
  for (const { atom, id } of atomObjects) {
    if (atom.requires.some((dependency) => !atomIds.has(dependency)))
      throw new Error(`Atom references missing dependency: ${atom.key}`);
    if (atom.conflicts.some((conflict) => !atomIds.has(conflict)))
      throw new Error(`Atom references missing conflict: ${atom.key}`);
    graph.set(id, atom.requires);
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
