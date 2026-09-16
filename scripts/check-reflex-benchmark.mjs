import fs from 'node:fs/promises';
import process from 'node:process';
import {
  canonicalCbor,
  digestDomain,
} from '@knolo/core';
import {
  assignReflexBenchmarkSplitsV1,
  validateReflexBenchmarkSplitPlanV1,
} from '../packages/reflex/dist/index.js';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node scripts/check-reflex-benchmark.mjs <report.json>');
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
if (report.schema !== 'knolo.reflex.benchmark/v2')
  throw new Error('Unsupported Reflex benchmark report schema.');
validateReflexBenchmarkSplitPlanV1(report.benchmark.splitPlan);
if (
  report.benchmark.taskDigest !== report.benchmark.splitPlan.taskDigest ||
  report.benchmark.splitDigest !== report.benchmark.splitPlan.splitDigest
)
  throw new Error('Benchmark report and split-plan digests disagree.');
if (
  report.benchmark.datasetClass === 'production-candidate' &&
  report.benchmark.datasetKind !== 'production'
)
  throw new Error(
    'Production-candidate benchmark must use a dataset wrapper with kind "production".'
  );
if (
  report.benchmark.datasetClass === 'production-candidate' &&
  report.benchmark.splitPlan.tasks.length <
    (report.benchmark.minimumProductionTasks ?? 500)
)
  throw new Error('Production-candidate benchmark is below the minimum task count.');
const expectedTasks = assignReflexBenchmarkSplitsV1(
  report.benchmark.splitPlan.tasks.map(({ split: _split, ...task }) => task)
);
if (JSON.stringify(expectedTasks.tasks) !== JSON.stringify(report.benchmark.splitPlan.tasks))
  throw new Error('Benchmark task ordering or split assignment is not reproducible.');
const expectedVariants = ['plain', 'full-reflex', 'mrs-reflex'];
if (JSON.stringify(report.variants) !== JSON.stringify(expectedVariants))
  throw new Error('Benchmark variant order is invalid.');
if (!Array.isArray(report.models) || !Array.isArray(report.runs))
  throw new Error('Benchmark models and runs are required.');
if (report.modelInferenceRun && report.runs.length !== report.models.length)
  throw new Error('Benchmark run count does not match model count.');
for (const run of report.runs) {
  if (JSON.stringify(run.variants.map((variant) => variant.id)) !== JSON.stringify(expectedVariants))
    throw new Error(`Benchmark variant ordering is invalid for ${run.model.id}.`);
  for (const variant of run.variants) {
    if (variant.all.totalTasks !== report.benchmark.splitPlan.tasks.length)
      throw new Error(`Benchmark task count is invalid for ${run.model.id}/${variant.id}.`);
  }
}
const plan = {
  version: 2,
  taskDigest: report.benchmark.taskDigest,
  splitDigest: report.benchmark.splitDigest,
  modelIds: report.models.map((model) => model.id),
  variantIds: report.variants,
  behaviorRoot: report.pack.behaviorRoot,
  selectionPolicyDigests: report.selectionPolicyDigests,
  frontierDigest: report.mrs.frontierDigest,
};
if ('generationOptions' in report.benchmark)
  plan.generationOptions = report.benchmark.generationOptions;
if ('thinking' in report.benchmark) plan.thinking = report.benchmark.thinking;
const expectedPlanDigest = digestDomain(
  'reflex-benchmark-plan',
  canonicalCbor(plan)
);
if (expectedPlanDigest !== report.runPlanDigest)
  throw new Error('Benchmark run-plan digest mismatch.');
console.log(`Reflex benchmark reproducibility check passed: ${reportPath}`);
