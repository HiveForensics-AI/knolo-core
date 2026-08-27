import {
  verifyKnowledgeAuthorityEnvelopeV5Async,
  type KnowledgeAuthorityEnvelopeV1,
  type KnowledgeAuthorityVerificationV1,
  type KnowledgeDelegationV1,
} from './knowledge_authority_v5.js';
import {
  keyRotationPayloadV1,
  applyKnowledgeKeyRotationV5Async,
  verifyKnowledgeKeyRotationV5Async,
  type KnowledgeAuthorityKeyringV1,
  type KnowledgeKeyRotationRecordV1,
} from './knowledge_key_rotation_v5.js';
import {
  syncRequestPayloadV1,
  syncResponsePayloadV1,
  verifyKnowledgeSyncRequestV5Async,
  verifyKnowledgeSyncResponseV5Async,
  type KnowledgeSyncMessageAsyncVerificationOptionsV1,
  type KnowledgeSyncRequestV1,
  type KnowledgeSyncResponseV1,
} from './knowledge_sync_protocol_v5.js';
import {
  exchangeKnowledgeSyncOverTransportV5,
  verifyKnowledgeSyncExchangeV5Async,
} from './knowledge_sync_exchange_v5.js';
import type {
  KnowledgeSyncReplayCacheV1,
  KnowledgeSyncTransportExchangeResultV1,
  KnowledgeSyncTransportV1,
} from './knowledge_sync_exchange_v5.js';
import type { KnowledgeAuthorizationResultV1 } from './knowledge_policy_v5.js';
import type { KnowledgeImageV5, KnowledgePolicyV1 } from './knowledge_image_v5.js';
import type { KnowledgeQueryResultV1 } from './knowledge_query_v5.js';
import type { Digest } from './knowledge_image_v5.js';
import {
  runAuthorityPayloadV1,
  verifyKnowledgeRunAuthorityV5Async,
  type KnowledgeRunAuthorityEnvelopeV1,
  type KnowledgeRunAuthorityVerificationV1,
} from './knowledge_run_authority_v5.js';
import type { KnowledgeRunV1 } from './knowledge_run_v5.js';

export type Ed25519AuthorityKeyV1 = {
  principal: string;
  keyId: string;
  publicKey: Uint8Array;
  notBefore?: number;
  notAfter?: number;
  revokedAt?: number;
};

export type Ed25519AuthorityKeyringV1 = {
  keys: Ed25519AuthorityKeyV1[];
  keyringRoot?: Digest;
};

export type UnsignedKnowledgeKeyRotationV1 = Omit<KnowledgeKeyRotationRecordV1, 'signature'>;

export async function verifyKnowledgeAuthorityEnvelopeWithEd25519(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  queryResult: KnowledgeQueryResultV1,
  policy: KnowledgePolicyV1,
  authorization: KnowledgeAuthorizationResultV1,
  envelope: KnowledgeAuthorityEnvelopeV1,
  keyring: Ed25519AuthorityKeyringV1,
  now: number,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<KnowledgeAuthorityVerificationV1> {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 verification.');
  const resolveKey = (principal: string, algorithm: string, keyId?: string): Uint8Array | undefined => {
    if (algorithm !== 'Ed25519') return undefined;
    const matches = keyring.keys.filter((key) => key.principal === principal && key.keyId === (keyId ?? key.keyId) && key.publicKey.length === 32 && (key.notBefore === undefined || key.notBefore <= now) && (key.notAfter === undefined || now < key.notAfter) && (key.revokedAt === undefined || now < key.revokedAt));
    if (keyId) return matches.length === 1 ? matches[0].publicKey : undefined;
    return matches.length === 1 ? matches[0].publicKey : undefined;
  };
  const verifySignature = async (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> => {
    if (algorithm !== 'Ed25519' || key.length !== 32 || signature.length !== 64) return false;
    try {
      const keyBytes = key.slice().buffer as ArrayBuffer;
      const signatureBytes = signature.slice().buffer as ArrayBuffer;
      const messageBytes = message.slice().buffer as ArrayBuffer;
      const publicKey = await subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, publicKey, signatureBytes, messageBytes);
    } catch {
      return false;
    }
  };
  return verifyKnowledgeAuthorityEnvelopeV5Async(input, queryResult, policy, authorization, envelope, { now, expectedKeyringRoot: keyring.keyringRoot, resolveKey, verifySignature });
}

export async function signKnowledgeKeyRotationWithEd25519(
  record: UnsignedKnowledgeKeyRotationV1,
  privateKey: CryptoKey,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<KnowledgeKeyRotationRecordV1> {
  if (record.algorithm !== 'Ed25519') throw new Error('V5 key rotation algorithm must be Ed25519 for this adapter.');
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 signing.');
  const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, keyRotationPayloadV1({ ...record, signature: new Uint8Array([0]) }).buffer as ArrayBuffer);
  return { ...record, signature: new Uint8Array(signature) };
}

export async function verifyKnowledgeKeyRotationWithEd25519(
  keyring: KnowledgeAuthorityKeyringV1,
  record: KnowledgeKeyRotationRecordV1,
  now: number,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<KnowledgeAuthorityKeyringV1> {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 verification.');
  const resolveKey = (principal: string, algorithm: string, keyId?: string): Uint8Array | undefined => {
    const match = keyring.keys.filter((key) => key.principal === principal && key.algorithm === algorithm && key.keyId === keyId && key.publicKey.length === 32);
    return match.length === 1 ? match[0].publicKey : undefined;
  };
  const verifySignature = async (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> => {
    if (algorithm !== 'Ed25519' || key.length !== 32 || signature.length !== 64) return false;
    try {
      const publicKey = await subtle.importKey('raw', key.slice().buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, publicKey, signature.slice().buffer as ArrayBuffer, message.slice().buffer as ArrayBuffer);
    } catch {
      return false;
    }
  };
  await verifyKnowledgeKeyRotationV5Async(keyring, record, { now, resolveKey, verifySignature });
  return { ...keyring, keys: keyring.keys.map((entry) => ({ ...entry, publicKey: new Uint8Array(entry.publicKey) })), rotations: keyring.rotations.map((entry) => ({ ...entry, publicKey: new Uint8Array(entry.publicKey), signature: new Uint8Array(entry.signature) })) };
}

export async function applyKnowledgeKeyRotationWithEd25519(
  keyring: KnowledgeAuthorityKeyringV1,
  record: KnowledgeKeyRotationRecordV1,
  now: number,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<KnowledgeAuthorityKeyringV1> {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 verification.');
  const resolveKey = (principal: string, algorithm: string, keyId?: string): Uint8Array | undefined => {
    const match = keyring.keys.filter((key) => key.principal === principal && key.algorithm === algorithm && key.keyId === keyId && key.publicKey.length === 32);
    return match.length === 1 ? match[0].publicKey : undefined;
  };
  const verifySignature = async (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> => {
    if (algorithm !== 'Ed25519' || key.length !== 32 || signature.length !== 64) return false;
    try {
      const publicKey = await subtle.importKey('raw', key.slice().buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, publicKey, signature.slice().buffer as ArrayBuffer, message.slice().buffer as ArrayBuffer);
    } catch {
      return false;
    }
  };
  return applyKnowledgeKeyRotationV5Async(keyring, record, { now, resolveKey, verifySignature });
}

export async function signKnowledgeSyncRequestWithEd25519(request: KnowledgeSyncRequestV1, privateKey: CryptoKey, cryptoLike?: { subtle: SubtleCrypto }): Promise<KnowledgeSyncRequestV1> {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 signing.');
  if (request.algorithm !== 'Ed25519') throw new Error('V5 sync request algorithm must be Ed25519 for this adapter.');
  const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, syncRequestPayloadV1(request).buffer as ArrayBuffer);
  return { ...request, signature: new Uint8Array(signature) };
}

export async function signKnowledgeSyncResponseWithEd25519(response: KnowledgeSyncResponseV1, privateKey: CryptoKey, cryptoLike?: { subtle: SubtleCrypto }): Promise<KnowledgeSyncResponseV1> {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 signing.');
  if (response.algorithm !== 'Ed25519') throw new Error('V5 sync response algorithm must be Ed25519 for this adapter.');
  const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, syncResponsePayloadV1(response).buffer as ArrayBuffer);
  return { ...response, signature: new Uint8Array(signature) };
}

export async function signKnowledgeRunAuthorityWithEd25519(envelope: KnowledgeRunAuthorityEnvelopeV1, privateKey: CryptoKey, cryptoLike?: { subtle: SubtleCrypto }): Promise<KnowledgeRunAuthorityEnvelopeV1> {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 signing.');
  if (envelope.algorithm !== 'Ed25519') throw new Error('V5 run authority algorithm must be Ed25519 for this adapter.');
  const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, runAuthorityPayloadV1(envelope).buffer as ArrayBuffer);
  return { ...envelope, signature: new Uint8Array(signature) };
}

export async function verifyKnowledgeRunAuthorityWithEd25519(run: KnowledgeRunV1, envelope: KnowledgeRunAuthorityEnvelopeV1, keyring: Ed25519AuthorityKeyringV1, now: number, cryptoLike?: { subtle: SubtleCrypto }): Promise<KnowledgeRunAuthorityVerificationV1> {
  const { resolveKey, verifySignature } = ed25519SyncVerifier(keyring, now, cryptoLike);
  return verifyKnowledgeRunAuthorityV5Async(run, envelope, { now, expectedKeyringRoot: keyring.keyringRoot, resolveKey, verifySignature });
}

export async function verifyKnowledgeSyncRequestWithEd25519(request: KnowledgeSyncRequestV1, keyring: Ed25519AuthorityKeyringV1, now: number, cryptoLike?: { subtle: SubtleCrypto }): Promise<void> {
  const { subtle, resolveKey, verifySignature } = ed25519SyncVerifier(keyring, now, cryptoLike);
  await verifyKnowledgeSyncRequestV5Async(request, { now, expectedKeyringRoot: keyring.keyringRoot, resolveKey, verifySignature });
}

export async function verifyKnowledgeSyncResponseWithEd25519(request: KnowledgeSyncRequestV1, response: KnowledgeSyncResponseV1, keyring: Ed25519AuthorityKeyringV1, now: number, cryptoLike?: { subtle: SubtleCrypto }): Promise<void> {
  const { subtle, resolveKey, verifySignature } = ed25519SyncVerifier(keyring, now, cryptoLike);
  void subtle;
  await verifyKnowledgeSyncResponseV5Async(request, response, { now, expectedKeyringRoot: keyring.keyringRoot, resolveKey, verifySignature });
}

export async function verifyKnowledgeSyncExchangeWithEd25519(
  request: KnowledgeSyncRequestV1,
  response: KnowledgeSyncResponseV1,
  keyring: Ed25519AuthorityKeyringV1,
  now: number,
  replayCache: KnowledgeSyncReplayCacheV1,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<void> {
  const { resolveKey, verifySignature } = ed25519SyncVerifier(keyring, now, cryptoLike);
  await verifyKnowledgeSyncExchangeV5Async(request, response, {
    now,
    expectedKeyringRoot: keyring.keyringRoot,
    resolveKey,
    verifySignature,
    replayCache,
  });
}

export async function exchangeKnowledgeSyncOverTransportWithEd25519(
  request: KnowledgeSyncRequestV1,
  keyring: Ed25519AuthorityKeyringV1,
  replayCache: KnowledgeSyncReplayCacheV1,
  transport: KnowledgeSyncTransportV1,
  now: number,
  cryptoLike?: { subtle: SubtleCrypto },
): Promise<KnowledgeSyncTransportExchangeResultV1> {
  const { resolveKey, verifySignature } = ed25519SyncVerifier(keyring, now, cryptoLike);
  return exchangeKnowledgeSyncOverTransportV5(request, {
    now,
    expectedKeyringRoot: keyring.keyringRoot,
    resolveKey,
    verifySignature,
    replayCache,
    transport,
  });
}

function ed25519SyncVerifier(keyring: Ed25519AuthorityKeyringV1, now: number, cryptoLike?: { subtle: SubtleCrypto }): { subtle: SubtleCrypto; resolveKey: (principal: string, algorithm: string, keyId?: string) => Uint8Array | undefined; verifySignature: KnowledgeSyncMessageAsyncVerificationOptionsV1['verifySignature'] } {
  const subtle = cryptoLike?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable for Ed25519 verification.');
  const resolveKey = (principal: string, algorithm: string, keyId?: string): Uint8Array | undefined => {
    if (algorithm !== 'Ed25519') return undefined;
    const matches = keyring.keys.filter((key) => key.principal === principal && key.keyId === (keyId ?? key.keyId) && key.publicKey.length === 32 && (key.notBefore === undefined || key.notBefore <= now) && (key.notAfter === undefined || now < key.notAfter) && (key.revokedAt === undefined || now < key.revokedAt));
    return matches.length === 1 ? matches[0].publicKey : undefined;
  };
  const verifySignature = async (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> => {
    if (algorithm !== 'Ed25519' || key.length !== 32 || signature.length !== 64) return false;
    try {
      const publicKey = await subtle.importKey('raw', key.slice().buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, publicKey, signature.slice().buffer as ArrayBuffer, message.slice().buffer as ArrayBuffer);
    } catch {
      return false;
    }
  };
  return { subtle, resolveKey, verifySignature };
}

export type { KnowledgeDelegationV1 };
