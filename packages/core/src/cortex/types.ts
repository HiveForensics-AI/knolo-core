export const CORTEX_TRACE_FORMAT = 'knolo-cortex-trace-1' as const;
export const CORTEX_DOSSIER_FORMAT = 'knolo-cortex-dossier-1' as const;

export const CORTEX_MODES = [
  'evidence_answer',
  'find_relevant',
  'compare_sources',
  'prove_or_abstain',
  'coverage_review',
] as const;

export type CortexMode = (typeof CORTEX_MODES)[number];

export const CORTEX_ANSWER_STATUSES = ['ANSWERED', 'PARTIAL', 'INSUFFICIENT_EVIDENCE'] as const;
export type CortexAnswerStatus = (typeof CORTEX_ANSWER_STATUSES)[number];

export type CortexPolicyV1 = {
  maxRounds: number;
  maxCandidatesPerRound: number;
  maxEvidenceInAnswer: number;
  requireCitations: boolean;
  allowSemanticRerank: boolean;
  allowAbstain: boolean;
};

export type CortexImageIdentity = {
  kind: 'v4-pack' | 'v5-image';
  stateRoot: string;
  commitDigest?: string;
  knowledgeRoot?: string;
};

export type CortexEvidenceRefV1 = {
  id: string;
  score: number;
  source?: string;
  excerpt: string;
  sourceDigest: string;
};

export type CortexRejectedRefV1 = {
  id: string;
  reason: string;
};

export type CortexQueryReceiptV1 =
  | { kind: 'v4-receipt'; replayHash: string; packDigest: string; normalizedQuery: string }
  | { kind: 'v5-result'; planRoot: string; resultRoot: string; stateRoot: string; normalizedQuery: string }
  | { kind: 'host-retriever'; retrieverRoot: string; normalizedQuery: string };

export type CortexRoundV1 = {
  round: number;
  query: string;
  normalizedQuery: string;
  lexicalHitIds: string[];
  selectedIds: string[];
  rejected: CortexRejectedRefV1[];
  reason: string;
  queryReceipt: CortexQueryReceiptV1;
};

export type CortexClaimV1 = {
  text: string;
  evidenceIds: string[];
};

export type CortexCitationV1 = {
  evidenceId: string;
  excerpt: string;
};

export type CortexGapV1 = {
  subquestion: string;
  reason: string;
};

export type KarResultRefV1 = {
  proposition: string;
  status: string;
  karRoot: string;
  evidenceSetRoot: string;
  planDigest: string;
};

export type CortexAnswerV1 = {
  status: CortexAnswerStatus;
  text: string;
  claims: CortexClaimV1[];
  citations: CortexCitationV1[];
  gaps: CortexGapV1[];
};

export type CortexTraceV1 = {
  format: typeof CORTEX_TRACE_FORMAT;
  question: string;
  questionDigest: string;
  image: CortexImageIdentity;
  policy: CortexPolicyV1;
  rounds: CortexRoundV1[];
  selectedEvidence: CortexEvidenceRefV1[];
  karEvaluations?: KarResultRefV1[];
  karPlan?: unknown;
  answer: CortexAnswerV1;
  receipt: {
    traceRoot: string;
    answerRoot: string;
    evidenceRoot: string;
    createdAt?: string;
  };
};

export type CortexDossier = {
  format: typeof CORTEX_DOSSIER_FORMAT;
  question: string;
  answer: CortexAnswerV1;
  selectedEvidence: CortexEvidenceRefV1[];
  citations: CortexCitationV1[];
  karEvaluations: KarResultRefV1[];
  gaps: CortexGapV1[];
  traceRoot: string;
  answerRoot: string;
  evidenceRoot: string;
  /** Roots matched the trace. This is not a truth verdict. */
  verified: true;
  dossierRoot: string;
};

export type CortexExplanation = {
  question: string;
  rounds: CortexRoundV1[];
  selectedEvidence: CortexEvidenceRefV1[];
  rejectedEvidence: CortexRejectedRefV1[];
  gaps: CortexGapV1[];
  karEvaluations: KarResultRefV1[];
  citationMap: Record<string, CortexCitationV1[]>;
  finalAnswer: CortexAnswerV1;
};

export type CortexVerification =
  | { ok: true; traceRoot: string; answerRoot: string; evidenceRoot: string }
  | { ok: false; code: string; message: string };
