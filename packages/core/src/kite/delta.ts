import { parseKiteCertificate } from './certificate.js';
import { KiteError } from './errors.js';
import { parseKiteDelta } from './rules.js';
import type { KiteSessionResult, KiteVerdict } from './types.js';

export function reviewKiteDelta(input: {
  certificate: unknown;
  delta: unknown;
  next: KiteSessionResult;
}): {
  invalidated: boolean;
  verdict: KiteVerdict;
  fullVerdict: KiteVerdict;
  same: boolean;
} {
  const certificate = parseKiteCertificate(input.certificate);
  const delta = parseKiteDelta(input.delta);
  if (delta.fromStateRoot !== certificate.stateRoot) {
    throw new KiteError(
      'KITE_DELTA_INVALID',
      'Delta fromStateRoot does not match the certificate.',
      'delta.fromStateRoot'
    );
  }
  if (delta.toStateRoot !== input.next.stateRoot) {
    throw new KiteError(
      'KITE_DELTA_INVALID',
      'Delta toStateRoot does not match the next image.',
      'delta.toStateRoot'
    );
  }
  const invalidated =
    overlaps(delta.changedObligationIds, certificate.obligationIds) ||
    overlaps(delta.retractedSources, certificate.sourcePartitions) ||
    overlaps(delta.insertedCollections, certificate.negativeCollections);
  const fullVerdict = input.next.verdict;
  const verdict = invalidated ? fullVerdict : certificate.verdict;
  return {
    invalidated,
    verdict,
    fullVerdict,
    same: verdict === fullVerdict,
  };
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const known = new Set(right);
  return left.some((item) => known.has(item));
}
