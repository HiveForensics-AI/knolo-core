import { parseKiteCertificate, sameCertificate } from './certificate.js';
import { KiteError } from './errors.js';
import {
  createKiteSession,
  evaluateKiteSession,
  type KiteSession,
} from './session.js';
import type { KiteCertificate } from './types.js';

export type KiteVerification =
  | { ok: true; invarianceRoot: string; verdict: KiteCertificate['verdict'] }
  | { ok: false; code: string; message: string };

export async function verifyKiteCertificate(input: {
  image: Uint8Array | ArrayBuffer;
  graph?: unknown;
  contract: unknown;
  rules: unknown;
  completeness?: unknown;
  changes?: unknown;
  bounds?: unknown;
  question?: string;
  asOf?: string | null;
  certificate: unknown;
}): Promise<KiteVerification> {
  try {
    const claimed = parseKiteCertificate(input.certificate);
    const session: KiteSession = createKiteSession({
      image: input.image,
      graph: input.graph,
      contract: input.contract,
      rules: input.rules,
      completeness: input.completeness,
      changes: input.changes,
      bounds: input.bounds,
    });
    const fresh = await evaluateKiteSession(session, {
      question: input.question,
      asOf: input.asOf,
    });
    if (!fresh.certificate) {
      return {
        ok: false,
        code: 'KITE_CERTIFICATE_MISMATCH',
        message: 'An unfinished search is not a certificate.',
      };
    }
    if (!sameCertificate(fresh.certificate, claimed)) {
      return {
        ok: false,
        code: 'KITE_CERTIFICATE_MISMATCH',
        message: 'Certificate does not match a fresh derivation.',
      };
    }
    return {
      ok: true,
      invarianceRoot: fresh.certificate.invarianceRoot,
      verdict: fresh.certificate.verdict,
    };
  } catch (error) {
    if (error instanceof KiteError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: 'KITE_CERTIFICATE_MISMATCH',
      message:
        error instanceof Error
          ? error.message
          : 'Certificate verification failed.',
    };
  }
}
