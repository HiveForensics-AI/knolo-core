import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestBytes,
  digestDomain,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
} from './knowledge_image_v5.js';
import { KnowledgeSyncReplayCacheV1 } from './knowledge_sync_exchange_v5.js';
import { sha256Hex } from './utils/sha256.js';

export const KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1 = 1024 * 1024;

export const KNOWLEDGE_EXCHANGE_VERIFICATION_CODES_V1 = [
  'verified',
  'digest-mismatch',
  'state-root-mismatch',
  'expired',
  'replay',
  'unauthorized-recipient',
  'revoked-key',
  'policy-denied',
  'mount-failed',
  'oversized',
  'interrupted',
] as const;

export type KnowledgeExchangeVerificationCodeV1 =
  (typeof KNOWLEDGE_EXCHANGE_VERIFICATION_CODES_V1)[number];

export type KnowledgeExchangeOfferV1 = {
  version: 1;
  kind: 'exchange-offer';
  offerId: Digest;
  sender: string;
  recipient: string;
  artifactKind: 'knowledge-image';
  sha256: string;
  stateRoot: Digest;
  sizeBytes: number;
  namespace?: string;
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  nonce: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export type KnowledgeExchangeDecisionV1 = {
  version: 1;
  kind: 'exchange-decision';
  decisionId: Digest;
  decision: 'accept' | 'reject';
  offerId: Digest;
  offerRoot: Digest;
  sender: string;
  recipient: string;
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  nonce: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export type KnowledgeExchangeReceiptV1 = {
  version: 1;
  kind: 'exchange-receipt';
  receiptId: Digest;
  role: 'sender' | 'recipient';
  offerId: Digest;
  decision: 'accept' | 'reject';
  sha256: string;
  stateRoot: Digest;
  sizeBytes: number;
  sender: string;
  recipient: string;
  verification: KnowledgeExchangeVerificationCodeV1;
  policy: string;
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  nonce: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export type KnowledgeExchangeOfferDraftV1 = Omit<
  KnowledgeExchangeOfferV1,
  'version' | 'kind' | 'offerId' | 'signature'
>;

export type KnowledgeExchangeVerificationOptionsV1 = {
  now: number;
  expectedRecipient?: string;
  expectedKeyringRoot?: Digest;
  resolveKey: (
    principal: string,
    algorithm: string,
    keyId?: string
  ) => Uint8Array | undefined;
  verifySignature: (
    algorithm: string,
    key: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array
  ) => boolean | Promise<boolean>;
};

type PreparedExchange = { payload: Uint8Array };

/** SHA-256, state root, and size for one mounted V5 image. */
export function describeKnowledgeExchangeArtifactV1(imageBytes: Uint8Array): {
  sha256: string;
  stateRoot: Digest;
  sizeBytes: number;
} {
  if (!(imageBytes instanceof Uint8Array))
    throw new Error('V5 exchange artifact bytes are required.');
  let image: KnowledgeImageV5;
  try {
    image = mountKnowledgeImageV5(imageBytes);
  } catch {
    throw new Error('V5 exchange artifact failed to mount.');
  }
  return {
    sha256: sha256Hex(imageBytes),
    stateRoot: image.stateRoot,
    sizeBytes: imageBytes.length,
  };
}

export function createKnowledgeExchangeOfferV1(
  input: KnowledgeExchangeOfferDraftV1
): KnowledgeExchangeOfferV1 {
  const offer: KnowledgeExchangeOfferV1 = {
    ...input,
    version: 1,
    kind: 'exchange-offer',
    offerId: '',
    signature: new Uint8Array(),
  };
  validateOffer(offer, false);
  return { ...offer, offerId: expectedOfferId(offer) };
}

export function exchangeOfferPayloadV1(
  offer: KnowledgeExchangeOfferV1
): Uint8Array {
  validateOffer(offer, false);
  return canonicalCbor({
    algorithm: offer.algorithm,
    artifactKind: offer.artifactKind,
    expiresAt: offer.expiresAt,
    issuedAt: offer.issuedAt,
    keyId: offer.keyId ?? null,
    keyringRoot: offer.keyringRoot ?? null,
    kind: offer.kind,
    namespace: offer.namespace ?? null,
    nonce: offer.nonce,
    offerId: offer.offerId,
    recipient: offer.recipient,
    sender: offer.sender,
    sha256: offer.sha256,
    sizeBytes: offer.sizeBytes,
    stateRoot: offer.stateRoot,
    version: offer.version,
  } as unknown as CborValue);
}

export function exchangeOfferRootV1(offer: KnowledgeExchangeOfferV1): Digest {
  return digestDomain(
    'exchange-offer',
    canonicalCbor({
      payload: exchangeOfferPayloadV1(offer),
      signature: offer.signature,
    } as unknown as CborValue)
  );
}

export function createKnowledgeExchangeDecisionV1(input: {
  offer: KnowledgeExchangeOfferV1;
  decision: 'accept' | 'reject';
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  nonce: Uint8Array;
  issuedAt: number;
  expiresAt: number;
}): KnowledgeExchangeDecisionV1 {
  validateOffer(input.offer, true);
  const decision: KnowledgeExchangeDecisionV1 = {
    version: 1,
    kind: 'exchange-decision',
    decisionId: '',
    decision: input.decision,
    offerId: input.offer.offerId,
    offerRoot: exchangeOfferRootV1(input.offer),
    sender: input.offer.sender,
    recipient: input.offer.recipient,
    algorithm: input.algorithm,
    ...(input.keyId === undefined ? {} : { keyId: input.keyId }),
    ...(input.keyringRoot === undefined
      ? {}
      : { keyringRoot: input.keyringRoot }),
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    signature: new Uint8Array(),
  };
  validateDecision(decision, false);
  return { ...decision, decisionId: expectedDecisionId(decision) };
}

export function exchangeDecisionPayloadV1(
  decision: KnowledgeExchangeDecisionV1
): Uint8Array {
  validateDecision(decision, false);
  return canonicalCbor({
    algorithm: decision.algorithm,
    decision: decision.decision,
    decisionId: decision.decisionId,
    expiresAt: decision.expiresAt,
    issuedAt: decision.issuedAt,
    keyId: decision.keyId ?? null,
    keyringRoot: decision.keyringRoot ?? null,
    kind: decision.kind,
    nonce: decision.nonce,
    offerId: decision.offerId,
    offerRoot: decision.offerRoot,
    recipient: decision.recipient,
    sender: decision.sender,
    version: decision.version,
  } as unknown as CborValue);
}

export function exchangeDecisionRootV1(
  decision: KnowledgeExchangeDecisionV1
): Digest {
  return digestDomain(
    'exchange-decision',
    canonicalCbor({
      payload: exchangeDecisionPayloadV1(decision),
      signature: decision.signature,
    } as unknown as CborValue)
  );
}

export function createKnowledgeExchangeReceiptV1(input: {
  offer: KnowledgeExchangeOfferV1;
  role: 'sender' | 'recipient';
  decision: 'accept' | 'reject';
  verification: KnowledgeExchangeVerificationCodeV1;
  policy: string;
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  nonce: Uint8Array;
  issuedAt: number;
  expiresAt: number;
}): KnowledgeExchangeReceiptV1 {
  validateOffer(input.offer, true);
  if (input.verification === 'verified' && input.decision !== 'accept') {
    throw new Error('V5 exchange receipt cannot record a verified rejection.');
  }
  const receipt: KnowledgeExchangeReceiptV1 = {
    version: 1,
    kind: 'exchange-receipt',
    receiptId: '',
    role: input.role,
    offerId: input.offer.offerId,
    decision: input.decision,
    sha256: input.offer.sha256,
    stateRoot: input.offer.stateRoot,
    sizeBytes: input.offer.sizeBytes,
    sender: input.offer.sender,
    recipient: input.offer.recipient,
    verification: input.verification,
    policy: input.policy,
    algorithm: input.algorithm,
    ...(input.keyId === undefined ? {} : { keyId: input.keyId }),
    ...(input.keyringRoot === undefined
      ? {}
      : { keyringRoot: input.keyringRoot }),
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    signature: new Uint8Array(),
  };
  validateReceipt(receipt, false);
  return { ...receipt, receiptId: expectedReceiptId(receipt) };
}

export function exchangeReceiptPayloadV1(
  receipt: KnowledgeExchangeReceiptV1
): Uint8Array {
  validateReceipt(receipt, false);
  return canonicalCbor({
    algorithm: receipt.algorithm,
    decision: receipt.decision,
    expiresAt: receipt.expiresAt,
    issuedAt: receipt.issuedAt,
    keyId: receipt.keyId ?? null,
    keyringRoot: receipt.keyringRoot ?? null,
    kind: receipt.kind,
    nonce: receipt.nonce,
    offerId: receipt.offerId,
    policy: receipt.policy,
    receiptId: receipt.receiptId,
    recipient: receipt.recipient,
    role: receipt.role,
    sender: receipt.sender,
    sha256: receipt.sha256,
    sizeBytes: receipt.sizeBytes,
    stateRoot: receipt.stateRoot,
    verification: receipt.verification,
    version: receipt.version,
  } as unknown as CborValue);
}

export function exchangeReceiptRootV1(
  receipt: KnowledgeExchangeReceiptV1
): Digest {
  return digestDomain(
    'exchange-receipt',
    canonicalCbor({
      payload: exchangeReceiptPayloadV1(receipt),
      signature: receipt.signature,
    } as unknown as CborValue)
  );
}

export async function verifyKnowledgeExchangeOfferV1(
  offer: KnowledgeExchangeOfferV1,
  options: KnowledgeExchangeVerificationOptionsV1
): Promise<void> {
  const prepared = prepareOffer(offer, options);
  await verifyPreparedSignature(
    offer.sender,
    offer.algorithm,
    offer.keyId,
    offer.signature,
    prepared,
    options,
    'V5 exchange offer signature verification failed.'
  );
}

export async function verifyKnowledgeExchangeDecisionV1(
  offer: KnowledgeExchangeOfferV1,
  decision: KnowledgeExchangeDecisionV1,
  options: KnowledgeExchangeVerificationOptionsV1
): Promise<void> {
  const prepared = prepareDecision(offer, decision, options);
  await verifyPreparedSignature(
    decision.recipient,
    decision.algorithm,
    decision.keyId,
    decision.signature,
    prepared,
    options,
    'V5 exchange decision signature verification failed.'
  );
}

export async function verifyKnowledgeExchangeReceiptV1(
  offer: KnowledgeExchangeOfferV1,
  receipt: KnowledgeExchangeReceiptV1,
  options: KnowledgeExchangeVerificationOptionsV1
): Promise<void> {
  const prepared = prepareReceipt(offer, receipt, options);
  const principal =
    receipt.role === 'sender' ? receipt.sender : receipt.recipient;
  await verifyPreparedSignature(
    principal,
    receipt.algorithm,
    receipt.keyId,
    receipt.signature,
    prepared,
    options,
    'V5 exchange receipt signature verification failed.'
  );
}

/**
 * Check size, SHA-256, V5 mount, and state root. Does not admit replay.
 * Check order is size, digest, mount, state root.
 */
export function verifyKnowledgeExchangeArtifactV1(
  offer: KnowledgeExchangeOfferV1,
  imageBytes: Uint8Array
): KnowledgeImageV5 {
  validateOffer(offer, true);
  if (!(imageBytes instanceof Uint8Array))
    throw new Error('V5 exchange artifact bytes are required.');
  if (offer.artifactKind !== 'knowledge-image')
    throw new Error('Unsupported V5 exchange artifact kind.');
  if (imageBytes.length !== offer.sizeBytes)
    throw new Error('V5 exchange artifact size mismatch.');
  if (sha256Hex(imageBytes) !== offer.sha256)
    throw new Error('V5 exchange artifact digest mismatch.');
  let image: KnowledgeImageV5;
  try {
    image = mountKnowledgeImageV5(imageBytes);
  } catch {
    throw new Error('V5 exchange artifact failed to mount.');
  }
  if (image.stateRoot !== offer.stateRoot)
    throw new Error('V5 exchange image state root mismatch.');
  return image;
}

/** Admit one verified offer or decision id. A failed transfer must not call this. */
export function claimKnowledgeExchangeReplayV1(
  cache: KnowledgeSyncReplayCacheV1,
  id: Digest,
  expiresAt: number,
  now: number
): void {
  try {
    if (cache.has(id, now)) throw new Error('V5 exchange replay detected.');
    cache.acceptVerifiedRequest({ requestId: id, expiresAt }, now);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('V5 exchange '))
      throw error;
    if (error instanceof Error && /replay/i.test(error.message))
      throw new Error('V5 exchange replay detected.');
    if (error instanceof Error && /validity window/i.test(error.message)) {
      throw new Error('V5 exchange message is outside its validity window.');
    }
    if (error instanceof Error && /capacity/i.test(error.message))
      throw new Error('V5 exchange replay cache capacity exhausted.');
    throw error;
  }
}

/**
 * Verify the offer, then the artifact, and only then admit offerId to replay.
 * A digest, mount, or state-root failure leaves the cache unchanged.
 */
export async function acceptKnowledgeExchangeTransferV1(
  offer: KnowledgeExchangeOfferV1,
  imageBytes: Uint8Array,
  options: KnowledgeExchangeVerificationOptionsV1 & {
    replayCache: KnowledgeSyncReplayCacheV1;
  }
): Promise<KnowledgeImageV5> {
  await verifyKnowledgeExchangeOfferV1(offer, options);
  if (options.replayCache.has(offer.offerId, options.now))
    throw new Error('V5 exchange replay detected.');
  const image = verifyKnowledgeExchangeArtifactV1(offer, imageBytes);
  claimKnowledgeExchangeReplayV1(
    options.replayCache,
    offer.offerId,
    offer.expiresAt,
    options.now
  );
  return image;
}

export function encodeKnowledgeExchangeOfferV1(
  offer: KnowledgeExchangeOfferV1
): Uint8Array {
  validateOffer(offer, true);
  return boundedEncode(offerToCbor(offer));
}

export function decodeKnowledgeExchangeOfferV1(
  input: ArrayBufferLike | Uint8Array
): KnowledgeExchangeOfferV1 {
  const record = asRecord(decodeBounded(input));
  assertKeys(record, OFFER_KEYS);
  const offer: KnowledgeExchangeOfferV1 = {
    version: asVersion(record.version),
    kind: asLiteral(record.kind, 'exchange-offer', 'kind'),
    offerId: asDigest(record.offerId),
    sender: asPrincipal(record.sender, 'sender'),
    recipient: asPrincipal(record.recipient, 'recipient'),
    artifactKind: asLiteral(
      record.artifactKind,
      'knowledge-image',
      'artifact kind'
    ),
    sha256: asSha256(record.sha256),
    stateRoot: asDigest(record.stateRoot),
    sizeBytes: asSize(record.sizeBytes),
    ...asOptionalLabel('namespace', record.namespace, NAMESPACE),
    algorithm: asAlgorithm(record.algorithm),
    ...asOptionalLabel('keyId', record.keyId, KEY_ID),
    ...asOptionalDigest('keyringRoot', record.keyringRoot),
    nonce: asNonce(record.nonce),
    issuedAt: asSafeNumber(record.issuedAt),
    expiresAt: asSafeNumber(record.expiresAt),
    signature: asSignature(record.signature),
  };
  validateOffer(offer, true);
  return offer;
}

export function encodeKnowledgeExchangeDecisionV1(
  decision: KnowledgeExchangeDecisionV1
): Uint8Array {
  validateDecision(decision, true);
  return boundedEncode(decisionToCbor(decision));
}

export function decodeKnowledgeExchangeDecisionV1(
  input: ArrayBufferLike | Uint8Array
): KnowledgeExchangeDecisionV1 {
  const record = asRecord(decodeBounded(input));
  assertKeys(record, DECISION_KEYS);
  const decision: KnowledgeExchangeDecisionV1 = {
    version: asVersion(record.version),
    kind: asLiteral(record.kind, 'exchange-decision', 'kind'),
    decisionId: asDigest(record.decisionId),
    decision: asDecision(record.decision),
    offerId: asDigest(record.offerId),
    offerRoot: asDigest(record.offerRoot),
    sender: asPrincipal(record.sender, 'sender'),
    recipient: asPrincipal(record.recipient, 'recipient'),
    algorithm: asAlgorithm(record.algorithm),
    ...asOptionalLabel('keyId', record.keyId, KEY_ID),
    ...asOptionalDigest('keyringRoot', record.keyringRoot),
    nonce: asNonce(record.nonce),
    issuedAt: asSafeNumber(record.issuedAt),
    expiresAt: asSafeNumber(record.expiresAt),
    signature: asSignature(record.signature),
  };
  validateDecision(decision, true);
  return decision;
}

export function encodeKnowledgeExchangeReceiptV1(
  receipt: KnowledgeExchangeReceiptV1
): Uint8Array {
  validateReceipt(receipt, true);
  return boundedEncode(receiptToCbor(receipt));
}

export function decodeKnowledgeExchangeReceiptV1(
  input: ArrayBufferLike | Uint8Array
): KnowledgeExchangeReceiptV1 {
  const record = asRecord(decodeBounded(input));
  assertKeys(record, RECEIPT_KEYS);
  const receipt: KnowledgeExchangeReceiptV1 = {
    version: asVersion(record.version),
    kind: asLiteral(record.kind, 'exchange-receipt', 'kind'),
    receiptId: asDigest(record.receiptId),
    role: asRole(record.role),
    offerId: asDigest(record.offerId),
    decision: asDecision(record.decision),
    sha256: asSha256(record.sha256),
    stateRoot: asDigest(record.stateRoot),
    sizeBytes: asSize(record.sizeBytes),
    sender: asPrincipal(record.sender, 'sender'),
    recipient: asPrincipal(record.recipient, 'recipient'),
    verification: asVerification(record.verification),
    policy: asPolicy(record.policy),
    algorithm: asAlgorithm(record.algorithm),
    ...asOptionalLabel('keyId', record.keyId, KEY_ID),
    ...asOptionalDigest('keyringRoot', record.keyringRoot),
    nonce: asNonce(record.nonce),
    issuedAt: asSafeNumber(record.issuedAt),
    expiresAt: asSafeNumber(record.expiresAt),
    signature: asSignature(record.signature),
  };
  validateReceipt(receipt, true);
  return receipt;
}

const PRINCIPAL = /^[\x21-\x7e]{1,256}$/;
const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY_ID = /^[\x21-\x7e]{1,128}$/;
const ALGORITHM = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,31}$/;
const POLICY = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const OFFER_KEYS = [
  'algorithm',
  'artifactKind',
  'expiresAt',
  'issuedAt',
  'keyId',
  'keyringRoot',
  'kind',
  'namespace',
  'nonce',
  'offerId',
  'recipient',
  'sender',
  'sha256',
  'signature',
  'sizeBytes',
  'stateRoot',
  'version',
];
const DECISION_KEYS = [
  'algorithm',
  'decision',
  'decisionId',
  'expiresAt',
  'issuedAt',
  'keyId',
  'keyringRoot',
  'kind',
  'nonce',
  'offerId',
  'offerRoot',
  'recipient',
  'sender',
  'signature',
  'version',
];
const RECEIPT_KEYS = [
  'algorithm',
  'decision',
  'expiresAt',
  'issuedAt',
  'keyId',
  'keyringRoot',
  'kind',
  'nonce',
  'offerId',
  'policy',
  'receiptId',
  'recipient',
  'role',
  'sender',
  'sha256',
  'signature',
  'sizeBytes',
  'stateRoot',
  'verification',
  'version',
];

function offerToCbor(offer: KnowledgeExchangeOfferV1): CborValue {
  return {
    algorithm: offer.algorithm,
    artifactKind: offer.artifactKind,
    expiresAt: offer.expiresAt,
    issuedAt: offer.issuedAt,
    keyId: offer.keyId ?? null,
    keyringRoot: offer.keyringRoot ?? null,
    kind: offer.kind,
    namespace: offer.namespace ?? null,
    nonce: offer.nonce,
    offerId: offer.offerId,
    recipient: offer.recipient,
    sender: offer.sender,
    sha256: offer.sha256,
    signature: offer.signature,
    sizeBytes: offer.sizeBytes,
    stateRoot: offer.stateRoot,
    version: offer.version,
  };
}

function decisionToCbor(decision: KnowledgeExchangeDecisionV1): CborValue {
  return {
    algorithm: decision.algorithm,
    decision: decision.decision,
    decisionId: decision.decisionId,
    expiresAt: decision.expiresAt,
    issuedAt: decision.issuedAt,
    keyId: decision.keyId ?? null,
    keyringRoot: decision.keyringRoot ?? null,
    kind: decision.kind,
    nonce: decision.nonce,
    offerId: decision.offerId,
    offerRoot: decision.offerRoot,
    recipient: decision.recipient,
    sender: decision.sender,
    signature: decision.signature,
    version: decision.version,
  };
}

function receiptToCbor(receipt: KnowledgeExchangeReceiptV1): CborValue {
  return {
    algorithm: receipt.algorithm,
    decision: receipt.decision,
    expiresAt: receipt.expiresAt,
    issuedAt: receipt.issuedAt,
    keyId: receipt.keyId ?? null,
    keyringRoot: receipt.keyringRoot ?? null,
    kind: receipt.kind,
    nonce: receipt.nonce,
    offerId: receipt.offerId,
    policy: receipt.policy,
    receiptId: receipt.receiptId,
    recipient: receipt.recipient,
    role: receipt.role,
    sender: receipt.sender,
    sha256: receipt.sha256,
    signature: receipt.signature,
    sizeBytes: receipt.sizeBytes,
    stateRoot: receipt.stateRoot,
    verification: receipt.verification,
    version: receipt.version,
  };
}

function expectedOfferId(offer: KnowledgeExchangeOfferV1): Digest {
  return digestDomain(
    'exchange-offer-id',
    canonicalCbor({
      artifactKind: offer.artifactKind,
      expiresAt: offer.expiresAt,
      issuedAt: offer.issuedAt,
      namespace: offer.namespace ?? null,
      nonce: offer.nonce,
      recipient: offer.recipient,
      sender: offer.sender,
      sha256: offer.sha256,
      sizeBytes: offer.sizeBytes,
      stateRoot: offer.stateRoot,
      version: 1,
    } as unknown as CborValue)
  );
}

function expectedDecisionId(decision: KnowledgeExchangeDecisionV1): Digest {
  return digestDomain(
    'exchange-decision-id',
    canonicalCbor({
      decision: decision.decision,
      expiresAt: decision.expiresAt,
      issuedAt: decision.issuedAt,
      nonce: decision.nonce,
      offerId: decision.offerId,
      offerRoot: decision.offerRoot,
      recipient: decision.recipient,
      sender: decision.sender,
      version: 1,
    } as unknown as CborValue)
  );
}

function expectedReceiptId(receipt: KnowledgeExchangeReceiptV1): Digest {
  return digestDomain(
    'exchange-receipt-id',
    canonicalCbor({
      decision: receipt.decision,
      expiresAt: receipt.expiresAt,
      issuedAt: receipt.issuedAt,
      nonce: receipt.nonce,
      offerId: receipt.offerId,
      policy: receipt.policy,
      recipient: receipt.recipient,
      role: receipt.role,
      sender: receipt.sender,
      sha256: receipt.sha256,
      sizeBytes: receipt.sizeBytes,
      stateRoot: receipt.stateRoot,
      verification: receipt.verification,
      version: 1,
    } as unknown as CborValue)
  );
}

function validateOffer(
  offer: KnowledgeExchangeOfferV1,
  requireSignature: boolean
): void {
  if (
    offer.version !== 1 ||
    offer.kind !== 'exchange-offer' ||
    offer.artifactKind !== 'knowledge-image'
  ) {
    throw new Error('Malformed V5 exchange offer.');
  }
  asPrincipalValue(offer.sender, 'sender');
  asPrincipalValue(offer.recipient, 'recipient');
  if (!SHA256_HEX.test(offer.sha256))
    throw new Error('Malformed V5 exchange sha256.');
  digestBytes(offer.stateRoot);
  asSizeValue(offer.sizeBytes);
  if (offer.namespace !== undefined && !NAMESPACE.test(offer.namespace))
    throw new Error('Malformed V5 exchange namespace.');
  asAlgorithmValue(offer.algorithm);
  if (offer.keyId !== undefined && !KEY_ID.test(offer.keyId))
    throw new Error('Malformed V5 exchange keyId.');
  if (offer.keyringRoot !== undefined) digestBytes(offer.keyringRoot);
  asNonceValue(offer.nonce);
  validateWindow(offer.issuedAt, offer.expiresAt);
  if (!requireSignature) return;
  asSignatureValue(offer.signature);
  if (offer.offerId !== expectedOfferId(offer))
    throw new Error('V5 exchange offer ID mismatch.');
}

function validateDecision(
  decision: KnowledgeExchangeDecisionV1,
  requireSignature: boolean
): void {
  if (decision.version !== 1 || decision.kind !== 'exchange-decision')
    throw new Error('Malformed V5 exchange decision.');
  if (decision.decision !== 'accept' && decision.decision !== 'reject')
    throw new Error('Malformed V5 exchange decision.');
  digestBytes(decision.offerId);
  digestBytes(decision.offerRoot);
  asPrincipalValue(decision.sender, 'sender');
  asPrincipalValue(decision.recipient, 'recipient');
  asAlgorithmValue(decision.algorithm);
  if (decision.keyId !== undefined && !KEY_ID.test(decision.keyId))
    throw new Error('Malformed V5 exchange keyId.');
  if (decision.keyringRoot !== undefined) digestBytes(decision.keyringRoot);
  asNonceValue(decision.nonce);
  validateWindow(decision.issuedAt, decision.expiresAt);
  if (!requireSignature) return;
  asSignatureValue(decision.signature);
  if (decision.decisionId !== expectedDecisionId(decision))
    throw new Error('V5 exchange decision ID mismatch.');
}

function validateReceipt(
  receipt: KnowledgeExchangeReceiptV1,
  requireSignature: boolean
): void {
  if (receipt.version !== 1 || receipt.kind !== 'exchange-receipt')
    throw new Error('Malformed V5 exchange receipt.');
  if (receipt.role !== 'sender' && receipt.role !== 'recipient')
    throw new Error('Malformed V5 exchange receipt.');
  if (receipt.decision !== 'accept' && receipt.decision !== 'reject')
    throw new Error('Malformed V5 exchange receipt.');
  if (
    !KNOWLEDGE_EXCHANGE_VERIFICATION_CODES_V1.includes(receipt.verification)
  ) {
    throw new Error('Malformed V5 exchange receipt.');
  }
  if (receipt.verification === 'verified' && receipt.decision !== 'accept') {
    throw new Error('V5 exchange receipt cannot record a verified rejection.');
  }
  digestBytes(receipt.offerId);
  if (!SHA256_HEX.test(receipt.sha256))
    throw new Error('Malformed V5 exchange sha256.');
  digestBytes(receipt.stateRoot);
  asSizeValue(receipt.sizeBytes);
  asPrincipalValue(receipt.sender, 'sender');
  asPrincipalValue(receipt.recipient, 'recipient');
  asPolicyValue(receipt.policy);
  asAlgorithmValue(receipt.algorithm);
  if (receipt.keyId !== undefined && !KEY_ID.test(receipt.keyId))
    throw new Error('Malformed V5 exchange keyId.');
  if (receipt.keyringRoot !== undefined) digestBytes(receipt.keyringRoot);
  asNonceValue(receipt.nonce);
  validateWindow(receipt.issuedAt, receipt.expiresAt);
  if (!requireSignature) return;
  asSignatureValue(receipt.signature);
  if (receipt.receiptId !== expectedReceiptId(receipt))
    throw new Error('V5 exchange receipt ID mismatch.');
}

function prepareOffer(
  offer: KnowledgeExchangeOfferV1,
  options: KnowledgeExchangeVerificationOptionsV1
): PreparedExchange {
  validateOffer(offer, true);
  validateMessageTime(offer.issuedAt, offer.expiresAt, options.now);
  if (
    options.expectedRecipient !== undefined &&
    offer.recipient !== options.expectedRecipient
  ) {
    throw new Error('V5 exchange recipient mismatch.');
  }
  assertKeyring(offer.keyringRoot, options.expectedKeyringRoot, 'offer');
  return { payload: exchangeOfferPayloadV1(offer) };
}

function prepareDecision(
  offer: KnowledgeExchangeOfferV1,
  decision: KnowledgeExchangeDecisionV1,
  options: KnowledgeExchangeVerificationOptionsV1
): PreparedExchange {
  validateOffer(offer, true);
  validateDecision(decision, true);
  if (
    decision.offerId !== offer.offerId ||
    decision.sender !== offer.sender ||
    decision.recipient !== offer.recipient ||
    decision.offerRoot !== exchangeOfferRootV1(offer)
  ) {
    throw new Error('V5 exchange decision offer binding mismatch.');
  }
  validateMessageTime(decision.issuedAt, decision.expiresAt, options.now);
  assertKeyring(decision.keyringRoot, options.expectedKeyringRoot, 'decision');
  return { payload: exchangeDecisionPayloadV1(decision) };
}

function prepareReceipt(
  offer: KnowledgeExchangeOfferV1,
  receipt: KnowledgeExchangeReceiptV1,
  options: KnowledgeExchangeVerificationOptionsV1
): PreparedExchange {
  validateOffer(offer, true);
  validateReceipt(receipt, true);
  if (
    receipt.offerId !== offer.offerId ||
    receipt.sender !== offer.sender ||
    receipt.recipient !== offer.recipient ||
    receipt.sha256 !== offer.sha256 ||
    receipt.stateRoot !== offer.stateRoot ||
    receipt.sizeBytes !== offer.sizeBytes
  ) {
    throw new Error('V5 exchange receipt offer binding mismatch.');
  }
  validateMessageTime(receipt.issuedAt, receipt.expiresAt, options.now);
  assertKeyring(receipt.keyringRoot, options.expectedKeyringRoot, 'receipt');
  return { payload: exchangeReceiptPayloadV1(receipt) };
}

async function verifyPreparedSignature(
  principal: string,
  algorithm: string,
  keyId: string | undefined,
  signature: Uint8Array,
  prepared: PreparedExchange,
  options: KnowledgeExchangeVerificationOptionsV1,
  failure: string
): Promise<void> {
  const key = options.resolveKey(principal, algorithm, keyId);
  if (
    !(key instanceof Uint8Array) ||
    !(await options.verifySignature(
      algorithm,
      key,
      prepared.payload,
      signature
    ))
  ) {
    throw new Error(failure);
  }
}

function assertKeyring(
  actual: Digest | undefined,
  expected: Digest | undefined,
  label: string
): void {
  if (actual !== undefined && expected !== actual) {
    throw new Error(`V5 exchange ${label} keyring root mismatch.`);
  }
}

function validateWindow(issuedAt: number, expiresAt: number): void {
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt < 0 ||
    issuedAt >= expiresAt
  ) {
    throw new Error('Invalid V5 exchange message window.');
  }
}

function validateMessageTime(
  issuedAt: number,
  expiresAt: number,
  now: number
): void {
  if (!Number.isSafeInteger(now) || issuedAt > now || now >= expiresAt) {
    throw new Error('V5 exchange message is outside its validity window.');
  }
}

function boundedEncode(value: CborValue): Uint8Array {
  const bytes = canonicalCbor(value);
  if (bytes.length > KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1) {
    throw new Error('V5 exchange wire message exceeds the size limit.');
  }
  return bytes;
}

function decodeBounded(input: ArrayBufferLike | Uint8Array): CborValue {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1) {
    throw new Error('V5 exchange wire message exceeds the size limit.');
  }
  return decodeCanonicalCbor(bytes);
}

function asRecord(value: CborValue | undefined): Record<string, CborValue> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Uint8Array
  ) {
    throw new Error('Malformed V5 exchange wire map.');
  }
  return value as Record<string, CborValue>;
}

function assertKeys(
  record: Record<string, CborValue>,
  required: string[]
): void {
  const allowed = new Set(required);
  const keys = Object.keys(record);
  if (
    keys.length !== required.length ||
    required.some(
      (key) => !Object.prototype.hasOwnProperty.call(record, key)
    ) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new Error('Malformed V5 exchange wire fields.');
  }
}

function asText(value: CborValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`Malformed V5 exchange ${label}.`);
  return value;
}

function asLiteral<T extends string>(
  value: CborValue | undefined,
  expected: T,
  label: string
): T {
  return asText(value, label) === expected
    ? expected
    : (() => {
        throw new Error(`Malformed V5 exchange ${label}.`);
      })();
}

function asVersion(value: CborValue | undefined): 1 {
  return asSafeNumber(value) === 1
    ? 1
    : (() => {
        throw new Error('Unsupported V5 exchange wire version.');
      })();
}

function asSafeNumber(value: CborValue | undefined): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw new Error('Malformed V5 exchange wire integer.');
  }
  return number;
}

function asPrincipal(value: CborValue | undefined, label: string): string {
  const text = asText(value, label);
  asPrincipalValue(text, label);
  return text;
}

function asPrincipalValue(value: string, label: string): void {
  if (!PRINCIPAL.test(value))
    throw new Error(`Malformed V5 exchange ${label}.`);
}

function asSha256(value: CborValue | undefined): string {
  const text = asText(value, 'sha256');
  if (!SHA256_HEX.test(text)) throw new Error('Malformed V5 exchange sha256.');
  return text;
}

function asDigest(value: CborValue | undefined): Digest {
  const text = asText(value, 'digest');
  digestBytes(text);
  return text;
}

function asSize(value: CborValue | undefined): number {
  const number = asSafeNumber(value);
  asSizeValue(number);
  return number;
}

function asSizeValue(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Malformed V5 exchange size.');
  }
}

function asAlgorithm(value: CborValue | undefined): string {
  const text = asText(value, 'algorithm');
  asAlgorithmValue(text);
  return text;
}

function asAlgorithmValue(value: string): void {
  if (!ALGORITHM.test(value))
    throw new Error('Malformed V5 exchange algorithm.');
}

function asNonce(value: CborValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new Error('Malformed V5 exchange nonce.');
  asNonceValue(value);
  return value;
}

function asNonceValue(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length < 1 || value.length > 64) {
    throw new Error('Malformed V5 exchange nonce.');
  }
}

function asSignature(value: CborValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new Error('V5 exchange message must be signed.');
  asSignatureValue(value);
  return value;
}

function asSignatureValue(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new Error('V5 exchange message must be signed.');
  }
}

function asDecision(value: CborValue | undefined): 'accept' | 'reject' {
  const text = asText(value, 'decision');
  if (text !== 'accept' && text !== 'reject')
    throw new Error('Malformed V5 exchange decision.');
  return text;
}

function asRole(value: CborValue | undefined): 'sender' | 'recipient' {
  const text = asText(value, 'role');
  if (text !== 'sender' && text !== 'recipient')
    throw new Error('Malformed V5 exchange receipt.');
  return text;
}

function asVerification(
  value: CborValue | undefined
): KnowledgeExchangeVerificationCodeV1 {
  const text = asText(value, 'verification');
  if (
    !KNOWLEDGE_EXCHANGE_VERIFICATION_CODES_V1.includes(
      text as KnowledgeExchangeVerificationCodeV1
    )
  ) {
    throw new Error('Malformed V5 exchange receipt.');
  }
  return text as KnowledgeExchangeVerificationCodeV1;
}

function asPolicy(value: CborValue | undefined): string {
  const text = asText(value, 'policy');
  asPolicyValue(text);
  return text;
}

function asPolicyValue(value: string): void {
  if (!POLICY.test(value)) throw new Error('Malformed V5 exchange policy.');
}

function asOptionalLabel(
  key: string,
  value: CborValue | undefined,
  pattern: RegExp
): Record<string, string | undefined> {
  if (value === null) return {};
  const text = asText(value, key);
  if (!pattern.test(text)) throw new Error(`Malformed V5 exchange ${key}.`);
  return { [key]: text };
}

function asOptionalDigest(
  key: string,
  value: CborValue | undefined
): Record<string, Digest | undefined> {
  if (value === null) return {};
  return { [key]: asDigest(value) };
}
