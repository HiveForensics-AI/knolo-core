import { evaluateCortexKar } from './kar.js';
import { createCortexSession, type CortexSession } from './session.js';
import type { CortexTraceV1, CortexVerification } from './types.js';
import { validateCortexTrace } from './validate.js';
import { CortexError } from './errors.js';
import { retrieveHits } from './retrieve.js';

/**
 * Recompute roots, evidence identity, retrieval receipts, and KAR refs.
 * A successful result means the trace matches the image. It does not mean the answer is true.
 */
export async function verifyCortexAnswer(input: {
  image: Uint8Array | ArrayBuffer;
  graph?: unknown;
  question: string;
  result: unknown;
  retriever?: CortexSession['retriever'];
  queryEmbedding?: Float32Array;
}): Promise<CortexVerification> {
  try {
    const trace = validateCortexTrace(input.result);
    if (input.question.trim().replace(/\s+/gu, ' ') !== trace.question) {
      return { ok: false, code: 'CORTEX_ROOT_MISMATCH', message: 'Question does not match the trace.' };
    }
    const session = await createCortexSession({
      image: input.image,
      graph: input.graph,
      retriever: input.retriever,
      policy: trace.policy,
      ...(trace.karPlan !== undefined ? { plan: trace.karPlan } : {}),
    });
    if (!sameImage(session.image, trace.image)) {
      return { ok: false, code: 'CORTEX_IMAGE_INVALID', message: 'Mounted image identity does not match the trace.' };
    }
    if ((trace.karEvaluations?.length ?? 0) > 0 && input.graph === undefined) {
      return { ok: false, code: 'CORTEX_KAR_UNBOUND', message: 'KAR references require the graph.' };
    }
    const selected = new Map<string, { score: number; excerpt: string; sourceDigest: string; source?: string }>();
    for (const round of trace.rounds) {
      const retrieved = await retrieveHits(session.mounted, trace.policy, round.query, input.retriever, input.queryEmbedding);
      const ids = retrieved.hits.map((hit) => hit.id);
      if (ids.join('\u0001') !== round.lexicalHitIds.join('\u0001') || !sameReceipt(retrieved.receipt, round.queryReceipt)) {
        return { ok: false, code: 'CORTEX_RECEIPT_MISMATCH', message: `Retrieval round ${round.round} does not replay.` };
      }
      const hits = new Map(retrieved.hits.map((hit) => [hit.id, hit]));
      for (const id of round.selectedIds) {
        const hit = hits.get(id);
        if (!hit) {
          return { ok: false, code: 'CORTEX_EVIDENCE_UNBOUND', message: `Selected id ${id} was not retrieved in round ${round.round}.` };
        }
        if (!selected.has(id)) selected.set(id, hit);
      }
    }
    for (const evidence of trace.selectedEvidence) {
      const hit = selected.get(evidence.id);
      if (!hit) {
        return { ok: false, code: 'CORTEX_EVIDENCE_UNBOUND', message: `Evidence ${evidence.id} was not selected by a replayed round.` };
      }
      if (hit.sourceDigest !== evidence.sourceDigest || hit.excerpt !== evidence.excerpt || (hit.source ?? '') !== (evidence.source ?? '')) {
        return { ok: false, code: 'CORTEX_EVIDENCE_UNBOUND', message: `Evidence ${evidence.id} does not match the replayed hit.` };
      }
      if (hit.score !== evidence.score) {
        return { ok: false, code: 'CORTEX_EVIDENCE_UNBOUND', message: `Evidence ${evidence.id} score does not match retrieval.` };
      }
    }
    if (trace.karEvaluations && trace.karEvaluations.length > 0) {
      for (const ref of trace.karEvaluations) {
        const actual = evaluateCortexKar(session, ref.proposition);
        if (actual.status !== ref.status || actual.karRoot !== ref.karRoot || actual.evidenceSetRoot !== ref.evidenceSetRoot || actual.planDigest !== ref.planDigest) {
          return { ok: false, code: 'CORTEX_KAR_UNBOUND', message: 'KAR reference does not match a fresh evaluation.' };
        }
      }
    }
    return {
      ok: true,
      traceRoot: trace.receipt.traceRoot,
      answerRoot: trace.receipt.answerRoot,
      evidenceRoot: trace.receipt.evidenceRoot,
    };
  } catch (error) {
    if (error instanceof CortexError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: 'CORTEX_TRACE_INVALID', message: error instanceof Error ? error.message : 'Trace verification failed.' };
  }
}

function sameImage(actual: CortexTraceV1['image'], expected: CortexTraceV1['image']): boolean {
  return actual.kind === expected.kind
    && actual.stateRoot === expected.stateRoot
    && actual.commitDigest === expected.commitDigest
    && actual.knowledgeRoot === expected.knowledgeRoot;
}

function sameReceipt(actual: CortexTraceV1['rounds'][number]['queryReceipt'], expected: CortexTraceV1['rounds'][number]['queryReceipt']): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
