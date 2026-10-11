import { resolveAnchor } from './anchor.js';
import { closeFrontiers } from './closure.js';
import { inspectCoverShape } from './cover.js';
import { validatePlan } from './plan.js';
import type { KarSession } from './session.js';

export type KarComplexityRisk = 'low' | 'moderate' | 'high' | 'unknown';

export type KarComplexity = {
  advisory: true;
  candidates: number | null;
  distinctRequirementMasks: number | null;
  searchPool: number | null;
  cardinalityBound: number | null;
  maxCoverVisits: number | null;
  estimatedCombinationUpperBound: number | null;
  combinationBoundCapped: boolean;
  risk: KarComplexityRisk;
  code: string | null;
  note: string;
};

const COMBINATION_CAP = 1e15;

/**
 * Advisory exact-cover cost estimate.
 * It does not select evidence and it does not change later evaluations.
 */
export function inspectKarComplexity(session: KarSession, planInput: unknown, proposition = ''): KarComplexity {
  const plan = validatePlan(planInput);
  if (!plan || typeof planInput !== 'object') {
    return unknown('KAR_PLAN_INVALID', 'The plan is not valid, so cover cost was not estimated.');
  }
  const nodeIds = new Set(session.nodeById.keys());
  const resolved = resolveAnchor(proposition, nodeIds, plan.anchor);
  const propositionNodes = resolved.commitment.nodes;
  if (plan.anchor.mode === 'supplied' && resolved.rejected) {
    return unknown('KAR_ANCHOR_REJECTED', 'The supplied anchor names a node outside the committed graph.');
  }
  const closed = closeFrontiers(session.graph, plan, propositionNodes, session.indexes);
  if (!closed.ok) {
    return {
      ...unknown('KAR_CLOSURE_BOUND_EXCEEDED', 'Closure exceeded a resource bound, so the cover pool was not estimated.'),
      risk: 'high',
    };
  }
  const shape = inspectCoverShape(plan, closed.admissions, session.texts);
  const maxSize = Math.min(plan.cardinalityBound, shape.searchPool);
  const upper = combinationUpperBound(shape.searchPool, maxSize);
  let risk: KarComplexityRisk = 'low';
  if (upper.capped || upper.value > plan.bounds.maxCoverVisits || shape.distinctRequirementMasks >= 15) risk = 'high';
  else if (shape.distinctRequirementMasks >= 9 || upper.value > plan.bounds.maxCoverVisits / 4) risk = 'moderate';
  return {
    advisory: true,
    candidates: shape.candidates,
    distinctRequirementMasks: shape.distinctRequirementMasks,
    searchPool: shape.searchPool,
    cardinalityBound: plan.cardinalityBound,
    maxCoverVisits: plan.bounds.maxCoverVisits,
    estimatedCombinationUpperBound: upper.value,
    combinationBoundCapped: upper.capped,
    risk,
    code: null,
    note: 'This estimate does not run exact cover and does not change a KAR result. minimum-cover still returns SEARCH_BOUND_EXCEEDED with an empty set when the visit budget is exceeded.',
  };
}

function combinationUpperBound(pool: number, maxSize: number): { value: number; capped: boolean } {
  if (pool < 0 || maxSize < 0) return { value: 0, capped: false };
  const limit = Math.min(maxSize, pool);
  let term = 1;
  let sum = 1;
  for (let size = 1; size <= limit; size += 1) {
    term = (term * (pool - size + 1)) / size;
    sum += term;
    if (!Number.isFinite(sum) || sum > COMBINATION_CAP) return { value: COMBINATION_CAP, capped: true };
  }
  return { value: Math.round(sum), capped: false };
}

function unknown(code: string, note: string): KarComplexity {
  return {
    advisory: true,
    candidates: null,
    distinctRequirementMasks: null,
    searchPool: null,
    cardinalityBound: null,
    maxCoverVisits: null,
    estimatedCombinationUpperBound: null,
    combinationBoundCapped: false,
    risk: 'unknown',
    code,
    note,
  };
}
