import { canonicalCbor, digestDomain } from '@knolo/core';
import {
  computeReflexSelectionPolicyDigestV1,
  selectReflexContextV1,
  type ReflexSessionV1,
  validateReflexOutputV1,
} from './runtime.js';

export const REFLEX_PROFILE_SCALE_V1 = 1_000_000;

export type ReflexEvaluationTaskV1 = {
  id: string;
  family: string;
  query: string;
  expectation?: ReflexTaskExpectationV1;
};

export type ReflexTaskExpectationV1 = {
  mode: 'answer' | 'clarify' | 'abstain';
  requiredTerms?: string[];
  forbiddenTerms?: string[];
};

export type ReflexModelAdapterV1 = {
  modelId: string;
  revision: string;
  run: (input: {
    taskId?: string;
    query: string;
    context: string;
    selectedAtomIds: string[];
  }) => Promise<{
    failure: boolean;
    policyViolation?: boolean;
    output?: unknown;
    outputTokens?: number;
    latencyMs?: number;
  }>;
};

export type ReflexModelProfileV1 = {
  schema: 'knolo.reflex.profile/v1';
  modelId: string;
  revision: string;
  tokenizerId: string;
  renderer: string;
  behaviorRoot: string;
  policyId: string;
  policyDigest: string;
  selectionPolicyDigest: string;
  datasetSplitDigest: string | null;
  metricScale: typeof REFLEX_PROFILE_SCALE_V1;
  metrics: {
    totalTasks: number;
    answeredTasks: number;
    failures: number;
    policyViolations: number;
    outputValidationFailures: number;
    coveragePpm: number;
    failureRatePpm: number | null;
    upperFailureBoundPpm: number | null;
    totalInputTokens: number;
    totalOutputTokens: number;
    meanLatencyMicros: number | null;
    p95LatencyMicros: number | null;
  };
  qualityByFamily: Record<
    string,
    {
      total: number;
      answered: number;
      failures: number;
      coveragePpm: number;
      failureRatePpm: number | null;
      upperFailureBoundPpm: number | null;
    }
  >;
  contextBudget: {
    maxInputTokens: number;
    meanInputTokensMicros: number | null;
  };
  profileDigest: string;
};

export type ReflexEvaluationConfig = {
  alpha?: number;
  riskCeiling?: number;
  policyId?: string;
  minCoverage?: number;
  minFamilyCoverage?: Record<string, number>;
  datasetSplitDigest?: string;
};

export type ReflexEvaluationReportV1 = {
  schema: 'knolo.reflex.evaluation/v1';
  profile: ReflexModelProfileV1;
  totalTasks: number;
  answeredTasks: number;
  abstainedTasks: number;
  failures: number;
  policyViolations: number;
  outputValidationFailures: number;
  selectionPolicyDigest: string;
  coverage: number;
  failureRate: number | null;
  upperFailureBound: number | null;
  status: 'certified' | 'uncertified';
  alpha: number;
  riskCeiling: number;
  minCoverage: number;
  minFamilyCoverage: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanLatencyMs: number | null;
  p95LatencyMs: number | null;
  byFamily: Record<
    string,
    { total: number; answered: number; failures: number; coverage: number }
  >;
};

export async function evaluateReflexPolicyV1(
  session: ReflexSessionV1,
  tasks: ReflexEvaluationTaskV1[],
  model: ReflexModelAdapterV1,
  config: ReflexEvaluationConfig = {}
): Promise<ReflexEvaluationReportV1> {
  const alpha = config.alpha ?? 0.05;
  const riskCeiling = config.riskCeiling ?? 0.05;
  const minCoverage = config.minCoverage ?? 1;
  const minFamilyCoverage = { ...(config.minFamilyCoverage ?? {}) };
  if (!(alpha > 0 && alpha < 1))
    throw new Error('Evaluation alpha must be between 0 and 1.');
  if (!(riskCeiling > 0 && riskCeiling < 1))
    throw new Error('Evaluation risk ceiling must be between 0 and 1.');
  if (!(minCoverage >= 0 && minCoverage <= 1))
    throw new Error('Evaluation minimum coverage must be between 0 and 1.');
  for (const [family, floor] of Object.entries(minFamilyCoverage)) {
    if (!(floor >= 0 && floor <= 1))
      throw new Error(
        `Evaluation minimum coverage for ${family} must be between 0 and 1.`
      );
  }
  if (
    config.datasetSplitDigest !== undefined &&
    !/^sha256-[0-9a-f]{64}$/.test(config.datasetSplitDigest)
  )
    throw new Error('Evaluation datasetSplitDigest must be a SHA-256 digest.');
  if (!Array.isArray(tasks) || tasks.some((task) => !task.id || !task.family)) {
    throw new Error('Evaluation tasks require IDs and families.');
  }
  const byFamily: ReflexEvaluationReportV1['byFamily'] = {};
  let answeredTasks = 0;
  let failures = 0;
  let policyViolations = 0;
  let outputValidationFailures = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const latencies: number[] = [];
  for (const task of tasks) {
    const family = (byFamily[task.family] ??= {
      total: 0,
      answered: 0,
      failures: 0,
      coverage: 0,
    });
    family.total++;
    const selection = selectReflexContextV1(session, task.query);
    if (selection.disposition !== 'ready') continue;
    const started = performance.now();
    const result = await model.run({
      taskId: task.id,
      query: task.query,
      context: selection.context,
      selectedAtomIds: selection.selectedAtomIds,
    });
    const elapsed = performance.now() - started;
    answeredTasks++;
    totalInputTokens += selection.receipt.inputTokens;
    totalOutputTokens += result.outputTokens ?? 0;
    latencies.push(result.latencyMs ?? elapsed);
    family.answered++;
    const outputInvalid =
      result.output !== undefined &&
      !validateReflexOutputV1(result.output, { schema: selection.outputSchema })
        .valid;
    if (outputInvalid) {
      outputValidationFailures++;
    }
    if (result.failure || outputInvalid) {
      failures++;
      family.failures++;
    }
    if (result.policyViolation) policyViolations++;
  }
  for (const family of Object.values(byFamily)) {
    family.coverage = family.total ? family.answered / family.total : 0;
  }
  const upperFailureBound = answeredTasks
    ? clopperPearsonUpper(failures, answeredTasks, alpha)
    : null;
  const coverage = tasks.length ? answeredTasks / tasks.length : 0;
  const policyId = config.policyId ?? 'reflex-finite-policy-v1';
  const policyDigest = digestDomain(
    'reflex-policy',
    canonicalCbor({
      version: 1,
      policyId,
      alphaPpm: fixedDown(alpha),
      riskCeilingPpm: fixedUp(riskCeiling),
      minCoveragePpm: fixedDown(minCoverage),
      minFamilyCoveragePpm: Object.fromEntries(
        Object.entries(minFamilyCoverage).map(([family, floor]) => [
          family,
          fixedDown(floor),
        ])
      ),
    } as never)
  );
  const profileBase = {
    schema: 'knolo.reflex.profile/v1' as const,
    modelId: model.modelId,
    revision: model.revision,
    tokenizerId: session.config.tokenizerId,
    renderer: 'reflex-renderer-v1',
    behaviorRoot: session.manifest.behaviorRoot,
    policyId,
    policyDigest,
    selectionPolicyDigest: computeReflexSelectionPolicyDigestV1(session),
    datasetSplitDigest: config.datasetSplitDigest ?? null,
    metricScale: REFLEX_PROFILE_SCALE_V1 as typeof REFLEX_PROFILE_SCALE_V1,
    metrics: {
      totalTasks: tasks.length,
      answeredTasks,
      failures,
      policyViolations,
      outputValidationFailures,
      coveragePpm: fixedDown(coverage),
      failureRatePpm: answeredTasks
        ? fixedDown(failures / answeredTasks)
        : null,
      upperFailureBoundPpm:
        upperFailureBound !== null ? fixedUp(upperFailureBound) : null,
      totalInputTokens,
      totalOutputTokens,
      meanLatencyMicros: latencies.length
        ? fixedNearest(
            latencies.reduce((sum, value) => sum + value, 0) / latencies.length
          )
        : null,
      p95LatencyMicros: latencies.length
        ? fixedNearest(percentile(latencies, 0.95))
        : null,
    },
    qualityByFamily: Object.fromEntries(
      Object.entries(byFamily).map(([family, value]) => [
        family,
        {
          total: value.total,
          answered: value.answered,
          failures: value.failures,
          coveragePpm: fixedDown(value.coverage),
          failureRatePpm: value.answered
            ? fixedDown(value.failures / value.answered)
            : null,
          upperFailureBoundPpm: value.answered
            ? fixedUp(
                clopperPearsonUpper(value.failures, value.answered, alpha)
              )
            : null,
        },
      ])
    ),
    contextBudget: {
      maxInputTokens: session.config.maxInputTokens,
      meanInputTokensMicros: answeredTasks
        ? fixedNearest(totalInputTokens / answeredTasks)
        : null,
    },
  };
  const profile: ReflexModelProfileV1 = {
    ...profileBase,
    profileDigest: digestDomain(
      'reflex-profile',
      canonicalCbor(profileBase as never)
    ),
  };
  const familyCoverageSatisfied = Object.entries(minFamilyCoverage).every(
    ([family, floor]) =>
      byFamily[family] !== undefined && byFamily[family].coverage >= floor
  );
  const certified =
    upperFailureBound !== null &&
    upperFailureBound <= riskCeiling &&
    policyViolations === 0 &&
    config.datasetSplitDigest !== undefined &&
    coverage >= minCoverage &&
    familyCoverageSatisfied;
  return {
    schema: 'knolo.reflex.evaluation/v1',
    profile,
    totalTasks: tasks.length,
    answeredTasks,
    abstainedTasks: tasks.length - answeredTasks,
    failures,
    policyViolations,
    outputValidationFailures,
    selectionPolicyDigest: computeReflexSelectionPolicyDigestV1(session),
    coverage,
    failureRate: answeredTasks ? failures / answeredTasks : null,
    upperFailureBound,
    status: certified ? 'certified' : 'uncertified',
    alpha,
    riskCeiling,
    minCoverage,
    minFamilyCoverage,
    totalInputTokens,
    totalOutputTokens,
    meanLatencyMs: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : null,
    p95LatencyMs: latencies.length ? percentile(latencies, 0.95) : null,
    byFamily,
  };
}

function fixedDown(value: number): number {
  return Math.floor(value * REFLEX_PROFILE_SCALE_V1);
}

function fixedUp(value: number): number {
  return Math.ceil(value * REFLEX_PROFILE_SCALE_V1);
}

function fixedNearest(value: number): number {
  return Math.round(value * REFLEX_PROFILE_SCALE_V1);
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(quantile * sorted.length) - 1
  );
  return sorted[Math.max(0, index)];
}

export function clopperPearsonUpper(
  failures: number,
  trials: number,
  alpha: number
): number {
  if (
    !Number.isInteger(failures) ||
    !Number.isInteger(trials) ||
    failures < 0 ||
    failures > trials
  ) {
    throw new Error('Invalid binomial counts.');
  }
  if (!(alpha > 0 && alpha < 1))
    throw new Error('Alpha must be between 0 and 1.');
  if (trials === 0 || failures === trials) return 1;
  if (failures === 0) return 1 - Math.pow(alpha, 1 / trials);
  return betaQuantile(1 - alpha, failures + 1, trials - failures);
}

function betaQuantile(probability: number, a: number, b: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 80; i++) {
    const middle = (low + high) / 2;
    if (regularizedBeta(middle, a, b) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log1p(-x)
  );
  if (x < (a + 1) / (a + b + 2))
    return (factor * betaContinuedFraction(x, a, b)) / a;
  return 1 - (factor * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    numerator = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function logGamma(value: number): number {
  const coefficients = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5)
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * value)) -
      logGamma(1 - value)
    );
  let sum = coefficients[0];
  const shifted = value - 1;
  for (let i = 1; i < coefficients.length; i++)
    sum += coefficients[i] / (shifted + i);
  const t = shifted + coefficients.length - 1.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(sum)
  );
}
