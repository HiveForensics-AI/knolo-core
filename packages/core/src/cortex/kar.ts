import { digest } from '../experimental/kar/canonicalize.js';
import { evaluateKar } from '../experimental/kar/session.js';
import { KarError } from '../experimental/kar/types.js';
import { CortexError } from './errors.js';
import type { CortexSession } from './session.js';
import type { KarResultRefV1 } from './types.js';

export function evaluateCortexKar(session: CortexSession, proposition: string): KarResultRefV1 {
  if (!session.kar || session.plan === undefined || !session.planDigest) {
    throw new CortexError('CORTEX_KAR_UNBOUND', 'prove_or_abstain requires a bound graph and a plan.', 'kar');
  }
  try {
    const evaluation = evaluateKar(session.kar, { proposition, plan: session.plan });
    return {
      proposition,
      status: evaluation.status,
      karRoot: evaluation.certificate.roots.karRoot,
      evidenceSetRoot: evaluation.certificate.roots.evidenceSetRoot,
      planDigest: session.planDigest,
    };
  } catch (error) {
    if (error instanceof CortexError) throw error;
    const message = error instanceof KarError || error instanceof Error ? error.message : 'KAR evaluation failed.';
    throw new CortexError('CORTEX_KAR_UNBOUND', message, 'kar', error);
  }
}

export function planDigestOf(plan: unknown): string {
  return digest(plan);
}
