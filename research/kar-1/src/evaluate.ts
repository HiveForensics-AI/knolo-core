import { anchorRoot, resolveAnchor, type AnchorCommitment } from './anchor.js';
import { digest } from './canonicalize.js';
import { closeFrontiers, frontierRoot, frontierWitnessRoot } from './closure.js';
import { decisionRoot, evidenceSetRoot, selectCover } from './cover.js';
import { prepareGraph, prepareImage, semanticRootOf, unresolvedEvidence } from './graph.js';
import { validatePlan } from './plan.js';
import {
  KAR_VERSION,
  emptyFrontiers,
  zeroCoverage,
  type Decision,
  type EvidenceChoice,
  type KarResult,
  type Status,
  type Witness,
} from './types.js';

const EMPTY_ANCHOR: AnchorCommitment = { mode: null, procedure: null, witness: null, nodes: [] };

export function evaluate(imageInput: unknown, graphInput: unknown, query: unknown, planInput: unknown): KarResult {
  const queryRoot = digest(typeof query === 'string' ? query : null);
  const planRoot = digest(planInput ?? null);
  const preparedImage = prepareImage(imageInput);
  const knowledgeRoot = preparedImage ? preparedImage.knowledgeRoot : digest({ invalidImage: true, image: imageInput ?? null });
  const graph = prepareGraph(graphInput);
  const semanticRoot = graph ? semanticRootOf(graph) : digest({ invalid: true, graph: graphInput ?? null });
  const plan = validatePlan(planInput);

  const emit = (
    status: Status,
    evidenceIds: string[] = [],
    frontiers = emptyFrontiers(),
    witnesses: Witness[] = [],
    choices: EvidenceChoice[] = [],
    decision?: Decision,
    commitment: AnchorCommitment = EMPTY_ANCHOR,
  ): KarResult => {
    const decided: Decision = decision ?? {
      status,
      profile: plan?.profile ?? '',
      cardinality: 0,
      coverage: plan ? requiredCoverage(plan) : zeroCoverage(),
    };
    if (decided.status !== status) decided.status = status;
    const anchor = anchorRoot(commitment);
    const frontier = frontierRoot(frontiers);
    const witness = frontierWitnessRoot(witnesses);
    const evidence = evidenceSetRoot(choices);
    const decisionHash = decisionRoot(decided);
    const roots = {
      knowledgeRoot,
      semanticRoot,
      queryRoot,
      planRoot,
      anchorRoot: anchor,
      frontierRoot: frontier,
      frontierWitnessRoot: witness,
      evidenceSetRoot: evidence,
      decisionRoot: decisionHash,
      karRoot: digest({
        knowledgeRoot,
        semanticRoot,
        queryRoot,
        planRoot,
        anchorRoot: anchor,
        frontierRoot: frontier,
        evidenceSetRoot: evidence,
        decisionRoot: decisionHash,
      }),
    };
    return {
      version: KAR_VERSION,
      status,
      evidenceIds,
      choices,
      frontiers,
      witnesses,
      decision: decided,
      roots,
    };
  };

  if (!plan || typeof query !== 'string') return emit('PLAN_INVALID');
  if (!preparedImage || !graph) return emit('GRAPH_INVALID');
  if (graph.knowledgeRoot !== preparedImage.knowledgeRoot || unresolvedEvidence(graph, preparedImage.texts)) {
    return emit('GRAPH_NOT_BOUND');
  }
  if (plan.lexical) {
    for (const evidenceId of plan.lexical.evidenceIds) {
      if (!preparedImage.texts.has(evidenceId)) return emit('GRAPH_NOT_BOUND');
    }
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const resolved = resolveAnchor(query, nodeIds, plan.anchor);
  if (plan.anchor.mode === 'recompute' && plan.anchor.procedure !== 'member-id-v1') {
    return emit('PLAN_INVALID', [], emptyFrontiers(), [], [], undefined, resolved.commitment);
  }
  if (resolved.rejected) return emit('ANCHOR_REJECTED', [], emptyFrontiers(), [], [], undefined, resolved.commitment);

  const closed = closeFrontiers(graph, plan, resolved.commitment.nodes);
  if (!closed.ok) return emit('CLOSURE_BOUND_EXCEEDED', [], emptyFrontiers(), [], [], undefined, resolved.commitment);

  const cover = selectCover(plan, closed.admissions, preparedImage.texts);
  return emit(cover.status, cover.evidenceIds, closed.frontiers, closed.witnesses, cover.choices, cover.decision, resolved.commitment);
}

function requiredCoverage(plan: NonNullable<ReturnType<typeof validatePlan>>) {
  const coverage = zeroCoverage();
  for (const frontier of Object.keys(coverage) as (keyof typeof coverage)[]) {
    coverage[frontier] = {
      covered: 0,
      required: plan.coverageMode === 'requirements' ? plan.requirements[frontier].length : 1,
    };
  }
  return coverage;
}
