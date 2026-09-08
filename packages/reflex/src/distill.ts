import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  REFLEX_RENDERER_V1,
  REFLEX_SCHEMA_VERSIONS,
  type ReflexAtomV1,
  validateReflexAtomV1,
} from './index.js';
import { type ReflexBundleBuildInput } from './compiler.js';

export type ReflexTeacherRecordV1 = {
  id: string;
  family: string;
  query: string;
  teacherOutput: string;
  sourceIds?: string[];
  accepted?: boolean;
};

export type ReflexBehaviorExtractionV1 = {
  atoms: ReflexAtomV1[];
  triggerAtomKeys?: string[];
};

export type ReflexBehaviorExtractorV1 = (
  record: ReflexTeacherRecordV1
) => ReflexBehaviorExtractionV1 | Promise<ReflexBehaviorExtractionV1>;

export type ReflexDistillationConfigV1 = {
  namespace: string;
  extractor: ReflexBehaviorExtractorV1;
  outputSchema?: Record<string, unknown>;
  renderer?: typeof REFLEX_RENDERER_V1;
};

export type ReflexDistillationRejectV1 = {
  id: string;
  reason: string;
};

export type ReflexDistillationResultV1 = {
  atoms: ReflexAtomV1[];
  bundles: ReflexBundleBuildInput[];
  acceptedRecordIds: string[];
  rejectedRecords: ReflexDistillationRejectV1[];
  duplicateAtomCount: number;
  distillationDigest: string;
};

/**
 * Distill already-frozen, authorized teacher records through an injected
 * extractor. The extractor is the model/provider boundary; this function is
 * deterministic once its extracted results are frozen.
 */
export async function distillReflexBehaviorV1(
  records: ReflexTeacherRecordV1[],
  config: ReflexDistillationConfigV1
): Promise<ReflexDistillationResultV1> {
  if (
    !config ||
    typeof config.namespace !== 'string' ||
    !config.namespace.trim()
  )
    throw new Error('Reflex distillation namespace is required.');
  if (typeof config.extractor !== 'function')
    throw new Error('Reflex distillation extractor is required.');
  if (!Array.isArray(records))
    throw new Error('Reflex teacher records are required.');

  const sortedRecords = records
    .slice()
    .sort((left, right) => compareBytes(left.id, right.id));
  const recordIds = new Set<string>();
  for (const record of sortedRecords) {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !record.id.trim() ||
      recordIds.has(record.id)
    )
      throw new Error(
        `Invalid or duplicate teacher record ID: ${record?.id ?? ''}`
      );
    if (typeof record.family !== 'string' || !record.family.trim())
      throw new Error(`Teacher record family is required: ${record.id}`);
    if (typeof record.query !== 'string' || !record.query.trim())
      throw new Error(`Teacher record query is required: ${record.id}`);
    if (
      typeof record.teacherOutput !== 'string' ||
      !record.teacherOutput.trim()
    )
      throw new Error(`Teacher record output is required: ${record.id}`);
    recordIds.add(record.id);
  }

  const atomsByKey = new Map<string, ReflexAtomV1>();
  const familyAtoms = new Map<string, Set<string>>();
  const familyTriggers = new Map<string, Set<string>>();
  const acceptedRecordIds: string[] = [];
  const rejectedRecords: ReflexDistillationRejectV1[] = [];
  let duplicateAtomCount = 0;

  for (const record of sortedRecords) {
    if (record.accepted === false) {
      rejectedRecords.push({
        id: record.id,
        reason: 'teacher record was not accepted',
      });
      continue;
    }
    const extracted = await config.extractor(record);
    if (!extracted || !Array.isArray(extracted.atoms)) {
      rejectedRecords.push({
        id: record.id,
        reason: 'extractor returned no atom list',
      });
      continue;
    }
    const recordAtomKeys = new Set<string>();
    for (const atom of extracted.atoms) {
      const normalized = normalizeAtom(
        atom,
        config.namespace,
        record.sourceIds ?? []
      );
      const existing = atomsByKey.get(normalized.key);
      if (existing) {
        if (atomSignature(existing) !== atomSignature(normalized)) {
          throw new Error(
            `Conflicting extracted behavior for atom key: ${normalized.key}`
          );
        }
        const merged = mergeAtomReferences(existing, normalized);
        atomsByKey.set(normalized.key, merged);
        duplicateAtomCount++;
      } else {
        atomsByKey.set(normalized.key, normalized);
      }
      recordAtomKeys.add(normalized.key);
    }
    if (!recordAtomKeys.size) {
      rejectedRecords.push({
        id: record.id,
        reason: 'extractor produced no atoms',
      });
      continue;
    }
    acceptedRecordIds.push(record.id);
    const atomsForFamily = familyAtoms.get(record.family) ?? new Set<string>();
    for (const key of recordAtomKeys) atomsForFamily.add(key);
    familyAtoms.set(record.family, atomsForFamily);
    const triggerKeys = extracted.triggerAtomKeys?.length
      ? extracted.triggerAtomKeys
      : [...recordAtomKeys].filter(
          (key) => atomsByKey.get(key)?.type === 'intent'
        );
    const triggersForFamily =
      familyTriggers.get(record.family) ?? new Set<string>();
    for (const key of triggerKeys) {
      if (recordAtomKeys.has(key)) triggersForFamily.add(key);
    }
    familyTriggers.set(record.family, triggersForFamily);
  }

  const atoms = [...atomsByKey.values()].sort((left, right) =>
    compareBytes(left.key, right.key)
  );
  const bundles: ReflexBundleBuildInput[] = [];
  for (const [family, keys] of [...familyAtoms.entries()].sort((left, right) =>
    compareBytes(left[0], right[0])
  )) {
    const requiredAtomKeys = [...keys].sort(compareBytes);
    const triggerAtomKeys = [
      ...(familyTriggers.get(family) ?? new Set<string>()),
    ]
      .filter((key) => keys.has(key))
      .sort(compareBytes);
    bundles.push({
      schema: REFLEX_SCHEMA_VERSIONS.bundle,
      key: `${config.namespace}.${family}.default`,
      namespace: config.namespace,
      requiredAtomKeys,
      triggerAtomKeys: triggerAtomKeys.length
        ? triggerAtomKeys
        : requiredAtomKeys.slice(),
      outputSchema: config.outputSchema ?? { type: 'object' },
      renderer: config.renderer ?? REFLEX_RENDERER_V1,
    });
  }
  const distillationDigest = digestDomain(
    'reflex-distillation',
    canonicalCbor({
      version: 1,
      namespace: config.namespace,
      acceptedRecordIds,
      rejectedRecords,
      atomKeys: atoms.map((atom) => atom.key),
      atomSignatures: atoms.map(atomSignature),
      bundleKeys: bundles.map((bundle) => bundle.key),
      duplicateAtomCount,
    } as never)
  );
  return {
    atoms,
    bundles,
    acceptedRecordIds,
    rejectedRecords,
    duplicateAtomCount,
    distillationDigest,
  };
}

function normalizeAtom(
  atom: ReflexAtomV1,
  namespace: string,
  recordSourceIds: string[]
): ReflexAtomV1 {
  validateReflexAtomV1(atom);
  if (atom.scope.namespace !== namespace)
    throw new Error(
      `Extracted atom outside distillation namespace: ${atom.key}`
    );
  const sourceIds = [...new Set([...atom.sourceIds, ...recordSourceIds])].sort(
    compareBytes
  );
  return {
    ...atom,
    requires: [...new Set(atom.requires)].sort(compareBytes),
    conflicts: [...new Set(atom.conflicts)].sort(compareBytes),
    sourceIds,
  };
}

function mergeAtomReferences(
  left: ReflexAtomV1,
  right: ReflexAtomV1
): ReflexAtomV1 {
  return {
    ...left,
    requires: [...new Set([...left.requires, ...right.requires])].sort(
      compareBytes
    ),
    conflicts: [...new Set([...left.conflicts, ...right.conflicts])].sort(
      compareBytes
    ),
    sourceIds: [...new Set([...left.sourceIds, ...right.sourceIds])].sort(
      compareBytes
    ),
  };
}

function atomSignature(atom: ReflexAtomV1): string {
  return digestDomain(
    'reflex-atom-signature',
    canonicalCbor({
      schema: atom.schema,
      type: atom.type,
      key: atom.key,
      scope: atom.scope,
      body: atom.body,
    } as never)
  );
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
