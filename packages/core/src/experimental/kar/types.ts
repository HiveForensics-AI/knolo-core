/**
 * Experimental KAR types.
 * Certificate fields use frozen semantics `kar-1-research-1`.
 * This module is not a stable `@knolo/core` root export.
 */

export const KAR_VERSION = 'kar-1-research-1' as const;

/** Marks this entrypoint as experimental. It is not part of the certificate. */
export const KAR_API = 'experimental' as const;

export const FRONTIERS = ['F_S', 'F_O', 'F_Q', 'F_T', 'F_A'] as const;
export type Frontier = (typeof FRONTIERS)[number];

export const PROFILES = ['minimum-cover', 'minimum-cover-redundancy-v1', 'exp1-lexicographic'] as const;
export type Profile = (typeof PROFILES)[number];

export type Status =
  | 'SATISFIED'
  | 'UNSATISFIED_EVIDENCE_REQUIREMENTS'
  | 'SEARCH_BOUND_EXCEEDED'
  | 'CLOSURE_BOUND_EXCEEDED'
  | 'ANCHOR_REJECTED'
  | 'GRAPH_NOT_BOUND'
  | 'GRAPH_INVALID'
  | 'PLAN_INVALID';

export type EvidenceRecord = { id: string; text: string };

/** Research projection of evidence. This is the preimage of KnowledgeRoot. */
export type Image = {
  version: 1;
  evidence: EvidenceRecord[];
};

export type Node = { id: string };

export type Relation = {
  id: string;
  from: string;
  relation: string;
  to: string;
};

export type EvidenceBinding = {
  id: string;
  nodeId: string;
  evidenceId: string;
  requirements: string[];
  authority?: number;
  unauthorized?: boolean;
  validFrom?: string;
  validUntil?: string;
  provenance?: string;
};

/** Committed Evidence Graph (CEG). Symbol G in the frozen specification. */
export type CommittedEvidenceGraph = {
  version: 1;
  knowledgeRoot: string;
  provenance: { producer: string; note?: string };
  nodes: Node[];
  relations: Relation[];
  bindings: EvidenceBinding[];
};

export type Graph = CommittedEvidenceGraph;

export type WitnessRecord = { nodeId: string; queryTerm?: string };

export type AnchorSpec =
  | { mode: 'recompute'; procedure: string }
  | { mode: 'supplied'; witness: WitnessRecord[] };

export type Bounds = {
  maxAnchorNodes: number;
  maxClosureNodes: number;
  maxClosureEdges: number;
  maxFrontierEvidence: number;
  maxRequirementsPerFrontier: number;
  maxEvidenceBindings: number;
  maxCoverVisits: number;
};

export type Plan = {
  version: 1;
  anchor: AnchorSpec;
  frontierMap: Record<string, Frontier>;
  depth: number;
  cardinalityBound: number;
  coverageMode: 'requirements' | 'nonempty';
  requirements: Record<Frontier, string[]>;
  floors: Record<Frontier, string>;
  profile: Profile;
  asOf: string;
  minAuthority: number | null;
  bounds: Bounds;
  lexical: null | { frontier: Frontier; evidenceIds: string[] };
};

export type PathStep = { node: string; relation?: string };

export type Witness = {
  evidenceId: string;
  frontier: Frontier;
  anchorId: string | null;
  path: PathStep[];
};

export type CoveragePair = { covered: number; required: number };

export type Rational = { numerator: number; denominator: number };

export type Decision = {
  status: Status;
  profile: string;
  cardinality: number;
  coverage: Record<Frontier, CoveragePair>;
  redundancy?: Rational;
};

export type EvidenceChoice = { evidenceId: string; frontiers: Frontier[] };

export type Roots = {
  knowledgeRoot: string;
  semanticRoot: string;
  queryRoot: string;
  planRoot: string;
  anchorRoot: string;
  frontierRoot: string;
  frontierWitnessRoot: string;
  evidenceSetRoot: string;
  decisionRoot: string;
  karRoot: string;
};

/** Frozen research certificate. Do not add fields. */
export type KarResult = {
  version: typeof KAR_VERSION;
  status: Status;
  evidenceIds: string[];
  choices: EvidenceChoice[];
  frontiers: Record<Frontier, string[]>;
  witnesses: Witness[];
  decision: Decision;
  roots: Roots;
};

export type KarIssue = {
  code: string;
  path: string;
  message: string;
};

export class KarError extends Error {
  readonly code: string;
  readonly errors: KarIssue[];

  constructor(code: string, message: string, errors: KarIssue[] = []) {
    super(message);
    this.name = 'KarError';
    this.code = code;
    this.errors = errors;
  }
}

/**
 * Execution indexes. They are not hashed and they are not accepted by verifyKar.
 * Relation lists are sorted by relation id. Binding lists keep prepared-graph order.
 */
export type KarIndexes = {
  evidenceById: ReadonlyMap<string, EvidenceRecord>;
  nodeById: ReadonlyMap<string, Node>;
  relationsByFrom: ReadonlyMap<string, readonly Relation[]>;
  bindingsByNode: ReadonlyMap<string, readonly EvidenceBinding[]>;
  bindingsByEvidence: ReadonlyMap<string, readonly EvidenceBinding[]>;
};

export type KarImageIdentity = {
  /** V5 mounted state identity. Null for a research-projection session. */
  stateRoot: string | null;
  /** Frozen KAR research projection root. Not a V5 state root. */
  knowledgeRoot: string;
  objectRoot: string | null;
  commitDigest: string | null;
};

export type KarSelectedEvidence = {
  id: string;
  source?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  frontiers: Frontier[];
};

/**
 * Developer result. `certificate` is the frozen KarResult.
 * Display fields sit outside that certificate.
 */
export type KarEvaluation = {
  experimental: true;
  api: typeof KAR_API;
  version: typeof KAR_VERSION;
  status: Status;
  code: string | null;
  proposition: string;
  plan: Plan | null;
  image: KarImageIdentity;
  frontiers: Record<Frontier, string[]>;
  selectedEvidence: KarSelectedEvidence[];
  witnesses: Witness[];
  certificate: KarResult;
};

export type KarSidecarV1 = {
  version: 1;
  stateRoot: string;
  objectRoot: string;
  commitDigest: string;
  knowledgeRoot: string;
  graph: CommittedEvidenceGraph;
};

export function emptyFrontiers(): Record<Frontier, string[]> {
  return { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
}

export function zeroCoverage(): Record<Frontier, CoveragePair> {
  return {
    F_S: { covered: 0, required: 0 },
    F_O: { covered: 0, required: 0 },
    F_Q: { covered: 0, required: 0 },
    F_T: { covered: 0, required: 0 },
    F_A: { covered: 0, required: 0 },
  };
}

export function karStatusCode(status: Status): string | null {
  switch (status) {
    case 'GRAPH_INVALID':
      return 'KAR_GRAPH_INVALID';
    case 'GRAPH_NOT_BOUND':
      return 'KAR_GRAPH_NOT_BOUND';
    case 'PLAN_INVALID':
      return 'KAR_PLAN_INVALID';
    case 'ANCHOR_REJECTED':
      return 'KAR_ANCHOR_REJECTED';
    case 'CLOSURE_BOUND_EXCEEDED':
      return 'KAR_CLOSURE_BOUND_EXCEEDED';
    case 'SEARCH_BOUND_EXCEEDED':
      return 'KAR_SEARCH_BOUND_EXCEEDED';
    default:
      return null;
  }
}
