import {
  decodeKnowledgeSyncResponseV1,
  encodeKnowledgeSyncRequestV1,
} from './knowledge_sync_wire_v5.js';
import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestBytes,
  digestDomain,
  mountKnowledgeImageV5,
  type CborValue,
  type KnowledgeImageV5,
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
  onChange?: (state: KnowledgeSyncReplayStateV1) => void;
};

export type KnowledgeSyncReplayEntryV1 = { requestId: Digest; expiresAt: number };
export type KnowledgeSyncReplayStateV1 = { version: 1; maxEntries: number; entries: KnowledgeSyncReplayEntryV1[]; cacheRoot: Digest };

/**
 * A bounded request replay cache. Entries are admitted only after the signed
 * request and its response have both been verified by an exchange helper.
 */
export class KnowledgeSyncReplayCacheV1 {
  private readonly maxEntries: number;
  private readonly onChange?: (state: KnowledgeSyncReplayStateV1) => void;
  private readonly entries = new Map<Digest, number>();

  constructor(options: KnowledgeSyncReplayCacheOptionsV1 = {}, initialEntries: KnowledgeSyncReplayEntryV1[] = []) {
    const maxEntries = options.maxEntries ?? 1024;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('V5 sync replay cache capacity must be a positive safe integer.');
    this.maxEntries = maxEntries;
    this.onChange = options.onChange;
    if (initialEntries.length > maxEntries || initialEntries.some((entry) => !isDigest(entry.requestId) || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt < 0)) throw new Error('Malformed V5 sync replay state entries.');
    for (const entry of initialEntries) this.entries.set(entry.requestId, entry.expiresAt);
  }

  static fromState(state: KnowledgeSyncReplayStateV1, options: Omit<KnowledgeSyncReplayCacheOptionsV1, 'maxEntries'> = {}): KnowledgeSyncReplayCacheV1 {
    validateReplayState(state);
    return new KnowledgeSyncReplayCacheV1({ ...options, maxEntries: state.maxEntries }, state.entries);
  }

  get size(): number { return this.entries.size; }

  has(requestId: Digest, now: number): boolean {
    validateNow(now);
    validateDigest(requestId);
    const next = this.entriesAt(now);
    if (next.size !== this.entries.size) this.commit(next);
    return next.has(requestId);
  }

  /** Record a request only after its authenticated exchange has succeeded. */
  acceptVerifiedRequest(request: Pick<KnowledgeSyncRequestV1, 'requestId' | 'expiresAt'>, now: number): void {
    validateNow(now);
    validateDigest(request.requestId);
    if (!Number.isSafeInteger(request.expiresAt) || now >= request.expiresAt) throw new Error('V5 sync request is outside its validity window.');
    const next = this.entriesAt(now);
    if (next.has(request.requestId)) throw new Error('V5 sync request replay detected.');
    if (next.size >= this.maxEntries) throw new Error('V5 sync replay cache capacity exhausted.');
    next.set(request.requestId, request.expiresAt);
    this.commit(next);
  }

  clear(): void { this.commit(new Map()); }

  snapshot(): KnowledgeSyncReplayStateV1 { return replayState(this.maxEntries, this.entries); }

  private entriesAt(now: number): Map<Digest, number> {
    const next = new Map<Digest, number>();
    for (const [requestId, expiresAt] of this.entries) if (expiresAt > now) next.set(requestId, expiresAt);
    return next;
  }

  private commit(next: Map<Digest, number>): void {
    if (this.onChange) this.onChange(replayState(this.maxEntries, next));
    this.entries.clear();
    for (const [requestId, expiresAt] of next) this.entries.set(requestId, expiresAt);
  }
}

export function serializeKnowledgeSyncReplayStateV1(state: KnowledgeSyncReplayStateV1): Uint8Array {
  validateReplayState(state);
  return canonicalCbor({ cacheRoot: state.cacheRoot, entries: state.entries, maxEntries: state.maxEntries, version: state.version } as unknown as CborValue);
}

export function deserializeKnowledgeSyncReplayStateV1(bytes: Uint8Array): KnowledgeSyncReplayStateV1 {
  const record = asRecord(decodeCanonicalCbor(bytes));
  const entries = Array.isArray(record.entries) ? record.entries.map((entry) => { const item = asRecord(entry); return { requestId: asDigest(item.requestId), expiresAt: asNumber(item.expiresAt) }; }) : (() => { throw new Error('Malformed V5 sync replay state entries.'); })();
  const state: KnowledgeSyncReplayStateV1 = { version: asNumber(record.version) as 1, maxEntries: asNumber(record.maxEntries), entries, cacheRoot: asDigest(record.cacheRoot) };
  validateReplayState(state);
  return state;
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

export type KnowledgeSyncImageTransportV1 = {
  requestImage: (requestBytes: Uint8Array) => { responseBytes: ArrayBufferLike | Uint8Array; imageBytes: ArrayBufferLike | Uint8Array } | Promise<{ responseBytes: ArrayBufferLike | Uint8Array; imageBytes: ArrayBufferLike | Uint8Array }>;
};

export type KnowledgeSyncImageTransportExchangeOptionsV1 = KnowledgeSyncExchangeAsyncVerificationOptionsV1 & { transport: KnowledgeSyncImageTransportV1 };

export type KnowledgeSyncImageTransportExchangeResultV1 = KnowledgeSyncTransportExchangeResultV1 & { image: KnowledgeImageV5; imageBytes: Uint8Array };

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

/** Exchange signed metadata and a complete verified Knowledge Image over a host transport. */
export async function exchangeKnowledgeSyncImageOverTransportV5(
  request: KnowledgeSyncRequestV1,
  options: KnowledgeSyncImageTransportExchangeOptionsV1,
): Promise<KnowledgeSyncImageTransportExchangeResultV1> {
  const requestBytes = encodeKnowledgeSyncRequestV1(request);
  await verifyKnowledgeSyncRequestV5Async(request, options);
  if (options.replayCache.has(request.requestId, options.now)) throw new Error('V5 sync request replay detected.');
  const transfer = await options.transport.requestImage(requestBytes.slice());
  const responseBytes = asTransportBytes(transfer.responseBytes);
  const imageBytes = asTransportBytes(transfer.imageBytes);
  const response = decodeKnowledgeSyncResponseV1(responseBytes);
  await verifyKnowledgeSyncResponseV5Async(request, response, options);
  const image = mountKnowledgeImageV5(imageBytes);
  if (image.stateRoot !== response.summary.stateRoot) throw new Error('V5 sync transfer image state root mismatch.');
  if (response.objectIds.some((id) => !image.objects.some((object) => object.id === id)) || response.eventIds.some((id) => !image.events.some((event) => event.id === id))) throw new Error('V5 sync transfer response references missing image records.');
  options.replayCache.acceptVerifiedRequest(request, options.now);
  return { request, response, requestBytes, responseBytes, image, imageBytes };
}

function validateDigest(value: Digest): void { digestBytes(value); }
function validateNow(now: number): void { if (!Number.isSafeInteger(now)) throw new Error('V5 sync replay cache time must be a safe integer.'); }
function asTransportBytes(input: ArrayBufferLike | Uint8Array): Uint8Array { return input instanceof Uint8Array ? input.slice() : new Uint8Array(input); }
function replayState(maxEntries: number, entries: Map<Digest, number>): KnowledgeSyncReplayStateV1 { const ordered = [...entries].map(([requestId, expiresAt]) => ({ requestId, expiresAt })).sort((left, right) => compareUtf8(left.requestId, right.requestId)); const body = { entries: ordered, maxEntries, version: 1 as const }; return { ...body, cacheRoot: digestDomain('sync-replay-cache', canonicalCbor(body as unknown as CborValue)) }; }
function validateReplayState(state: KnowledgeSyncReplayStateV1): void { if (!state || state.version !== 1 || !Number.isSafeInteger(state.maxEntries) || state.maxEntries < 1 || !Array.isArray(state.entries) || state.entries.length > state.maxEntries || !isDigest(state.cacheRoot)) throw new Error('Malformed V5 sync replay state.'); for (let i = 0; i < state.entries.length; i++) { const entry = state.entries[i]; if (!isDigest(entry.requestId) || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt < 0 || i > 0 && compareUtf8(state.entries[i - 1].requestId, entry.requestId) >= 0) throw new Error('Malformed V5 sync replay state entries.'); } const body = { entries: state.entries, maxEntries: state.maxEntries, version: 1 as const }; if (digestDomain('sync-replay-cache', canonicalCbor(body as unknown as CborValue)) !== state.cacheRoot) throw new Error('V5 sync replay state root mismatch.'); }
function isDigest(value: unknown): value is Digest { if (typeof value !== 'string') return false; try { digestBytes(value); return true; } catch { return false; } }
function compareUtf8(left: string, right: string): number { const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
function asRecord(value: CborValue): Record<string, CborValue> { if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Malformed V5 sync replay state map.'); return value as Record<string, CborValue>; }
function asNumber(value: CborValue | undefined): number { const number = typeof value === 'bigint' ? Number(value) : value; if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('Malformed V5 sync replay state integer.'); return number; }
function asDigest(value: CborValue | undefined): Digest { if (typeof value !== 'string' || !isDigest(value)) throw new Error('Malformed V5 sync replay state digest.'); return value; }
