import {
  canonicalCbor,
  digestBytes,
  digestDomain,
  type CborValue,
  type Digest,
} from './knowledge_image_v5.js';
import {
  syncSummaryRootV1,
  type KnowledgeSyncRelationV1,
  type KnowledgeSyncSummaryV1,
} from './knowledge_sync_v5.js';
import type { Ed25519AuthorityKeyringV1 } from './knowledge_crypto_v5.js';

export type KnowledgeSyncRequestV1 = {
  version: 1;
  kind: 'sync-request';
  requestId: Digest;
  sender: string;
  summary: KnowledgeSyncSummaryV1;
  wantObjectIds: Digest[];
  wantEventIds: Digest[];
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  nonce: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export type KnowledgeSyncResponseV1 = {
  version: 1;
  kind: 'sync-response';
  requestRoot: Digest;
  responder: string;
  summary: KnowledgeSyncSummaryV1;
  relation: KnowledgeSyncRelationV1;
  objectIds: Digest[];
  eventIds: Digest[];
  algorithm: string;
  keyId?: string;
  keyringRoot?: Digest;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export type KnowledgeSyncMessageVerificationOptionsV1 = {
  now: number;
  resolveKey: (principal: string, algorithm: string, keyId?: string) => Uint8Array | undefined;
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
  expectedKeyringRoot?: Digest;
};

export type KnowledgeSyncMessageAsyncVerificationOptionsV1 = Omit<KnowledgeSyncMessageVerificationOptionsV1, 'verifySignature'> & {
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean | Promise<boolean>;
};

export function createKnowledgeSyncRequestV1(input: Omit<KnowledgeSyncRequestV1, 'requestId' | 'signature'>): KnowledgeSyncRequestV1 {
  const requestBody = { ...input, signature: new Uint8Array(), requestId: '' };
  validateRequest(requestBody, false);
  const requestId = digestDomain('sync-request-id', canonicalCbor({
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    sender: input.sender,
    summaryRoot: input.summary.summaryRoot,
    wantEventIds: input.wantEventIds,
    wantObjectIds: input.wantObjectIds,
    version: 1,
  } as unknown as CborValue));
  return { ...requestBody, requestId, signature: new Uint8Array() };
}

export function createKnowledgeSyncResponseV1(input: Omit<KnowledgeSyncResponseV1, 'requestRoot' | 'signature'> & { request: KnowledgeSyncRequestV1 }): KnowledgeSyncResponseV1 {
  const response = { ...input, requestRoot: syncRequestRootV1(input.request), signature: new Uint8Array() };
  delete (response as { request?: KnowledgeSyncRequestV1 }).request;
  validateResponse(response, false);
  return response;
}

export function syncRequestPayloadV1(request: KnowledgeSyncRequestV1): Uint8Array {
  validateRequest(request, false);
  return canonicalCbor({
    algorithm: request.algorithm,
    expiresAt: request.expiresAt,
    issuedAt: request.issuedAt,
    keyringRoot: request.keyringRoot ?? null,
    keyId: request.keyId ?? null,
    kind: request.kind,
    nonce: request.nonce,
    requestId: request.requestId,
    sender: request.sender,
    summary: request.summary.summaryRoot,
    version: request.version,
    wantEventIds: request.wantEventIds,
    wantObjectIds: request.wantObjectIds,
  } as unknown as CborValue);
}

export function syncResponsePayloadV1(response: KnowledgeSyncResponseV1): Uint8Array {
  validateResponse(response, false);
  return canonicalCbor({
    algorithm: response.algorithm,
    eventIds: response.eventIds,
    expiresAt: response.expiresAt,
    issuedAt: response.issuedAt,
    keyringRoot: response.keyringRoot ?? null,
    keyId: response.keyId ?? null,
    kind: response.kind,
    objectIds: response.objectIds,
    relation: response.relation,
    requestRoot: response.requestRoot,
    responder: response.responder,
    summary: response.summary.summaryRoot,
    version: response.version,
  } as unknown as CborValue);
}

export function syncRequestRootV1(request: KnowledgeSyncRequestV1): Digest {
  return digestDomain('sync-request', canonicalCbor({ payload: syncRequestPayloadV1(request), signature: request.signature } as unknown as CborValue));
}

export function syncResponseRootV1(response: KnowledgeSyncResponseV1): Digest {
  return digestDomain('sync-response', canonicalCbor({ payload: syncResponsePayloadV1(response), signature: response.signature } as unknown as CborValue));
}

export function verifyKnowledgeSyncRequestV5(request: KnowledgeSyncRequestV1, options: KnowledgeSyncMessageVerificationOptionsV1): void {
  validateRequest(request, true);
  validateMessageTime(request.issuedAt, request.expiresAt, options.now);
  if (request.keyringRoot !== undefined && options.expectedKeyringRoot !== request.keyringRoot) throw new Error('V5 sync request keyring root mismatch.');
  const key = options.resolveKey(request.sender, request.algorithm, request.keyId);
  if (!(key instanceof Uint8Array) || !options.verifySignature(request.algorithm, key, syncRequestPayloadV1(request), request.signature)) throw new Error('V5 sync request signature verification failed.');
}

export async function verifyKnowledgeSyncRequestV5Async(request: KnowledgeSyncRequestV1, options: KnowledgeSyncMessageAsyncVerificationOptionsV1): Promise<void> {
  validateRequest(request, true);
  validateMessageTime(request.issuedAt, request.expiresAt, options.now);
  if (request.keyringRoot !== undefined && options.expectedKeyringRoot !== request.keyringRoot) throw new Error('V5 sync request keyring root mismatch.');
  const key = options.resolveKey(request.sender, request.algorithm, request.keyId);
  if (!(key instanceof Uint8Array) || !await options.verifySignature(request.algorithm, key, syncRequestPayloadV1(request), request.signature)) throw new Error('V5 sync request signature verification failed.');
}

export function verifyKnowledgeSyncResponseV5(request: KnowledgeSyncRequestV1, response: KnowledgeSyncResponseV1, options: KnowledgeSyncMessageVerificationOptionsV1): void {
  validateResponse(response, true);
  validateMessageTime(response.issuedAt, response.expiresAt, options.now);
  if (response.requestRoot !== syncRequestRootV1(request)) throw new Error('V5 sync response request binding mismatch.');
  if (request.keyringRoot !== undefined && response.keyringRoot !== request.keyringRoot) throw new Error('V5 sync response keyring root mismatch.');
  if (response.keyringRoot !== undefined && options.expectedKeyringRoot !== response.keyringRoot) throw new Error('V5 sync response keyring root mismatch.');
  const key = options.resolveKey(response.responder, response.algorithm, response.keyId);
  if (!(key instanceof Uint8Array) || !options.verifySignature(response.algorithm, key, syncResponsePayloadV1(response), response.signature)) throw new Error('V5 sync response signature verification failed.');
}

export async function verifyKnowledgeSyncResponseV5Async(request: KnowledgeSyncRequestV1, response: KnowledgeSyncResponseV1, options: KnowledgeSyncMessageAsyncVerificationOptionsV1): Promise<void> {
  validateResponse(response, true);
  validateMessageTime(response.issuedAt, response.expiresAt, options.now);
  if (response.requestRoot !== syncRequestRootV1(request)) throw new Error('V5 sync response request binding mismatch.');
  if (request.keyringRoot !== undefined && response.keyringRoot !== request.keyringRoot) throw new Error('V5 sync response keyring root mismatch.');
  if (response.keyringRoot !== undefined && options.expectedKeyringRoot !== response.keyringRoot) throw new Error('V5 sync response keyring root mismatch.');
  const key = options.resolveKey(response.responder, response.algorithm, response.keyId);
  if (!(key instanceof Uint8Array) || !await options.verifySignature(response.algorithm, key, syncResponsePayloadV1(response), response.signature)) throw new Error('V5 sync response signature verification failed.');
}

function validateRequest(request: KnowledgeSyncRequestV1, requireSignature: boolean): void {
  if (request.version !== 1 || request.kind !== 'sync-request' || (requireSignature && !request.requestId) || !request.sender || !request.algorithm || (request.keyId !== undefined && !request.keyId) || !(request.nonce instanceof Uint8Array) || request.nonce.length === 0 || request.nonce.length > 64 || (requireSignature && (!(request.signature instanceof Uint8Array) || request.signature.length === 0))) throw new Error('Malformed V5 sync request.');
  validateSummary(request.summary);
  if (requireSignature) validateDigest(request.requestId);
  if (requireSignature && request.requestId !== expectedRequestId(request)) throw new Error('V5 sync request ID mismatch.');
  validateIds(request.wantObjectIds);
  validateIds(request.wantEventIds);
  validateWindow(request.issuedAt, request.expiresAt);
  if (request.keyringRoot !== undefined) validateDigest(request.keyringRoot);
}

function validateResponse(response: KnowledgeSyncResponseV1, requireSignature: boolean): void {
  if (response.version !== 1 || response.kind !== 'sync-response' || !response.requestRoot || !response.responder || !response.algorithm || !['equal', 'local-ahead', 'remote-ahead', 'diverged'].includes(response.relation) || (response.keyId !== undefined && !response.keyId) || (requireSignature && (!(response.signature instanceof Uint8Array) || response.signature.length === 0))) throw new Error('Malformed V5 sync response.');
  validateSummary(response.summary);
  validateDigest(response.requestRoot);
  validateIds(response.objectIds);
  validateIds(response.eventIds);
  validateWindow(response.issuedAt, response.expiresAt);
  if (response.keyringRoot !== undefined) validateDigest(response.keyringRoot);
}

function validateSummary(summary: KnowledgeSyncSummaryV1): void {
  if (!summary || summary.version !== 1 || syncSummaryRootV1(summary) !== summary.summaryRoot) throw new Error('Malformed V5 sync summary.');
}
function validateIds(ids: Digest[]): void { if (!Array.isArray(ids) || ids.some((id) => { try { validateDigest(id); return false; } catch { return true; } }) || ids.some((id, index) => index > 0 && compareUtf8(ids[index - 1], id) >= 0)) throw new Error('Invalid V5 sync digest list.'); }
function validateDigest(digest: Digest): void { digestBytes(digest); }
function expectedRequestId(request: KnowledgeSyncRequestV1): Digest {
  return digestDomain('sync-request-id', canonicalCbor({
    expiresAt: request.expiresAt,
    issuedAt: request.issuedAt,
    nonce: request.nonce,
    sender: request.sender,
    summaryRoot: request.summary.summaryRoot,
    wantEventIds: request.wantEventIds,
    wantObjectIds: request.wantObjectIds,
    version: 1,
  } as unknown as CborValue));
}
function validateWindow(issuedAt: number, expiresAt: number): void { if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || issuedAt >= expiresAt) throw new Error('Invalid V5 sync message window.'); }
function validateMessageTime(issuedAt: number, expiresAt: number, now: number): void { if (!Number.isSafeInteger(now) || issuedAt > now || now >= expiresAt) throw new Error('V5 sync message is outside its validity window.'); }
function compareUtf8(left: string, right: string): number { const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
