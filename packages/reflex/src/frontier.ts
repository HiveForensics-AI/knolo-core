import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  enumerateReflexMRSSubsetsV1,
  validateReflexMRSProblemV1,
  type ReflexMRSProblemV1,
  type ReflexMRSSubsetV1,
} from './optimizer.js';

const FRONTIER_SCHEMA = 'knolo.reflex.mrs-frontier/v1' as const;
const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/;

export type ReflexMRSFrontierEntryV1 = {
  selectedAtomIds: string[];
  tokenCost: number;
  predictedSuccess: number;
};

export type ReflexMRSFrontierV1 = {
  schema: typeof FRONTIER_SCHEMA;
  candidateAtomIds: string[];
  requiredAtomIds: string[];
  threshold: number;
  problemDigest: string;
  entries: ReflexMRSFrontierEntryV1[];
  frontierDigest: string;
};

export type ReflexMRSFrontierLookupOptionsV1 = {
  maxContextAtoms?: number;
  maxInputTokens?: number;
};

/** Build the exact offline Pareto frontier for a finite MRS problem. */
export function buildReflexMRSFrontierV1(
  problem: ReflexMRSProblemV1
): ReflexMRSFrontierV1 {
  validateReflexMRSProblemV1(problem);
  const enumeration = enumerateReflexMRSSubsetsV1(problem);
  if (enumeration.status === 'search_limit')
    throw new Error(enumeration.reason ?? 'MRS frontier search limit reached.');
  const entries = paretoFrontier(enumeration.subsets);
  const frontier = {
    schema: FRONTIER_SCHEMA,
    candidateAtomIds: problem.atoms.map((atom) => atom.id).sort(compareBytes),
    requiredAtomIds: [...(problem.requiredAtomIds ?? [])].sort(compareBytes),
    threshold: problem.successThreshold,
    problemDigest: computeReflexMRSProblemDigestV1(problem),
    entries,
  } satisfies Omit<ReflexMRSFrontierV1, 'frontierDigest'>;
  return {
    ...frontier,
    frontierDigest: computeFrontierDigest(frontier),
  };
}

/** Verify the self-contained, content-addressed frontier envelope. */
export function validateReflexMRSFrontierV1(
  value: unknown
): asserts value is ReflexMRSFrontierV1 {
  if (!isRecord(value) || value.schema !== FRONTIER_SCHEMA)
    throw new Error('Invalid Reflex MRS frontier schema.');
  const allowed = new Set([
    'schema',
    'candidateAtomIds',
    'requiredAtomIds',
    'threshold',
    'problemDigest',
    'entries',
    'frontierDigest',
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      throw new Error(`Unknown Reflex frontier field: ${key}`);
  assertStringArray(value.candidateAtomIds, 'candidateAtomIds');
  assertStringArray(value.requiredAtomIds, 'requiredAtomIds');
  if (new Set(value.requiredAtomIds).size !== value.requiredAtomIds.length)
    throw new Error('Duplicate Reflex frontier requiredAtomIds.');
  const candidates = new Set(value.candidateAtomIds);
  if (value.requiredAtomIds.some((id) => !candidates.has(id)))
    throw new Error('Reflex frontier required atom is not a candidate.');
  if (
    !Number.isFinite(value.threshold) ||
    !(value.threshold > 0 && value.threshold < 1)
  )
    throw new Error('Reflex frontier threshold must be between 0 and 1.');
  if (!DIGEST_PATTERN.test(value.problemDigest))
    throw new Error('Invalid Reflex frontier problemDigest.');
  if (!DIGEST_PATTERN.test(value.frontierDigest))
    throw new Error('Invalid Reflex frontier frontierDigest.');
  if (!Array.isArray(value.entries))
    throw new Error('Reflex frontier entries are required.');
  const seen = new Set<string>();
  const entryAllowed = new Set([
    'selectedAtomIds',
    'tokenCost',
    'predictedSuccess',
  ]);
  for (const entry of value.entries) {
    if (!isRecord(entry) || !Array.isArray(entry.selectedAtomIds))
      throw new Error('Invalid Reflex frontier entry.');
    for (const key of Object.keys(entry))
      if (!entryAllowed.has(key))
        throw new Error(`Unknown Reflex frontier entry field: ${key}`);
    if (
      entry.selectedAtomIds.some(
        (id) => typeof id !== 'string' || !candidates.has(id)
      ) ||
      new Set(entry.selectedAtomIds).size !== entry.selectedAtomIds.length
    )
      throw new Error('Invalid Reflex frontier entry atom IDs.');
    if (
      !Number.isFinite(entry.tokenCost) ||
      entry.tokenCost < 0 ||
      !Number.isFinite(entry.predictedSuccess) ||
      entry.predictedSuccess < 0 ||
      entry.predictedSuccess > 1 ||
      entry.predictedSuccess + Number.EPSILON < value.threshold
    )
      throw new Error('Invalid Reflex frontier entry metrics.');
    if (value.requiredAtomIds.some((id) => !entry.selectedAtomIds.includes(id)))
      throw new Error('Reflex frontier entry omits a required atom.');
    const key = entry.selectedAtomIds.join('\0');
    if (seen.has(key)) throw new Error('Duplicate Reflex frontier entry.');
    seen.add(key);
  }
  if (
    computeFrontierDigest(
      value as unknown as Omit<ReflexMRSFrontierV1, 'frontierDigest'>
    ) !== value.frontierDigest
  )
    throw new Error('Reflex frontier digest mismatch.');
}

/** Return the cheapest compatible Pareto entry without enumerating subsets. */
export function lookupReflexMRSFrontierV1(
  frontier: ReflexMRSFrontierV1,
  candidateAtomIds: string[],
  options: ReflexMRSFrontierLookupOptionsV1 = {}
): ReflexMRSFrontierEntryV1 | null {
  validateReflexMRSFrontierV1(frontier);
  if (
    !Array.isArray(candidateAtomIds) ||
    new Set(candidateAtomIds).size !== candidateAtomIds.length
  )
    throw new Error('Reflex frontier lookup candidates must be unique.');
  for (const [name, value] of [
    ['maxContextAtoms', options.maxContextAtoms],
    ['maxInputTokens', options.maxInputTokens],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0))
      throw new Error(
        `Reflex frontier ${name} must be a non-negative integer.`
      );
  }
  const available = new Set(candidateAtomIds);
  const compatible = frontier.entries.filter(
    (entry) =>
      entry.selectedAtomIds.every((id) => available.has(id)) &&
      (options.maxContextAtoms === undefined ||
        entry.selectedAtomIds.length <= options.maxContextAtoms) &&
      (options.maxInputTokens === undefined ||
        entry.tokenCost <= options.maxInputTokens)
  );
  const selected = compatible.sort(compareEntries)[0];
  return selected
    ? { ...selected, selectedAtomIds: selected.selectedAtomIds.slice() }
    : null;
}

export function computeReflexMRSFrontierEntryDigestV1(
  entry: ReflexMRSFrontierEntryV1
): string {
  return digestDomain(
    'reflex-mrs-frontier-entry',
    canonicalCbor(serializeEntry(entry) as never)
  );
}

export function computeReflexMRSProblemDigestV1(
  problem: ReflexMRSProblemV1
): string {
  validateReflexMRSProblemV1(problem);
  return digestDomain(
    'reflex-mrs-problem',
    canonicalCbor({
      atoms: problem.atoms
        .slice()
        .sort((left, right) => compareBytes(left.id, right.id))
        .map((atom) => ({
          id: atom.id,
          tokenCost: numberToken(atom.tokenCost),
          contribution: numberToken(atom.contribution),
          requires: [...(atom.requires ?? [])].sort(compareBytes),
          conflicts: [...(atom.conflicts ?? [])].sort(compareBytes),
        })),
      requiredAtomIds: [...(problem.requiredAtomIds ?? [])].sort(compareBytes),
      intercept: numberToken(problem.intercept),
      successThreshold: numberToken(problem.successThreshold),
      interactions: (problem.interactions ?? [])
        .map((interaction) => ({
          atomIds: [...interaction.atomIds].sort(compareBytes),
          contribution: numberToken(interaction.contribution),
        }))
        .sort((left, right) =>
          compareBytes(left.atomIds.join('\0'), right.atomIds.join('\0'))
        ),
      maxTokenCost:
        problem.maxTokenCost === undefined
          ? null
          : numberToken(problem.maxTokenCost),
      maxSearchAtoms: problem.maxSearchAtoms ?? 20,
    } as never)
  );
}

function paretoFrontier(
  subsets: ReflexMRSSubsetV1[]
): ReflexMRSFrontierEntryV1[] {
  const unique = new Map<string, ReflexMRSSubsetV1>();
  for (const subset of subsets) {
    const key = `${numberToken(subset.tokenCost)}\0${numberToken(subset.predictedSuccess)}`;
    const previous = unique.get(key);
    if (
      !previous ||
      compareIds(subset.selectedAtomIds, previous.selectedAtomIds) < 0
    )
      unique.set(key, subset);
  }
  return [...unique.values()]
    .filter(
      (candidate, _, all) =>
        !all.some(
          (other) =>
            other !== candidate &&
            other.tokenCost <= candidate.tokenCost &&
            other.predictedSuccess >= candidate.predictedSuccess &&
            (other.tokenCost < candidate.tokenCost ||
              other.predictedSuccess > candidate.predictedSuccess)
        )
    )
    .map((entry) => ({
      selectedAtomIds: entry.selectedAtomIds.slice(),
      tokenCost: entry.tokenCost,
      predictedSuccess: entry.predictedSuccess,
    }))
    .sort(compareEntries);
}

function computeFrontierDigest(
  frontier: Omit<ReflexMRSFrontierV1, 'frontierDigest'>
): string {
  return digestDomain(
    'reflex-mrs-frontier',
    canonicalCbor({
      schema: frontier.schema,
      candidateAtomIds: frontier.candidateAtomIds.slice().sort(compareBytes),
      requiredAtomIds: frontier.requiredAtomIds.slice().sort(compareBytes),
      threshold: numberToken(frontier.threshold),
      problemDigest: frontier.problemDigest,
      entries: frontier.entries.map(serializeEntry),
    } as never)
  );
}

function serializeEntry(entry: ReflexMRSFrontierEntryV1) {
  return {
    selectedAtomIds: entry.selectedAtomIds.slice(),
    tokenCost: numberToken(entry.tokenCost),
    predictedSuccess: numberToken(entry.predictedSuccess),
  };
}

function compareEntries(
  left: ReflexMRSFrontierEntryV1,
  right: ReflexMRSFrontierEntryV1
): number {
  return (
    left.tokenCost - right.tokenCost ||
    right.predictedSuccess - left.predictedSuccess ||
    left.selectedAtomIds.length - right.selectedAtomIds.length ||
    compareIds(left.selectedAtomIds, right.selectedAtomIds)
  );
}

function compareIds(left: string[], right: string[]): number {
  return compareBytes(left.join('\0'), right.join('\0'));
}

function assertStringArray(
  value: unknown,
  label: string
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item)
  )
    throw new Error(`Invalid Reflex frontier ${label}.`);
  if (new Set(value).size !== value.length)
    throw new Error(`Duplicate Reflex frontier ${label}.`);
}

function numberToken(value: number): string {
  return Number.isFinite(value)
    ? (Object.is(value, -0) ? 0 : value).toPrecision(17)
    : 'non-finite';
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
