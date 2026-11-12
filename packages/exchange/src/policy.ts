import type { KnowledgeExchangeOfferV1 } from '@knolo/core';
import type { ExchangeReceivePolicy } from './config.js';

export function evaluateReceivePolicy(
  policy: ExchangeReceivePolicy,
  offer: Pick<
    KnowledgeExchangeOfferV1,
    'sender' | 'artifactKind' | 'sizeBytes' | 'namespace'
  >
): { ok: true; rule: 'receive' } | { ok: false; code: 'policy-denied' } {
  if (!policy.senders.includes(offer.sender))
    return { ok: false, code: 'policy-denied' };
  if (!policy.kinds.includes(offer.artifactKind))
    return { ok: false, code: 'policy-denied' };
  if (offer.sizeBytes > policy.maxBytes)
    return { ok: false, code: 'policy-denied' };
  if (
    policy.namespaces.length > 0 &&
    (offer.namespace === undefined ||
      !policy.namespaces.includes(offer.namespace))
  ) {
    return { ok: false, code: 'policy-denied' };
  }
  return { ok: true, rule: 'receive' };
}
