import {
  decodeKnowledgeSyncResponseV1,
  encodeKnowledgeSyncRequestV1,
} from './knowledge_sync_wire_v5.js';
import {
  digestBytes,
  type Digest,
} from './knowledge_image_v5.js';
import {
  verifyKnowledgeSyncRequestV5,
  verifyKnowledgeSyncRequestV5Async,
  verifyKnowledgeSyncResponseV5,
  verifyKnowledgeSyncResponseV5Async,
  type KnowledgeSyncMessageAsyncVerificationOptionsV1,
  type KnowledgeSyncMessageVerificationOptionsV1,
  type KnowledgeSyncRequestV1,
  type KnowledgeSyncResponseV1,
} from './knowledge_sync_protocol_v5.js';

export type KnowledgeSyncReplayCacheOptionsV1 = {
  maxEntries?: number;
};

/**
 * A bounded request replay cache. Entries are admitted only after the signed
 * request and its response have both been verified by an exchange helper.
 */
export class KnowledgeSyncReplayCacheV1 {
  private readonly maxEntries: number;
  private readonly entries = new Map<Digest, number>();

  constructor(options: KnowledgeSyncReplayCacheOptionsV1 = {}) {
    const maxEntries = options.maxEntries ?? 1024;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('V5 sync replay cache capacity must be a positive safe integer.');
    this.maxEntries = maxEntries;
  }

  get size(): number { return this.entries.size; }

  has(requestId: Digest, now: number): boolean {
    validateNow(now);
    this.prune(now);
    validateDigest(requestId);
    return this.entries.has(requestId);
  }

  /** Record a request only after its authenticated exchange has succeeded. */
  acceptVerifiedRequest(request: Pick<KnowledgeSyncRequestV1, 'requestId' | 'expiresAt'>, now: number): void {
    validateNow(now);
    validateDigest(request.requestId);
    if (!Number.isSafeInteger(request.expiresAt) || now >= request.expiresAt) throw new Error('V5 sync request is outside its validity window.');
    this.prune(now);
    if (this.entries.has(request.requestId)) throw new Error('V5 sync request replay detected.');
    if (this.entries.size >= this.maxEntries) throw new Error('V5 sync replay cache capacity exhausted.');
    this.entries.set(request.requestId, request.expiresAt);
  }

  clear(): void { this.entries.clear(); }

  private prune(now: number): void {
    for (const [requestId, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(requestId);
  }
}

export type KnowledgeSyncExchangeVerificationOptionsV1 = KnowledgeSyncMessageVerificationOptionsV1 & {
  replayCache: KnowledgeSyncReplayCacheV1;
};

export type KnowledgeSyncExchangeAsyncVerificationOptionsV1 = KnowledgeSyncMessageAsyncVerificationOptionsV1 & {
  replayCache: KnowledgeSyncReplayCacheV1;
};

export type KnowledgeSyncTransportV1 = {
  request: (requestBytes: Uint8Array) => ArrayBufferLike | Uint8Array | Promise<ArrayBufferLike | Uint8Array>;
};

export type KnowledgeSyncTransportExchangeOptionsV1 = KnowledgeSyncExchangeAsyncVerificationOptionsV1 & {
  transport: KnowledgeSyncTransportV1;
};

export type KnowledgeSyncTransportExchangeResultV1 = {
  request: KnowledgeSyncRequestV1;
  response: KnowledgeSyncResponseV1;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array;
};

/** Verify both signed messages, then atomically admit the request to replay protection. */
export function verifyKnowledgeSyncExchangeV5(
  request: KnowledgeSyncRequestV1,
  response: KnowledgeSyncResponseV1,
  options: KnowledgeSyncExchangeVerificationOptionsV1,
): void {
  verifyKnowledgeSyncRequestV5(request, options);
  verifyKnowledgeSyncResponseV5(request, response, options);
  options.replayCache.acceptVerifiedRequest(request, options.now);
}

/** Async counterpart for WebCrypto and other asynchronous signature providers. */
export async function verifyKnowledgeSyncExchangeV5Async(
  request: KnowledgeSyncRequestV1,
  response: KnowledgeSyncResponseV1,
  options: KnowledgeSyncExchangeAsyncVerificationOptionsV1,
): Promise<void> {
  await verifyKnowledgeSyncRequestV5Async(request, options);
  await verifyKnowledgeSyncResponseV5Async(request, response, options);
  options.replayCache.acceptVerifiedRequest(request, options.now);
}

/**
 * Carry one signed exchange over a host-provided byte transport. The adapter
 * verifies the outbound request before sending and admits replay state only
 * after the returned response has passed all checks.
 */
export async function exchangeKnowledgeSyncOverTransportV5(
  request: KnowledgeSyncRequestV1,
  options: KnowledgeSyncTransportExchangeOptionsV1,
): Promise<KnowledgeSyncTransportExchangeResultV1> {
  const requestBytes = encodeKnowledgeSyncRequestV1(request);
  await verifyKnowledgeSyncRequestV5Async(request, options);
  if (options.replayCache.has(request.requestId, options.now)) throw new Error('V5 sync request replay detected.');
  const responseBytes = asTransportBytes(await options.transport.request(requestBytes.slice()));
  const response = decodeKnowledgeSyncResponseV1(responseBytes);
  await verifyKnowledgeSyncExchangeV5Async(request, response, options);
  return { request, response, requestBytes, responseBytes };
}

function validateDigest(value: Digest): void { digestBytes(value); }
function validateNow(now: number): void { if (!Number.isSafeInteger(now)) throw new Error('V5 sync replay cache time must be a safe integer.'); }
function asTransportBytes(input: ArrayBufferLike | Uint8Array): Uint8Array { return input instanceof Uint8Array ? input.slice() : new Uint8Array(input); }
