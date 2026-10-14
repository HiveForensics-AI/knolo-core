import { CortexError } from './errors.js';
import { CORTEX_LIMITS, normalizeCortexQuestion } from './policy.js';
import type { RetrievedHit } from './retrieve.js';
import type { CortexSelectOutput, CortexSynthesizeOutput } from './session.js';
import type { CortexAnswerStatus, CortexCitationV1, CortexClaimV1, CortexEvidenceRefV1, CortexGapV1, CortexPolicyV1 } from './types.js';

export function validateSubquestions(value: unknown, policy: CortexPolicyV1): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { subquestions?: unknown }).subquestions)) {
    throw new CortexError('CORTEX_MODEL_UNBOUND', 'planQuestion must return subquestions.', 'model.planQuestion');
  }
  const subquestions = (value as { subquestions: unknown[] }).subquestions.slice(0, policy.maxRounds);
  return subquestions.map((item, index) => {
    if (typeof item !== 'string') {
      throw new CortexError('CORTEX_MODEL_UNBOUND', 'A subquestion must be a string.', `model.planQuestion.${index}`);
    }
    return normalizeCortexQuestion(item);
  });
}

export function validateSelection(output: unknown, hits: readonly RetrievedHit[], policy: CortexPolicyV1): {
  selected: RetrievedHit[];
  rejected: Array<{ id: string; reason: string }>;
  reason: string;
} {
  const value = output as CortexSelectOutput;
  if (!value || !Array.isArray(value.selectedIds) || typeof value.reason !== 'string') {
    throw new CortexError('CORTEX_MODEL_UNBOUND', 'selectEvidence must return selectedIds and a reason.', 'model.selectEvidence');
  }
  const byId = new Map(hits.map((hit) => [hit.id, hit]));
  const selected: RetrievedHit[] = [];
  const seen = new Set<string>();
  for (const id of value.selectedIds) {
    if (typeof id !== 'string' || !byId.has(id)) {
      throw new CortexError('CORTEX_MODEL_UNBOUND', `Model selected unknown evidence id ${String(id)}.`, 'model.selectEvidence');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const hit = byId.get(id);
    if (hit) selected.push(hit);
  }
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const item of value.rejected ?? []) {
    if (!item || typeof item.id !== 'string' || !byId.has(item.id) || typeof item.reason !== 'string') {
      throw new CortexError('CORTEX_MODEL_UNBOUND', 'Model rejected an id that was not retrieved.', 'model.selectEvidence');
    }
    rejected.push({ id: item.id, reason: boundReason(item.reason) });
  }
  const chosen = new Set(selected.map((hit) => hit.id));
  for (const hit of hits) {
    if (!chosen.has(hit.id) && !rejected.some((item) => item.id === hit.id)) {
      rejected.push({ id: hit.id, reason: 'not-selected' });
    }
  }
  return {
    selected: selected.slice(0, policy.maxEvidenceInAnswer),
    rejected,
    reason: boundReason(value.reason),
  };
}

export function validateSynthesis(
  output: unknown,
  evidence: readonly CortexEvidenceRefV1[],
  policy: CortexPolicyV1,
): { text: string; claims: CortexClaimV1[]; citations: CortexCitationV1[]; gaps: CortexGapV1[] } {
  const value = output as CortexSynthesizeOutput;
  if (!value || typeof value.text !== 'string') {
    throw new CortexError('CORTEX_MODEL_UNBOUND', 'synthesizeAnswer must return text.', 'model.synthesizeAnswer');
  }
  if (value.text.length > CORTEX_LIMITS.maxAnswerChars) {
    throw new CortexError('CORTEX_MODEL_UNBOUND', 'Model answer exceeds 8000 characters.', 'model.synthesizeAnswer');
  }
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const claims: CortexClaimV1[] = [];
  for (const claim of value.claims ?? []) {
    if (!claim || typeof claim.text !== 'string' || !Array.isArray(claim.evidenceIds)) {
      throw new CortexError('CORTEX_MODEL_UNBOUND', 'A model claim is incomplete.', 'model.synthesizeAnswer');
    }
    const evidenceIds = claim.evidenceIds.map((id) => {
      if (typeof id !== 'string' || !byId.has(id)) {
        throw new CortexError('CORTEX_MODEL_UNBOUND', `Model claim cites unknown evidence id ${String(id)}.`, 'model.synthesizeAnswer');
      }
      return id;
    });
    claims.push({ text: claim.text, evidenceIds });
  }
  const cited = new Set<string>();
  for (const citation of value.citations ?? []) {
    if (!citation || typeof citation.evidenceId !== 'string' || !byId.has(citation.evidenceId)) {
      throw new CortexError('CORTEX_MODEL_UNBOUND', 'Model citation is not in the selected evidence.', 'model.synthesizeAnswer');
    }
    cited.add(citation.evidenceId);
  }
  if (policy.requireCitations && (value.text.length > 0 || claims.length > 0) && cited.size === 0) {
    throw new CortexError('CORTEX_MODEL_UNBOUND', 'Model answer has no citation in the selected evidence.', 'model.synthesizeAnswer');
  }
  const citations: CortexCitationV1[] = [...cited].map((id) => {
    const item = byId.get(id);
    return { evidenceId: id, excerpt: item?.excerpt ?? '' };
  });
  const gaps: CortexGapV1[] = [];
  for (const gap of value.gaps ?? []) {
    if (!gap || typeof gap.subquestion !== 'string' || typeof gap.reason !== 'string') {
      throw new CortexError('CORTEX_MODEL_UNBOUND', 'A model gap is incomplete.', 'model.synthesizeAnswer');
    }
    gaps.push({ subquestion: normalizeCortexQuestion(gap.subquestion), reason: boundReason(gap.reason) });
  }
  return { text: value.text, claims, citations, gaps };
}

export function rankHits(hits: readonly RetrievedHit[]): RetrievedHit[] {
  return [...hits].sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function automaticSelection(hits: readonly RetrievedHit[], policy: CortexPolicyV1): {
  selected: RetrievedHit[];
  rejected: Array<{ id: string; reason: string }>;
  reason: string;
} {
  const ranked = rankHits(hits);
  const selected = ranked.slice(0, policy.maxEvidenceInAnswer);
  const chosen = new Set(selected.map((hit) => hit.id));
  return {
    selected,
    rejected: ranked.filter((hit) => !chosen.has(hit.id)).map((hit) => ({ id: hit.id, reason: 'over-cap' })),
    reason: 'lexical-rank',
  };
}

export function toEvidence(hits: readonly RetrievedHit[]): CortexEvidenceRefV1[] {
  return hits.map((hit) => {
    const ref: CortexEvidenceRefV1 = {
      id: hit.id,
      score: hit.score,
      excerpt: hit.excerpt,
      sourceDigest: hit.sourceDigest,
    };
    if (hit.source !== undefined) ref.source = hit.source;
    return ref;
  });
}

export function citationsFor(evidence: readonly CortexEvidenceRefV1[]): CortexCitationV1[] {
  return evidence.map((item) => ({ evidenceId: item.id, excerpt: item.excerpt }));
}

export function statusForHits(count: number): CortexAnswerStatus {
  return count > 0 ? 'ANSWERED' : 'INSUFFICIENT_EVIDENCE';
}

function boundReason(reason: string): string {
  return reason.slice(0, CORTEX_LIMITS.maxReasonChars);
}
