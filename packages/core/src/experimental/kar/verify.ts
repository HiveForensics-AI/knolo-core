import { canonicalize } from './canonicalize.js';
import { evaluateKarProjection } from './evaluate.js';
import { createKarSession, evaluateKar, type KarSession } from './session.js';
import { KarError, type KarEvaluation, type KarResult, type Status } from './types.js';
import { certificateOf } from './validate.js';
import type { KarImageInput } from './v5.js';

export type KarVerification = {
  ok: boolean;
  code: string;
  reason: string;
  status?: Status;
};

const RESULT_FIELDS = ['version', 'status', 'evidenceIds', 'choices', 'frontiers', 'witnesses', 'decision', 'roots'] as const;
const ROOT_FIELDS = [
  'knowledgeRoot', 'semanticRoot', 'queryRoot', 'planRoot', 'anchorRoot', 'frontierRoot',
  'frontierWitnessRoot', 'evidenceSetRoot', 'decisionRoot', 'karRoot',
] as const;

/**
 * Recompute a certificate from image bytes, the sidecar, the proposition, and the plan.
 * Caller indexes are not accepted. A mounted image is remounted from its bytes.
 */
export function verifyKar(input: {
  image: KarImageInput;
  graph: unknown;
  proposition: string;
  plan: unknown;
  result: unknown;
}): KarVerification {
  let session: KarSession;
  try {
    session = createKarSession({ image: input.image, graph: input.graph });
  } catch (error) {
    if (error instanceof KarError) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
  const actual = evaluateKar(session, { proposition: input.proposition, plan: input.plan });
  return compareClaim(actual, input.result, input.proposition);
}

/** Recompute the frozen research certificate. This is the differential verifier. */
export function verifyKarProjection(image: unknown, graph: unknown, proposition: unknown, plan: unknown, result: unknown): KarVerification {
  const actual = evaluateKarProjection(image, graph, proposition, plan);
  const claimed = certificateOf(result);
  if (!claimed) return { ok: false, code: 'KAR_RESULT_INVALID', reason: 'The claimed result is not a KAR certificate.' };
  if (canonicalize(actual) !== canonicalize(claimed)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: mismatchReason(actual, claimed), status: actual.status };
  }
  return { ok: true, code: 'VERIFIED', reason: '', status: actual.status };
}

function compareClaim(actual: KarEvaluation, claimedInput: unknown, proposition: string): KarVerification {
  const claimed = certificateOf(claimedInput);
  if (!claimed) return { ok: false, code: 'KAR_RESULT_INVALID', reason: 'The claimed result is not a KAR certificate.', status: actual.status };
  if (canonicalize(actual.certificate) !== canonicalize(claimed)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: mismatchReason(actual.certificate, claimed), status: actual.status };
  }
  if (!isRecord(claimedInput) || !isRecord(claimedInput.certificate)) {
    return { ok: true, code: 'VERIFIED', reason: '', status: actual.status };
  }
  const envelope = claimedInput;
  if (envelope.experimental !== undefined && envelope.experimental !== true) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'experimental flag mismatch', status: actual.status };
  }
  if (typeof envelope.proposition === 'string' && envelope.proposition !== proposition) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'proposition mismatch', status: actual.status };
  }
  if (envelope.plan !== undefined && canonicalize(envelope.plan) !== canonicalize(actual.plan)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'plan mismatch', status: actual.status };
  }
  if (envelope.image !== undefined && canonicalize(envelope.image) !== canonicalize(actual.image)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'image identity mismatch', status: actual.status };
  }
  if (envelope.selectedEvidence !== undefined && canonicalize(envelope.selectedEvidence) !== canonicalize(actual.selectedEvidence)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'selected evidence mismatch', status: actual.status };
  }
  if (envelope.code !== undefined && envelope.code !== actual.code) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'status code mismatch', status: actual.status };
  }
  if (envelope.status !== undefined && envelope.status !== actual.status) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'status mismatch', status: actual.status };
  }
  if (envelope.frontiers !== undefined && canonicalize(envelope.frontiers) !== canonicalize(actual.frontiers)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'frontier mismatch', status: actual.status };
  }
  if (envelope.witnesses !== undefined && canonicalize(envelope.witnesses) !== canonicalize(actual.witnesses)) {
    return { ok: false, code: 'KAR_RESULT_MISMATCH', reason: 'witness mismatch', status: actual.status };
  }
  return { ok: true, code: 'VERIFIED', reason: '', status: actual.status };
}

function mismatchReason(actual: KarResult, claimed: KarResult): string {
  for (const field of RESULT_FIELDS) {
    if (canonicalize(actual[field]) === canonicalize(claimed[field])) continue;
    if (field === 'roots') {
      for (const root of ROOT_FIELDS) {
        if (actual.roots[root] !== claimed.roots[root]) return `root mismatch ${root}`;
      }
    }
    if (field === 'status') return `status ${actual.status} did not match ${claimed.status}`;
    return `field mismatch ${field}`;
  }
  return 'certificate mismatch';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
