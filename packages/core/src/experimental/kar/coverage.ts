import { resolveAnchor } from './anchor.js';
import { canonicalize, digest } from './canonicalize.js';
import { closeFrontiers, type Admission } from './closure.js';
import { floorMicros } from './cover.js';
import { karDossierStatusStatement } from './dossier.js';
import { validatePlan } from './plan.js';
import { createKarSession, evaluateKar, type KarSession } from './session.js';
import {
  FRONTIERS,
  KarError,
  type Decision,
  type Frontier,
  type KarResult,
  type Plan,
  type Status,
} from './types.js';
import type { KarVerification } from './verify.js';
import type { KarImageInput } from './v5.js';

/**
 * Packaging over frozen kar-1-research-1 evaluations.
 * CoverageRoot is not an input to KARRoot and is not written into a KarResult.
 * The second closure pass is read-only: its admissions are not passed to selectCover.
 */

export const KAR_COVERAGE_FORMAT = 'kar-coverage-report-1' as const;
export const KAR_COVERAGE_MAX_CASES = 32 as const;

export type KarCoverageDisposition = 'met' | 'gap' | 'blocked';

export type KarCoverageSlotState =
  | 'met'
  | 'unadmitted'
  | 'admitted-but-uncovered'
  | 'not-required'
  | 'not-evaluated';

export type KarCoverageSlot = {
  frontier: Frontier;
  slot: KarCoverageSlotState;
  unadmittedTokens: string[];
};

export type KarCoverageCaseInput = {
  id: string;
  proposition: string;
  plan: unknown;
};

export type KarCoverageDomainPack = {
  id: string;
  version: string;
  root: string;
};

export type KarCoverageCase = {
  id: string;
  proposition: string;
  status: Status;
  disposition: KarCoverageDisposition;
  statement: string;
  planRoot: string;
  karRoot: string;
  slots: KarCoverageSlot[];
  /** Copied from the certificate, including covered 0 on an unsatisfied decision. */
  coverage: Decision['coverage'];
  certificate: KarResult;
};

export type KarCoverageManifest = {
  format: typeof KAR_COVERAGE_FORMAT;
  coverageRoot: string;
  semanticRoot: string;
  knowledgeRoot: string;
  stateRoot: string | null;
  counts: { cases: number; met: number; gap: number; blocked: number };
  caseRoots: { id: string; planRoot: string; karRoot: string; disposition: KarCoverageDisposition }[];
  maxCases: typeof KAR_COVERAGE_MAX_CASES;
  domainPack: KarCoverageDomainPack | null;
};

export type KarCoverageReport = {
  format: typeof KAR_COVERAGE_FORMAT;
  experimental: true;
  image: {
    stateRoot: string | null;
    knowledgeRoot: string;
    objectRoot: string | null;
    commitDigest: string | null;
  };
  semanticRoot: string;
  domainPack: KarCoverageDomainPack | null;
  maxCases: typeof KAR_COVERAGE_MAX_CASES;
  counts: KarCoverageManifest['counts'];
  cases: KarCoverageCase[];
  manifest: KarCoverageManifest;
};

export function karCoverageStatement(status: Status): string {
  return karDossierStatusStatement(status);
}

/**
 * Evaluate every case on one session.
 * Case order does not change CoverageRoot. Rows are emitted sorted by id.
 */
export function createKarCoverage(input: {
  image: KarImageInput;
  graph: unknown;
  cases: readonly KarCoverageCaseInput[];
  domainPack?: KarCoverageDomainPack | null;
}): KarCoverageReport {
  const domainPack = readDomainPack(input.domainPack);
  const cases = normalizeCases(input.cases);
  const session = createKarSession({ image: input.image, graph: input.graph });
  const rows = cases.map((item) => evaluateCase(session, item));
  const counts = countRows(rows);
  const image = {
    stateRoot: session.image.stateRoot,
    knowledgeRoot: session.image.knowledgeRoot,
    objectRoot: session.image.objectRoot,
    commitDigest: session.image.commitDigest,
  };
  const coverageRoot = digest({
    domain: KAR_COVERAGE_FORMAT,
    format: KAR_COVERAGE_FORMAT,
    image,
    semanticRoot: session.roots.semanticRoot,
    domainPack,
    maxCases: KAR_COVERAGE_MAX_CASES,
    cases: rows.map((row) => ({
      id: row.id,
      proposition: row.proposition,
      status: row.status,
      disposition: row.disposition,
      planRoot: row.planRoot,
      karRoot: row.karRoot,
      slots: row.slots.map((slot) => ({
        frontier: slot.frontier,
        slot: slot.slot,
        unadmittedTokens: slot.unadmittedTokens,
      })),
    })),
  });
  const manifest: KarCoverageManifest = {
    format: KAR_COVERAGE_FORMAT,
    coverageRoot,
    semanticRoot: session.roots.semanticRoot,
    knowledgeRoot: image.knowledgeRoot,
    stateRoot: image.stateRoot,
    counts,
    caseRoots: rows.map((row) => ({
      id: row.id,
      planRoot: row.planRoot,
      karRoot: row.karRoot,
      disposition: row.disposition,
    })),
    maxCases: KAR_COVERAGE_MAX_CASES,
    domainPack,
  };
  return {
    format: KAR_COVERAGE_FORMAT,
    experimental: true,
    image,
    semanticRoot: session.roots.semanticRoot,
    domainPack,
    maxCases: KAR_COVERAGE_MAX_CASES,
    counts,
    cases: rows,
    manifest,
  };
}

/**
 * Recompute the report from the image, the sidecar, and the case inputs.
 * domainPack comes from those inputs. A claimed report cannot supply its own root.
 */
export function verifyKarCoverage(input: {
  image: KarImageInput;
  graph: unknown;
  cases: unknown;
  domainPack?: KarCoverageDomainPack | null;
  manifest: unknown;
  report: unknown;
  rendering?: string;
}): KarVerification {
  let actual: KarCoverageReport;
  try {
    if (!Array.isArray(input.cases)) {
      return { ok: false, code: 'KAR_COVERAGE_INVALID', reason: 'Coverage cases must be an array.' };
    }
    actual = createKarCoverage({
      image: input.image,
      graph: input.graph,
      cases: input.cases as KarCoverageCaseInput[],
      domainPack: input.domainPack,
    });
  } catch (error) {
    if (error instanceof KarError) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
  if (canonicalize(input.manifest) !== canonicalize(actual.manifest)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'coverage manifest mismatch' };
  }
  if (canonicalize(input.report) !== canonicalize(actual)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'coverage report mismatch' };
  }
  if (input.rendering !== undefined && input.rendering !== renderKarCoverage(actual)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'coverage rendering mismatch' };
  }
  return { ok: true, code: 'VERIFIED', reason: '' };
}

export function renderKarCoverage(report: KarCoverageReport): string {
  const lines: string[] = [];
  lines.push('EVIDENCE COVERAGE');
  lines.push(`format ${report.format}`);
  lines.push(`CoverageRoot ${report.manifest.coverageRoot}`);
  lines.push(`SemanticRoot ${report.semanticRoot}`);
  lines.push(`KnowledgeRoot ${report.image.knowledgeRoot}`);
  if (report.image.stateRoot) lines.push(`V5StateRoot ${report.image.stateRoot}`);
  lines.push(report.domainPack
    ? `DomainPack ${report.domainPack.id} ${report.domainPack.version} ${report.domainPack.root}`
    : 'DomainPack (none)');
  lines.push(`cases ${report.counts.cases} met ${report.counts.met} gap ${report.counts.gap} blocked ${report.counts.blocked}`);
  for (const row of report.cases) {
    lines.push('');
    lines.push(`CASE ${row.id}`);
    lines.push('PROPOSITION');
    lines.push(row.proposition);
    lines.push('STATUS');
    lines.push(row.status);
    lines.push(row.statement);
    lines.push(`DISPOSITION ${row.disposition}`);
    lines.push(`PlanRoot ${row.planRoot}`);
    lines.push(`KARRoot ${row.karRoot}`);
    lines.push('SLOTS');
    for (const slot of row.slots) {
      const tokens = slot.unadmittedTokens.length > 0 ? ` ${slot.unadmittedTokens.join(' ')}` : '';
      lines.push(`${slot.frontier} ${slot.slot}${tokens}`);
    }
    lines.push('COVERAGE');
    for (const frontier of FRONTIERS) {
      const pair = row.coverage[frontier];
      lines.push(`${frontier} covered ${pair.covered} required ${pair.required}`);
    }
  }
  lines.push('');
  lines.push('HOW TO VERIFY');
  lines.push('Recompute this report from the Knowledge Image, the Committed Evidence Graph, and the cases.');
  lines.push('knolo kar coverage verify <coverage-directory>');
  lines.push('A change to the report, the manifest, or this rendering fails closed.');
  lines.push('met means the declared evidence requirements were satisfied. It does not prove the proposition.');
  lines.push('gap means those requirements were not satisfied. It does not mean the proposition is false.');
  lines.push('blocked means this plan did not decide. It is not a knowledge gap.');
  lines.push('This report is not a completeness claim.');
  lines.push('');
  return lines.join('\n');
}

function evaluateCase(session: KarSession, item: KarCoverageCaseInput): KarCoverageCase {
  const evaluation = evaluateKar(session, { proposition: item.proposition, plan: item.plan });
  const disposition = dispositionOf(evaluation.status);
  return {
    id: item.id,
    proposition: item.proposition,
    status: evaluation.status,
    disposition,
    statement: karCoverageStatement(evaluation.status),
    planRoot: evaluation.certificate.roots.planRoot,
    karRoot: evaluation.certificate.roots.karRoot,
    slots: slotsFor(session, item.proposition, item.plan, evaluation.status, disposition),
    coverage: evaluation.certificate.decision.coverage,
    certificate: evaluation.certificate,
  };
}

function slotsFor(
  session: KarSession,
  proposition: string,
  planInput: unknown,
  status: Status,
  disposition: KarCoverageDisposition,
): KarCoverageSlot[] {
  const plan = validatePlan(planInput);
  if (!plan || !closureDecided(status)) return notEvaluatedSlots();
  const resolved = resolveAnchor(proposition, session.nodeById, plan.anchor);
  if (plan.anchor.mode === 'recompute' && plan.anchor.procedure !== 'member-id-v1') return notEvaluatedSlots();
  if (resolved.rejected) return notEvaluatedSlots();
  const closed = closeFrontiers(session.graph, plan, resolved.commitment.nodes, session.indexes);
  if (!closed.ok) return notEvaluatedSlots();
  return FRONTIERS.map((frontier) => slotFor(frontier, plan, closed.admissions, disposition, status));
}

function slotFor(
  frontier: Frontier,
  plan: Plan,
  admissions: readonly Admission[],
  disposition: KarCoverageDisposition,
  status: Status,
): KarCoverageSlot {
  const required = plan.requirements[frontier];
  const floor = floorMicros(plan.floors[frontier]) ?? 0;
  // An empty requirements-mode list demands nothing, whatever the floor string says.
  if (required.length === 0 && (floor === 0 || plan.coverageMode === 'requirements')) {
    return { frontier, slot: 'not-required', unadmittedTokens: [] };
  }
  if (disposition === 'met') return { frontier, slot: 'met', unadmittedTokens: [] };
  const unadmittedTokens = missingTokens(required, admittedTokens(admissions, frontier));
  if (required.length === 0) {
    const applicable = admissions.some((admission) => admission.frontier === frontier && admission.applicable === true);
    if (!applicable) return { frontier, slot: 'unadmitted', unadmittedTokens: [] };
    return { frontier, slot: 'admitted-but-uncovered', unadmittedTokens: [] };
  }
  if (unadmittedTokens.length > 0) return { frontier, slot: 'unadmitted', unadmittedTokens };
  if (disposition === 'gap' || status === 'SEARCH_BOUND_EXCEEDED') {
    return { frontier, slot: 'admitted-but-uncovered', unadmittedTokens: [] };
  }
  return { frontier, slot: 'not-evaluated', unadmittedTokens: [] };
}

function admittedTokens(admissions: readonly Admission[], frontier: Frontier): Set<string> {
  const tokens = new Set<string>();
  for (const admission of admissions) {
    if (admission.frontier !== frontier || admission.applicable !== true) continue;
    for (const token of admission.requirements) tokens.add(token);
  }
  return tokens;
}

function missingTokens(required: readonly string[], admitted: ReadonlySet<string>): string[] {
  const missing = new Set<string>();
  for (const token of required) {
    if (!admitted.has(token)) missing.add(token);
  }
  return [...missing].sort(compareText);
}

function notEvaluatedSlots(): KarCoverageSlot[] {
  return FRONTIERS.map((frontier) => ({ frontier, slot: 'not-evaluated', unadmittedTokens: [] }));
}

function closureDecided(status: Status): boolean {
  return status === 'SATISFIED'
    || status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS'
    || status === 'SEARCH_BOUND_EXCEEDED';
}

function dispositionOf(status: Status): KarCoverageDisposition {
  if (status === 'SATISFIED') return 'met';
  if (status === 'UNSATISFIED_EVIDENCE_REQUIREMENTS') return 'gap';
  return 'blocked';
}

function countRows(rows: readonly KarCoverageCase[]): KarCoverageManifest['counts'] {
  const counts = { cases: rows.length, met: 0, gap: 0, blocked: 0 };
  for (const row of rows) counts[row.disposition] += 1;
  return counts;
}

function normalizeCases(input: readonly KarCoverageCaseInput[]): KarCoverageCaseInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw invalid('cases', 'Coverage requires at least one case.');
  }
  if (input.length > KAR_COVERAGE_MAX_CASES) {
    throw invalid('cases', `Coverage accepts at most ${KAR_COVERAGE_MAX_CASES} cases.`);
  }
  const seen = new Set<string>();
  const cases: KarCoverageCaseInput[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalid(`cases[${index}]`, 'Coverage case must be an object.');
    }
    if (typeof item.id !== 'string' || !validToken(item.id, 128)) {
      throw invalid(`cases[${index}].id`, 'Coverage case id must be a token of at most 128 characters.');
    }
    if (seen.has(item.id)) throw invalid(`cases[${index}].id`, `Coverage case id "${item.id}" is duplicated.`);
    seen.add(item.id);
    if (typeof item.proposition !== 'string' || item.proposition.length === 0 || hasControl(item.proposition)) {
      throw invalid(`cases[${index}].proposition`, 'Coverage proposition must be a non-empty string without control characters.');
    }
    cases.push({ id: item.id, proposition: item.proposition, plan: item.plan });
  }
  cases.sort((left, right) => compareText(left.id, right.id));
  return cases;
}

function readDomainPack(value: unknown): KarCoverageDomainPack | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !exactKeys(value, ['id', 'version', 'root'])) {
    throw invalid('domainPack', 'Domain pack identity accepts only id, version, and root.');
  }
  if (typeof value.id !== 'string' || !validToken(value.id, 128)) {
    throw invalid('domainPack.id', 'Domain pack id must be a token of at most 128 characters.');
  }
  if (typeof value.version !== 'string' || !validToken(value.version, 128)) {
    throw invalid('domainPack.version', 'Domain pack version must be a token of at most 128 characters.');
  }
  if (typeof value.root !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(value.root)) {
    throw invalid('domainPack.root', 'Domain pack root must be a sha256 digest.');
  }
  return { id: value.id, version: value.version, root: value.root };
}

function invalid(path: string, message: string): KarError {
  return new KarError('KAR_COVERAGE_INVALID', message, [{ code: 'KAR_COVERAGE_INVALID', path, message }]);
}

function validToken(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && !hasControl(value) && !/\s/u.test(value);
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  if (present.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
