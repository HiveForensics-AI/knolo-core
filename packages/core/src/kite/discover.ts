import { resolveCortexPolicy } from '../cortex/policy.js';
import {
  mountCortexImage,
  retrieveHits,
  type CortexMounted,
} from '../cortex/retrieve.js';
import { KiteError } from './errors.js';
import type { KiteObligation, KiteRetrieval } from './types.js';

const RETRIEVAL_POLICY = resolveCortexPolicy({
  maxRounds: 1,
  maxCandidatesPerRound: 20,
});

/**
 * One bounded V5 chunk search for one obligation.
 * A retrieval without an obligation id is a failure.
 */
export function namedRetrieval(
  obligationId: string,
  query: string,
  normalizedQuery: string,
  hitIds: readonly string[]
): KiteRetrieval {
  if (typeof obligationId !== 'string' || obligationId.length === 0) {
    throw new KiteError(
      'KITE_OBLIGATION_UNBOUND',
      'A retrieval must name an obligation.',
      'obligationId'
    );
  }
  return {
    obligationId,
    query,
    normalizedQuery,
    hitIds: [...hitIds],
  };
}

export async function discoverObligation(
  mounted: CortexMounted,
  obligation: KiteObligation
): Promise<{ hitIds: string[]; sources: string[]; retrieval: KiteRetrieval }> {
  if (!mounted.v5) {
    throw new KiteError(
      'KITE_IMAGE_INVALID',
      'KITE phase 1 reads a V5 Knowledge Image.',
      'image'
    );
  }
  const retrieved = await retrieveHits(
    mounted,
    RETRIEVAL_POLICY,
    obligation.term,
    undefined
  );
  const hitIds = retrieved.hits.map((hit) => hit.id);
  const sources = [
    ...new Set(
      retrieved.hits.flatMap((hit) => (hit.source ? [hit.source] : []))
    ),
  ].sort();
  return {
    hitIds,
    sources,
    retrieval: namedRetrieval(
      obligation.id,
      obligation.term,
      retrieved.normalizedQuery,
      hitIds
    ),
  };
}

export function mountKiteImage(image: Uint8Array | ArrayBuffer): CortexMounted {
  try {
    return mountCortexImage(image);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Image is invalid.';
    throw new KiteError('KITE_IMAGE_INVALID', message, 'image', error);
  }
}
