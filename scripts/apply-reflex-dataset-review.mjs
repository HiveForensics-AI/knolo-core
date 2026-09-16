import fs from 'node:fs/promises';
import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  assignReflexBenchmarkSplitsV1,
  validateReflexBenchmarkDatasetEnvelopeV1,
} from '../packages/reflex/dist/index.js';

const inputPath = process.argv[2];
const reviewPath = process.argv[3];
const outputPath = process.argv[4] ?? './tasks-production.json';
if (!inputPath || !reviewPath)
  throw new Error(
    'Usage: node scripts/apply-reflex-dataset-review.mjs <dataset.json> <review.json> [output.json]'
  );
const dataset = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
validateReflexBenchmarkDatasetEnvelopeV1(dataset);
if (review.schema !== 'knolo.reflex.benchmark-review/v1')
  throw new Error('Invalid Reflex benchmark review schema.');
if (!isRecord(review.reviewer))
  throw new Error('A reviewer identity is required before applying review.');
for (const field of ['id', 'revision', 'owner']) {
  if (
    typeof review.reviewer[field] !== 'string' ||
    !review.reviewer[field].trim()
  )
    throw new Error(`Reviewer requires a non-empty ${field}.`);
}
const plan = assignReflexBenchmarkSplitsV1(dataset.tasks);
const taskType = dataset.taskType ?? 'support-response';
if (
  review.sourceDataset?.taskDigest !== plan.taskDigest ||
  review.sourceDataset?.splitDigest !== plan.splitDigest ||
  review.sourceDataset?.taskType !== taskType
)
  throw new Error('Review does not match the current frozen dataset digests.');
if (!Array.isArray(review.tasks) || review.tasks.length !== plan.tasks.length)
  throw new Error('Review task count does not match the frozen dataset.');
const reviewedById = new Map(review.tasks.map((task) => [task.id, task]));
const tasks = plan.tasks.map((task) => {
  const reviewed = reviewedById.get(task.id);
  if (!reviewed) throw new Error(`Review is missing task ${task.id}.`);
  const expectedDigest = digestDomain(
    'reflex-benchmark-review-task',
    canonicalCbor({ id: task.id, family: task.family, query: task.query })
  );
  if (reviewed.taskDigest !== expectedDigest)
    throw new Error(`Review digest mismatch for task ${task.id}.`);
  if (reviewed.approved !== true)
    throw new Error(`Task ${task.id} is not approved.`);
  if (
    taskType === 'intent-classification' &&
    (typeof reviewed.approvedExpectedIntent !== 'string' ||
      !reviewed.approvedExpectedIntent.trim())
  )
    throw new Error(`Task ${task.id} requires an approved expected intent.`);
  if (!['allow', 'abstain', 'reject'].includes(reviewed.policyDecision))
    throw new Error(`Task ${task.id} requires a policy decision.`);
  return {
    ...task,
    ...(taskType === 'intent-classification'
      ? { expectedIntent: reviewed.approvedExpectedIntent.trim() }
      : {}),
    expectation: {
      mode:
        reviewed.policyDecision === 'abstain'
          ? 'abstain'
          : reviewed.policyDecision === 'reject'
            ? 'clarify'
            : 'answer',
    },
  };
});
const output = {
  schema: 'knolo.reflex.benchmark-dataset/v1',
  kind: 'production',
  taskType,
  description: 'Knolo-reviewed benchmark dataset derived from a public seed.',
  source: {
    id: `knolo-reflex-${dataset.source?.name ?? 'reviewed-dataset'}`,
    revision: review.reviewer.revision,
    owner: review.reviewer.owner,
    derivedFrom: dataset.source ?? null,
    sourceTaskDigest: plan.taskDigest,
    reviewSchema: review.schema,
    reviewerId: review.reviewer.id,
  },
  tasks,
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Applied review and created ${tasks.length}-task production dataset at ${outputPath}`
);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
