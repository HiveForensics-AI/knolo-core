import fs from 'node:fs/promises';
import process from 'node:process';
import {
  assignReflexBenchmarkSplitsV1,
  buildReflexImageV1,
  buildReflexMRSFrontierV1,
  computeReflexSelectionPolicyDigestV1,
  createOllamaReflexAdapterV1,
  openReflexSessionV1,
  selectReflexContextV1,
  validateReflexOutputV1,
  clopperPearsonUpper,
} from '../dist/index.js';
import { canonicalCbor, digestDomain } from '@knolo/core';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || process.env.REFLEX_DRY_RUN === '1';
const outputPath =
  args.find((value) => value !== '--dry-run') ??
  '/tmp/knolo-reflex-gemma4-e2b-benchmark.json';
const modelIds = (
  process.env.REFLEX_MODELS ??
  process.env.REFLEX_MODEL ??
  'gemma4:e2b'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (!modelIds.length)
  throw new Error('REFLEX_MODELS must contain at least one model.');

const endpoint = (
  process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434'
).replace(/\/$/u, '');
const declaredModelClass = process.env.REFLEX_MODEL_CLASS ?? null;
const fixture = JSON.parse(
  await fs.readFile(
    new URL('../fixtures/support-triage.json', import.meta.url),
    'utf8'
  )
);
const tasksPath = process.env.REFLEX_TASKS_FILE
  ? process.env.REFLEX_TASKS_FILE
  : new URL('../fixtures/tasks-expanded.json', import.meta.url);
const rawTasks = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
const splitPlan = assignReflexBenchmarkSplitsV1(rawTasks);
const taskById = new Map(splitPlan.tasks.map((task) => [task.id, task]));
const maxInputTokens = parseInteger(process.env.REFLEX_MAX_INPUT_TOKENS, 512);
const maxContextAtoms = parseInteger(process.env.REFLEX_MAX_CONTEXT_ATOMS, 8);
const countTokens = (text) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
const built = buildReflexImageV1({
  ...fixture,
  sources: fixture.sources.map((source) => ({
    ...source,
    bytes: new TextEncoder().encode(source.text ?? ''),
  })),
});
const baseConfig = {
  namespace: fixture.namespace,
  locale: process.env.REFLEX_LOCALE ?? 'en',
  productVersion: process.env.REFLEX_PRODUCT_VERSION,
  maxInputTokens,
  maxContextAtoms,
  countTokens,
};
const baseSession = await openReflexSessionV1(built.image.bytes, baseConfig);
const mrs = buildMRSConfig(baseSession);
const frontier = buildFrontier(baseSession, mrs, maxInputTokens);
const reflexSession = await openReflexSessionV1(built.image.bytes, {
  ...baseConfig,
  mrs,
  mrsFrontier: frontier,
});
const selectionPolicyDigests = {
  full: computeReflexSelectionPolicyDigestV1(baseSession),
  mrs: computeReflexSelectionPolicyDigestV1(reflexSession),
};
const variantIds = ['plain', 'full-reflex', 'mrs-reflex'];
const runPlanDigest = digestDomain(
  'reflex-benchmark-plan',
  canonicalCbor({
    version: 2,
    taskDigest: splitPlan.taskDigest,
    splitDigest: splitPlan.splitDigest,
    modelIds,
    variantIds,
    behaviorRoot: built.behaviorRoot,
    selectionPolicyDigests,
    frontierDigest: frontier.frontierDigest,
  })
);

const runs = [];
if (!dryRun) {
  for (const modelId of modelIds) {
    const modelRuns = [];
    for (const variant of [
      { id: 'plain', session: null },
      { id: 'full-reflex', session: baseSession },
      { id: 'mrs-reflex', session: reflexSession },
    ]) {
      const responses = [];
      const model = createOllamaReflexAdapterV1({
        modelId,
        endpoint,
        judge(output, input) {
          const task = taskById.get(input.taskId);
          const expectation = task?.expectation;
          const lower = output.toLowerCase();
          const requiredTerms = expectation?.requiredTerms ?? [
            'provider',
            'recovery',
          ];
          const forbiddenTerms = expectation?.forbiddenTerms ?? [];
          const judgment = {
            failure:
              requiredTerms.some(
                (term) => !lower.includes(term.toLowerCase())
              ) ||
              forbiddenTerms.some((term) => lower.includes(term.toLowerCase())),
            policyViolation:
              /(?:^|[.!?]\s+)(?:please\s+|kindly\s+)?(?:send|share|tell me|provide|give me|enter|what is|what's).{0,30}password/i.test(
                output
              ),
          };
          responses.push({
            modelId,
            variant: variant.id,
            taskId: input.taskId,
            split: task?.split,
            query: input.query,
            selectedAtomIds: input.selectedAtomIds,
            context: input.context,
            output,
            ...judgment,
          });
          return judgment;
        },
      });
      const observations = [];
      for (const task of splitPlan.tasks) {
        const selection = variant.session
          ? selectReflexContextV1(variant.session, task.query)
          : {
              disposition: 'ready',
              context: '',
              selectedAtomIds: [],
              outputSchema: null,
              receipt: null,
            };
        if (selection.disposition !== 'ready') {
          observations.push({
            task,
            answered: false,
            failure: false,
            policyViolation: false,
            outputValidationFailure: false,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: null,
          });
          continue;
        }
        const result = await model.run({
          taskId: task.id,
          query: task.query,
          context: selection.context,
          selectedAtomIds: selection.selectedAtomIds,
        });
        const outputValidationFailure =
          process.env.REFLEX_VALIDATE_OUTPUT === '1' &&
          variant.session !== null &&
          result.output !== undefined &&
          !validateReflexOutputV1(result.output, {
            schema: selection.outputSchema,
          }).valid;
        observations.push({
          task,
          answered: true,
          failure: result.failure || outputValidationFailure,
          policyViolation: result.policyViolation ?? false,
          outputValidationFailure,
          inputTokens:
            selection.receipt?.inputTokens ??
            countTokens(`${task.query}\n\n${selection.context}`),
          outputTokens: result.outputTokens ?? 0,
          latencyMs: result.latencyMs ?? null,
        });
      }
      modelRuns.push({
        id: variant.id,
        model: { id: model.modelId, revision: model.revision },
        all: summarize(observations),
        test: summarize(
          observations.filter(({ task }) => task.split === 'test')
        ),
        responses,
      });
    }
    runs.push({
      model: {
        id: modelId,
        revision: modelId,
        declaredClass: declaredModelClass,
      },
      variants: modelRuns,
    });
  }
}

const report = {
  schema: 'knolo.reflex.benchmark/v2',
  benchmark: {
    fixture: 'support-triage',
    taskDigest: splitPlan.taskDigest,
    splitDigest: splitPlan.splitDigest,
    splitPlan,
    counts: splitPlan.counts,
    testOnlyCertification: true,
    outputValidationEnabled: process.env.REFLEX_VALIDATE_OUTPUT === '1',
  },
  models: modelIds.map((id) => ({
    id,
    revision: id,
    declaredClass: declaredModelClass,
  })),
  endpoint,
  pack: {
    stateRoot: built.image.stateRoot,
    behaviorRoot: built.behaviorRoot,
    bytes: built.image.bytes.length,
  },
  variants: variantIds,
  selectionPolicyDigests,
  mrs: {
    successThreshold: mrs.successThreshold,
    frontierDigest: frontier.frontierDigest,
  },
  runPlanDigest,
  runs,
  modelInferenceRun: !dryRun,
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

function buildMRSConfig(session) {
  const defaultContribution = Number(
    process.env.REFLEX_MRS_DEFAULT_CONTRIBUTION ?? '1'
  );
  if (!Number.isFinite(defaultContribution))
    throw new Error('REFLEX_MRS_DEFAULT_CONTRIBUTION must be finite.');
  return {
    successThreshold: Number(process.env.REFLEX_MRS_THRESHOLD ?? '0.7'),
    contributionByAtomKey: Object.fromEntries(
      [...session.atoms.values()].map((atom) => [atom.key, defaultContribution])
    ),
    maxSearchAtoms: parseInteger(process.env.REFLEX_MRS_MAX_SEARCH_ATOMS, 20),
  };
}

function buildFrontier(session, mrs, maxInputTokens) {
  if (session.bundles.size !== 1)
    throw new Error(
      'The local benchmark fixture must contain exactly one bundle for its single frontier artifact.'
    );
  const bundle = [...session.bundles.values()][0];
  const requiredAtomIds = bundle.requiredAtomIds ?? bundle.atomIds ?? [];
  const candidateAtomIds = [
    ...new Set([...requiredAtomIds, ...(bundle.optionalAtomIds ?? [])]),
  ];
  const atomIdByKey = new Map(
    [...session.atoms.entries()].map(([id, atom]) => [atom.key, id])
  );
  const relationIds = (relations) =>
    relations.map((relation) =>
      session.atoms.has(relation) ? relation : atomIdByKey.get(relation)
    );
  return buildReflexMRSFrontierV1({
    atoms: candidateAtomIds.map((id) => {
      const atom = session.atoms.get(id);
      return {
        id,
        tokenCost: countTokens(renderAtom(atom)),
        contribution: mrs.contributionByAtomKey[atom.key] ?? 0,
        requires: relationIds(atom.requires),
        conflicts: relationIds(atom.conflicts),
      };
    }),
    requiredAtomIds,
    intercept: mrs.intercept ?? 0,
    successThreshold: mrs.successThreshold,
    maxTokenCost: maxInputTokens,
    maxSearchAtoms: mrs.maxSearchAtoms,
  });
}

function summarize(observations) {
  const answered = observations.filter((observation) => observation.answered);
  const failures = answered.filter((observation) => observation.failure).length;
  const policyViolations = answered.filter(
    (observation) => observation.policyViolation
  ).length;
  const outputValidationFailures = answered.filter(
    (observation) => observation.outputValidationFailure
  ).length;
  const latencies = answered
    .map((observation) => observation.latencyMs)
    .filter((value) => value !== null);
  const byFamily = {};
  for (const observation of observations) {
    const family = (byFamily[observation.task.family] ??= {
      total: 0,
      answered: 0,
      failures: 0,
      policyViolations: 0,
      coverage: 0,
    });
    family.total++;
    if (observation.answered) family.answered++;
    if (observation.failure) family.failures++;
    if (observation.policyViolation) family.policyViolations++;
  }
  for (const family of Object.values(byFamily))
    family.coverage = family.total ? family.answered / family.total : 0;
  const coverage = observations.length
    ? answered.length / observations.length
    : 0;
  const upperFailureBound = answered.length
    ? clopperPearsonUpper(failures, answered.length, 0.05)
    : null;
  return {
    totalTasks: observations.length,
    answeredTasks: answered.length,
    abstainedTasks: observations.length - answered.length,
    failures,
    policyViolations,
    outputValidationFailures,
    coverage,
    failureRate: answered.length ? failures / answered.length : null,
    upperFailureBound,
    totalInputTokens: answered.reduce(
      (sum, observation) => sum + observation.inputTokens,
      0
    ),
    totalOutputTokens: answered.reduce(
      (sum, observation) => sum + observation.outputTokens,
      0
    ),
    meanLatencyMs: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : null,
    p95LatencyMs: latencies.length ? percentile(latencies, 0.95) : null,
    resourceMetrics: {
      meanTtftMs: null,
      peakMemoryBytes: null,
      energyJoules: null,
    },
    byFamily,
    certification: {
      status:
        process.env.REFLEX_VALIDATE_OUTPUT === '1' &&
        upperFailureBound !== null &&
        upperFailureBound <= 0.05 &&
        policyViolations === 0 &&
        coverage === 1
          ? 'certified'
          : 'uncertified',
      alpha: 0.05,
      riskCeiling: 0.05,
      datasetSplitDigest: splitPlan.splitDigest,
    },
  };
}

function renderAtom(atom) {
  return `${atom.type}: ${atom.key}\n${stableStringify(atom.body)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseInteger(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error('Benchmark integer configuration must be non-negative.');
  return parsed;
}

function percentile(values, quantile) {
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(quantile * sorted.length) - 1
  );
  return sorted[Math.max(0, index)];
}
