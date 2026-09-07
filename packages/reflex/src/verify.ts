import { decodeCanonicalCbor, openKnowledgeImageV5 } from '@knolo/core';
import { type ReflexManifestV1, validateReflexManifestV1 } from './index.js';

export type ReflexVerificationLimits = {
  maxObjects?: number;
  maxAtoms?: number;
  maxBundles?: number;
  maxProjections?: number;
  maxObjectBytes?: number;
};

export type ReflexVerificationResult = {
  valid: true;
  stateRoot: string;
  commitDigest: string;
  behaviorRoot: string;
  objects: number;
  atoms: number;
  bundles: number;
  projections: number;
};

export function verifyReflexImageV1(
  input: ArrayBufferLike | Uint8Array,
  limits: ReflexVerificationLimits = {}
): ReflexVerificationResult {
  const reader = openKnowledgeImageV5(input);
  const image = reader.materialize();
  const maxObjects = limits.maxObjects ?? 10_000;
  const maxAtoms = limits.maxAtoms ?? 10_000;
  const maxBundles = limits.maxBundles ?? 2_000;
  const maxProjections = limits.maxProjections ?? 10_000;
  const maxObjectBytes = limits.maxObjectBytes ?? 1_048_576;
  if (image.objects.length > maxObjects)
    throw new Error('Reflex object limit exceeded.');
  if (image.objects.some((object) => object.bytes.length > maxObjectBytes)) {
    throw new Error('Reflex object byte limit exceeded.');
  }
  const objectIds = new Set(image.objects.map((object) => object.id));
  const manifests = image.objects.filter(
    (object) => object.meta.reflex_role === 'manifest'
  );
  if (manifests.length !== 1)
    throw new Error('Reflex image must contain exactly one manifest.');
  const manifestValue = decodeCanonicalCbor(manifests[0].bytes);
  validateReflexManifestV1(manifestValue);
  validateReferences(
    manifestValue,
    objectIds,
    maxAtoms,
    maxBundles,
    maxProjections
  );
  for (const projectionId of manifestValue.projectionIds) {
    const projection = image.objects.find(
      (object) => object.id === projectionId
    );
    if (
      projection?.kind !== 'chunk' ||
      typeof projection.meta.reflex_atom !== 'string'
    ) {
      throw new Error('Reflex projection mapping is invalid.');
    }
    if (!manifestValue.atomIds.includes(projection.meta.reflex_atom)) {
      throw new Error('Reflex projection references an unknown atom.');
    }
  }
  return {
    valid: true,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    behaviorRoot: manifestValue.behaviorRoot,
    objects: image.objects.length,
    atoms: manifestValue.atomIds.length,
    bundles: manifestValue.bundleIds.length,
    projections: manifestValue.projectionIds.length,
  };
}

function validateReferences(
  manifest: ReflexManifestV1,
  objectIds: Set<string>,
  maxAtoms: number,
  maxBundles: number,
  maxProjections: number
): void {
  if (manifest.atomIds.length > maxAtoms)
    throw new Error('Reflex atom limit exceeded.');
  if (manifest.bundleIds.length > maxBundles)
    throw new Error('Reflex bundle limit exceeded.');
  if (manifest.projectionIds.length > maxProjections)
    throw new Error('Reflex projection limit exceeded.');
  const allReferences = [
    ...manifest.atomIds,
    ...manifest.bundleIds,
    ...manifest.projectionIds,
    ...manifest.sourceIds,
    ...manifest.profileIds,
    ...manifest.evaluationIds,
  ];
  if (allReferences.some((id) => !objectIds.has(id))) {
    throw new Error('Reflex manifest contains a dangling object reference.');
  }
}
