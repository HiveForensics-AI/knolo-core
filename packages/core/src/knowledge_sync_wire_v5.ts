import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestBytes,
  type CborValue,
  type Digest,
} from './knowledge_image_v5.js';
import {
  syncRequestPayloadV1,
  syncResponsePayloadV1,
  type KnowledgeSyncRequestV1,
  type KnowledgeSyncResponseV1,
} from './knowledge_sync_protocol_v5.js';
import {
  syncSummaryRootV1,
  type KnowledgeSyncRelationV1,
  type KnowledgeSyncSummaryV1,
} from './knowledge_sync_v5.js';

export const KNOWLEDGE_SYNC_MAX_WIRE_BYTES_V1 = 1024 * 1024;

/** Encode a signed request as a bounded, canonical CBOR wire message. */
export function encodeKnowledgeSyncRequestV1(request: KnowledgeSyncRequestV1): Uint8Array {
  validateSignedRequest(request);
  return boundedEncode(requestToCbor(request));
}

/** Decode and structurally validate a canonical signed request. */
export function decodeKnowledgeSyncRequestV1(input: ArrayBufferLike | Uint8Array): KnowledgeSyncRequestV1 {
  const record = asRecord(decodeBounded(input));
  assertKeys(record, ['algorithm', 'expiresAt', 'issuedAt', 'keyId', 'keyringRoot', 'kind', 'nonce', 'requestId', 'sender', 'signature', 'summary', 'version', 'wantEventIds', 'wantObjectIds'], []);
  const request: KnowledgeSyncRequestV1 = {
    version: asVersion(record.version),
    kind: asLiteral(record.kind, 'sync-request'),
    requestId: asDigest(record.requestId),
    sender: asText(record.sender),
    summary: asSummary(record.summary),
    wantObjectIds: asDigestArray(record.wantObjectIds),
    wantEventIds: asDigestArray(record.wantEventIds),
    algorithm: asText(record.algorithm),
    ...asOptionalText('keyId', record.keyId),
    ...asOptionalDigest('keyringRoot', record.keyringRoot),
    nonce: asBytes(record.nonce),
    issuedAt: asSafeNumber(record.issuedAt),
    expiresAt: asSafeNumber(record.expiresAt),
    signature: asBytes(record.signature),
  };
  validateSignedRequest(request);
  return request;
}

/** Encode a signed response as a bounded, canonical CBOR wire message. */
export function encodeKnowledgeSyncResponseV1(response: KnowledgeSyncResponseV1): Uint8Array {
  validateSignedResponse(response);
  return boundedEncode(responseToCbor(response));
}

/** Decode and structurally validate a canonical signed response. */
export function decodeKnowledgeSyncResponseV1(input: ArrayBufferLike | Uint8Array): KnowledgeSyncResponseV1 {
  const record = asRecord(decodeBounded(input));
  assertKeys(record, ['algorithm', 'eventIds', 'expiresAt', 'issuedAt', 'keyId', 'keyringRoot', 'kind', 'objectIds', 'relation', 'requestRoot', 'responder', 'signature', 'summary', 'version'], []);
  const response: KnowledgeSyncResponseV1 = {
    version: asVersion(record.version),
    kind: asLiteral(record.kind, 'sync-response'),
    requestRoot: asDigest(record.requestRoot),
    responder: asText(record.responder),
    summary: asSummary(record.summary),
    relation: asRelation(record.relation),
    objectIds: asDigestArray(record.objectIds),
    eventIds: asDigestArray(record.eventIds),
    algorithm: asText(record.algorithm),
    ...asOptionalText('keyId', record.keyId),
    ...asOptionalDigest('keyringRoot', record.keyringRoot),
    issuedAt: asSafeNumber(record.issuedAt),
    expiresAt: asSafeNumber(record.expiresAt),
    signature: asBytes(record.signature),
  };
  validateSignedResponse(response);
  return response;
}

function requestToCbor(request: KnowledgeSyncRequestV1): CborValue {
  return {
    algorithm: request.algorithm,
    expiresAt: request.expiresAt,
    issuedAt: request.issuedAt,
    keyId: request.keyId ?? null,
    keyringRoot: request.keyringRoot ?? null,
    kind: request.kind,
    nonce: request.nonce,
    requestId: request.requestId,
    sender: request.sender,
    signature: request.signature,
    summary: summaryToCbor(request.summary),
    version: request.version,
    wantEventIds: request.wantEventIds,
    wantObjectIds: request.wantObjectIds,
  };
}

function responseToCbor(response: KnowledgeSyncResponseV1): CborValue {
  return {
    algorithm: response.algorithm,
    eventIds: response.eventIds,
    expiresAt: response.expiresAt,
    issuedAt: response.issuedAt,
    keyId: response.keyId ?? null,
    keyringRoot: response.keyringRoot ?? null,
    kind: response.kind,
    objectIds: response.objectIds,
    relation: response.relation,
    requestRoot: response.requestRoot,
    responder: response.responder,
    signature: response.signature,
    summary: summaryToCbor(response.summary),
    version: response.version,
  };
}

function summaryToCbor(summary: KnowledgeSyncSummaryV1): CborValue {
  return {
    commitDigest: summary.commitDigest,
    eventRoot: summary.eventRoot,
    keyringRoot: summary.keyringRoot ?? null,
    objectRoot: summary.objectRoot,
    parents: summary.parents,
    sequence: summary.sequence,
    stateRoot: summary.stateRoot,
    summaryRoot: summary.summaryRoot,
    version: summary.version,
  };
}

function asSummary(value: CborValue | undefined): KnowledgeSyncSummaryV1 {
  const record = asRecord(value);
  assertKeys(record, ['commitDigest', 'eventRoot', 'keyringRoot', 'objectRoot', 'parents', 'sequence', 'stateRoot', 'summaryRoot', 'version'], []);
  const summary: KnowledgeSyncSummaryV1 = {
    version: asVersion(record.version),
    stateRoot: asDigest(record.stateRoot),
    commitDigest: asDigest(record.commitDigest),
    sequence: asSafeNumber(record.sequence),
    parents: asDigestArray(record.parents),
    objectRoot: asDigest(record.objectRoot),
    eventRoot: asDigest(record.eventRoot),
    ...asOptionalDigest('keyringRoot', record.keyringRoot),
    summaryRoot: asDigest(record.summaryRoot),
  };
  if (syncSummaryRootV1(summary) !== summary.summaryRoot) throw new Error('Malformed V5 sync summary wire value.');
  return summary;
}

function validateSignedRequest(request: KnowledgeSyncRequestV1): void {
  syncRequestPayloadV1(request);
  digestBytes(request.requestId);
  if (!(request.signature instanceof Uint8Array) || request.signature.length === 0) throw new Error('V5 sync request wire message must be signed.');
}

function validateSignedResponse(response: KnowledgeSyncResponseV1): void {
  syncResponsePayloadV1(response);
  if (!(response.signature instanceof Uint8Array) || response.signature.length === 0) throw new Error('V5 sync response wire message must be signed.');
}

function boundedEncode(value: CborValue): Uint8Array {
  const bytes = canonicalCbor(value);
  if (bytes.length > KNOWLEDGE_SYNC_MAX_WIRE_BYTES_V1) throw new Error('V5 sync wire message exceeds the size limit.');
  return bytes;
}

function decodeBounded(input: ArrayBufferLike | Uint8Array): CborValue {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > KNOWLEDGE_SYNC_MAX_WIRE_BYTES_V1) throw new Error('V5 sync wire message exceeds the size limit.');
  return decodeCanonicalCbor(bytes);
}

function asRecord(value: CborValue | undefined): Record<string, CborValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Malformed V5 sync wire map.');
  return value as Record<string, CborValue>;
}
function assertKeys(record: Record<string, CborValue>, required: string[], optional: string[]): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(record);
  if (keys.length !== required.length + keys.filter((key) => optional.includes(key)).length || required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) || keys.some((key) => !allowed.has(key))) throw new Error('Malformed V5 sync wire fields.');
}
function asText(value: CborValue | undefined): string { if (typeof value !== 'string' || !value) throw new Error('Malformed V5 sync wire text.'); return value; }
function asLiteral<T extends string>(value: CborValue | undefined, expected: T): T { return asText(value) === expected ? expected : (() => { throw new Error('Malformed V5 sync wire kind.'); })(); }
function asVersion(value: CborValue | undefined): 1 { return asSafeNumber(value) === 1 ? 1 : (() => { throw new Error('Unsupported V5 sync wire version.'); })(); }
function asSafeNumber(value: CborValue | undefined): number { const number = typeof value === 'bigint' ? Number(value) : value; if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('Malformed V5 sync wire integer.'); return number; }
function asBytes(value: CborValue | undefined): Uint8Array { if (!(value instanceof Uint8Array)) throw new Error('Malformed V5 sync wire bytes.'); return value; }
function asDigest(value: CborValue | undefined): Digest { const text = asText(value); digestBytes(text); return text; }
function asDigestArray(value: CborValue | undefined): Digest[] { if (!Array.isArray(value)) throw new Error('Malformed V5 sync wire digest list.'); return value.map((item) => asDigest(item)); }
function asRelation(value: CborValue | undefined): KnowledgeSyncRelationV1 { const relation = asText(value); if (!['equal', 'local-ahead', 'remote-ahead', 'diverged'].includes(relation)) throw new Error('Malformed V5 sync wire relation.'); return relation as KnowledgeSyncRelationV1; }
function asOptionalText(key: string, value: CborValue | undefined): { [key: string]: string | undefined } { if (value === null) return {}; return { [key]: asText(value) }; }
function asOptionalDigest(key: string, value: CborValue | undefined): { [key: string]: Digest | undefined } { if (value === null) return {}; return { [key]: asDigest(value) }; }
