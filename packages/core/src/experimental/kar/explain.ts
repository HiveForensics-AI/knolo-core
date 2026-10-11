import { resolveAnchor } from './anchor.js';
import { canonicalize } from './canonicalize.js';
import { closeFrontiers } from './closure.js';
import { coversPlan } from './cover.js';
import { validatePlan } from './plan.js';
import type { KarSession } from './session.js';
import {
  FRONTIERS,
  type Frontier,
  type KarEvaluation,
  type KarResult,
  type KarSelectedEvidence,
  type Plan,
  type Status,
  type Witness,
} from './types.js';
import { certificateOf } from './validate.js';

export type KarExplanationEvidence = {
  evidenceId: string;
  frontier: Frontier;
  selected: boolean;
  anchorId: string | null;
  path: Witness['path'];
  relations: string[];
  applicable: boolean | null;
  requirements: string[];
  necessaryForSelectedSet: boolean | null;
  reason: string;
};

export type KarExplanation = {
  status: Status;
  anchor: {
    mode: string | null;
    procedure: string | null;
    witness: { nodeId: string; queryTerm?: string }[] | null;
    anchorRoot: string | null;
  };
  grounding: string | null;
  frontiers: Record<Frontier, string[]>;
  selectedEvidence: KarSelectedEvidence[];
  evidence: KarExplanationEvidence[];
  coverage: KarResult['decision']['coverage'] | null;
  abstention: { status: Status; reason: string } | null;
  bound: { code: string; reason: string } | null;
  roots: KarResult['roots'] | null;
  lines: string[];
};

const FRONTIER_LABEL: Record<Frontier, string> = {
  F_S: 'SUPPORT',
  F_O: 'OPPOSITION',
  F_Q: 'QUALIFICATION',
  F_T: 'TEMPORAL',
  F_A: 'AUTHORITY',
};

/**
 * Deterministic explanation. No model.
 * Applicability and necessity are filled only when the session and plan
 * recompute the same certificate. Missing inputs stay null.
 */
export function explainKarResult(session: KarSession, result: KarEvaluation | KarResult): KarExplanation {
  return buildExplanation(session, result);
}

/** Explain a certificate without inventing image or graph facts. */
export function explainKarCertificate(result: KarEvaluation | KarResult): KarExplanation {
  return buildExplanation(null, result);
}

function buildExplanation(session: KarSession | null, result: KarEvaluation | KarResult): KarExplanation {
  const certificate = certificateOf(result);
  if (!certificate) {
    throw new Error('explainKarResult requires a KAR evaluation or certificate.');
  }
  const evaluation = isEvaluation(result) ? result : null;
  const plan = evaluation?.plan ?? null;
  const proposition = evaluation?.proposition ?? '';
  const selected = new Set(certificate.evidenceIds);
  const choiceById = new Map(certificate.choices.map((choice) => [choice.evidenceId, choice]));
  const admissions = session && plan ? admissionsFor(session, plan, proposition, certificate) : null;

  const evidence: KarExplanationEvidence[] = [];
  const seen = new Set<string>();
  const witnesses = [...certificate.witnesses].sort(witnessOrder);
  for (const witness of witnesses) {
    const key = `${witness.frontier}\0${witness.evidenceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const requirements = admissions
      ? uniqueRequirements(admissions, witness.evidenceId, witness.frontier)
      : [];
    const applicable = admissions ? applicableEvidence(admissions, witness.evidenceId, witness.frontier) : null;
    const necessary = selected.has(witness.evidenceId) && plan && admissions
      ? !coversPlan(plan, admissions, session?.texts ?? new Map(), certificate.evidenceIds.filter((id) => id !== witness.evidenceId))
      : null;
    const relations = witness.path.filter((step) => step.relation).map((step) => step.relation!);
    evidence.push({
      evidenceId: witness.evidenceId,
      frontier: witness.frontier,
      selected: selected.has(witness.evidenceId),
      anchorId: witness.anchorId,
      path: witness.path,
      relations,
      applicable,
      requirements,
      necessaryForSelectedSet: certificate.status === 'SATISFIED' ? necessary : null,
      reason: evidenceReason(certificate.status, selected.has(witness.evidenceId), necessary, requirements),
    });
  }

  const abstention = certificate.status === 'SATISFIED' ? null : {
    status: certificate.status,
    reason: abstentionReason(certificate),
  };
  const bound = certificate.status === 'CLOSURE_BOUND_EXCEEDED' || certificate.status === 'SEARCH_BOUND_EXCEEDED'
    ? { code: certificate.status, reason: abstentionReason(certificate) }
    : null;

  const explanation: KarExplanation = {
    status: certificate.status,
    anchor: {
      mode: plan?.anchor.mode ?? null,
      procedure: plan?.anchor.mode === 'recompute' ? plan.anchor.procedure : null,
      witness: plan?.anchor.mode === 'supplied' ? plan.anchor.witness : null,
      anchorRoot: certificate.roots.anchorRoot,
    },
    grounding: groundingLine(plan),
    frontiers: certificate.frontiers,
    selectedEvidence: evaluation?.selectedEvidence ?? certificate.evidenceIds.map((id) => {
      const object = session?.objects.get(id);
      const row: KarSelectedEvidence = {
        id,
        frontiers: choiceById.get(id)?.frontiers ?? [],
      };
      if (object?.text !== undefined) row.text = object.text;
      if (object?.source !== undefined) row.source = object.source;
      if (object?.metadata !== undefined) row.metadata = object.metadata;
      return row;
    }),
    evidence,
    coverage: certificate.decision.coverage,
    abstention,
    bound,
    roots: certificate.roots,
    lines: [],
  };
  explanation.lines = renderKarExplanation(explanation).split('\n');
  return explanation;
}

export function renderKarExplanation(explanation: KarExplanation): string {
  const lines: string[] = [];
  lines.push(`status ${explanation.status}`);
  if (explanation.grounding) lines.push(explanation.grounding);
  if (explanation.anchor.anchorRoot) lines.push(`anchor-root ${explanation.anchor.anchorRoot}`);
  for (const frontier of FRONTIERS) {
    lines.push(`frontier ${frontier} ${(explanation.frontiers[frontier] ?? []).join(',')}`);
  }
  for (const row of explanation.evidence) {
    lines.push([
      row.selected ? 'selected' : 'frontier-member',
      row.evidenceId,
      `frontier ${row.frontier}`,
      `anchor ${row.anchorId ?? 'lexical'}`,
      `relations ${row.relations.join(',') || 'none'}`,
      `applicable ${row.applicable === null ? 'unknown' : row.applicable}`,
      `requirements ${row.requirements.join(',') || 'none'}`,
      `necessary ${row.necessaryForSelectedSet === null ? 'unknown' : row.necessaryForSelectedSet}`,
      row.reason,
    ].join(' | '));
  }
  if (explanation.abstention) lines.push(`abstention ${explanation.abstention.reason}`);
  if (explanation.roots) {
    for (const name of ['knowledgeRoot', 'semanticRoot', 'queryRoot', 'planRoot', 'anchorRoot', 'frontierRoot', 'frontierWitnessRoot', 'evidenceSetRoot', 'decisionRoot', 'karRoot'] as const) {
      lines.push(`root ${name} ${explanation.roots[name]}`);
    }
  }
  return lines.join('\n');
}

/** Human rendering of an evaluation for the CLI. */
export function renderKarEvaluation(evaluation: KarEvaluation): string {
  const lines: string[] = [];
  lines.push('STATUS');
  lines.push(evaluation.status);
  lines.push('');
  const byId = new Map(evaluation.selectedEvidence.map((row) => [row.id, row]));
  for (const frontier of FRONTIERS) {
    lines.push(FRONTIER_LABEL[frontier]);
    const members = evaluation.frontiers[frontier];
    if (members.length === 0) lines.push('(none)');
    for (const id of members) {
      const row = byId.get(id) ?? evaluation.selectedEvidence.find((item) => item.id === id);
      const source = row?.source ? `  ${row.source}` : '';
      const text = row?.text ? `  ${row.text}` : '';
      lines.push(`${id}${source}${text}`);
    }
    lines.push('');
  }
  lines.push('SELECTED EVIDENCE');
  if (evaluation.selectedEvidence.length === 0) lines.push('(none)');
  for (const row of evaluation.selectedEvidence) {
    lines.push(`${row.id}  ${row.frontiers.join(',') || 'none'}`);
  }
  lines.push('');
  lines.push('KAR ROOT');
  lines.push(evaluation.certificate.roots.karRoot);
  lines.push('');
  lines.push('V5 STATE ROOT');
  lines.push(evaluation.image.stateRoot ?? '(projection session)');
  lines.push('');
  lines.push('KAR KNOWLEDGE ROOT');
  lines.push(evaluation.image.knowledgeRoot);
  return lines.join('\n');
}

function admissionsFor(session: KarSession, plan: Plan, proposition: string, certificate: KarResult) {
  const validated = validatePlan(plan);
  if (!validated || proposition.length === 0 && plan.anchor.mode !== 'supplied') return null;
  const nodeIds = new Set(session.nodeById.keys());
  const resolved = resolveAnchor(proposition, nodeIds, validated.anchor);
  if (resolved.rejected) return null;
  const closed = closeFrontiers(session.graph, validated, resolved.commitment.nodes, session.indexes);
  if (!closed.ok) return null;
  if (canonicalize(closed.witnesses) !== canonicalize(certificate.witnesses)) return null;
  if (canonicalize(closed.frontiers) !== canonicalize(certificate.frontiers)) return null;
  return closed.admissions;
}

function uniqueRequirements(
  admissions: readonly { evidenceId: string; frontier: Frontier; applicable: boolean; requirements: string[] }[],
  evidenceId: string,
  frontier: Frontier,
): string[] {
  const found = new Set<string>();
  for (const admission of admissions) {
    if (admission.evidenceId !== evidenceId || admission.frontier !== frontier || !admission.applicable) continue;
    for (const requirement of admission.requirements) found.add(requirement);
  }
  return [...found].sort();
}

function applicableEvidence(
  admissions: readonly { evidenceId: string; frontier: Frontier; applicable: boolean }[],
  evidenceId: string,
  frontier: Frontier,
): boolean | null {
  const rows = admissions.filter((admission) => admission.evidenceId === evidenceId && admission.frontier === frontier);
  if (rows.length === 0) return null;
  return rows.some((admission) => admission.applicable);
}

function evidenceReason(status: Status, selected: boolean, necessary: boolean | null, requirements: string[]): string {
  if (!selected) return 'left out of the selected set';
  if (status !== 'SATISFIED') return 'listed on a frontier while the decision did not select a set';
  if (necessary === null) return 'selected; necessity was not recomputed';
  if (necessary) {
    return requirements.length > 0
      ? `required for this set; contributes ${requirements.join(',')}`
      : 'required for this set';
  }
  return 'kept by the profile order; the floors still pass without it';
}

function groundingLine(plan: Plan | null): string | null {
  if (!plan) return null;
  if (plan.anchor.mode === 'supplied') {
    const witness = [...plan.anchor.witness]
      .map((row) => `${row.nodeId}${row.queryTerm ? `:${row.queryTerm}` : ''}`)
      .sort()
      .join(',');
    return `grounding supplied ${witness}`;
  }
  return `grounding recompute ${plan.anchor.procedure}`;
}

function abstentionReason(certificate: KarResult): string {
  const status = certificate.status;
  if (status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS') {
    const unmet = FRONTIERS.filter((frontier) => {
      const pair = certificate.decision.coverage[frontier];
      return pair.required > 0 && pair.covered < pair.required;
    });
    const populated = FRONTIERS.filter((frontier) => certificate.frontiers[frontier].length > 0);
    const which = unmet.length > 0 ? unmet.join(',') : 'requirements';
    return `unsatisfied ${which}; returned evidence count ${certificate.evidenceIds.length}; populated frontiers ${populated.join(',') || 'none'}; no top-k fallback`;
  }
  if (status === 'GRAPH_NOT_BOUND') return 'the committed evidence graph is not bound to this knowledge image';
  if (status === 'ANCHOR_REJECTED') return 'the supplied anchor names a node outside the committed graph';
  if (status === 'CLOSURE_BOUND_EXCEEDED') return 'closure exceeded a plan resource bound and the frontiers were emptied';
  if (status === 'SEARCH_BOUND_EXCEEDED') return 'exact cover exceeded maxCoverVisits before a minimum set was proven; the selected set is empty';
  if (status === 'PLAN_INVALID') return 'the plan is not a valid KAR plan';
  if (status === 'GRAPH_INVALID') return 'the image or committed evidence graph is not valid';
  return status;
}

function witnessOrder(left: Witness, right: Witness): number {
  if (left.frontier !== right.frontier) return left.frontier < right.frontier ? -1 : 1;
  if (left.evidenceId !== right.evidenceId) return left.evidenceId < right.evidenceId ? -1 : 1;
  const a = left.anchorId ?? '';
  const b = right.anchorId ?? '';
  return a < b ? -1 : a > b ? 1 : 0;
}

function isEvaluation(value: KarEvaluation | KarResult): value is KarEvaluation {
  return 'certificate' in value && 'selectedEvidence' in value;
}
