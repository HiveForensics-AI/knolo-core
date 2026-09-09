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
