import {
  clopperPearsonUpper,
  type ReflexEvaluationTaskV1,
  type ReflexModelAdapterV1,
} from './evaluation.js';
import { selectReflexContextV1, type ReflexSessionV1 } from './runtime.js';

export type ReflexEvaluationVariantV1 = {
  id: string;
  session?: ReflexSessionV1;
  model: ReflexModelAdapterV1;
};

export type ReflexVariantReportV1 = {
  id: string;
  modelId: string;
  totalTasks: number;
  answeredTasks: number;
  abstainedTasks: number;
  failures: number;
  policyViolations: number;
  coverage: number;
  failureRate: number | null;
  upperFailureBound: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  meanLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type ReflexComparisonReportV1 = {
  schema: 'knolo.reflex.comparison/v1';
  taskCount: number;
  alpha: number;
  riskCeiling: number;
  variants: ReflexVariantReportV1[];
};

export async function compareReflexVariantsV1(
  tasks: ReflexEvaluationTaskV1[],
  variants: ReflexEvaluationVariantV1[],
  options: { alpha?: number; riskCeiling?: number } = {}
): Promise<ReflexComparisonReportV1> {
  const alpha = options.alpha ?? 0.05;
  const riskCeiling = options.riskCeiling ?? 0.05;
  if (!variants.length)
    throw new Error('At least one evaluation variant is required.');
  const reports: ReflexVariantReportV1[] = [];
  for (const variant of variants) {
    if (!variant.id || !variant.model.modelId)
      throw new Error('Evaluation variants require IDs and model identities.');
    let answeredTasks = 0;
    let failures = 0;
    let policyViolations = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const latencies: number[] = [];
    for (const task of tasks) {
      const selected = variant.session
        ? selectReflexContextV1(variant.session, task.query)
        : {
            disposition: 'ready' as const,
            context: '',
            selectedAtomIds: [] as string[],
          };
      if (selected.disposition !== 'ready') continue;
      const started = performance.now();
      const result = await variant.model.run({
        taskId: task.id,
        query: task.query,
        context: selected.context,
        selectedAtomIds: selected.selectedAtomIds,
      });
      const elapsed = performance.now() - started;
      answeredTasks++;
      totalInputTokens +=
        variant.session && 'receipt' in selected
          ? selected.receipt.inputTokens
          : countTokens(`${task.query}\n\n${selected.context}`);
      totalOutputTokens += result.outputTokens ?? 0;
      latencies.push(result.latencyMs ?? elapsed);
      if (result.failure) failures++;
      if (result.policyViolation) policyViolations++;
    }
    const upperFailureBound = answeredTasks
      ? clopperPearsonUpper(failures, answeredTasks, alpha)
      : null;
    reports.push({
      id: variant.id,
      modelId: variant.model.modelId,
      totalTasks: tasks.length,
      answeredTasks,
      abstainedTasks: tasks.length - answeredTasks,
      failures,
      policyViolations,
      coverage: tasks.length ? answeredTasks / tasks.length : 0,
      failureRate: answeredTasks ? failures / answeredTasks : null,
      upperFailureBound,
      totalInputTokens,
      totalOutputTokens,
      meanLatencyMs: latencies.length
        ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
        : null,
      p95LatencyMs: latencies.length ? percentile(latencies, 0.95) : null,
    });
  }
  return {
    schema: 'knolo.reflex.comparison/v1',
    taskCount: tasks.length,
    alpha,
    riskCeiling,
    variants: reports,
  };
}

function countTokens(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(quantile * sorted.length) - 1
  );
  return sorted[Math.max(0, index)];
}
