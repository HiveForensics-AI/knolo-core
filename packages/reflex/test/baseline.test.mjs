import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReflexVariantsV1 } from '../dist/index.js';

test('compares variants on the same task set', async () => {
  const tasks = [
    { id: '1', family: 'support', query: 'reset account' },
    { id: '2', family: 'support', query: 'reset account' },
  ];
  const report = await compareReflexVariantsV1(tasks, [
    {
      id: 'no-pack',
      model: {
        modelId: 'student',
        revision: 'r1',
        run: async () => ({ failure: false }),
      },
    },
    {
      id: 'reflex',
      model: {
        modelId: 'student',
        revision: 'r1',
        run: async () => ({ failure: true, policyViolation: true }),
      },
    },
  ]);
  assert.equal(report.schema, 'knolo.reflex.comparison/v1');
  assert.equal(report.variants[0].answeredTasks, 2);
  assert.equal(report.variants[0].failures, 0);
  assert.equal(report.variants[1].policyViolations, 2);
});
