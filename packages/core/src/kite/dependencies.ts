import type { KiteDependencies, KiteDerivation } from './types.js';

export function dependenciesFromDerivation(
  derivation: KiteDerivation
): KiteDependencies {
  return {
    obligationIds: [...derivation.obligationIds],
    sourcePartitions: [...derivation.sourcePartitions],
    negativeCollections: [...derivation.negativeCollections],
  };
}
