import {
  canonicalCbor,
  digestBytes,
  digestDomain,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
} from './knowledge_image_v5.js';
import { verifyKnowledgeAuthorizationResultV5, type KnowledgeAuthorizationResultV1, type KnowledgePolicyActionV1 } from './knowledge_policy_v5.js';
import type { KnowledgePolicyV1 } from './knowledge_image_v5.js';
import type { KnowledgeQueryResultV1 } from './knowledge_query_v5.js';

const MAX_DELEGATION_DEPTH = 8;

export type KnowledgeDelegationV1 = {
  version: 1;
  delegator: string;
  delegatee: string;
  action: KnowledgePolicyActionV1;
  issuedAt: number;
  expiresAt: number;
  algorithm: string;
  keyId?: string;
  signature: Uint8Array;
};

export type KnowledgeAuthorityEnvelopeV1 = {
  version: 1;
  issuer: string;
  subject: string;
  authorizationRoot: Digest;
  keyringRoot?: Digest;
  issuedAt: number;
  expiresAt: number;
  algorithm: string;
  keyId?: string;
  delegations: KnowledgeDelegationV1[];
  signature: Uint8Array;
};

export type KnowledgeAuthorityVerificationV1 = {
  valid: true;
  envelopeRoot: Digest;
  issuer: string;
  subject: string;
  authorizationRoot: Digest;
  keyringRoot?: Digest;
  delegationDepth: number;
};

export type KnowledgeAuthorityVerificationOptionsV1 = {
  now: number;
  resolveKey: (principal: string, algorithm: string, keyId?: string) => Uint8Array | undefined;
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
  maxDelegationDepth?: number;
  expectedKeyringRoot?: Digest;
};

export type KnowledgeAuthorityAsyncVerificationOptionsV1 = Omit<KnowledgeAuthorityVerificationOptionsV1, 'verifySignature'> & {
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean | Promise<boolean>;
};

export function authorityEnvelopePayloadV1(envelope: KnowledgeAuthorityEnvelopeV1): Uint8Array {
  return canonicalCbor({
    algorithm: envelope.algorithm,
    authorizationRoot: envelope.authorizationRoot,
    delegations: envelope.delegations.map((delegation) => delegationRootPayload(delegation)),
    expiresAt: envelope.expiresAt,
    issuedAt: envelope.issuedAt,
    issuer: envelope.issuer,
    subject: envelope.subject,
    version: envelope.version,
    ...(envelope.keyringRoot === undefined ? {} : { keyringRoot: envelope.keyringRoot }),
    ...(envelope.keyId === undefined ? {} : { keyId: envelope.keyId }),
  } as unknown as CborValue);
}

export function delegationPayloadV1(delegation: KnowledgeDelegationV1): Uint8Array {
  return canonicalCbor({
    action: delegation.action,
    algorithm: delegation.algorithm,
    delegatee: delegation.delegatee,
    delegator: delegation.delegator,
    expiresAt: delegation.expiresAt,
    issuedAt: delegation.issuedAt,
    version: delegation.version,
    ...(delegation.keyId === undefined ? {} : { keyId: delegation.keyId }),
  } as unknown as CborValue);
}

export function authorityEnvelopeRootV1(envelope: KnowledgeAuthorityEnvelopeV1): Digest {
  return digestDomain('authority-envelope', canonicalCbor({
    payload: authorityEnvelopePayloadV1(envelope),
    signature: envelope.signature,
  } as unknown as CborValue));
}

export function delegationRootV1(delegation: KnowledgeDelegationV1): Digest {
  return digestDomain('delegation', canonicalCbor({
    payload: delegationPayloadV1(delegation),
    signature: delegation.signature,
  } as unknown as CborValue));
}

export function verifyKnowledgeAuthorityEnvelopeV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  queryResult: KnowledgeQueryResultV1,
  policy: KnowledgePolicyV1,
  authorization: KnowledgeAuthorizationResultV1,
  envelope: KnowledgeAuthorityEnvelopeV1,
  options: KnowledgeAuthorityVerificationOptionsV1,
): KnowledgeAuthorityVerificationV1 {
  const image = isKnowledgeImage(input) ? input : mountKnowledgeImageV5(input);
  validateAuthorityEnvelope(envelope, options.now);
  verifyKnowledgeAuthorizationResultV5(image, queryResult, policy, authorization);
  if (authorization.stateRoot !== image.stateRoot || envelope.authorizationRoot !== authorization.authorizationRoot) throw new Error('V5 authority authorization root mismatch.');
  if (envelope.keyringRoot !== undefined && options.expectedKeyringRoot !== envelope.keyringRoot) throw new Error('V5 authority keyring root mismatch.');
  if (envelope.subject !== authorization.principal) throw new Error('V5 authority subject does not match the authorization principal.');
  const maxDepth = options.maxDelegationDepth ?? MAX_DELEGATION_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DELEGATION_DEPTH || envelope.delegations.length > maxDepth) throw new Error('V5 authority delegation depth exceeds the limit.');

  verifyPrincipalSignature(envelope.issuer, envelope.algorithm, envelope.keyId, authorityEnvelopePayloadV1(envelope), envelope.signature, options);
  let previous = envelope.issuer;
  for (const delegation of envelope.delegations) {
    validateDelegation(delegation, options.now, authorization.action);
    if (delegation.delegator !== previous) throw new Error('V5 delegation chain is discontinuous.');
    verifyPrincipalSignature(delegation.delegator, delegation.algorithm, delegation.keyId, delegationPayloadV1(delegation), delegation.signature, options);
    previous = delegation.delegatee;
  }
  if (envelope.delegations.length > 0 && previous !== envelope.subject) throw new Error('V5 delegation chain does not reach the authority subject.');
  return { valid: true, envelopeRoot: authorityEnvelopeRootV1(envelope), issuer: envelope.issuer, subject: envelope.subject, authorizationRoot: envelope.authorizationRoot, ...(envelope.keyringRoot === undefined ? {} : { keyringRoot: envelope.keyringRoot }), delegationDepth: envelope.delegations.length };
}

export async function verifyKnowledgeAuthorityEnvelopeV5Async(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  queryResult: KnowledgeQueryResultV1,
  policy: KnowledgePolicyV1,
  authorization: KnowledgeAuthorizationResultV1,
  envelope: KnowledgeAuthorityEnvelopeV1,
  options: KnowledgeAuthorityAsyncVerificationOptionsV1,
): Promise<KnowledgeAuthorityVerificationV1> {
  const image = isKnowledgeImage(input) ? input : mountKnowledgeImageV5(input);
  validateAuthorityEnvelope(envelope, options.now);
  verifyKnowledgeAuthorizationResultV5(image, queryResult, policy, authorization);
  if (authorization.stateRoot !== image.stateRoot || envelope.authorizationRoot !== authorization.authorizationRoot) throw new Error('V5 authority authorization root mismatch.');
  if (envelope.keyringRoot !== undefined && options.expectedKeyringRoot !== envelope.keyringRoot) throw new Error('V5 authority keyring root mismatch.');
  if (envelope.subject !== authorization.principal) throw new Error('V5 authority subject does not match the authorization principal.');
  const maxDepth = options.maxDelegationDepth ?? MAX_DELEGATION_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DELEGATION_DEPTH || envelope.delegations.length > maxDepth) throw new Error('V5 authority delegation depth exceeds the limit.');
  await verifyPrincipalSignatureAsync(envelope.issuer, envelope.algorithm, envelope.keyId, authorityEnvelopePayloadV1(envelope), envelope.signature, options);
  let previous = envelope.issuer;
  for (const delegation of envelope.delegations) {
    validateDelegation(delegation, options.now, authorization.action);
    if (delegation.delegator !== previous) throw new Error('V5 delegation chain is discontinuous.');
    await verifyPrincipalSignatureAsync(delegation.delegator, delegation.algorithm, delegation.keyId, delegationPayloadV1(delegation), delegation.signature, options);
    previous = delegation.delegatee;
  }
  if (envelope.delegations.length > 0 && previous !== envelope.subject) throw new Error('V5 delegation chain does not reach the authority subject.');
  return { valid: true, envelopeRoot: authorityEnvelopeRootV1(envelope), issuer: envelope.issuer, subject: envelope.subject, authorizationRoot: envelope.authorizationRoot, ...(envelope.keyringRoot === undefined ? {} : { keyringRoot: envelope.keyringRoot }), delegationDepth: envelope.delegations.length };
}

function validateAuthorityEnvelope(envelope: KnowledgeAuthorityEnvelopeV1, now: number): void {
  if (envelope.version !== 1 || !envelope.issuer || !envelope.subject || !envelope.algorithm || (envelope.keyId !== undefined && !envelope.keyId) || (envelope.keyringRoot !== undefined && !envelope.keyringRoot) || !(envelope.signature instanceof Uint8Array)) throw new Error('Malformed V5 authority envelope.');
  if (envelope.keyringRoot !== undefined) digestBytes(envelope.keyringRoot);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(envelope.issuedAt) || !Number.isSafeInteger(envelope.expiresAt) || envelope.issuedAt > now || now >= envelope.expiresAt) throw new Error('V5 authority envelope is outside its validity window.');
}

function validateDelegation(delegation: KnowledgeDelegationV1, now: number, action: KnowledgePolicyActionV1): void {
  if (delegation.version !== 1 || !delegation.delegator || !delegation.delegatee || !delegation.algorithm || (delegation.keyId !== undefined && !delegation.keyId) || !(delegation.signature instanceof Uint8Array)) throw new Error('Malformed V5 delegation.');
  if (delegation.action !== action || !Number.isSafeInteger(delegation.issuedAt) || !Number.isSafeInteger(delegation.expiresAt) || delegation.issuedAt > now || now >= delegation.expiresAt) throw new Error('V5 delegation is invalid for this action or time.');
}

function verifyPrincipalSignature(principal: string, algorithm: string, keyId: string | undefined, message: Uint8Array, signature: Uint8Array, options: KnowledgeAuthorityVerificationOptionsV1): void {
  const key = options.resolveKey(principal, algorithm, keyId);
  if (!(key instanceof Uint8Array) || !options.verifySignature(algorithm, key, message, signature)) throw new Error(`V5 authority signature verification failed for ${principal}.`);
}

async function verifyPrincipalSignatureAsync(principal: string, algorithm: string, keyId: string | undefined, message: Uint8Array, signature: Uint8Array, options: KnowledgeAuthorityAsyncVerificationOptionsV1): Promise<void> {
  const key = options.resolveKey(principal, algorithm, keyId);
  if (!(key instanceof Uint8Array) || !await options.verifySignature(algorithm, key, message, signature)) throw new Error(`V5 authority signature verification failed for ${principal}.`);
}

function delegationRootPayload(delegation: KnowledgeDelegationV1): Digest {
  return digestDomain('delegation-payload', delegationPayloadV1(delegation));
}

function isKnowledgeImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 {
  return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input;
}
