/**
 * KITE-1 phase 1 types.
 *
 * An obligation is a typed gap. A retrieval names the unmet obligation that
 * caused it. These types do not certify invariance and they do not replace
 * Cortex answer statuses.
 */

export const KITE_CONTRACT_FORMAT = 'knolo-kite-contract-1';
export const KITE_EVALUATION_FORMAT = 'knolo-kite-evaluation-1';

export const KITE_CONDITION_KINDS = [
  'entity',
  'relation',
  'date',
  'authority',
  'qualification',
  'contradiction',
  'evidence',
] as const;

export type KiteConditionKind = (typeof KITE_CONDITION_KINDS)[number];

/** Starting budget from the V7 note. This slice does not search variants. */
export const KITE_BOUNDS = {
  maxGraphNodes: 5000,
  maxVariants: 2048,
  maxCounterfactualChanges: 2,
  maxRetrievals: 64,
} as const;

export type KiteBounds = {
  maxGraphNodes: number;
  maxVariants: number;
  maxCounterfactualChanges: number;
  maxRetrievals: number;
};

export type KiteObligation = {
  id: string;
  kind: KiteConditionKind;
  term: string;
};

export type KiteContract = {
  format: typeof KITE_CONTRACT_FORMAT;
  question: string;
  obligations: KiteObligation[];
};

export type KiteRetrieval = {
  obligationId: string;
  query: string;
  normalizedQuery: string;
  hitIds: string[];
};

export type KiteObligationResult = {
  id: string;
  kind: KiteConditionKind;
  hitIds: string[];
};

export type KiteEvaluation = {
  format: typeof KITE_EVALUATION_FORMAT;
  question: string;
  stateRoot: string;
  met: KiteObligationResult[];
  unmet: KiteObligationResult[];
  retrievals: KiteRetrieval[];
  bounds: KiteBounds & {
    variantsChecked: 0;
    counterfactualChanges: 0;
  };
};

export const KITE_VERDICTS = [
  'WARRANTED_IN_SCOPE',
  'SUPPORTED_OPEN_WORLD',
  'REFUTED_IN_SCOPE',
  'CONFLICTED',
  'UNDERDETERMINED',
  'BOUND_EXCEEDED',
] as const;

export type KiteVerdict = (typeof KITE_VERDICTS)[number];

/** Per-world label. Scope verdicts are separate. A closed world is not yet warranted. */
export const KITE_WORLD_LABELS = [
  'SUPPORTED_CLOSED',
  'REFUTED',
  'SUPPORTED_OPEN_WORLD',
  'CONFLICTED',
  'UNDERDETERMINED',
] as const;

export type KiteWorldLabel = (typeof KITE_WORLD_LABELS)[number];

export const KITE_RULES_FORMAT = 'knolo-kite-rules-1';
export const KITE_COMPLETENESS_FORMAT = 'knolo-kite-completeness-1';
export const KITE_CHANGES_FORMAT = 'knolo-kite-changes-1';
export const KITE_WORLD_FORMAT = 'knolo-kite-world-1';
export const KITE_CERTIFICATE_FORMAT = 'knolo-kite-certificate-1';
export const KITE_RESULT_FORMAT = 'knolo-kite-result-1';
export const KITE_DELTA_FORMAT = 'knolo-kite-delta-1';
export const KITE_CHANGE_KINDS = ['retract', 'amend', 'conflict'] as const;

export type KiteChangeKind = (typeof KITE_CHANGE_KINDS)[number];

export type KiteConflict = { left: string; right: string };

export type KiteCompletenessRule = {
  id: string;
  collection: string;
  obligationId: string;
};

export type KiteRules = {
  format: typeof KITE_RULES_FORMAT;
  proposition: string;
  support: string[];
  oppose: string[];
  require: string[];
  conflicts: KiteConflict[];
  completeness: KiteCompletenessRule[];
};

export type KiteDeclaration = {
  id: string;
  collection: string;
  signed: true;
};

export type KiteCompleteness = {
  format: typeof KITE_COMPLETENESS_FORMAT;
  declarations: KiteDeclaration[];
};

export type KiteChange = {
  id: string;
  kind: KiteChangeKind;
  obligationId: string;
};

export type KiteChangeSet = {
  format: typeof KITE_CHANGES_FORMAT;
  changes: KiteChange[];
};

export type KiteWorldObligation = {
  id: string;
  kind: KiteConditionKind;
  met: boolean;
  hitIds: string[];
  sources: string[];
};

export type KiteWorld = {
  format: typeof KITE_WORLD_FORMAT;
  question: string;
  asOf: string | null;
  stateRoot: string;
  semanticRoot: string | null;
  obligations: KiteWorldObligation[];
  rules: KiteRules;
  completeness: KiteCompleteness;
  changes: KiteChange[];
  bounds: KiteBounds;
};

export type KiteWorldStep = {
  changeIds: string[];
  label: KiteWorldLabel;
};

export type KiteDerivation = {
  verdict: KiteVerdict;
  baseWorld: KiteWorldLabel | null;
  agrees: boolean;
  witness: string[] | null;
  worldsChecked: number;
  worlds: KiteWorldStep[];
  invarianceRoot: string | null;
  negativeCollections: string[];
  obligationIds: string[];
  sourcePartitions: string[];
  variantsChecked: number;
  counterfactualChanges: number;
};

export type KiteCertificate = {
  format: typeof KITE_CERTIFICATE_FORMAT;
  verdict: Exclude<KiteVerdict, 'BOUND_EXCEEDED'>;
  baseWorld: KiteWorldLabel;
  question: string;
  asOf: string | null;
  stateRoot: string;
  semanticRoot: string | null;
  invarianceRoot: string;
  worldsChecked: number;
  agrees: boolean;
  witness: string[] | null;
  variantsChecked: number;
  counterfactualChanges: number;
  met: string[];
  unmet: string[];
  negativeCollections: string[];
  obligationIds: string[];
  sourcePartitions: string[];
};

export type KiteDependencies = {
  obligationIds: string[];
  sourcePartitions: string[];
  negativeCollections: string[];
};

export type KiteSessionResult = {
  format: typeof KITE_RESULT_FORMAT;
  verdict: KiteVerdict;
  question: string;
  asOf: string | null;
  stateRoot: string;
  semanticRoot: string | null;
  met: KiteObligationResult[];
  unmet: KiteObligationResult[];
  retrievals: KiteRetrieval[];
  worldsChecked: number;
  agrees: boolean;
  witness: { changeIds: string[] } | null;
  bounds: KiteBounds & {
    variantsChecked: number;
    counterfactualChanges: number;
  };
  certificate: KiteCertificate | null;
  dependencies: KiteDependencies;
};

export type KiteDelta = {
  format: typeof KITE_DELTA_FORMAT;
  fromStateRoot: string;
  toStateRoot: string;
  retractedSources: string[];
  insertedCollections: string[];
  changedObligationIds: string[];
};
