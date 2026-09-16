import fs from 'node:fs/promises';
import {
  assignReflexBenchmarkSplitsV1,
  validateReflexBenchmarkDatasetEnvelopeV1,
  validateReflexBenchmarkDatasetV1,
} from '../packages/reflex/dist/index.js';

const datasetPath = process.argv[2];
if (!datasetPath)
  throw new Error('Usage: node scripts/check-reflex-dataset.mjs <tasks.json>');
let parsed;
try {
  parsed = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT')
    throw new Error(
      `Benchmark dataset file not found: ${datasetPath}. Supply a real frozen task dataset JSON file.`,
      { cause: error }
    );
  throw error;
}
const tasks = Array.isArray(parsed) ? parsed : parsed?.tasks;
if (!Array.isArray(parsed)) validateReflexBenchmarkDatasetEnvelopeV1(parsed);
const plan = assignReflexBenchmarkSplitsV1(tasks);
validateReflexBenchmarkDatasetV1(plan);
const datasetKind = Array.isArray(parsed) ? null : (parsed?.kind ?? null);
console.log(
  JSON.stringify(
    {
      schema: 'knolo.reflex.production-dataset-check/v1',
      tasks: plan.tasks.length,
      counts: plan.counts,
      taskDigest: plan.taskDigest,
      splitDigest: plan.splitDigest,
      status:
        datasetKind === 'production'
          ? 'eligible'
          : datasetKind === 'synthetic-test'
            ? 'synthetic-test-only'
            : datasetKind === 'public-seed'
              ? 'public-seed-only'
              : 'unclassified-only',
      datasetKind,
    },
    null,
    2
  )
);
