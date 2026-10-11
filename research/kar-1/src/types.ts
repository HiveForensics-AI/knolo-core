export const KAR_VERSION = 'kar-1-research-1';

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

export type Graph = {
  version: 1;
  knowledgeRoot: string;
  provenance: { producer: string; note?: string };
  nodes: Node[];
  relations: Relation[];
  bindings: EvidenceBinding[];
};

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
