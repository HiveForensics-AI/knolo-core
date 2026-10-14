import { CortexError } from './errors.js';
import { CORTEX_LIMITS } from './policy.js';
import { cortexAnswerRoot, cortexEvidenceRoot, cortexQuestionDigest, cortexTraceRoot } from './roots.js';
import {
  CORTEX_ANSWER_STATUSES,
  CORTEX_TRACE_FORMAT,
  type CortexAnswerV1,
  type CortexEvidenceRefV1,
  type CortexImageIdentity,
  type CortexPolicyV1,
  type CortexQueryReceiptV1,
  type CortexRoundV1,
  type CortexTraceV1,
  type KarResultRefV1,
} from './types.js';

export function validateCortexTrace(input: unknown): CortexTraceV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Cortex trace must be an object.', 'trace');
  }
  const trace = input as CortexTraceV1;
  if (trace.format !== CORTEX_TRACE_FORMAT) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Unsupported cortex trace format.', 'format');
  }
  if (typeof trace.question !== 'string' || trace.question.length === 0 || trace.question.length > CORTEX_LIMITS.maxQuestionChars) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace question is missing or too long.', 'question');
  }
  if (trace.questionDigest !== cortexQuestionDigest(trace.question)) {
    throw new CortexError('CORTEX_ROOT_MISMATCH', 'questionDigest does not match the question.', 'questionDigest');
  }
  const image = readImage(trace.image);
  const policy = readPolicy(trace.policy);
  const rounds = readRounds(trace.rounds, policy);
  const selected = readEvidence(trace.selectedEvidence, policy);
  const selectedByRound = new Set(rounds.flatMap((round) => round.selectedIds));
  for (const item of selected) {
    if (!selectedByRound.has(item.id)) {
      throw new CortexError('CORTEX_EVIDENCE_UNBOUND', `Evidence ${item.id} was not selected by a round.`, 'selectedEvidence');
    }
  }
  const answer = readAnswer(trace.answer, selected, policy);
  const karEvaluations = trace.karEvaluations === undefined ? undefined : readKarRefs(trace.karEvaluations);
  if (trace.receipt?.createdAt !== undefined && !isCreatedAt(trace.receipt.createdAt)) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'createdAt must be a short string.', 'receipt.createdAt');
  }
  const answerRoot = cortexAnswerRoot(answer);
  const evidenceRoot = cortexEvidenceRoot(selected);
  const traceRoot = cortexTraceRoot({
    questionDigest: trace.questionDigest,
    image,
    policy,
    rounds,
    selectedIds: selected.map((item) => item.id),
    karEvaluations,
    karPlan: trace.karPlan,
    answerRoot,
    evidenceRoot,
  });
  if (trace.receipt?.answerRoot !== answerRoot || trace.receipt?.evidenceRoot !== evidenceRoot || trace.receipt?.traceRoot !== traceRoot) {
    throw new CortexError('CORTEX_ROOT_MISMATCH', 'Trace roots do not match the trace body.', 'receipt');
  }
  return trace;
}

function readImage(image: CortexImageIdentity): CortexImageIdentity {
  if (!image || (image.kind !== 'v4-pack' && image.kind !== 'v5-image') || typeof image.stateRoot !== 'string' || !image.stateRoot.startsWith('sha256-')) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace image identity is invalid.', 'image');
  }
  const out: CortexImageIdentity = { kind: image.kind, stateRoot: image.stateRoot };
  if (image.commitDigest !== undefined) {
    if (typeof image.commitDigest !== 'string') throw new CortexError('CORTEX_TRACE_INVALID', 'commitDigest is invalid.', 'image.commitDigest');
    out.commitDigest = image.commitDigest;
  }
  if (image.knowledgeRoot !== undefined) {
    if (typeof image.knowledgeRoot !== 'string') throw new CortexError('CORTEX_TRACE_INVALID', 'knowledgeRoot is invalid.', 'image.knowledgeRoot');
    out.knowledgeRoot = image.knowledgeRoot;
  }
  return out;
}

function readPolicy(policy: CortexPolicyV1): CortexPolicyV1 {
  if (!policy || typeof policy !== 'object') throw new CortexError('CORTEX_TRACE_INVALID', 'Trace policy is missing.', 'policy');
  const fields: Array<keyof CortexPolicyV1> = [
    'maxRounds',
    'maxCandidatesPerRound',
    'maxEvidenceInAnswer',
    'requireCitations',
    'allowSemanticRerank',
    'allowAbstain',
  ];
  for (const field of fields) {
    if (policy[field] === undefined) throw new CortexError('CORTEX_TRACE_INVALID', `Policy field ${field} is missing.`, `policy.${field}`);
  }
  if (!Number.isInteger(policy.maxRounds) || policy.maxRounds < 1 || policy.maxRounds > CORTEX_LIMITS.maxRounds) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace policy maxRounds is outside the hard cap.', 'policy.maxRounds');
  }
  if (!Number.isInteger(policy.maxCandidatesPerRound) || policy.maxCandidatesPerRound < 1 || policy.maxCandidatesPerRound > CORTEX_LIMITS.maxCandidatesPerRound) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace policy maxCandidatesPerRound is outside the hard cap.', 'policy.maxCandidatesPerRound');
  }
  if (!Number.isInteger(policy.maxEvidenceInAnswer) || policy.maxEvidenceInAnswer < 1 || policy.maxEvidenceInAnswer > CORTEX_LIMITS.maxEvidenceInAnswer) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace policy maxEvidenceInAnswer is outside the hard cap.', 'policy.maxEvidenceInAnswer');
  }
  if (typeof policy.requireCitations !== 'boolean' || typeof policy.allowSemanticRerank !== 'boolean' || typeof policy.allowAbstain !== 'boolean') {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace policy booleans are invalid.', 'policy');
  }
  return {
    maxRounds: policy.maxRounds,
    maxCandidatesPerRound: policy.maxCandidatesPerRound,
    maxEvidenceInAnswer: policy.maxEvidenceInAnswer,
    requireCitations: policy.requireCitations,
    allowSemanticRerank: policy.allowSemanticRerank,
    allowAbstain: policy.allowAbstain,
  };
}

function readRounds(rounds: CortexRoundV1[], policy: CortexPolicyV1): CortexRoundV1[] {
  if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > policy.maxRounds) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Trace rounds are missing or over the policy cap.', 'rounds');
  }
  return rounds.map((round, index) => {
    if (!round || round.round !== index + 1) throw new CortexError('CORTEX_TRACE_INVALID', 'Round numbers must start at 1.', `rounds.${index}.round`);
    if (typeof round.query !== 'string' || typeof round.normalizedQuery !== 'string' || typeof round.reason !== 'string') {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Round query fields are invalid.', `rounds.${index}`);
    }
    if (!Array.isArray(round.lexicalHitIds) || round.lexicalHitIds.length > policy.maxCandidatesPerRound) {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Round hits exceed the candidate cap.', `rounds.${index}.lexicalHitIds`);
    }
    if (new Set(round.lexicalHitIds).size !== round.lexicalHitIds.length) {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Round hits must be unique.', `rounds.${index}.lexicalHitIds`);
    }
    const hits = new Set(round.lexicalHitIds);
    if (!Array.isArray(round.selectedIds) || round.selectedIds.some((id) => !hits.has(id))) {
      throw new CortexError('CORTEX_EVIDENCE_UNBOUND', 'A selected id is not in that round.', `rounds.${index}.selectedIds`);
    }
    if (!Array.isArray(round.rejected) || round.rejected.some((item) => !hits.has(item?.id) || typeof item.reason !== 'string')) {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Rejected evidence is invalid.', `rounds.${index}.rejected`);
    }
    readReceipt(round.queryReceipt, round.normalizedQuery);
    return round;
  });
}

function readReceipt(receipt: CortexQueryReceiptV1, normalizedQuery: string): void {
  if (!receipt || receipt.normalizedQuery !== normalizedQuery) {
    throw new CortexError('CORTEX_RECEIPT_MISMATCH', 'Round receipt does not match the normalized query.', 'queryReceipt');
  }
  if (receipt.kind === 'v4-receipt') {
    if (typeof receipt.replayHash !== 'string' || typeof receipt.packDigest !== 'string') {
      throw new CortexError('CORTEX_RECEIPT_MISMATCH', 'V4 retrieval receipt is incomplete.', 'queryReceipt');
    }
    return;
  }
  if (receipt.kind === 'v5-result') {
    if (typeof receipt.planRoot !== 'string' || typeof receipt.resultRoot !== 'string' || typeof receipt.stateRoot !== 'string') {
      throw new CortexError('CORTEX_RECEIPT_MISMATCH', 'V5 retrieval receipt is incomplete.', 'queryReceipt');
    }
    return;
  }
  if (receipt.kind === 'host-retriever') {
    if (typeof receipt.retrieverRoot !== 'string') {
      throw new CortexError('CORTEX_RECEIPT_MISMATCH', 'Host retriever receipt is incomplete.', 'queryReceipt');
    }
    return;
  }
  throw new CortexError('CORTEX_RECEIPT_MISMATCH', 'Unknown retrieval receipt kind.', 'queryReceipt');
}

function readEvidence(evidence: CortexEvidenceRefV1[], policy: CortexPolicyV1): CortexEvidenceRefV1[] {
  if (!Array.isArray(evidence) || evidence.length > policy.maxEvidenceInAnswer) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Selected evidence exceeds the answer cap.', 'selectedEvidence');
  }
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!item || typeof item.id !== 'string' || typeof item.excerpt !== 'string' || typeof item.sourceDigest !== 'string' || typeof item.score !== 'number') {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Selected evidence is incomplete.', 'selectedEvidence');
    }
    if (ids.has(item.id)) throw new CortexError('CORTEX_TRACE_INVALID', 'Selected evidence ids must be unique.', 'selectedEvidence');
    if (item.source !== undefined && typeof item.source !== 'string') {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Evidence source must be a string.', 'selectedEvidence');
    }
    if (item.excerpt.length > CORTEX_LIMITS.excerptChars) {
      throw new CortexError('CORTEX_TRACE_INVALID', 'Evidence excerpt exceeds 500 characters.', 'selectedEvidence');
    }
    ids.add(item.id);
  }
  return evidence;
}

function readAnswer(answer: CortexAnswerV1, evidence: CortexEvidenceRefV1[], policy: CortexPolicyV1): CortexAnswerV1 {
  if (!answer || !CORTEX_ANSWER_STATUSES.includes(answer.status) || typeof answer.text !== 'string') {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Answer status or text is invalid.', 'answer');
  }
  if (answer.text.length > CORTEX_LIMITS.maxAnswerChars) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Answer text exceeds 8000 characters.', 'answer.text');
  }
  const ids = new Set(evidence.map((item) => item.id));
  const excerpts = new Map(evidence.map((item) => [item.id, item.excerpt]));
  if (!Array.isArray(answer.claims) || !Array.isArray(answer.citations) || !Array.isArray(answer.gaps)) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Answer claims, citations, or gaps are missing.', 'answer');
  }
  for (const claim of answer.claims) {
    if (typeof claim?.text !== 'string' || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.some((id) => !ids.has(id))) {
      throw new CortexError('CORTEX_EVIDENCE_UNBOUND', 'A claim cites evidence that was not selected.', 'answer.claims');
    }
  }
  for (const citation of answer.citations) {
    if (!ids.has(citation?.evidenceId) || citation.excerpt !== excerpts.get(citation.evidenceId)) {
      throw new CortexError('CORTEX_EVIDENCE_UNBOUND', 'A citation does not match selected evidence.', 'answer.citations');
    }
  }
  for (const gap of answer.gaps) {
    if (typeof gap?.subquestion !== 'string' || typeof gap?.reason !== 'string') {
      throw new CortexError('CORTEX_TRACE_INVALID', 'A gap is incomplete.', 'answer.gaps');
    }
  }
  const cites = answer.text.length > 0 || answer.claims.length > 0;
  if (policy.requireCitations && cites && answer.citations.length === 0) {
    throw new CortexError('CORTEX_TRACE_INVALID', 'Citations are required for this answer.', 'answer.citations');
  }
  return answer;
}

function readKarRefs(value: KarResultRefV1[]): KarResultRefV1[] {
  if (!Array.isArray(value)) throw new CortexError('CORTEX_TRACE_INVALID', 'karEvaluations must be an array.', 'karEvaluations');
  for (const ref of value) {
    if (typeof ref?.proposition !== 'string' || typeof ref.status !== 'string' || typeof ref.karRoot !== 'string' || typeof ref.evidenceSetRoot !== 'string' || typeof ref.planDigest !== 'string') {
      throw new CortexError('CORTEX_TRACE_INVALID', 'A KAR reference is incomplete.', 'karEvaluations');
    }
  }
  return value;
}

function isCreatedAt(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}
