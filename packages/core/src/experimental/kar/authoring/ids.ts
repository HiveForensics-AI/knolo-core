import { digest } from '../canonicalize.js';
import { CEG_BINDING_DOMAIN, CEG_NODE_DOMAIN, CEG_RELATION_DOMAIN } from './constants.js';

/**
 * Stable compiler identities for `ceg-source-1`.
 * The preimage is canonical JSON. These ids are not KAR certificate roots.
 */

export function cegNodeId(name: string): string {
  return digest({ domain: CEG_NODE_DOMAIN, name });
}

export function cegRelationId(from: string, relation: string, to: string): string {
  return digest({ domain: CEG_RELATION_DOMAIN, from, relation, to });
}

export function cegBindingId(parts: {
  nodeId: string;
  evidenceId: string;
  requirements: readonly string[];
  authority: number | null;
  unauthorized: true | null;
  validFrom: string | null;
  validUntil: string | null;
  provenance: string | null;
}): string {
  return digest({
    domain: CEG_BINDING_DOMAIN,
    nodeId: parts.nodeId,
    evidenceId: parts.evidenceId,
    requirements: [...parts.requirements],
    authority: parts.authority,
    unauthorized: parts.unauthorized,
    validFrom: parts.validFrom,
    validUntil: parts.validUntil,
    provenance: parts.provenance,
  });
}
