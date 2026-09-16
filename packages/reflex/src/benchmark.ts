import { canonicalCbor, digestDomain } from '@knolo/core';
import type { ReflexEvaluationTaskV1 } from './evaluation.js';

export type ReflexBenchmarkSplitV1 = 'calibration' | 'development' | 'test';

export type ReflexBenchmarkTaskV1 = ReflexEvaluationTaskV1 & {
  split: ReflexBenchmarkSplitV1;
};

export type ReflexBenchmarkSplitPlanV1 = {
  schema: 'knolo.reflex.benchmark-splits/v1';
  tasks: ReflexBenchmarkTaskV1[];
  counts: Record<ReflexBenchmarkSplitV1, number>;
  taskDigest: string;
  splitDigest: string;
};

export type ReflexBenchmarkDatasetValidationOptionsV1 = {
  minimumTasks?: number;
};

export type ReflexBenchmarkDatasetKindV1 =
  'production' | 'public-seed' | 'synthetic-test' | null;

export type ReflexBenchmarkTaskTypeV1 =
  'support-response' | 'intent-classification';

export type ReflexBenchmarkDatasetSourceV1 = {
  id: string;
  revision: string;
  owner: string;
  [key: string]: unknown;
};

export type ReflexBenchmarkDatasetEnvelopeV1 = {
  schema: 'knolo.reflex.benchmark-dataset/v1';
  kind: Exclude<ReflexBenchmarkDatasetKindV1, null>;
  taskType?: ReflexBenchmarkTaskTypeV1;
  source?: ReflexBenchmarkDatasetSourceV1 | string;
  tasks: ReflexEvaluationTaskV1[];
  [key: string]: unknown;
};

export type ReflexBenchmarkDatasetClassV1 =
  | 'production-candidate'
  | 'public-seed-only'
  | 'synthetic-test-only'
  | 'exploratory';

/** Classify evidence without allowing unclassified data to become production evidence. */
export function classifyReflexBenchmarkDatasetV1(
  taskCount: number,
  datasetKind: ReflexBenchmarkDatasetKindV1,
  minimumTasks = 500
): ReflexBenchmarkDatasetClassV1 {
  if (!Number.isInteger(taskCount) || taskCount < 0)
    throw new Error('Benchmark taskCount must be a non-negative integer.');
  if (!Number.isInteger(minimumTasks) || minimumTasks <= 0)
    throw new Error('Benchmark minimumTasks must be a positive integer.');
  if (datasetKind === 'production' && taskCount >= minimumTasks)
    return 'production-candidate';
  if (datasetKind === 'public-seed') return 'public-seed-only';
  if (datasetKind === 'synthetic-test') return 'synthetic-test-only';
  return 'exploratory';
}

/** Validate the versioned wrapper used for frozen benchmark datasets. */
export function validateReflexBenchmarkDatasetEnvelopeV1(
  value: unknown
): asserts value is ReflexBenchmarkDatasetEnvelopeV1 {
  if (!isRecord(value) || value.schema !== 'knolo.reflex.benchmark-dataset/v1')
    throw new Error('Invalid Reflex benchmark dataset envelope schema.');
  if (!['production', 'public-seed', 'synthetic-test'].includes(value.kind))
    throw new Error(
      'Benchmark dataset kind must be production, public-seed, or synthetic-test.'
    );
  if (
    value.taskType !== undefined &&
    !['support-response', 'intent-classification'].includes(value.taskType)
  )
    throw new Error(
      'Benchmark dataset taskType must be support-response or intent-classification.'
    );
  if (!Array.isArray(value.tasks))
    throw new Error('Benchmark dataset envelope requires a tasks array.');
  if (value.kind === 'production') {
    if (!isRecord(value.source))
      throw new Error(
        'Production benchmark datasets require an object source with id, revision, and owner.'
      );
    for (const field of ['id', 'revision', 'owner']) {
      if (
        typeof value.source[field] !== 'string' ||
        !value.source[field].trim()
      )
        throw new Error(
          `Production benchmark dataset source requires a non-empty ${field}.`
        );
    }
  }
  validateTasks(value.tasks as ReflexEvaluationTaskV1[]);
  if (
    value.taskType === 'intent-classification' &&
    value.tasks.some(
      (task) =>
        typeof task.expectedIntent !== 'string' || !task.expectedIntent.trim()
    )
  )
    throw new Error(
      'Intent-classification datasets require expectedIntent on every task.'
    );
}

/** Assign frozen 60/20/20 calibration/development/test splits by task digest. */
export function assignReflexBenchmarkSplitsV1(
  tasks: ReflexEvaluationTaskV1[]
): ReflexBenchmarkSplitPlanV1 {
  validateTasks(tasks);
  const ranked = tasks
    .map((task) => ({
      task,
      rank: digestDomain(
        'reflex-benchmark-task-rank',
        canonicalCbor(task as never)
      ),
    }))
    .sort((left, right) => compareBytes(left.rank, right.rank));
  const calibrationCount = Math.ceil(tasks.length * 0.6);
  const developmentCount = Math.floor(tasks.length * 0.2);
  const assigned = ranked.map(({ task }, index) => ({
    ...task,
    split:
      index < calibrationCount
        ? ('calibration' as const)
        : index < calibrationCount + developmentCount
          ? ('development' as const)
          : ('test' as const),
  }));
  const ordered = assigned
    .slice()
    .sort((left, right) => compareBytes(left.id, right.id));
  const counts = {
    calibration: ordered.filter((task) => task.split === 'calibration').length,
    development: ordered.filter((task) => task.split === 'development').length,
    test: ordered.filter((task) => task.split === 'test').length,
  };
  const taskDigest = digestDomain(
    'reflex-benchmark-tasks',
    canonicalCbor(ordered as never)
  );
  const splitDigest = digestDomain(
    'reflex-benchmark-splits',
    canonicalCbor(ordered.map(({ id, split }) => ({ id, split })) as never)
  );
  return {
    schema: 'knolo.reflex.benchmark-splits/v1',
    tasks: ordered,
    counts,
    taskDigest,
    splitDigest,
  };
}

/** Enforce the minimum dataset size and split ratios required for production evidence. */
export function validateReflexBenchmarkDatasetV1(
  plan: ReflexBenchmarkSplitPlanV1,
  options: ReflexBenchmarkDatasetValidationOptionsV1 = {}
): void {
  validateReflexBenchmarkSplitPlanV1(plan);
  const minimumTasks = options.minimumTasks ?? 500;
  if (!Number.isInteger(minimumTasks) || minimumTasks <= 0)
    throw new Error('Benchmark minimumTasks must be a positive integer.');
  if (plan.tasks.length < minimumTasks)
    throw new Error(
      `Production benchmark requires at least ${minimumTasks} tasks; received ${plan.tasks.length}.`
    );
  const total = plan.tasks.length;
  const ratios = {
    calibration: plan.counts.calibration / total,
    development: plan.counts.development / total,
    test: plan.counts.test / total,
  };
  if (
    ratios.calibration < 0.55 ||
    ratios.calibration > 0.65 ||
    ratios.development < 0.15 ||
    ratios.development > 0.25 ||
    ratios.test < 0.15 ||
    ratios.test > 0.25
  )
    throw new Error(
      'Production benchmark split ratios must be approximately 60/20/20.'
    );
}

export function validateReflexBenchmarkSplitPlanV1(
  value: unknown
): asserts value is ReflexBenchmarkSplitPlanV1 {
  if (
    !isRecord(value) ||
    value.schema !== 'knolo.reflex.benchmark-splits/v1' ||
    !Array.isArray(value.tasks)
  )
    throw new Error('Invalid Reflex benchmark split plan.');
  validateTasks(value.tasks as ReflexEvaluationTaskV1[]);
  for (const task of value.tasks) {
    if (!['calibration', 'development', 'test'].includes(task.split))
      throw new Error(`Invalid benchmark split: ${task.id}`);
  }
  if (
    !isRecord(value.counts) ||
    !Number.isInteger(value.counts.calibration) ||
    !Number.isInteger(value.counts.development) ||
    !Number.isInteger(value.counts.test)
  )
    throw new Error('Invalid Reflex benchmark split counts.');
  if (
    value.counts.calibration + value.counts.development + value.counts.test !==
    value.tasks.length
  )
    throw new Error('Reflex benchmark split counts do not match tasks.');
  if (
    typeof value.taskDigest !== 'string' ||
    !/^sha256-[0-9a-f]{64}$/.test(value.taskDigest) ||
    typeof value.splitDigest !== 'string' ||
    !/^sha256-[0-9a-f]{64}$/.test(value.splitDigest)
  )
    throw new Error('Invalid Reflex benchmark split digests.');
  const expected = assignReflexBenchmarkSplitsV1(
    value.tasks.map(({ split: _split, ...task }) => task)
  );
  if (
    expected.taskDigest !== value.taskDigest ||
    expected.splitDigest !== value.splitDigest ||
    JSON.stringify(expected.tasks) !== JSON.stringify(value.tasks)
  )
    throw new Error('Reflex benchmark split plan digest mismatch.');
}

function validateTasks(tasks: ReflexEvaluationTaskV1[]): void {
  if (
    !Array.isArray(tasks) ||
    tasks.some(
      (task) =>
        !isRecord(task) ||
        typeof task.id !== 'string' ||
        !task.id.trim() ||
        typeof task.family !== 'string' ||
        !task.family.trim() ||
        typeof task.query !== 'string' ||
        !task.query.trim()
    )
  )
    throw new Error(
      'Reflex benchmark tasks require IDs, families, and queries.'
    );
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    throw new Error('Reflex benchmark task IDs must be unique.');
  if (
    tasks.some(
      (task) =>
        task.expectedIntent !== undefined &&
        (typeof task.expectedIntent !== 'string' || !task.expectedIntent.trim())
    )
  )
    throw new Error(
      'Benchmark expectedIntent values must be non-empty strings.'
    );
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
