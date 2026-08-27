import { mountPackFromBuffer } from './pack.runtime.js';
import { inspectPackV4 } from './pack.v4.js';
import { sha256Hex } from './utils/sha256.js';
import { getTextDecoder, getTextEncoder } from './utils/utf8.js';

export const KNOWLEDGE_IMAGE_V5_MAGIC = 'KNLOV5\0\0';
export const KNOWLEDGE_IMAGE_V5_VERSION = 5;
export const KNOWLEDGE_IMAGE_V5_HEADER_SIZE = 16;
export const KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE = 128;
export const KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE = 48;

const SUPERBLOCK_MAGIC = 'KNLOSB1\0';
const SEGMENT_MAGIC = 'KSEG';
const OBJECT_SEGMENT = 1;
const EVENT_SEGMENT = 2;
const COMMIT_SEGMENT = 3;
const OPTIONAL_SEGMENT_MIN = 128;
const MAX_SEGMENT_SIZE = 512 * 1024 * 1024;
const MAX_SEGMENTS = 1024;
const SHA256_PREFIX = 'sha256-';

export type Digest = string;

export type KnowledgeObjectV1 = {
  id: Digest;
  kind: 'source' | 'chunk' | 'claims' | 'agents' | 'metadata';
  bytes: Uint8Array;
  meta: Record<string, unknown>;
};

export type KnowledgeEventV1 = {
  version: 1;
  id: Digest;
  transactionId: Digest;
  parents: Digest[];
  actor: string;
  actorCounter: number;
  kind: string;
  target: Digest;
  payload: Digest;
  provenance: Record<string, unknown>;
};

export type KnowledgeCommitV1 = {
  version: 1;
  parents: Digest[];
  transactionRoot: Digest;
  objectRoot: Digest;
  eventRoot: Digest;
  views: Record<string, Digest>;
  schemaRoot: Digest;
  policyRoot: Digest;
  runtimeContract: Digest;
  sequence: number;
  actor: string;
  objectSegmentDigest: Digest;
  eventSegmentDigest: Digest;
};

export type KnowledgePolicyRuleV1 = {
  effect: 'allow' | 'deny';
  action: 'query' | 'read';
  principal?: string;
  kind?: string;
};

export type KnowledgePolicyV1 = {
  version: 1;
  default: 'allow' | 'deny';
  rules?: KnowledgePolicyRuleV1[];
};

export type MigrationReceiptV1 = {
  version: 1;
  kind: 'v4-to-v5-migration';
  sourceDigest: Digest;
  sourceVersion: number;
  stateRoot: Digest;
  objectMappings: Array<{ legacyBlockId: number; sourceObject: Digest; chunkObject: Digest }>;
  receiptDigest: Digest;
};

export type KnowledgeImageV5 = {
  bytes: Uint8Array;
  stateRoot: Digest;
  commitDigest: Digest;
  commit: KnowledgeCommitV1;
  objects: KnowledgeObjectV1[];
  events: KnowledgeEventV1[];
  segments: KnowledgeImageSegment[];
  activeSuperblock: 'A' | 'B';
};

export type KnowledgeImageSegment = {
  kind: number;
  schema: number;
  flags: number;
  offset: number;
  length: number;
  payloadLength: number;
  digest: Digest;
};

type CborPrimitive = null | boolean | number | bigint | string | Uint8Array;
type CborValue = CborPrimitive | CborValue[] | { [key: string]: CborValue };

export type KnowledgeObjectInput = Omit<KnowledgeObjectV1, 'id'> & { id?: Digest };
type ObjectInput = KnowledgeObjectInput;

export type CreateKnowledgeImageOptions = {
  objects: ObjectInput[];
  events?: Array<Omit<KnowledgeEventV1, 'id' | 'transactionId'>>;
  parents?: Digest[];
  additionalParents?: Digest[];
  preservedEvents?: KnowledgeEventV1[];
  actor?: string;
  sequence?: number;
  views?: Record<string, Digest>;
  policy?: KnowledgePolicyV1;
  commitOverrides?: Partial<Pick<KnowledgeCommitV1, 'schemaRoot' | 'policyRoot' | 'runtimeContract' | 'views'>>;
  /** Internal/public foundation hook for append-only child commits. */
  baseImage?: KnowledgeImageV5;
};

/** Canonical policy root. An empty rule set preserves the V5 default-root form. */
export function knowledgePolicyRootV5(policy: KnowledgePolicyV1): Digest {
  if (policy.version !== 1 || (policy.default !== 'allow' && policy.default !== 'deny')) throw new Error('Unsupported V5 policy.');
  const rules = policy.rules ?? [];
  for (const rule of rules) {
    if ((rule.effect !== 'allow' && rule.effect !== 'deny') || (rule.action !== 'query' && rule.action !== 'read')) throw new Error('Invalid V5 policy rule.');
    if (rule.principal !== undefined && (!rule.principal || typeof rule.principal !== 'string')) throw new Error('Invalid V5 policy principal.');
    if (rule.kind !== undefined && (!rule.kind || typeof rule.kind !== 'string')) throw new Error('Invalid V5 policy kind.');
  }
  const normalizedRules = [...rules].sort((left, right) => compareUtf8(policyRuleKey(left), policyRuleKey(right))).map((rule) => {
    const normalized: Record<string, CborValue> = { action: rule.action, effect: rule.effect };
    if (rule.kind !== undefined) normalized.kind = rule.kind.toLowerCase();
    if (rule.principal !== undefined) normalized.principal = rule.principal;
    return normalized;
  });
  const body = normalizedRules.length > 0 ? { default: policy.default, rules: normalizedRules } : { default: policy.default };
  return digestDomain('policy', canonicalCbor(body as unknown as CborValue));
}

function policyRuleKey(rule: KnowledgePolicyRuleV1): string {
  return `${rule.effect}\0${rule.action}\0${rule.principal ?? ''}\0${rule.kind?.toLowerCase() ?? ''}`;
}

export type KnowledgeImageVerification = {
  valid: true;
  stateRoot: Digest;
  commitDigest: Digest;
  activeSuperblock: 'A' | 'B';
  segments: KnowledgeImageSegment[];
};

export function canonicalCbor(value: CborValue): Uint8Array {
  const out: number[] = [];
  encodeCbor(value, out);
  return Uint8Array.from(out);
}

export function digestDomain(domain: string, payload: Uint8Array): Digest {
  return `${SHA256_PREFIX}${sha256Hex(concat(getTextEncoder().encode(`knolo:${domain}:v1\0`), payload))}`;
}

export function digestBytes(digest: Digest): Uint8Array {
  if (!digest.startsWith(SHA256_PREFIX) || digest.length !== SHA256_PREFIX.length + 64) {
    throw new Error(`Invalid digest: ${digest}`);
  }
  const hex = digest.slice(SHA256_PREFIX.length);
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(byte)) throw new Error(`Invalid digest: ${digest}`);
    out[i] = byte;
  }
  return out;
}

export function isKnowledgeImageV5(input: ArrayBufferLike | Uint8Array): boolean {
  const bytes = asBytes(input);
  if (bytes.length < KNOWLEDGE_IMAGE_V5_HEADER_SIZE) return false;
  return getTextDecoder().decode(bytes.slice(0, 8)) === KNOWLEDGE_IMAGE_V5_MAGIC;
}

export function createKnowledgeImageV5(options: CreateKnowledgeImageOptions): KnowledgeImageV5 {
  const base = options.baseImage;
  const actor = options.actor ?? (base ? 'knolo-transaction' : 'knolo-migration');
  const parents = options.parents ? [...options.parents] : base ? [base.commitDigest, ...(options.additionalParents ?? [])] : [];
  const newObjects = options.objects.map((input) => {
    const bytes = new Uint8Array(input.bytes);
    const body = { kind: input.kind, bytes, meta: input.meta as unknown as CborValue } as CborValue;
    const id = input.id ?? digestDomain('object', canonicalCbor(body));
    if (id !== digestDomain('object', canonicalCbor(body))) throw new Error('Object id does not match canonical payload.');
    return { id, kind: input.kind, bytes, meta: input.meta } satisfies KnowledgeObjectV1;
  });
  const objectById = new Map<string, KnowledgeObjectV1>();
  for (const object of base?.objects ?? []) objectById.set(object.id, { ...object, bytes: new Uint8Array(object.bytes) });
  for (const object of newObjects) {
    if (!objectById.has(object.id)) objectById.set(object.id, object);
  }
  const objects = [...objectById.values()].sort((a, b) => a.id.localeCompare(b.id));

  const objectPayload = canonicalCbor(objects.map((object) => objectToCbor(object)));
  const objectSegmentDigest = digestDomain('segment', objectPayload);
  const objectIds = objects.map((object) => object.id);
  const transactionObjects = [...newObjects].sort((a, b) => a.id.localeCompare(b.id));
  const transactionObjectIds = base ? transactionObjects.map((object) => object.id) : objectIds;
  const seed = canonicalCbor({ actor, objects: transactionObjectIds, parents });
  const transactionId = digestDomain('transaction', seed);
  const suppliedEvents = options.events ?? transactionObjects.map((object, i) => ({
    version: 1 as const,
    parents: i === 0 ? (base ? [base.commitDigest] : []) : [transactionId],
    actor,
    actorCounter: i + 1,
    kind: object.kind === 'chunk' ? 'document.put' : `${object.kind}.put`,
    target: object.id,
    payload: object.id,
    provenance: { objectId: object.id },
  }));
  const newEvents = suppliedEvents.map((event) => {
    const body = { ...event, transactionId, provenance: event.provenance as unknown as CborValue } as CborValue;
    return { ...event, transactionId, id: digestDomain('event', canonicalCbor(body)) } satisfies KnowledgeEventV1;
  });
  const preservedEvents = options.preservedEvents ?? [];
  for (const event of preservedEvents) {
    if (event.id !== digestDomain('event', canonicalCbor(eventIdentityToCbor(event)))) throw new Error('Preserved V5 event identity mismatch.');
  }
  const eventById = new Map<string, KnowledgeEventV1>();
  for (const event of base?.events ?? []) eventById.set(event.id, event);
  for (const event of preservedEvents) eventById.set(event.id, event);
  for (const event of newEvents) eventById.set(event.id, event);
  const events = [...eventById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const eventPayload = canonicalCbor(events.map((event) => eventToCbor(event)));
  const eventSegmentDigest = digestDomain('segment', eventPayload);
  const eventIds = events.map((event) => event.id);
  const transactionRoot = digestDomain('transaction-root', canonicalCbor({ transactionId, objectIds: transactionObjectIds, eventIds: [...preservedEvents.map((event) => event.id), ...newEvents.map((event) => event.id)].sort() }));
  const objectRoot = digestDomain('object-root', canonicalCbor(objectIds));
  const eventRoot = digestDomain('event-root', canonicalCbor(eventIds));
  const views = options.commitOverrides?.views ?? options.views ?? { lexical: digestDomain('view', canonicalCbor({ kind: 'lexical', objectIds })) };
  const commit: KnowledgeCommitV1 = {
    version: 1,
    parents,
    transactionRoot,
    objectRoot,
    eventRoot,
    views,
    schemaRoot: options.commitOverrides?.schemaRoot ?? digestDomain('schema', canonicalCbor({ version: 1 })),
    policyRoot: options.commitOverrides?.policyRoot ?? base?.commit.policyRoot ?? (options.policy ? knowledgePolicyRootV5(options.policy) : digestDomain('policy', canonicalCbor({ default: 'deny' }))),
    runtimeContract: options.commitOverrides?.runtimeContract ?? digestDomain('runtime', canonicalCbor({ format: 5, codec: 'cbor-v1' })),
    sequence: options.sequence ?? (base ? base.commit.sequence + 1 : 1),
    actor,
    objectSegmentDigest,
    eventSegmentDigest,
  };
  const commitPayload = canonicalCbor(commitToCbor(commit));
  const commitDigest = digestDomain('commit', commitPayload);
  const stateRoot = digestDomain('state', digestBytes(commitDigest));
  const objectSegment = encodeSegment(OBJECT_SEGMENT, objectPayload);
  const eventSegment = encodeSegment(EVENT_SEGMENT, eventPayload);
  const commitSegment = encodeSegment(COMMIT_SEGMENT, commitPayload);
  const dataStart = KNOWLEDGE_IMAGE_V5_HEADER_SIZE + KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE * 2;
  const commitOffset = dataStart + objectSegment.length + eventSegment.length;
  const bytes = new Uint8Array(dataStart + objectSegment.length + eventSegment.length + commitSegment.length);
  bytes.set(getTextEncoder().encode(KNOWLEDGE_IMAGE_V5_MAGIC), 0);
  const header = new DataView(bytes.buffer);
  header.setUint16(8, KNOWLEDGE_IMAGE_V5_VERSION, true);
  header.setUint16(10, 0, true);
  header.setUint16(12, KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE, true);
  header.setUint16(14, 0, true);
  bytes.set(objectSegment, dataStart);
  bytes.set(eventSegment, dataStart + objectSegment.length);
  bytes.set(commitSegment, commitOffset);
  const superblock = encodeSuperblock(1n, commitOffset, commitSegment.length, commitDigest, stateRoot);
  bytes.set(superblock, KNOWLEDGE_IMAGE_V5_HEADER_SIZE);
  return mountKnowledgeImageV5(bytes);
}

export function mountKnowledgeImageV5(input: ArrayBufferLike | Uint8Array): KnowledgeImageV5 {
  const bytes = asBytes(input);
  const parsed = parseKnowledgeImage(bytes);
  return { bytes: bytes.slice(), ...parsed };
}

export function inspectKnowledgeImageV5(input: ArrayBufferLike | Uint8Array): KnowledgeImageVerification {
  const parsed = parseKnowledgeImage(asBytes(input));
  return { valid: true, stateRoot: parsed.stateRoot, commitDigest: parsed.commitDigest, activeSuperblock: parsed.activeSuperblock, segments: parsed.segments };
}

export function verifyKnowledgeImageV5(input: ArrayBufferLike | Uint8Array): KnowledgeImageVerification {
  return inspectKnowledgeImageV5(input);
}

export function stateRoot(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): Digest {
  return typeof input === 'object' && input !== null && 'stateRoot' in input
    ? input.stateRoot
    : inspectKnowledgeImageV5(input as ArrayBufferLike | Uint8Array).stateRoot;
}

export async function migrateV4ToV5(input: ArrayBufferLike | Uint8Array): Promise<{ image: Uint8Array; receipt: MigrationReceiptV1 }> {
  const bytes = asBytes(input);
  const pack = mountPackFromBuffer(bytes.slice().buffer);
  // The receipt identifies the verified source artifact itself. Using the raw
  // bytes keeps this digest stable across runtimes and V4 parser versions.
  const sourceDigest = `sha256-${sha256Hex(bytes)}`;
  const objects: ObjectInput[] = [];
  const mappings: Array<{ legacyBlockId: number; sourceObject: Digest; chunkObject: Digest }> = [];
  for (let i = 0; i < pack.blocks.length; i++) {
    const text = pack.blocks[i] ?? '';
    const sourceMeta = { legacyBlockId: i, docId: pack.docIds?.[i] ?? null, namespace: pack.namespaces?.[i] ?? null };
    const sourceBody = { kind: 'source' as const, bytes: getTextEncoder().encode(text), meta: sourceMeta } as unknown as { kind: 'source'; bytes: Uint8Array; meta: Record<string, unknown> };
    const sourceObject = digestDomain('object', canonicalCbor({ kind: sourceBody.kind, bytes: sourceBody.bytes, meta: sourceBody.meta as unknown as CborValue } as CborValue));
    const chunkMeta = { ...sourceMeta, sourceObject, heading: pack.headings?.[i] ?? null, span: { start: 0, end: text.length } };
    const chunkBody = { kind: 'chunk' as const, bytes: getTextEncoder().encode(text), meta: chunkMeta } as unknown as { kind: 'chunk'; bytes: Uint8Array; meta: Record<string, unknown> };
    const chunkObject = digestDomain('object', canonicalCbor({ kind: chunkBody.kind, bytes: chunkBody.bytes, meta: chunkBody.meta as unknown as CborValue } as CborValue));
    objects.push({ kind: 'source', bytes: sourceBody.bytes, meta: sourceBody.meta, id: sourceObject });
    objects.push({ kind: 'chunk', bytes: chunkBody.bytes, meta: chunkBody.meta, id: chunkObject });
    mappings.push({ legacyBlockId: i, sourceObject, chunkObject });
  }
  if (pack.claimGraph) {
    const section = isV4Artifact(bytes) ? inspectPackV4(bytes.slice().buffer).sections.find((entry) => entry.name === 'claims') : undefined;
    const claimsBytes = section ? bytes.slice(section.offset, section.offset + section.length) : getTextEncoder().encode(JSON.stringify(pack.claimGraph));
    objects.push({ kind: 'claims', bytes: claimsBytes, meta: { version: 1, encoding: 'json-v4' } });
  }
  if (pack.meta.agents) {
    const bytes = getTextEncoder().encode(JSON.stringify(pack.meta.agents));
    objects.push({ kind: 'agents', bytes, meta: { version: 1, encoding: 'json-v4' } });
  }
  const migrationMetadata = { sourceDigest, sourceVersion: pack.meta.version };
  objects.push({ kind: 'metadata', bytes: canonicalCbor(migrationMetadata as unknown as CborValue), meta: migrationMetadata });
  const created = createKnowledgeImageV5({ objects, actor: 'knolo-v4-migrator' });
  const receiptBody = { version: 1 as const, kind: 'v4-to-v5-migration' as const, sourceDigest, sourceVersion: pack.meta.version, stateRoot: created.stateRoot, objectMappings: mappings };
  const receipt: MigrationReceiptV1 = { ...receiptBody, receiptDigest: digestDomain('receipt', canonicalCbor(receiptBody as unknown as CborValue)) };
  return { image: created.bytes, receipt };
}

function parseKnowledgeImage(bytes: Uint8Array): Omit<KnowledgeImageV5, 'bytes'> {
  if (bytes.length < KNOWLEDGE_IMAGE_V5_HEADER_SIZE + KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE * 2) throw new Error('Invalid V5 image: truncated header.');
  if (getTextDecoder().decode(bytes.slice(0, 8)) !== KNOWLEDGE_IMAGE_V5_MAGIC) throw new Error('Invalid V5 image magic.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint16(8, true) !== KNOWLEDGE_IMAGE_V5_VERSION || header.getUint16(12, true) !== KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE) throw new Error('Unsupported V5 image header.');
  const candidates = (['A', 'B'] as const).map((slot, i) => readSuperblock(bytes, KNOWLEDGE_IMAGE_V5_HEADER_SIZE + i * KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE, slot)).filter((x): x is NonNullable<typeof x> => x !== undefined);
  if (!candidates.length) throw new Error('No valid V5 superblock.');
  const segments: KnowledgeImageSegment[] = [];
  let offset = KNOWLEDGE_IMAGE_V5_HEADER_SIZE + KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE * 2;
  const seen = new Set<number>();
  while (offset < bytes.length) {
    if (segments.length >= MAX_SEGMENTS) throw new Error('V5 image exceeds the segment limit.');
    if (bytes.length - offset < KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE) throw new Error('Invalid V5 segment header bounds.');
    const segment = readSegmentHeader(bytes, offset);
    if (![OBJECT_SEGMENT, EVENT_SEGMENT, COMMIT_SEGMENT].includes(segment.kind) && segment.kind < OPTIONAL_SEGMENT_MIN) throw new Error(`Unknown non-optional V5 segment: ${segment.kind}.`);
    if (segment.kind <= COMMIT_SEGMENT && segment.schema !== 1) throw new Error(`Unsupported required V5 segment schema: ${segment.kind}/${segment.schema}.`);
    if (seen.has(segment.kind) && segment.kind < OPTIONAL_SEGMENT_MIN) throw new Error(`Duplicate required V5 segment: ${segment.kind}.`);
    seen.add(segment.kind);
    segments.push(segment);
    offset += segment.length;
  }
  if (offset !== bytes.length) throw new Error('Invalid V5 segment alignment.');
  const commitSegment = segments.find((segment) => segment.kind === COMMIT_SEGMENT);
  const objectSegment = segments.find((segment) => segment.kind === OBJECT_SEGMENT);
  const eventSegment = segments.find((segment) => segment.kind === EVENT_SEGMENT);
  if (!commitSegment || !objectSegment || !eventSegment) throw new Error('V5 image is missing a required segment.');
  const commitPayload = bytes.slice(commitSegment.offset + KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE, commitSegment.offset + commitSegment.length);
  const commit = decodeCommit(commitPayload);
  const commitDigest = digestDomain('commit', commitPayload);
  const state = digestDomain('state', digestBytes(commitDigest));
  candidates.sort((a, b) => Number(b.generation - a.generation));
  const active = candidates.find((candidate) => candidate.commitOffset === commitSegment.offset && candidate.commitLength === commitSegment.length && candidate.commitDigest === commitDigest && candidate.stateRoot === state);
  if (!active) throw new Error('No V5 superblock points to a valid commit.');
  if (active.commitDigest !== commitDigest || active.stateRoot !== state) throw new Error('V5 commit/state root mismatch.');
  if (commit.objectSegmentDigest !== objectSegment.digest || commit.eventSegmentDigest !== eventSegment.digest) throw new Error('V5 commit segment digest mismatch.');
  const objects = decodeObjects(bytes.slice(objectSegment.offset + KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE, objectSegment.offset + objectSegment.length));
  const events = decodeEvents(bytes.slice(eventSegment.offset + KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE, eventSegment.offset + eventSegment.length));
  if (digestDomain('object-root', canonicalCbor(objects.map((object) => object.id))) !== commit.objectRoot) throw new Error('V5 object root mismatch.');
  if (digestDomain('event-root', canonicalCbor(events.map((event) => event.id))) !== commit.eventRoot) throw new Error('V5 event root mismatch.');
  return { stateRoot: state, commitDigest, commit, objects, events, segments, activeSuperblock: active.slot };
}

function encodeSegment(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE + payload.length);
  const view = new DataView(out.buffer);
  out.set(getTextEncoder().encode(SEGMENT_MAGIC), 0);
  view.setUint8(4, kind); view.setUint8(5, 1); view.setUint16(6, 0, true); view.setBigUint64(8, BigInt(payload.length), true);
  out.set(digestBytes(digestDomain('segment', payload)), 16); out.set(payload, KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE);
  return out;
}

function encodeSuperblock(generation: bigint, commitOffset: number, commitLength: number, commitDigest: Digest, state: Digest): Uint8Array {
  const out = new Uint8Array(KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE);
  const view = new DataView(out.buffer);
  out.set(getTextEncoder().encode(SUPERBLOCK_MAGIC), 0); view.setBigUint64(8, generation, true); view.setBigUint64(16, BigInt(commitOffset), true); view.setBigUint64(24, BigInt(commitLength), true);
  out.set(digestBytes(commitDigest), 32); out.set(digestBytes(state), 64); out.set(digestBytes(digestDomain('superblock', out.slice(0, 96))), 96);
  return out;
}

function readSuperblock(bytes: Uint8Array, offset: number, slot: 'A' | 'B'): { slot: 'A' | 'B'; generation: bigint; commitOffset: number; commitLength: number; commitDigest: Digest; stateRoot: Digest } | undefined {
  const raw = bytes.slice(offset, offset + KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE);
  if (raw.length !== KNOWLEDGE_IMAGE_V5_SUPERBLOCK_SIZE || getTextDecoder().decode(raw.slice(0, 8)) !== SUPERBLOCK_MAGIC) return undefined;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const generation = view.getBigUint64(8, true); const commitOffset = Number(view.getBigUint64(16, true)); const commitLength = Number(view.getBigUint64(24, true));
  if (!Number.isSafeInteger(commitOffset) || !Number.isSafeInteger(commitLength) || commitLength < KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE || commitOffset + commitLength > bytes.length) return undefined;
  const commitDigest = bytesToDigest(raw.slice(32, 64)); const stateRoot = bytesToDigest(raw.slice(64, 96));
  if (bytesToDigest(raw.slice(96, 128)) !== digestDomain('superblock', raw.slice(0, 96))) return undefined;
  return { slot, generation, commitOffset, commitLength, commitDigest, stateRoot };
}

function readSegmentHeader(bytes: Uint8Array, offset: number): KnowledgeImageSegment {
  const raw = bytes.slice(offset, offset + KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE);
  if (getTextDecoder().decode(raw.slice(0, 4)) !== SEGMENT_MAGIC) throw new Error('Invalid V5 segment magic.');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); const kind = view.getUint8(4); const schema = view.getUint8(5); const flags = view.getUint16(6, true); const payloadLength = Number(view.getBigUint64(8, true));
  if (!Number.isSafeInteger(payloadLength) || payloadLength > MAX_SEGMENT_SIZE || offset + KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE + payloadLength > bytes.length) throw new Error('Invalid V5 segment length.');
  const length = KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE + payloadLength; const payload = bytes.slice(offset + KNOWLEDGE_IMAGE_V5_SEGMENT_HEADER_SIZE, offset + length); const digest = bytesToDigest(raw.slice(16, 48));
  if (digest !== digestDomain('segment', payload)) throw new Error(`V5 segment digest mismatch: ${kind}.`);
  return { kind, schema, flags, offset, length, payloadLength, digest };
}

function decodeObjects(payload: Uint8Array): KnowledgeObjectV1[] {
  const value = decodeCbor(payload);
  if (!Array.isArray(value)) throw new Error('Invalid V5 object segment.');
  return value.map((entry) => {
    const object = asRecord(entry); const id = asString(object.id); const kind = asString(object.kind) as KnowledgeObjectV1['kind']; const bytes = asBytesValue(object.bytes); const meta = asRecord(object.meta);
    if (digestDomain('object', canonicalCbor({ kind, bytes, meta })) !== id) throw new Error('V5 object identity mismatch.');
    return { id, kind, bytes, meta };
  });
}

function decodeEvents(payload: Uint8Array): KnowledgeEventV1[] {
  const value = decodeCbor(payload); if (!Array.isArray(value)) throw new Error('Invalid V5 event segment.');
  return value.map((entry) => {
    const event = asRecord(entry);
    const id = asDigest(event.id);
    const normalized = { version: asNumber(event.version), transactionId: asDigest(event.transactionId), parents: asDigestArray(event.parents), actor: asString(event.actor), actorCounter: asNumber(event.actorCounter), kind: asString(event.kind), target: asDigest(event.target), payload: asDigest(event.payload), provenance: asRecord(event.provenance) };
    if (normalized.version !== 1 || normalized.actor.length === 0 || normalized.actorCounter < 1 || digestDomain('event', canonicalCbor({ ...normalized })) !== id) throw new Error('V5 event identity mismatch.');
    return { ...normalized, version: 1, id };
  });
}

function decodeCommit(payload: Uint8Array): KnowledgeCommitV1 {
  const value = asRecord(decodeCbor(payload));
  const commit = {
    version: asNumber(value.version),
    parents: asDigestArray(value.parents),
    transactionRoot: asDigest(value.transactionRoot),
    objectRoot: asDigest(value.objectRoot),
    eventRoot: asDigest(value.eventRoot),
    views: asDigestRecord(value.views),
    schemaRoot: asDigest(value.schemaRoot),
    policyRoot: asDigest(value.policyRoot),
    runtimeContract: asDigest(value.runtimeContract),
    sequence: asNumber(value.sequence),
    actor: asString(value.actor),
    objectSegmentDigest: asDigest(value.objectSegmentDigest),
    eventSegmentDigest: asDigest(value.eventSegmentDigest),
  };
  if (commit.version !== 1 || commit.sequence < 1 || commit.actor.length === 0 || new Set(commit.parents).size !== commit.parents.length) throw new Error('Malformed V5 commit.');
  return { ...commit, version: 1 };
}

function objectToCbor(object: KnowledgeObjectV1): CborValue { return { id: object.id, kind: object.kind, bytes: object.bytes, meta: object.meta as CborValue }; }
function eventIdentityToCbor(event: KnowledgeEventV1): CborValue { return { version: event.version, transactionId: event.transactionId, parents: event.parents, actor: event.actor, actorCounter: event.actorCounter, kind: event.kind, target: event.target, payload: event.payload, provenance: event.provenance as CborValue }; }
function eventToCbor(event: KnowledgeEventV1): CborValue { return { version: event.version, id: event.id, transactionId: event.transactionId, parents: event.parents, actor: event.actor, actorCounter: event.actorCounter, kind: event.kind, target: event.target, payload: event.payload, provenance: event.provenance as CborValue }; }
function commitToCbor(commit: KnowledgeCommitV1): CborValue { return { version: commit.version, parents: commit.parents, transactionRoot: commit.transactionRoot, objectRoot: commit.objectRoot, eventRoot: commit.eventRoot, views: commit.views, schemaRoot: commit.schemaRoot, policyRoot: commit.policyRoot, runtimeContract: commit.runtimeContract, sequence: commit.sequence, actor: commit.actor, objectSegmentDigest: commit.objectSegmentDigest, eventSegmentDigest: commit.eventSegmentDigest }; }

function encodeCbor(value: CborValue, out: number[]): void {
  if (value === null) { out.push(0xf6); return; }
  if (typeof value === 'boolean') { out.push(value ? 0xf5 : 0xf4); return; }
  if (typeof value === 'string') { const bytes = getTextEncoder().encode(value); encodeLength(3, bytes.length, out); out.push(...bytes); return; }
  if (value instanceof Uint8Array) { encodeLength(2, value.length, out); out.push(...value); return; }
  if (typeof value === 'number' || typeof value === 'bigint') { if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('V5 CBOR numbers must be safe integers.'); const n = typeof value === 'number' ? BigInt(value) : value; if (n >= 0n) encodeLength(0, n, out); else encodeLength(1, -1n - n, out); return; }
  if (Array.isArray(value)) { encodeLength(4, value.length, out); for (const item of value) encodeCbor(item, out); return; }
  const entries = Object.entries(value).sort(([a], [b]) => compareUtf8(a, b)); encodeLength(5, entries.length, out); for (const [key, item] of entries) { encodeCbor(key, out); encodeCbor(item, out); }
}

function encodeLength(major: number, length: number | bigint, out: number[]): void { const n = BigInt(length); if (n < 24n) { out.push((major << 5) | Number(n)); } else if (n <= 0xffn) { out.push((major << 5) | 24, Number(n)); } else if (n <= 0xffffn) { out.push((major << 5) | 25, Number(n >> 8n), Number(n & 0xffn)); } else if (n <= 0xffffffffn) { out.push((major << 5) | 26, Number((n >> 24n) & 0xffn), Number((n >> 16n) & 0xffn), Number((n >> 8n) & 0xffn), Number(n & 0xffn)); } else { out.push((major << 5) | 27); for (let shift = 56n; shift >= 0n; shift -= 8n) out.push(Number((n >> shift) & 0xffn)); } }
function compareUtf8(a: string, b: string): number { const aa = getTextEncoder().encode(a), bb = getTextEncoder().encode(b); for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]; return aa.length - bb.length; }

export function decodeCanonicalCbor(bytes: Uint8Array): CborValue { const reader = new CborReader(bytes); const value = reader.read(); if (!reader.done) throw new Error('Trailing bytes in V5 CBOR payload.'); if (!bytesEqual(canonicalCbor(value), bytes)) throw new Error('Non-canonical V5 CBOR payload.'); return value; }
function decodeCbor(bytes: Uint8Array): CborValue { return decodeCanonicalCbor(bytes); }
class CborReader { private offset = 0; constructor(private readonly bytes: Uint8Array) {} get done(): boolean { return this.offset === this.bytes.length; } read(): CborValue { const initial = this.readByte(); const major = initial >> 5; const ai = initial & 31; if (major === 0) return this.readLength(ai); if (major === 1) return -1n - this.readLength(ai); if (major === 2) return this.readBytes(this.readLength(ai)); if (major === 3) return getTextDecoder().decode(this.readBytes(this.readLength(ai))); if (major === 4) { const length = this.readLength(ai); return Array.from({ length: Number(length) }, () => this.read()); } if (major === 5) { const length = this.readLength(ai); const out: Record<string, CborValue> = {}; for (let i = 0; i < Number(length); i++) { const key = this.read(); if (typeof key !== 'string') throw new Error('V5 CBOR map key must be text.'); out[key] = this.read(); } return out; } if (major === 7 && ai === 20) return false; if (major === 7 && ai === 21) return true; if (major === 7 && ai === 22) return null; throw new Error('Unsupported V5 CBOR value.'); } private readByte(): number { if (this.offset >= this.bytes.length) throw new Error('Truncated V5 CBOR value.'); return this.bytes[this.offset++]; } private readLength(ai: number): bigint { if (ai < 24) return BigInt(ai); if (ai === 24) return BigInt(this.readByte()); if (ai === 25) return BigInt(this.readByte() * 256 + this.readByte()); if (ai === 26) return BigInt(this.readByte() * 0x1000000 + this.readByte() * 0x10000 + this.readByte() * 0x100 + this.readByte()); if (ai === 27) { let value = 0n; for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(this.readByte()); return value; } throw new Error('Indefinite-length V5 CBOR is not allowed.'); } private readBytes(length: bigint): Uint8Array { if (length > BigInt(this.bytes.length - this.offset)) throw new Error('Truncated V5 CBOR byte string.'); const n = Number(length); const out = this.bytes.slice(this.offset, this.offset + n); this.offset += n; return out; } }

function asRecord(value: CborValue): Record<string, CborValue> { if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Expected V5 CBOR map.'); return value as Record<string, CborValue>; }
function asString(value: CborValue | undefined): string { if (typeof value !== 'string') throw new Error('Expected V5 text value.'); return value; }
function asNumber(value: CborValue | undefined): number { if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Expected V5 integer value.'); const n = Number(value); if (!Number.isSafeInteger(n)) throw new Error('V5 integer exceeds safe range.'); return n; }
function asBytesValue(value: CborValue | undefined): Uint8Array { if (!(value instanceof Uint8Array)) throw new Error('Expected V5 byte string.'); return value; }
function asStringArray(value: CborValue | undefined): string[] { if (!Array.isArray(value)) throw new Error('Expected V5 text array.'); return value.map((item) => asString(item)); }
function asDigest(value: CborValue | undefined): Digest { const digest = asString(value); digestBytes(digest); return digest; }
function asDigestArray(value: CborValue | undefined): Digest[] { if (!Array.isArray(value)) throw new Error('Expected V5 digest array.'); return value.map((item) => asDigest(item)); }
function asDigestRecord(value: CborValue | undefined): Record<string, Digest> { const record = asRecord(value ?? null); return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, asDigest(item)])); }
function bytesToDigest(bytes: Uint8Array): Digest { return `${SHA256_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`; }
function asBytes(input: ArrayBufferLike | Uint8Array): Uint8Array { return input instanceof Uint8Array ? input : new Uint8Array(input); }
function isV4Artifact(bytes: Uint8Array): boolean { return bytes.length >= 8 && getTextDecoder().decode(bytes.slice(0, 8)) === 'KNLOV4\0\0'; }
function concat(a: Uint8Array, b: Uint8Array): Uint8Array { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((byte, index) => byte === b[index]); }

export type { CborValue };
