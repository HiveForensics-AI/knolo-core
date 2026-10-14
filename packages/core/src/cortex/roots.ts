import { digest } from '../experimental/kar/canonicalize.js';
import type {
  CortexAnswerV1,
  CortexEvidenceRefV1,
  CortexImageIdentity,
  CortexPolicyV1,
  CortexRoundV1,
  CortexTraceV1,
  KarResultRefV1,
} from './types.js';
import { CORTEX_TRACE_FORMAT } from './types.js';

export function cortexQuestionDigest(question: string): string {
  return digest(question);
}

export function cortexEvidenceRoot(evidence: readonly CortexEvidenceRefV1[]): string {
  return digest(
    evidence.map((item) => ({
      excerpt: item.excerpt,
      id: item.id,
      score: item.score,
      sourceDigest: item.sourceDigest,
    })),
  );
}

export function cortexAnswerRoot(answer: CortexAnswerV1): string {
  return digest({
    citations: answer.citations.map((item) => ({ evidenceId: item.evidenceId, excerpt: item.excerpt })),
    claims: answer.claims.map((item) => ({ evidenceIds: [...item.evidenceIds], text: item.text })),
    gaps: answer.gaps.map((item) => ({ reason: item.reason, subquestion: item.subquestion })),
    status: answer.status,
    text: answer.text,
  });
}

export function cortexTraceRoot(input: {
  questionDigest: string;
  image: CortexImageIdentity;
  policy: CortexPolicyV1;
  rounds: readonly CortexRoundV1[];
  selectedIds: readonly string[];
  karEvaluations?: readonly KarResultRefV1[];
  karPlan?: unknown;
  answerRoot: string;
  evidenceRoot: string;
}): string {
  const body: Record<string, unknown> = {
    answerRoot: input.answerRoot,
    evidenceRoot: input.evidenceRoot,
    format: CORTEX_TRACE_FORMAT,
    image: input.image,
    karEvaluations: input.karEvaluations ?? [],
    policy: input.policy,
    questionDigest: input.questionDigest,
    rounds: input.rounds,
    selectedIds: [...input.selectedIds],
  };
  if (input.karPlan !== undefined) body.karPlan = input.karPlan;
  return digest(body);
}

export function sealCortexTrace(
  input: Omit<CortexTraceV1, 'receipt'> & { createdAt?: string },
): CortexTraceV1 {
  const answerRoot = cortexAnswerRoot(input.answer);
  const evidenceRoot = cortexEvidenceRoot(input.selectedEvidence);
  const traceRoot = cortexTraceRoot({
    questionDigest: input.questionDigest,
    image: input.image,
    policy: input.policy,
    rounds: input.rounds,
    selectedIds: input.selectedEvidence.map((item) => item.id),
    karEvaluations: input.karEvaluations,
    karPlan: input.karPlan,
    answerRoot,
    evidenceRoot,
  });
  const receipt: CortexTraceV1['receipt'] = { traceRoot, answerRoot, evidenceRoot };
  if (input.createdAt !== undefined) receipt.createdAt = input.createdAt;
  const trace: CortexTraceV1 = {
    format: CORTEX_TRACE_FORMAT,
    question: input.question,
    questionDigest: input.questionDigest,
    image: input.image,
    policy: input.policy,
    rounds: input.rounds,
    selectedEvidence: input.selectedEvidence,
    answer: input.answer,
    receipt,
  };
  if (input.karEvaluations !== undefined) trace.karEvaluations = input.karEvaluations;
  if (input.karPlan !== undefined) trace.karPlan = input.karPlan;
  return trace;
}
