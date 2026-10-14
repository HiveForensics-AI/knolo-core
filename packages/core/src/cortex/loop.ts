import {
  automaticSelection,
  citationsFor,
  statusForHits,
  toEvidence,
  validateSelection,
  validateSubquestions,
  validateSynthesis,
} from './adapter.js';
import { CortexError } from './errors.js';
import { evaluateCortexKar } from './kar.js';
import { normalizeCortexQuestion } from './policy.js';
import { normalizeCortexQuery, retrieveHits, type RetrievedHit } from './retrieve.js';
import { cortexQuestionDigest, sealCortexTrace } from './roots.js';
import type { CortexSession } from './session.js';
import type {
  CortexAnswerV1,
  CortexEvidenceRefV1,
  CortexGapV1,
  CortexMode,
  CortexRoundV1,
  CortexTraceV1,
  KarResultRefV1,
} from './types.js';
import { CORTEX_MODES } from './types.js';

const MODEL_MODES = new Set<CortexMode>(['evidence_answer', 'compare_sources', 'prove_or_abstain']);

export async function askCortex(
  session: CortexSession,
  input: { question: string; mode?: CortexMode; createdAt?: string; queryEmbedding?: Float32Array },
): Promise<CortexTraceV1> {
  const question = normalizeCortexQuestion(input.question);
  const mode = input.mode ?? 'evidence_answer';
  if (!CORTEX_MODES.includes(mode)) throw new CortexError('CORTEX_POLICY_INVALID', 'Unknown cortex mode.', 'mode');
  if (input.createdAt !== undefined && (typeof input.createdAt !== 'string' || input.createdAt.length === 0 || input.createdAt.length > 64)) {
    throw new CortexError('CORTEX_POLICY_INVALID', 'createdAt must be a short string supplied by the caller.', 'createdAt');
  }
  if (mode === 'prove_or_abstain' && (!session.kar || session.plan === undefined)) {
    throw new CortexError('CORTEX_KAR_UNBOUND', 'prove_or_abstain requires a bound graph and a plan.', 'kar');
  }
  if (MODEL_MODES.has(mode) && !session.model?.synthesizeAnswer && !session.policy.allowAbstain) {
    throw new CortexError('CORTEX_MODEL_REQUIRED', `${mode} requires a model adapter.`, 'model');
  }
  if (input.queryEmbedding && !session.policy.allowSemanticRerank) {
    throw new CortexError('CORTEX_POLICY_INVALID', 'queryEmbedding requires allowSemanticRerank.', 'queryEmbedding');
  }

  const subquestions = await planSubquestions(session, question, mode);
  const seen = new Set<string>();
  const known = new Set<string>();
  const rounds: CortexRoundV1[] = [];
  const chosen = new Map<string, RetrievedHit>();
  const queue = [...subquestions];

  while (queue.length > 0 && rounds.length < session.policy.maxRounds) {
    const query = queue.shift() ?? '';
    const normalized = normalizeCortexQuery(query);
    if (!normalized || seen.has(normalized)) break;
    seen.add(normalized);
    const retrieved = await retrieveHits(session.mounted, session.policy, query, session.retriever, input.queryEmbedding);
    const before = known.size;
    for (const hit of retrieved.hits) known.add(hit.id);
    const selection = await selectRound(session, question, rounds.length + 1, query, retrieved.hits, mode);
    for (const hit of selection.selected) {
      if (!chosen.has(hit.id)) chosen.set(hit.id, hit);
    }
    rounds.push({
      round: rounds.length + 1,
      query,
      normalizedQuery: retrieved.normalizedQuery,
      lexicalHitIds: retrieved.hits.map((hit) => hit.id),
      selectedIds: selection.selected.map((hit) => hit.id),
      rejected: selection.rejected,
      reason: selection.reason,
      queryReceipt: retrieved.receipt,
    });
    if (known.size === before) break;
    if (mode === 'find_relevant' || mode === 'coverage_review' || !session.model?.refineQuery) continue;
    if (rounds.length >= session.policy.maxRounds) break;
    const gaps = retrieved.hits.length === 0 ? [{ subquestion: query, reason: 'no-evidence' }] : [];
    const refined = await session.model.refineQuery({ question, gaps, previousQueries: [...seen] });
    if (!refined || typeof refined.query !== 'string') {
      throw new CortexError('CORTEX_MODEL_UNBOUND', 'refineQuery must return a query.', 'model.refineQuery');
    }
    const next = refined.query.trim();
    if (!next || seen.has(normalizeCortexQuery(next))) break;
    queue.unshift(next);
  }

  if (rounds.length === 0) {
    throw new CortexError('CORTEX_POLICY_INVALID', 'The question produced no retrieval round.', 'question');
  }

  const selectedHits = capChosen(chosen, session.policy.maxEvidenceInAnswer);
  const selectedEvidence = toEvidence(selectedHits);
  const kar = mode === 'prove_or_abstain' || (mode === 'coverage_review' && session.kar && session.plan !== undefined)
    ? evaluateCortexKar(session, question)
    : undefined;
  const answer = await buildAnswer(session, mode, question, selectedEvidence, rounds, kar);
  return sealCortexTrace({
    format: 'knolo-cortex-trace-1',
    question,
    questionDigest: cortexQuestionDigest(question),
    image: session.image,
    policy: session.policy,
    rounds,
    selectedEvidence,
    ...(kar ? { karEvaluations: [kar], karPlan: session.plan } : {}),
    answer,
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
  });
}

export async function runCortexRetrievalRound(
  session: CortexSession,
  input: { query: string; round?: number; queryEmbedding?: Float32Array },
): Promise<CortexRoundV1> {
  const query = input.query.trim();
  const retrieved = await retrieveHits(session.mounted, session.policy, query, session.retriever, input.queryEmbedding);
  const selection = automaticSelection(retrieved.hits, session.policy);
  return {
    round: input.round ?? 1,
    query,
    normalizedQuery: retrieved.normalizedQuery,
    lexicalHitIds: retrieved.hits.map((hit) => hit.id),
    selectedIds: selection.selected.map((hit) => hit.id),
    rejected: selection.rejected,
    reason: selection.reason,
    queryReceipt: retrieved.receipt,
  };
}

async function planSubquestions(session: CortexSession, question: string, mode: CortexMode): Promise<string[]> {
  if (mode === 'find_relevant' || !session.model?.planQuestion) return [question];
  const planned = validateSubquestions(await session.model.planQuestion({ question, mode }), session.policy);
  return planned.length > 0 ? planned : [question];
}

async function selectRound(
  session: CortexSession,
  question: string,
  round: number,
  query: string,
  hits: RetrievedHit[],
  mode: CortexMode,
): Promise<{ selected: RetrievedHit[]; rejected: Array<{ id: string; reason: string }>; reason: string }> {
  if (mode === 'coverage_review' || mode === 'find_relevant' || !session.model?.selectEvidence) {
    return automaticSelection(hits, session.policy);
  }
  const output = await session.model.selectEvidence({
    question,
    round,
    query,
    hits: hits.map((hit) => ({ id: hit.id, score: hit.score, excerpt: hit.excerpt, ...(hit.source ? { source: hit.source } : {}) })),
  });
  return validateSelection(output, hits, session.policy);
}

function capChosen(chosen: Map<string, RetrievedHit>, cap: number): RetrievedHit[] {
  return [...chosen.values()]
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, cap);
}

async function buildAnswer(
  session: CortexSession,
  mode: CortexMode,
  question: string,
  evidence: CortexEvidenceRefV1[],
  rounds: CortexRoundV1[],
  kar: KarResultRefV1 | undefined,
): Promise<CortexAnswerV1> {
  const gaps = gapFromRounds(rounds);
  if (mode === 'find_relevant') {
    return {
      status: statusForHits(evidence.length),
      text: '',
      claims: [],
      citations: [],
      gaps: evidence.length > 0 ? [] : [{ subquestion: question, reason: 'no-evidence' }],
    };
  }
  if (mode === 'coverage_review') {
    if (kar && kar.status !== 'SATISFIED') gaps.push({ subquestion: question, reason: kar.status });
    const missed = gaps.length;
    const status = evidence.length === 0 ? 'INSUFFICIENT_EVIDENCE' : missed > 0 ? 'PARTIAL' : 'ANSWERED';
    return { status, text: '', claims: [], citations: [], gaps };
  }
  if (mode === 'compare_sources') {
    const sources = new Set(evidence.map((item) => item.source ?? item.sourceDigest));
    if (sources.size < 2) {
      return {
        status: evidence.length === 0 ? 'INSUFFICIENT_EVIDENCE' : 'PARTIAL',
        text: '',
        claims: [],
        citations: [],
        gaps: [...gaps, { subquestion: question, reason: 'need-two-sources' }],
      };
    }
  }
  if (!session.model?.synthesizeAnswer) {
    const abstainGaps = [...gaps, { subquestion: question, reason: 'model-required' }];
    if (kar && kar.status !== 'SATISFIED') abstainGaps.push({ subquestion: question, reason: kar.status });
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      text: '',
      claims: [],
      citations: citationsFor(evidence),
      gaps: abstainGaps,
    };
  }
  const drafted = validateSynthesis(await session.model.synthesizeAnswer({
    question,
    mode,
    evidence: evidence.map((item) => ({ id: item.id, excerpt: item.excerpt, ...(item.source ? { source: item.source } : {}) })),
  }), evidence, session.policy);
  const answerGaps = [...gaps, ...drafted.gaps];
  if (kar && kar.status !== 'SATISFIED') answerGaps.push({ subquestion: question, reason: kar.status });
  let status: CortexAnswerV1['status'] = 'ANSWERED';
  if (kar && kar.status !== 'SATISFIED') status = evidence.length > 0 ? 'PARTIAL' : 'INSUFFICIENT_EVIDENCE';
  if (mode === 'compare_sources') {
    const citedSources = new Set(drafted.citations.map((item) => {
      const found = evidence.find((entry) => entry.id === item.evidenceId);
      return found?.source ?? found?.sourceDigest ?? item.evidenceId;
    }));
    if (citedSources.size < 2) {
      status = 'PARTIAL';
      answerGaps.push({ subquestion: question, reason: 'need-two-sources' });
    }
  }
  if (evidence.length === 0) status = 'INSUFFICIENT_EVIDENCE';
  return { status, text: drafted.text, claims: drafted.claims, citations: drafted.citations, gaps: answerGaps };
}

function gapFromRounds(rounds: CortexRoundV1[]): CortexGapV1[] {
  return rounds.filter((round) => round.lexicalHitIds.length === 0).map((round) => ({ subquestion: round.query, reason: 'no-evidence' }));
}
