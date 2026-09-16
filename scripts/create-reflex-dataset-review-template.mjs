import fs from 'node:fs/promises';
import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  assignReflexBenchmarkSplitsV1,
  validateReflexBenchmarkDatasetEnvelopeV1,
} from '../packages/reflex/dist/index.js';

const inputPath = process.argv[2] ?? '/tmp/knolo-clinc-oos-500.json';
const outputPath = process.argv[3] ?? '/tmp/knolo-reflex-dataset-review.json';
const dataset = JSON.parse(await fs.readFile(inputPath, 'utf8'));
validateReflexBenchmarkDatasetEnvelopeV1(dataset);
const plan = assignReflexBenchmarkSplitsV1(dataset.tasks);
const review = {
  schema: 'knolo.reflex.benchmark-review/v1',
  sourceDataset: {
    taskDigest: plan.taskDigest,
    splitDigest: plan.splitDigest,
    taskType: dataset.taskType ?? 'support-response',
    source: dataset.source ?? null,
  },
  reviewer: null,
  tasks: plan.tasks.map((task) => ({
    id: task.id,
    taskDigest: digestDomain(
      'reflex-benchmark-review-task',
      canonicalCbor({ id: task.id, family: task.family, query: task.query })
    ),
    proposedExpectedIntent: task.expectedIntent ?? null,
    approvedExpectedIntent: null,
    policyDecision: null,
    approved: false,
    notes: '',
  })),
};
await fs.writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`);
console.log(
  `Created ${plan.tasks.length}-task review template at ${outputPath}`
);
