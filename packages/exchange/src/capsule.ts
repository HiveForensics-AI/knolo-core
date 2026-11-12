import {
  verifyKnowledgeCapsuleV1,
  verifyKnowledgeExchangeOfferWithEd25519,
  type Ed25519AuthorityKeyringV1,
  type KnowledgeCapsuleV1,
  type KnowledgeExchangeOfferV1,
} from '@knolo/core';

export async function attachExchangeCapsule(input: {
  offer: KnowledgeExchangeOfferV1;
  capsule: KnowledgeCapsuleV1;
  keyring: Ed25519AuthorityKeyringV1;
  now: number;
  expectedRecipient: string;
}): Promise<KnowledgeCapsuleV1> {
  await verifyKnowledgeExchangeOfferWithEd25519(
    input.offer,
    input.keyring,
    input.now,
    globalThis.crypto,
    input.expectedRecipient
  );
  return verifyKnowledgeCapsuleV1(input.capsule, input.offer.stateRoot);
}
