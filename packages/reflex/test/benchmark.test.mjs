import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignReflexBenchmarkSplitsV1,
  validateReflexBenchmarkSplitPlanV1,
} from '../dist/index.js';

const tasks = [
  { id: 't-1', family: 'a', query: 'one' },
  { id: 't-2', family: 'a', query: 'two' },
  { id: 't-3', family: 'b', query: 'three' },
  { id: 't-4', family: 'b', query: 'four' },
  { id: 't-5', family: 'c', query: 'five' },
  { id: 't-6', family: 'c', query: 'six' },
  { id: 't-7', family: 'd', query: 'seven' },
  { id: 't-8', family: 'd', query: 'eight' },
  { id: 't-9', family: 'e', query: 'nine' },
  { id: 't-10', family: 'e', query: 'ten' },
];

test('assigns stable 60/20/20 benchmark splits and digests', () => {
  const first = assignReflexBenchmarkSplitsV1(tasks);
  const second = assignReflexBenchmarkSplitsV1(tasks.slice().reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first.counts, {
    calibration: 6,
    development: 2,
    test: 2,
  });
  validateReflexBenchmarkSplitPlanV1(first);
});

test('rejects changed task content in a frozen split plan', () => {
  const plan = assignReflexBenchmarkSplitsV1(tasks);
  const tampered = {
    ...plan,
    tasks: plan.tasks.map((task, index) =>
      index === 0 ? { ...task, query: `${task.query} changed` } : task
    ),
  };
  assert.throws(
    () => validateReflexBenchmarkSplitPlanV1(tampered),
    /split plan digest mismatch/
  );
});
