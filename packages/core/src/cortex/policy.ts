import { CortexError } from './errors.js';
import type { CortexPolicyV1 } from './types.js';

export const CORTEX_LIMITS = {
  maxRounds: 8,
  maxCandidatesPerRound: 200,
  maxEvidenceInAnswer: 32,
  maxQuestionChars: 4000,
  excerptChars: 500,
  maxAnswerChars: 8000,
  maxReasonChars: 500,
} as const;

export const CORTEX_DEFAULT_POLICY: CortexPolicyV1 = {
  maxRounds: 4,
  maxCandidatesPerRound: 80,
  maxEvidenceInAnswer: 12,
  requireCitations: true,
  allowSemanticRerank: false,
  allowAbstain: true,
};

export function resolveCortexPolicy(input: Partial<CortexPolicyV1> = {}): CortexPolicyV1 {
  const policy: CortexPolicyV1 = {
    maxRounds: input.maxRounds ?? CORTEX_DEFAULT_POLICY.maxRounds,
    maxCandidatesPerRound: input.maxCandidatesPerRound ?? CORTEX_DEFAULT_POLICY.maxCandidatesPerRound,
    maxEvidenceInAnswer: input.maxEvidenceInAnswer ?? CORTEX_DEFAULT_POLICY.maxEvidenceInAnswer,
    requireCitations: input.requireCitations ?? CORTEX_DEFAULT_POLICY.requireCitations,
    allowSemanticRerank: input.allowSemanticRerank ?? CORTEX_DEFAULT_POLICY.allowSemanticRerank,
    allowAbstain: input.allowAbstain ?? CORTEX_DEFAULT_POLICY.allowAbstain,
  };
  return validateCortexPolicy(policy);
}

export function validateCortexPolicy(policy: CortexPolicyV1): CortexPolicyV1 {
  assertInteger(policy.maxRounds, 1, CORTEX_LIMITS.maxRounds, 'maxRounds');
  assertInteger(policy.maxCandidatesPerRound, 1, CORTEX_LIMITS.maxCandidatesPerRound, 'maxCandidatesPerRound');
  assertInteger(policy.maxEvidenceInAnswer, 1, CORTEX_LIMITS.maxEvidenceInAnswer, 'maxEvidenceInAnswer');
  assertBoolean(policy.requireCitations, 'requireCitations');
  assertBoolean(policy.allowSemanticRerank, 'allowSemanticRerank');
  assertBoolean(policy.allowAbstain, 'allowAbstain');
  return {
    maxRounds: policy.maxRounds,
    maxCandidatesPerRound: policy.maxCandidatesPerRound,
    maxEvidenceInAnswer: policy.maxEvidenceInAnswer,
    requireCitations: policy.requireCitations,
    allowSemanticRerank: policy.allowSemanticRerank,
    allowAbstain: policy.allowAbstain,
  };
}

export function normalizeCortexQuestion(question: string): string {
  if (typeof question !== 'string') {
    throw new CortexError('CORTEX_POLICY_INVALID', 'Question must be a string.', 'question');
  }
  const normalized = question.trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new CortexError('CORTEX_POLICY_INVALID', 'Question is empty.', 'question');
  if (normalized.length > CORTEX_LIMITS.maxQuestionChars) {
    throw new CortexError('CORTEX_POLICY_INVALID', 'Question exceeds 4000 characters.', 'question');
  }
  return normalized;
}

function assertInteger(value: number, min: number, max: number, path: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CortexError('CORTEX_POLICY_INVALID', `${path} must be an integer from ${min} to ${max}.`, path);
  }
}

function assertBoolean(value: boolean, path: string): void {
  if (typeof value !== 'boolean') {
    throw new CortexError('CORTEX_POLICY_INVALID', `${path} must be a boolean.`, path);
  }
}
