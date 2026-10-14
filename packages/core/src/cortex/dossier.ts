import { digest } from '../experimental/kar/canonicalize.js';
import { CortexError } from './errors.js';
import { CORTEX_DOSSIER_FORMAT, type CortexDossier, type CortexTraceV1 } from './types.js';
import { validateCortexTrace } from './validate.js';

/**
 * Package a trace. `verified: true` means the dossier roots match the trace.
 * It does not mean the answer is true.
 */
export function createCortexDossier(trace: CortexTraceV1): CortexDossier {
  const valid = validateCortexTrace(trace);
  const body = {
    format: CORTEX_DOSSIER_FORMAT,
    question: valid.question,
    answer: valid.answer,
    selectedEvidence: valid.selectedEvidence,
    citations: valid.answer.citations,
    karEvaluations: valid.karEvaluations ?? [],
    gaps: valid.answer.gaps,
    traceRoot: valid.receipt.traceRoot,
    answerRoot: valid.receipt.answerRoot,
    evidenceRoot: valid.receipt.evidenceRoot,
    verified: true as const,
  };
  return { ...body, dossierRoot: digest(body) };
}

export function verifyCortexDossier(dossier: unknown, trace: CortexTraceV1): { ok: true } | { ok: false; code: string; message: string } {
  try {
    const valid = validateCortexTrace(trace);
    if (!dossier || typeof dossier !== 'object') {
      return { ok: false, code: 'CORTEX_TRACE_INVALID', message: 'Dossier must be an object.' };
    }
    const claimed = dossier as CortexDossier;
    if (claimed.format !== CORTEX_DOSSIER_FORMAT) {
      return { ok: false, code: 'CORTEX_TRACE_INVALID', message: 'Unsupported dossier format.' };
    }
    const { dossierRoot, ...body } = claimed;
    if (digest(body) !== dossierRoot) {
      return { ok: false, code: 'CORTEX_ROOT_MISMATCH', message: 'Dossier root does not match the dossier body.' };
    }
    if (body.traceRoot !== valid.receipt.traceRoot || body.answerRoot !== valid.receipt.answerRoot || body.evidenceRoot !== valid.receipt.evidenceRoot) {
      return { ok: false, code: 'CORTEX_ROOT_MISMATCH', message: 'Dossier roots do not match the trace.' };
    }
    if (body.verified !== true) {
      return { ok: false, code: 'CORTEX_TRACE_INVALID', message: 'Dossier verification flag is not set.' };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof CortexError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: 'CORTEX_TRACE_INVALID', message: error instanceof Error ? error.message : 'Dossier verification failed.' };
  }
}
