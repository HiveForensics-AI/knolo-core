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
