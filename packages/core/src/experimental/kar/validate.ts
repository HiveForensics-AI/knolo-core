import { prepareGraph } from './graph.js';
import { validatePlan } from './plan.js';
import {
  FRONTIERS,
  KAR_VERSION,
  type Decision,
  type KarIssue,
  type KarResult,
  type KarSidecarV1,
  type Plan,
  type Status,
} from './types.js';

const ROOT = /^sha256-[0-9a-f]{64}$/;
const STATUSES: readonly Status[] = [
  'SATISFIED',
  'UNSATISFIED_EVIDENCE_REQUIREMENTS',
  'SEARCH_BOUND_EXCEEDED',
  'CLOSURE_BOUND_EXCEEDED',
  'ANCHOR_REJECTED',
  'GRAPH_NOT_BOUND',
  'GRAPH_INVALID',
  'PLAN_INVALID',
];

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: KarIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function issue(code: string, path: string, message: string): KarIssue {
  return { code, path, message };
}

function fail(errors: KarIssue[]): Validation<never> {
  return { ok: false, errors };
}

export function validateKarSidecar(input: unknown): Validation<KarSidecarV1> {
  if (!isRecord(input)) return fail([issue('KAR_SIDECAR_INVALID', '', 'A KAR sidecar must be an object.')]);
  const errors: KarIssue[] = [];
  if (input.version !== 1) errors.push(issue('KAR_SIDECAR_INVALID', 'version', 'Sidecar version must be 1.'));
  for (const field of ['stateRoot', 'objectRoot', 'commitDigest', 'knowledgeRoot'] as const) {
    if (typeof input[field] !== 'string' || !ROOT.test(input[field])) {
      errors.push(issue('KAR_SIDECAR_INVALID', field, `${field} must be a sha256 digest.`));
    }
  }
  const graph = prepareGraph(input.graph);
  if (!graph) {
    errors.push(issue('KAR_GRAPH_INVALID', 'graph', 'The committed evidence graph is not valid.'));
    return fail(errors);
  }
  if (errors.length > 0) return fail(errors);
  if (graph.knowledgeRoot !== input.knowledgeRoot) {
    return fail([issue(
      'KAR_GRAPH_NOT_BOUND',
      'knowledgeRoot',
      'Sidecar knowledgeRoot does not equal the committed evidence graph knowledgeRoot.',
    )]);
  }
  return {
    ok: true,
    value: {
      version: 1,
      stateRoot: input.stateRoot as string,
      objectRoot: input.objectRoot as string,
      commitDigest: input.commitDigest as string,
      knowledgeRoot: input.knowledgeRoot as string,
      graph,
    },
  };
}

export function validateKarPlan(input: unknown): Validation<Plan> {
  const plan = validatePlan(input);
  if (!plan) {
    return fail([issue('KAR_PLAN_INVALID', '', 'The plan is not a valid KAR plan.')]);
  }
  return { ok: true, value: plan };
}

export function validateKarResult(input: unknown): Validation<KarResult> {
  const certificate = certificateOf(input);
  if (!certificate) {
    return fail([issue('KAR_RESULT_INVALID', '', 'The value is not a KAR result or evaluation certificate.')]);
  }
  return { ok: true, value: certificate };
}

export function certificateOf(input: unknown): KarResult | null {
  if (!isRecord(input)) return null;
  if (isRecord(input.certificate)) return certificateOf(input.certificate);
  if (input.version !== KAR_VERSION) return null;
  if (typeof input.status !== 'string' || !STATUSES.includes(input.status as Status)) return null;
  if (!stringArray(input.evidenceIds)) return null;
  if (!Array.isArray(input.choices) || !Array.isArray(input.witnesses)) return null;
  if (!isRecord(input.frontiers) || !isRecord(input.decision) || !isRecord(input.roots)) return null;
  for (const frontier of FRONTIERS) {
    if (!stringArray(input.frontiers[frontier])) return null;
  }
  const decision = input.decision as Decision;
  if (decision.status !== input.status) return null;
  for (const name of [
    'knowledgeRoot', 'semanticRoot', 'queryRoot', 'planRoot', 'anchorRoot', 'frontierRoot',
    'frontierWitnessRoot', 'evidenceSetRoot', 'decisionRoot', 'karRoot',
  ]) {
    if (typeof input.roots[name] !== 'string' || !ROOT.test(input.roots[name] as string)) return null;
  }
  return input as unknown as KarResult;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
