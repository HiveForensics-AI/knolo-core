import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  REFLEX_RENDERER_V1,
  REFLEX_SCHEMA_VERSIONS,
  type ReflexAtomV1,
  validateReflexAtomV1,
} from './index.js';
import { type ReflexBundleBuildInput } from './compiler.js';

const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/;

export type ReflexTeacherRecordV1 = {
  schema: 'knolo.reflex.teacher-record/v1';
  id: string;
  family: string;
  query: string;
  teacherOutput: string;
  sourceIds?: string[];
  accepted?: boolean;
  provenance: ReflexTeacherProvenanceV1;
  recordRoot?: string;
};

export type ReflexTeacherProvenanceV1 = {
  teacherModelId: string;
  teacherRevision: string;
  promptContractDigest: string;
  extractorId: string;
  extractorRevision: string;
  extractionContractDigest: string;
  judgeId: string;
  judgeRevision: string;
  datasetSplit: 'train' | 'calibration' | 'development' | 'test';
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

export type ReflexFrozenDistillationConfigV1 = Omit<
  ReflexDistillationConfigV1,
  'extractor'
>;

export type ReflexDistillationRejectV1 = {
  id: string;
  reason: string;
};

export type ReflexDistillationResultV1 = {
  atoms: ReflexAtomV1[];
  bundles: ReflexBundleBuildInput[];
  extractionRecords: ReflexExtractionRecordV1[];
  acceptedRecordIds: string[];
  rejectedRecords: ReflexDistillationRejectV1[];
  duplicateAtomCount: number;
  distillationDigest: string;
};

export type ReflexExtractionRecordV1 = {
  schema: 'knolo.reflex.extraction-record/v1';
  recordId: string;
  family: string;
  query: string;
  teacherOutput: string;
  sourceIds: string[];
  accepted: boolean;
  provenance: ReflexTeacherProvenanceV1;
  teacherRecordRoot: string;
  extraction: ReflexBehaviorExtractionV1;
  extractionRoot: string;
};

export function validateReflexExtractionRecordV1(
  record: unknown
): asserts record is ReflexExtractionRecordV1 {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('Invalid Reflex extraction record.');
  const value = record as Record<string, unknown>;
  if (value.schema !== 'knolo.reflex.extraction-record/v1')
    throw new Error('Invalid Reflex extraction record schema.');
  for (const field of ['recordId', 'family', 'query', 'teacherOutput']) {
    if (typeof value[field] !== 'string' || !value[field].trim())
      throw new Error(`Extraction record ${field} is required.`);
  }
  if (
    typeof value.teacherRecordRoot !== 'string' ||
    !DIGEST_PATTERN.test(value.teacherRecordRoot)
  )
    throw new Error('Extraction record teacher root is invalid.');
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.some(
      (id) => typeof id !== 'string' || !DIGEST_PATTERN.test(id)
    )
  )
    throw new Error('Extraction record sourceIds are invalid.');
  if (value.accepted !== true)
    throw new Error('Extraction record must be accepted.');
  if (!value.provenance || typeof value.provenance !== 'object')
    throw new Error('Extraction record provenance is required.');
  const teacherRecord = {
    schema: 'knolo.reflex.teacher-record/v1' as const,
    id: value.recordId as string,
    family: value.family as string,
    query: value.query as string,
    teacherOutput: value.teacherOutput as string,
    sourceIds: value.sourceIds as string[],
    accepted: true,
    provenance: value.provenance as ReflexTeacherProvenanceV1,
  };
  validateReflexTeacherRecordV1({
    ...teacherRecord,
    recordRoot: value.teacherRecordRoot,
  });
  const extraction = value.extraction;
  if (
    !extraction ||
    typeof extraction !== 'object' ||
    Array.isArray(extraction)
  )
    throw new Error('Extraction record extraction is required.');
  const extractionValue = extraction as Record<string, unknown>;
  if (!Array.isArray(extractionValue.atoms))
    throw new Error('Extraction record atoms are required.');
  for (const atom of extractionValue.atoms) validateReflexAtomV1(atom);
  if (
    extractionValue.triggerAtomKeys !== undefined &&
    (!Array.isArray(extractionValue.triggerAtomKeys) ||
      extractionValue.triggerAtomKeys.some((key) => typeof key !== 'string'))
  )
    throw new Error('Extraction record trigger keys are invalid.');
  if (
    typeof value.extractionRoot !== 'string' ||
    !DIGEST_PATTERN.test(value.extractionRoot) ||
    value.extractionRoot !==
      computeReflexExtractionRootV1(
        value.teacherRecordRoot,
        extraction as ReflexBehaviorExtractionV1
      )
  )
    throw new Error('Extraction record root mismatch.');
}

export function computeReflexTeacherRecordRootV1(
  record: Omit<ReflexTeacherRecordV1, 'recordRoot'>
): string {
  return digestDomain(
    'reflex-teacher-record',
    canonicalCbor({
      schema: record.schema,
      id: record.id,
      family: record.family,
      query: record.query,
      teacherOutput: record.teacherOutput,
      sourceIds: [...(record.sourceIds ?? [])].sort(compareBytes),
      accepted: true,
      provenance: record.provenance,
    } as never)
  );
}

export function computeReflexExtractionRootV1(
  recordRoot: string,
  extraction: ReflexBehaviorExtractionV1
): string {
  return digestDomain(
    'reflex-extraction',
    canonicalCbor({
      version: 1,
      teacherRecordRoot: recordRoot,
      triggerAtomKeys: [...(extraction.triggerAtomKeys ?? [])].sort(
        compareBytes
      ),
      atomSignatures: extraction.atoms.map(atomSignature).sort(compareBytes),
    } as never)
  );
}

export function validateReflexTeacherRecordV1(
  record: unknown
): asserts record is ReflexTeacherRecordV1 {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('Invalid Reflex teacher record.');
  const value = record as Record<string, unknown>;
  if (value.schema !== 'knolo.reflex.teacher-record/v1')
    throw new Error('Invalid Reflex teacher record schema.');
  for (const field of ['id', 'family', 'query', 'teacherOutput']) {
    if (typeof value[field] !== 'string' || !value[field].trim())
      throw new Error(`Teacher record ${field} is required.`);
  }
  if (value.accepted !== undefined && typeof value.accepted !== 'boolean')
    throw new Error('Teacher record accepted must be boolean.');
  if (
    value.sourceIds !== undefined &&
    (!Array.isArray(value.sourceIds) ||
      value.sourceIds.some(
        (id) => typeof id !== 'string' || !DIGEST_PATTERN.test(id)
      ))
  )
    throw new Error('Teacher record sourceIds are invalid.');
  const provenance = value.provenance;
  if (
    !provenance ||
    typeof provenance !== 'object' ||
    Array.isArray(provenance)
  )
    throw new Error('Teacher record provenance is required.');
  const provenanceValue = provenance as Record<string, unknown>;
  for (const field of [
    'teacherModelId',
    'teacherRevision',
    'promptContractDigest',
    'extractorId',
    'extractorRevision',
    'extractionContractDigest',
    'judgeId',
    'judgeRevision',
  ]) {
    if (
      typeof provenanceValue[field] !== 'string' ||
      !provenanceValue[field].trim()
    )
      throw new Error(`Teacher provenance ${field} is required.`);
  }
  if (
    !['train', 'calibration', 'development', 'test'].includes(
      provenanceValue.datasetSplit as string
    )
  )
    throw new Error('Teacher provenance datasetSplit is invalid.');
  for (const field of ['promptContractDigest', 'extractionContractDigest']) {
    if (!DIGEST_PATTERN.test(provenanceValue[field] as string))
      throw new Error(`Teacher provenance ${field} must be a digest.`);
  }
  if (value.recordRoot !== undefined) {
    if (
      typeof value.recordRoot !== 'string' ||
      !DIGEST_PATTERN.test(value.recordRoot)
    )
      throw new Error('Teacher record root is invalid.');
    const expected = computeReflexTeacherRecordRootV1(
      value as unknown as Omit<ReflexTeacherRecordV1, 'recordRoot'>
    );
    if (value.recordRoot !== expected)
      throw new Error('Teacher record root mismatch.');
  }
}

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
    validateReflexTeacherRecordV1(record);
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
  const extractionRecords: ReflexExtractionRecordV1[] = [];
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
    const normalizedAtoms: ReflexAtomV1[] = [];
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
      normalizedAtoms.push(normalized);
    }
    if (!recordAtomKeys.size) {
      rejectedRecords.push({
        id: record.id,
        reason: 'extractor produced no atoms',
      });
      continue;
    }
    acceptedRecordIds.push(record.id);
    const teacherRecordRoot =
      record.recordRoot ?? computeReflexTeacherRecordRootV1(record);
    const normalizedExtraction = {
      atoms: normalizedAtoms.sort((left, right) =>
        compareBytes(left.key, right.key)
      ),
      ...(extracted.triggerAtomKeys
        ? { triggerAtomKeys: [...extracted.triggerAtomKeys].sort(compareBytes) }
        : {}),
    };
    extractionRecords.push({
      schema: 'knolo.reflex.extraction-record/v1',
      recordId: record.id,
      family: record.family,
      query: record.query,
      teacherOutput: record.teacherOutput,
      sourceIds: [...(record.sourceIds ?? [])].sort(compareBytes),
      accepted: true,
      provenance: record.provenance,
      teacherRecordRoot,
      extraction: normalizedExtraction,
      extractionRoot: computeReflexExtractionRootV1(
        teacherRecordRoot,
        normalizedExtraction
      ),
    });
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
      triggerMode: 'any',
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
      extractionRoots: extractionRecords.map((record) => record.extractionRoot),
      duplicateAtomCount,
    } as never)
  );
  return {
    atoms,
    bundles,
    extractionRecords,
    acceptedRecordIds,
    rejectedRecords,
    duplicateAtomCount,
    distillationDigest,
  };
}

/**
 * Rebuild behavior using only serialized extraction records. This is the
 * executable-code-free deterministic stage after teacher extraction.
 */
export async function distillReflexFrozenExtractionsV1(
  records: ReflexExtractionRecordV1[],
  config: ReflexFrozenDistillationConfigV1
): Promise<ReflexDistillationResultV1> {
  if (!Array.isArray(records))
    throw new Error('Reflex extraction records are required.');
  const sorted = records
    .slice()
    .sort((left, right) => compareBytes(left.recordId, right.recordId));
  for (const record of sorted) validateReflexExtractionRecordV1(record);
  const seen = new Set<string>();
  for (const record of sorted) {
    if (seen.has(record.recordId))
      throw new Error(`Duplicate extraction record ID: ${record.recordId}`);
    seen.add(record.recordId);
  }
  const extractionById = new Map(
    sorted.map((record) => [record.recordId, record.extraction])
  );
  return distillReflexBehaviorV1(
    sorted.map((record) => ({
      schema: 'knolo.reflex.teacher-record/v1',
      id: record.recordId,
      family: record.family,
      query: record.query,
      teacherOutput: record.teacherOutput,
      sourceIds: record.sourceIds,
      accepted: true,
      provenance: record.provenance,
      recordRoot: record.teacherRecordRoot,
    })),
    {
      ...config,
      extractor: (record) =>
        extractionById.get(record.id) as ReflexBehaviorExtractionV1,
    }
  );
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
