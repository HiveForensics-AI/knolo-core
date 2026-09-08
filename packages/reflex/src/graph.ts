import { decodeCanonicalCbor, type KnowledgeObjectV1 } from '@knolo/core';
import {
  type ReflexAtomV1,
  type ReflexBundleV1,
  type ReflexManifestV1,
  validateReflexAtomV1,
  validateReflexBundleV1,
} from './index.js';

/**
 * Validate every decoded Reflex relationship before runtime use. This is the
 * shared logical-graph gate for image verification and runtime mounting.
 */
export function validateReflexLogicalGraphV1(
  manifest: ReflexManifestV1,
  objects: KnowledgeObjectV1[]
): void {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const atoms = new Map<string, ReflexAtomV1>();
  for (const atomId of manifest.atomIds) {
    const object = byId.get(atomId);
    assertRole(object, 'metadata', 'atom');
    const atom = decodeCanonicalCbor(object.bytes);
    validateReflexAtomV1(atom);
    if (object.meta.reflex_namespace !== atom.scope.namespace)
      throw new Error(`Reflex atom namespace metadata mismatch: ${atom.key}`);
    for (const sourceId of atom.sourceIds) {
      const source = byId.get(sourceId);
      assertRole(source, 'source', 'evidence');
    }
    atoms.set(atomId, atom);
  }

  const idByKey = new Map(
    [...atoms.entries()].map(([id, atom]) => [atom.key, id] as const)
  );
  const requires = new Map<string, string[]>();
  for (const [atomId, atom] of atoms) {
    requires.set(atomId, []);
    for (const relation of [...atom.requires, ...atom.conflicts]) {
      const relationId = atoms.has(relation) ? relation : idByKey.get(relation);
      if (!relationId)
        throw new Error(`Reflex atom references missing relation: ${atom.key}`);
      if (atom.requires.includes(relation))
        requires.get(atomId)?.push(relationId);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (atomId: string): void => {
    if (visiting.has(atomId)) throw new Error('Reflex atom dependency cycle.');
    if (visited.has(atomId)) return;
    visiting.add(atomId);
    for (const dependency of requires.get(atomId) ?? []) visit(dependency);
    visiting.delete(atomId);
    visited.add(atomId);
  };
  for (const atomId of atoms.keys()) visit(atomId);

  for (const bundleId of manifest.bundleIds) {
    const object = byId.get(bundleId);
    assertRole(object, 'metadata', 'bundle');
    const bundle = decodeCanonicalCbor(object.bytes);
    validateReflexBundleV1(bundle);
    if (object.meta.reflex_namespace !== bundle.namespace)
      throw new Error(
        `Reflex bundle namespace metadata mismatch: ${bundle.key}`
      );
    for (const atomId of [
      ...(bundle.requiredAtomIds ?? bundle.atomIds ?? []),
      ...(bundle.triggerAtomIds ?? []),
      ...(bundle.optionalAtomIds ?? []),
    ]) {
      if (!atoms.has(atomId))
        throw new Error(`Reflex bundle references missing atom: ${bundle.key}`);
      if (atoms.get(atomId)?.scope.namespace !== bundle.namespace)
        throw new Error(`Reflex bundle atom namespace mismatch: ${bundle.key}`);
    }
  }
  for (const projectionId of manifest.projectionIds) {
    const object = byId.get(projectionId);
    assertRole(object, 'chunk', 'projection');
    const atomId = object.meta.reflex_atom;
    if (typeof atomId !== 'string' || !atoms.has(atomId))
      throw new Error('Reflex projection references an unknown atom.');
  }
}

function assertRole(
  object: KnowledgeObjectV1 | undefined,
  kind: string,
  role: string
): asserts object is KnowledgeObjectV1 {
  if (!object || object.kind !== kind || object.meta.reflex_role !== role)
    throw new Error(`Reflex object role is invalid: ${role}.`);
}
