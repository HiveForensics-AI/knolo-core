import {
  canonicalCbor,
  digestDomain,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
  type KnowledgePolicyV1,
} from './knowledge_image_v5.js';
import {
  evaluateKnowledgeQueryPolicyV5,
  type KnowledgeAuthorizationResultV1,
  type KnowledgePolicyActionV1,
} from './knowledge_policy_v5.js';
import {
  queryKnowledgeImageV5,
  type KnowledgeQueryPlanV1,
  type KnowledgeQueryResultV1,
} from './knowledge_query_v5.js';
import {
  verifyKnowledgeAuthorityEnvelopeWithEd25519,
  type Ed25519AuthorityKeyringV1,
} from './knowledge_crypto_v5.js';
import type { KnowledgeAuthorityEnvelopeV1, KnowledgeAuthorityVerificationV1 } from './knowledge_authority_v5.js';

export type KnowledgeAuthorityKeyringProviderV1 = (root: Digest | undefined) => Ed25519AuthorityKeyringV1 | undefined | Promise<Ed25519AuthorityKeyringV1 | undefined>;

export type KnowledgeAuthoritySessionInputV1 = {
  image: KnowledgeImageV5 | ArrayBufferLike | Uint8Array;
  expression: string | KnowledgeQueryPlanV1;
  policy: KnowledgePolicyV1;
  action?: KnowledgePolicyActionV1;
  envelope: KnowledgeAuthorityEnvelopeV1;
  now: number;
};

export type KnowledgeAuthoritySessionV1 = {
  version: 1;
  stateRoot: Digest;
  keyringRoot?: Digest;
  query: KnowledgeQueryResultV1;
  authorization: KnowledgeAuthorizationResultV1;
  authority: KnowledgeAuthorityVerificationV1;
  sessionRoot: Digest;
};

export function authoritySessionRootV1(input: {
  stateRoot: Digest;
  planRoot: Digest;
  resultRoot: Digest;
  authorizationRoot: Digest;
  envelopeRoot: Digest;
  keyringRoot?: Digest;
}): Digest {
  return digestDomain('authority-session', canonicalCbor({
    authorizationRoot: input.authorizationRoot,
    envelopeRoot: input.envelopeRoot,
    keyringRoot: input.keyringRoot ?? null,
    planRoot: input.planRoot,
    resultRoot: input.resultRoot,
    stateRoot: input.stateRoot,
    version: 1,
  } as unknown as CborValue));
}

export async function verifyKnowledgeAuthoritySessionWithEd25519(
  input: KnowledgeAuthoritySessionInputV1,
  resolveKeyring: KnowledgeAuthorityKeyringProviderV1,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<KnowledgeAuthoritySessionV1> {
  if (typeof resolveKeyring !== 'function') throw new Error('V5 authority keyring provider is required.');
  const action = input.action ?? 'query';
  const query = queryKnowledgeImageV5(input.image, input.expression);
  const authorization = evaluateKnowledgeQueryPolicyV5(input.image, query, input.policy, input.envelope.subject, action);
  const keyring = await resolveKeyring(input.envelope.keyringRoot);
  if (!keyring) throw new Error('V5 authority keyring root is unavailable.');
  const authority = await verifyKnowledgeAuthorityEnvelopeWithEd25519(input.image, query, input.policy, authorization, input.envelope, keyring, input.now, cryptoLike);
  const sessionRoot = authoritySessionRootV1({ stateRoot: query.stateRoot, planRoot: query.planRoot, resultRoot: query.resultRoot, authorizationRoot: authorization.authorizationRoot, envelopeRoot: authority.envelopeRoot, keyringRoot: authority.keyringRoot });
  return { version: 1, stateRoot: query.stateRoot, ...(authority.keyringRoot === undefined ? {} : { keyringRoot: authority.keyringRoot }), query, authorization, authority, sessionRoot };
}
