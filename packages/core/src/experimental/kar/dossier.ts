import { digest } from './canonicalize.js';
import { explainKarResult } from './explain.js';
import { createKarSession, evaluateKar, type KarSession } from './session.js';
import {
  type Decision,
  type Frontier,
  type KarEvaluation,
  type KarResult,
  type KarSelectedEvidence,
  type Roots,
  type Status,
  type Witness,
} from './types.js';
import type { KarVerification } from './verify.js';
import { verifyKar } from './verify.js';
import { canonicalize } from './canonicalize.js';
import type { KarImageInput } from './v5.js';

/**
 * Packaging over a frozen kar-1-research-1 evaluation.
 * A dossier does not create a semantic root and does not change retrieval.
 */

export const KAR_DOSSIER_FORMAT = 'kar-evidence-dossier-1' as const;

export type KarDossierManifest = {
  format: typeof KAR_DOSSIER_FORMAT;
  queryDigest: string;
  image: {
    stateRoot: string | null;
    knowledgeRoot: string;
    objectRoot: string | null;
    commitDigest: string | null;
  };
  semanticRoot: string;
  planRoot: string;
  karRoot: string;
  resultDigest: string;
};

export type KarDossierFrontier = {
  frontier: Frontier;
  evidenceIds: string[];
  evidence: KarSelectedEvidence[];
};

export type KarDossier = {
  format: typeof KAR_DOSSIER_FORMAT;
  experimental: true;
  proposition: string;
  status: Status;
  statusStatement: string;
  support: KarDossierFrontier;
  opposition: KarDossierFrontier;
  qualification: KarDossierFrontier;
  temporal: KarDossierFrontier;
  authority: KarDossierFrontier;
  selectedEvidence: KarSelectedEvidence[];
  anchor: {
    mode: string | null;
    procedure: string | null;
    witness: { nodeId: string; queryTerm?: string }[] | null;
    anchorRoot: string | null;
  };
  witnesses: Witness[];
  coverage: Decision['coverage'] | null;
  roots: Roots & { stateRoot: string | null };
  whySelected: string[];
  certificate: KarResult;
  manifest: KarDossierManifest;
  evaluation: KarEvaluation;
};

export function karDossierStatusStatement(status: Status): string {
  if (status === 'SATISFIED') return 'Evidence requirements satisfied';
  if (status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS') return 'Evidence requirements not satisfied';
  return `Evaluation did not decide evidence requirements: ${status}`;
}

/**
 * Build one dossier for one proposition.
 * Uses the frozen session, evaluation, explanation, and certificate only.
 */
export function createKarDossier(input: {
  image: KarImageInput;
  graph: unknown;
  plan: unknown;
  proposition: string;
}): KarDossier {
  const session = createKarSession({ image: input.image, graph: input.graph });
  const evaluation = evaluateKar(session, { proposition: input.proposition, plan: input.plan });
  return dossierFromEvaluation(session, evaluation);
}

export function renderKarDossier(dossier: KarDossier): string {
  const lines: string[] = [];
  lines.push('PROPOSITION');
  lines.push(dossier.proposition);
  lines.push('');
  lines.push('STATUS');
  lines.push(dossier.status);
  lines.push(dossier.statusStatement);
  lines.push('');
  lines.push('SELECTED EVIDENCE');
  pushEvidence(lines, dossier.selectedEvidence);
  lines.push('');
  lines.push('SUPPORT');
  pushEvidence(lines, dossier.support.evidence);
  lines.push('');
  lines.push('OPPOSITION');
  pushEvidence(lines, dossier.opposition.evidence);
  lines.push('');
  lines.push('QUALIFICATIONS');
  pushEvidence(lines, dossier.qualification.evidence);
  lines.push('');
  lines.push('TEMPORAL/APPLICABILITY');
  pushEvidence(lines, dossier.temporal.evidence);
  lines.push('');
  lines.push('AUTHORITY');
  pushEvidence(lines, dossier.authority.evidence);
  lines.push('');
  lines.push('WHY THESE ITEMS WERE SELECTED');
  if (dossier.whySelected.length === 0) lines.push('(none)');
  for (const reason of dossier.whySelected) lines.push(reason);
  lines.push('');
  lines.push('CERTIFICATE ROOTS');
  lines.push(`KnowledgeRoot ${dossier.roots.knowledgeRoot}`);
  lines.push(`SemanticRoot ${dossier.roots.semanticRoot}`);
  lines.push(`PlanRoot ${dossier.roots.planRoot}`);
  lines.push(`AnchorRoot ${dossier.roots.anchorRoot}`);
  lines.push(`FrontierRoot ${dossier.roots.frontierRoot}`);
  lines.push(`EvidenceSetRoot ${dossier.roots.evidenceSetRoot}`);
  lines.push(`DecisionRoot ${dossier.roots.decisionRoot}`);
  lines.push(`KARRoot ${dossier.roots.karRoot}`);
  lines.push(`QueryRoot ${dossier.roots.queryRoot}`);
  lines.push(`FrontierWitnessRoot ${dossier.roots.frontierWitnessRoot}`);
  if (dossier.roots.stateRoot) lines.push(`V5StateRoot ${dossier.roots.stateRoot}`);
  lines.push('');
  lines.push('HOW TO VERIFY');
  lines.push('Recompute the frozen KAR certificate from the Knowledge Image, the Committed Evidence Graph, the plan, and the proposition.');
  lines.push('knolo kar dossier verify <dossier-directory>');
  lines.push('A change to the certificate, manifest, selected evidence, or this rendering fails closed.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Recompute the dossier and compare committed fields.
 * Filesystem access stays in the caller.
 */
export function verifyKarDossier(input: {
  image: KarImageInput;
  graph: unknown;
  plan: unknown;
  proposition: string;
  manifest: unknown;
  certificate: unknown;
  evaluation?: unknown;
  evidenceMarkdown?: string;
}): KarVerification {
  const verdict = verifyKar({
    image: input.image,
    graph: input.graph,
    proposition: input.proposition,
    plan: input.plan,
    result: input.certificate,
  });
  if (!verdict.ok) return verdict;
  let actual: KarDossier;
  try {
    actual = createKarDossier(input);
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'KAR_RESULT_MISMATCH';
    const reason = error instanceof Error ? error.message : 'Dossier recomputation failed.';
    return { ok: false, code, reason };
  }
  if (canonicalize(input.manifest) !== canonicalize(actual.manifest)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'dossier manifest mismatch', status: actual.status };
  }
  if (canonicalize(input.certificate) !== canonicalize(actual.certificate)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'dossier certificate mismatch', status: actual.status };
  }
  if (input.evaluation !== undefined && canonicalize(input.evaluation) !== canonicalize(actual.evaluation)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'dossier result mismatch', status: actual.status };
  }
  if (input.evidenceMarkdown !== undefined && input.evidenceMarkdown !== renderKarDossier(actual)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'dossier rendering mismatch', status: actual.status };
  }
  return { ok: true, code: 'VERIFIED', reason: '', status: actual.status };
}

function dossierFromEvaluation(session: KarSession, evaluation: KarEvaluation): KarDossier {
  const explanation = explainKarResult(session, evaluation);
  const byId = new Map(evaluation.selectedEvidence.map((row) => [row.id, row]));
  const whySelected = explanation.evidence
    .filter((row) => row.selected)
    .map((row) => `${row.evidenceId} ${row.frontier} ${row.reason}`);
  const manifest: KarDossierManifest = {
    format: KAR_DOSSIER_FORMAT,
    queryDigest: digest(evaluation.proposition),
    image: {
      stateRoot: evaluation.image.stateRoot,
      knowledgeRoot: evaluation.image.knowledgeRoot,
      objectRoot: evaluation.image.objectRoot,
      commitDigest: evaluation.image.commitDigest,
    },
    semanticRoot: evaluation.certificate.roots.semanticRoot,
    planRoot: evaluation.certificate.roots.planRoot,
    karRoot: evaluation.certificate.roots.karRoot,
    resultDigest: digest(evaluation.certificate),
  };
  return {
    format: KAR_DOSSIER_FORMAT,
    experimental: true,
    proposition: evaluation.proposition,
    status: evaluation.status,
    statusStatement: karDossierStatusStatement(evaluation.status),
    support: frontierSection('F_S', evaluation, byId, session),
    opposition: frontierSection('F_O', evaluation, byId, session),
    qualification: frontierSection('F_Q', evaluation, byId, session),
    temporal: frontierSection('F_T', evaluation, byId, session),
    authority: frontierSection('F_A', evaluation, byId, session),
    selectedEvidence: evaluation.selectedEvidence,
    anchor: explanation.anchor,
    witnesses: evaluation.witnesses,
    coverage: evaluation.certificate.decision.coverage,
    roots: { ...evaluation.certificate.roots, stateRoot: evaluation.image.stateRoot },
    whySelected,
    certificate: evaluation.certificate,
    manifest,
    evaluation,
  };
}

function frontierSection(
  frontier: Frontier,
  evaluation: KarEvaluation,
  byId: Map<string, KarSelectedEvidence>,
  session: KarSession,
): KarDossierFrontier {
  const evidenceIds = evaluation.frontiers[frontier];
  const evidence = evidenceIds.map((id) => byId.get(id) ?? evidenceRow(session, id, [frontier]));
  return { frontier, evidenceIds, evidence };
}

function evidenceRow(session: KarSession, id: string, frontiers: Frontier[]): KarSelectedEvidence {
  const object = session.objects.get(id);
  const row: KarSelectedEvidence = { id, frontiers };
  const text = object?.text ?? session.texts.get(id);
  if (text !== undefined) row.text = text;
  if (object?.source !== undefined) row.source = object.source;
  if (object?.metadata !== undefined) row.metadata = object.metadata;
  return row;
}

function pushEvidence(lines: string[], rows: readonly KarSelectedEvidence[]): void {
  if (rows.length === 0) {
    lines.push('(none)');
    return;
  }
  for (const row of rows) {
    const source = row.source ? `  source ${row.source}` : '';
    const frontiers = row.frontiers.length > 0 ? `  frontiers ${row.frontiers.join(',')}` : '';
    lines.push(`${row.id}${source}${frontiers}`);
    if (row.text !== undefined) lines.push(row.text);
  }
}
