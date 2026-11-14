import {
  canonicalCbor,
  digestDomain,
  type CborValue,
} from '../knowledge_image_v5.js';
import type { KiteWorld } from './types.js';

/**
 * InvarianceRoot commits the KITE inputs beside stateRoot.
 * It does not replace stateRoot or KARRoot.
 */
export function invarianceRoot(world: KiteWorld): string {
  return digestDomain('kite-invariance', canonicalCbor(invarianceValue(world)));
}

export function invarianceValue(world: KiteWorld): CborValue {
  const obligations = [...world.obligations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  return {
    asOf: world.asOf,
    bounds: {
      maxCounterfactualChanges: world.bounds.maxCounterfactualChanges,
      maxGraphNodes: world.bounds.maxGraphNodes,
      maxRetrievals: world.bounds.maxRetrievals,
      maxVariants: world.bounds.maxVariants,
    },
    changes: world.changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      obligationId: change.obligationId,
    })),
    completeness: world.completeness.declarations.map((item) => ({
      collection: item.collection,
      id: item.id,
      signed: item.signed,
    })),
    format: world.format,
    obligations: obligations.map((item) => ({
      hitIds: [...item.hitIds],
      id: item.id,
      kind: item.kind,
      met: item.met,
      sources: [...item.sources].sort(),
    })),
    question: world.question,
    rules: {
      completeness: world.rules.completeness.map((rule) => ({
        collection: rule.collection,
        id: rule.id,
        obligationId: rule.obligationId,
      })),
      conflicts: world.rules.conflicts.map((pair) => ({
        left: pair.left,
        right: pair.right,
      })),
      format: world.rules.format,
      oppose: [...world.rules.oppose],
      proposition: world.rules.proposition,
      require: [...world.rules.require],
      support: [...world.rules.support],
    },
    semanticRoot: world.semanticRoot,
    stateRoot: world.stateRoot,
  };
}
