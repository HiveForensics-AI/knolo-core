import {
  canonicalCbor,
  digestDomain,
  knowledgePolicyRootV5,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
  type KnowledgePolicyV1,
} from './knowledge_image_v5.js';
import {
  verifyKnowledgeQueryResultV5,
  type KnowledgeQueryHitV1,
  type KnowledgeQueryResultV1,
} from './knowledge_query_v5.js';

export type KnowledgePolicyActionV1 = 'query' | 'read';
export type KnowledgeAuthorizationDecisionV1 = 'allow' | 'partial' | 'deny';
export type KnowledgeAuthorizationResultV1 = {
  version: 1;
  stateRoot: Digest;
  policyRoot: Digest;
  planRoot: Digest;
  principal: string;
  action: KnowledgePolicyActionV1;
  decision: KnowledgeAuthorizationDecisionV1;
  allowedHits: KnowledgeQueryHitV1[];
  deniedHits: KnowledgeQueryHitV1[];
  authorizationRoot: Digest;
};

export { knowledgePolicyRootV5 };

export function evaluateKnowledgeQueryPolicyV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  queryResult: KnowledgeQueryResultV1,
  policy: KnowledgePolicyV1,
  principal: string,
  action: KnowledgePolicyActionV1 = 'query',
): KnowledgeAuthorizationResultV1 {
  const image = isKnowledgeImage(input) ? input : mountKnowledgeImageV5(input);
  if (!principal || typeof principal !== 'string') throw new Error('V5 authorization principal must be non-empty.');
  if (action !== 'query' && action !== 'read') throw new Error('Unsupported V5 authorization action.');
  verifyKnowledgeQueryResultV5(image, queryResult);
  const policyRoot = knowledgePolicyRootV5(policy);
  if (policyRoot !== image.commit.policyRoot) throw new Error('V5 policy root does not match the committed image.');

  const allowedHits: KnowledgeQueryHitV1[] = [];
  const deniedHits: KnowledgeQueryHitV1[] = [];
  for (const hit of queryResult.hits) {
    if (authorizeHit(hit, policy, principal, action)) allowedHits.push(hit);
    else deniedHits.push(hit);
  }
  const decision: KnowledgeAuthorizationDecisionV1 = deniedHits.length === 0 ? 'allow' : allowedHits.length === 0 ? 'deny' : 'partial';
  const authorizationRoot = digestDomain('authorization', canonicalCbor({
    action,
    allowedObjectIds: allowedHits.map((hit) => hit.objectId),
    decision,
    deniedObjectIds: deniedHits.map((hit) => hit.objectId),
    planRoot: queryResult.planRoot,
    policyRoot,
    principal,
    stateRoot: image.stateRoot,
  } as unknown as CborValue));
  return { version: 1, stateRoot: image.stateRoot, policyRoot, planRoot: queryResult.planRoot, principal, action, decision, allowedHits, deniedHits, authorizationRoot };
}

export function verifyKnowledgeAuthorizationResultV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  queryResult: KnowledgeQueryResultV1,
  policy: KnowledgePolicyV1,
  result: KnowledgeAuthorizationResultV1,
): void {
  const expected = evaluateKnowledgeQueryPolicyV5(input, queryResult, policy, result.principal, result.action);
  if (JSON.stringify(expected) !== JSON.stringify(result)) throw new Error('V5 authorization result root mismatch.');
}

function authorizeHit(hit: KnowledgeQueryHitV1, policy: KnowledgePolicyV1, principal: string, action: KnowledgePolicyActionV1): boolean {
  const matches = (policy.rules ?? []).filter((rule) => rule.action === action && (rule.principal === undefined || rule.principal === principal) && (rule.kind === undefined || rule.kind.toLowerCase() === hit.kind));
  if (matches.some((rule) => rule.effect === 'deny')) return false;
  if (matches.some((rule) => rule.effect === 'allow')) return true;
  return policy.default === 'allow';
}

function isKnowledgeImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 {
  return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input;
}
