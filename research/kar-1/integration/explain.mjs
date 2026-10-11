import { resolveAnchor } from '../dist/anchor.js';
import { closeFrontiers } from '../dist/closure.js';
import { validatePlan } from '../dist/plan.js';

const FRONTIERS = ['F_S', 'F_O', 'F_Q', 'F_T', 'F_A'];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function admissionsFor(graph, plan, query) {
  const validated = validatePlan(plan);
  if (!validated || typeof query !== 'string' || !graph?.nodes) return [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const resolved = resolveAnchor(query, nodeIds, validated.anchor);
  if (resolved.rejected) return [];
  const closed = closeFrontiers(graph, validated, resolved.commitment.nodes);
  return closed.ok ? closed.admissions : [];
}

function requirementHits(admissions, evidenceId) {
  const hits = [];
  for (const admission of admissions) {
    if (admission.evidenceId !== evidenceId || !admission.applicable) continue;
    for (const requirement of admission.requirements) {
      hits.push({ frontier: admission.frontier, requirement });
    }
  }
  hits.sort((left, right) => compareText(left.frontier, right.frontier) || compareText(left.requirement, right.requirement));
  return hits;
}

function applicableEvidence(admissions, evidenceId) {
  const rows = admissions.filter((admission) => admission.evidenceId === evidenceId);
  if (rows.length === 0) return null;
  return rows.some((admission) => admission.applicable);
}

/**
 * Deterministic rendering of a KAR envelope. No model.
 * `envelope` is a Knolo integration result or a bare KarResult.
 */
export function explainKarResult(envelope, context) {
  const kar = envelope.kar ?? envelope;
  const plan = context.plan;
  const graph = context.graph;
  const query = context.query;
  const admissions = admissionsFor(graph, plan, query);
  const selected = new Set(kar.evidenceIds ?? []);
  const choiceById = new Map((kar.choices ?? []).map((choice) => [choice.evidenceId, choice]));
  const witnesses = [...(kar.witnesses ?? [])].sort((left, right) => {
    return compareText(left.frontier, right.frontier) || compareText(left.evidenceId, right.evidenceId) || compareText(left.anchorId ?? '', right.anchorId ?? '');
  });

  const evidence = [];
  const seen = new Set();
  for (const witness of witnesses) {
    const key = `${witness.frontier}\0${witness.evidenceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const choice = choiceById.get(witness.evidenceId);
    const relations = (witness.path ?? []).filter((step) => step.relation).map((step) => step.relation);
    evidence.push({
      evidenceId: witness.evidenceId,
      frontier: witness.frontier,
      selected: selected.has(witness.evidenceId),
      anchorId: witness.anchorId,
      relations,
      applicable: applicableEvidence(admissions, witness.evidenceId),
      requirements: requirementHits(admissions, witness.evidenceId).filter((hit) => hit.frontier === witness.frontier),
      satisfiedFrontiers: choice?.frontiers ?? [],
    });
  }

  const unnecessary = evidence
    .filter((row) => !row.selected)
    .map((row) => ({
      evidenceId: row.evidenceId,
      frontier: row.frontier,
      reason: 'minimum-cover left this frontier member out because a smaller or lexicographically earlier set already met the floors',
    }));

  const coverage = kar.decision?.coverage ?? {};
  const unmet = FRONTIERS.filter((frontier) => {
    const pair = coverage[frontier];
    return pair && pair.required > 0 && pair.covered < pair.required;
  });

  const abstention = kar.status === 'SATISFIED' ? null : {
    status: kar.status,
    evidenceIds: kar.evidenceIds ?? [],
    unmet,
    reason: abstentionReason(kar.status, unmet, kar.frontiers, kar.evidenceIds ?? []),
  };

  const lines = [];
  lines.push(`status ${kar.status}`);
  if (plan?.anchor?.mode === 'supplied') {
    const witness = [...(plan.anchor.witness ?? [])].map((row) => `${row.nodeId}${row.queryTerm ? `:${row.queryTerm}` : ''}`).sort().join(',');
    lines.push(`grounding supplied ${witness}`);
  } else if (plan?.anchor?.mode === 'recompute') {
    lines.push(`grounding recompute ${plan.anchor.procedure}`);
  }
  if (kar.roots?.anchorRoot) lines.push(`anchor-root ${kar.roots.anchorRoot}`);
  for (const frontier of FRONTIERS) {
    const members = kar.frontiers?.[frontier] ?? [];
    lines.push(`frontier ${frontier} ${members.join(',')}`);
  }
  for (const row of evidence) {
    lines.push(
      [
        row.selected ? 'selected' : 'frontier-member',
        row.evidenceId,
        `frontier ${row.frontier}`,
        `anchor ${row.anchorId ?? 'lexical'}`,
        `relations ${row.relations.join(',') || 'none'}`,
        `applicable ${row.applicable === null ? 'unknown' : row.applicable}`,
        `requirements ${row.requirements.map((hit) => hit.requirement).join(',') || 'none'}`,
      ].join(' | '),
    );
  }
  for (const row of unnecessary) lines.push(`unnecessary ${row.evidenceId} ${row.frontier} ${row.reason}`);
  if (abstention) lines.push(`abstention ${abstention.reason}`);
  for (const name of ['knowledgeRoot', 'semanticRoot', 'queryRoot', 'planRoot', 'anchorRoot', 'frontierRoot', 'frontierWitnessRoot', 'evidenceSetRoot', 'decisionRoot', 'karRoot']) {
    if (kar.roots?.[name]) lines.push(`root ${name} ${kar.roots[name]}`);
  }

  return {
    status: kar.status,
    grounding: plan?.anchor ?? null,
    evidence,
    unnecessary,
    abstention,
    frontiers: kar.frontiers,
    lines,
  };
}

function abstentionReason(status, unmet, frontiers, evidenceIds) {
  if (status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS') {
    const which = unmet.length > 0 ? unmet.join(',') : 'requirements';
    const populated = FRONTIERS.filter((frontier) => (frontiers?.[frontier] ?? []).length > 0);
    return `unsatisfied ${which}; returned evidence count ${evidenceIds.length}; populated frontiers ${populated.join(',') || 'none'}; no top-k fallback`;
  }
  if (status === 'GRAPH_NOT_BOUND') return 'the committed evidence graph is not bound to this knowledge image';
  if (status === 'ANCHOR_REJECTED') return 'the supplied anchor names a node outside the committed graph';
  if (status === 'CLOSURE_BOUND_EXCEEDED') return 'closure exceeded a plan resource bound and the frontiers were emptied';
  if (status === 'SEARCH_BOUND_EXCEEDED') return 'exact cover exceeded maxCoverVisits before a minimum set was proven';
  if (status === 'PLAN_INVALID') return 'the plan is not a valid KAR plan';
  if (status === 'GRAPH_INVALID') return 'the image or committed evidence graph is not valid';
  return status;
}
