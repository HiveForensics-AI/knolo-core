import {
  discoverObligation,
  mountKiteImage,
  namedRetrieval,
} from './discover.js';
import { KiteError } from './errors.js';
import { parseKiteContract, resolveKiteBounds } from './contract.js';
import {
  KITE_EVALUATION_FORMAT,
  type KiteEvaluation,
  type KiteObligationResult,
  type KiteRetrieval,
} from './types.js';

export async function evaluateKite(input: {
  image: Uint8Array | ArrayBuffer;
  contract: unknown;
  bounds?: unknown;
}): Promise<KiteEvaluation> {
  const contract = parseKiteContract(input.contract);
  const bounds = resolveKiteBounds(input.bounds);
  const mounted = mountKiteImage(input.image);
  const objectCount = mounted.v5?.objects.length ?? mounted.byId.size;
  if (objectCount > bounds.maxGraphNodes) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Image object count exceeds maxGraphNodes.',
      'bounds.maxGraphNodes'
    );
  }
  if (contract.obligations.length > bounds.maxRetrievals) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Obligation count exceeds the retrieval bound.',
      'bounds.maxRetrievals'
    );
  }
  const met: KiteObligationResult[] = [];
  const unmet: KiteObligationResult[] = [];
  const retrievals: KiteRetrieval[] = [];
  for (const obligation of contract.obligations) {
    const found = await discoverObligation(mounted, obligation);
    const result = {
      id: obligation.id,
      kind: obligation.kind,
      hitIds: found.hitIds,
    };
    if (found.hitIds.length > 0) {
      met.push(result);
      continue;
    }
    unmet.push({ id: result.id, kind: result.kind, hitIds: [] });
    retrievals.push(found.retrieval);
  }
  for (const retrieval of retrievals) {
    namedRetrieval(
      retrieval.obligationId,
      retrieval.query,
      retrieval.normalizedQuery,
      retrieval.hitIds
    );
  }
  return {
    format: KITE_EVALUATION_FORMAT,
    question: contract.question,
    stateRoot: mounted.image.stateRoot,
    met,
    unmet,
    retrievals,
    bounds: {
      ...bounds,
      variantsChecked: 0,
      counterfactualChanges: 0,
    },
  };
}
