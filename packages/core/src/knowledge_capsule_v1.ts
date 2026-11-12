import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestBytes,
  knowledgeCommitStateV1,
  knowledgeObjectIdV1,
  knowledgeObjectRootV1,
  type CborValue,
  type Digest,
  type KnowledgeCommitV1,
  type KnowledgeImageV5,
  type KnowledgeObjectV1,
} from './knowledge_image_v5.js';

const MAX_SELECTED = 64;
const KINDS = new Set(['source', 'chunk', 'claims', 'agents', 'metadata']);
const CAPSULE_KEYS = [
  'version',
  'kind',
  'stateRoot',
  'commit',
  'objectIds',
  'objects',
];
const COMMIT_KEYS = [
  'version',
  'parents',
  'transactionRoot',
  'objectRoot',
  'eventRoot',
  'views',
  'schemaRoot',
  'policyRoot',
  'runtimeContract',
  'sequence',
  'actor',
  'objectSegmentDigest',
  'eventSegmentDigest',
];
const OBJECT_KEYS = ['id', 'kind', 'bytes', 'meta'];

export type KnowledgeCapsuleObjectV1 = {
  id: Digest;
  kind: KnowledgeObjectV1['kind'];
  bytes: Uint8Array;
  meta: Record<string, unknown>;
};

export type KnowledgeCapsuleV1 = {
  version: 1;
  kind: 'exchange-capsule';
  stateRoot: Digest;
  commit: KnowledgeCommitV1;
  objectIds: Digest[];
  objects: KnowledgeCapsuleObjectV1[];
};

export function createKnowledgeCapsuleV1(input: {
  image: KnowledgeImageV5;
  objectIds: readonly Digest[];
}): KnowledgeCapsuleV1 {
  if (input.objectIds.length > MAX_SELECTED)
    throw new Error('V5 exchange capsule selects at most 64 objects.');
  const wanted = new Set(input.objectIds);
  if (wanted.size !== input.objectIds.length)
    throw new Error('V5 exchange capsule object id is repeated.');
  const byId = new Map(
    input.image.objects.map((object) => [object.id, object])
  );
  const objects = [...input.objectIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const object = byId.get(id);
      if (!object)
        throw new Error('V5 exchange capsule object is not in the image.');
      return {
        id: object.id,
        kind: object.kind,
        bytes: new Uint8Array(object.bytes),
        meta: object.meta,
      };
    });
  return verifyKnowledgeCapsuleV1(
    {
      version: 1,
      kind: 'exchange-capsule',
      stateRoot: input.image.stateRoot,
      commit: input.image.commit,
      objectIds: input.image.objects.map((object) => object.id),
      objects,
    },
    input.image.stateRoot
  );
}

export function encodeKnowledgeCapsuleV1(
  capsule: KnowledgeCapsuleV1
): Uint8Array {
  verifyKnowledgeCapsuleV1(capsule, capsule.stateRoot);
  return canonicalCbor(capsuleToCbor(capsule));
}

export function decodeKnowledgeCapsuleV1(
  bytes: Uint8Array
): KnowledgeCapsuleV1 {
  const record = asRecord(decodeCanonicalCbor(bytes));
  assertKeys(record, CAPSULE_KEYS);
  if (asNumber(record.version) !== 1)
    throw new Error('Unsupported V5 exchange capsule version.');
  if (record.kind !== 'exchange-capsule')
    throw new Error('Malformed V5 exchange capsule kind.');
  return {
    version: 1,
    kind: 'exchange-capsule',
    stateRoot: asDigest(record.stateRoot),
    commit: asCommit(record.commit),
    objectIds: asDigestList(record.objectIds),
    objects: asObjects(record.objects),
  };
}

export function verifyKnowledgeCapsuleV1(
  capsule: KnowledgeCapsuleV1,
  expectedStateRoot: Digest
): KnowledgeCapsuleV1 {
  if (capsule.version !== 1 || capsule.kind !== 'exchange-capsule')
    throw new Error('Malformed V5 exchange capsule.');
  if (capsule.objects.length > MAX_SELECTED)
    throw new Error('V5 exchange capsule selects at most 64 objects.');
  if (!isStrictlySorted(capsule.objectIds))
    throw new Error('V5 exchange capsule object ids must be sorted.');
  const known = new Set(capsule.objectIds);
  for (const object of capsule.objects) {
    if (!KINDS.has(object.kind))
      throw new Error('Malformed V5 exchange capsule object kind.');
    const id = knowledgeObjectIdV1(object);
    if (id !== object.id)
      throw new Error('V5 exchange capsule object id mismatch.');
    if (!known.has(object.id))
      throw new Error('V5 exchange capsule object is outside the id list.');
  }
  if (knowledgeObjectRootV1(capsule.objectIds) !== capsule.commit.objectRoot)
    throw new Error('V5 exchange capsule object root mismatch.');
  const state = knowledgeCommitStateV1(capsule.commit);
  if (
    state.stateRoot !== capsule.stateRoot ||
    capsule.stateRoot !== expectedStateRoot
  ) {
    throw new Error('V5 exchange capsule state root mismatch.');
  }
  return capsule;
}

function capsuleToCbor(capsule: KnowledgeCapsuleV1): CborValue {
  return {
    version: capsule.version,
    kind: capsule.kind,
    stateRoot: capsule.stateRoot,
    commit: {
      version: capsule.commit.version,
      parents: capsule.commit.parents,
      transactionRoot: capsule.commit.transactionRoot,
      objectRoot: capsule.commit.objectRoot,
      eventRoot: capsule.commit.eventRoot,
      views: capsule.commit.views,
      schemaRoot: capsule.commit.schemaRoot,
      policyRoot: capsule.commit.policyRoot,
      runtimeContract: capsule.commit.runtimeContract,
      sequence: capsule.commit.sequence,
      actor: capsule.commit.actor,
      objectSegmentDigest: capsule.commit.objectSegmentDigest,
      eventSegmentDigest: capsule.commit.eventSegmentDigest,
    },
    objectIds: capsule.objectIds,
    objects: capsule.objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      bytes: object.bytes,
      meta: object.meta as CborValue,
    })),
  };
}

function asCommit(value: CborValue | undefined): KnowledgeCommitV1 {
  const record = asRecord(value);
  assertKeys(record, COMMIT_KEYS);
  return {
    version: 1,
    parents: asDigestList(record.parents),
    transactionRoot: asDigest(record.transactionRoot),
    objectRoot: asDigest(record.objectRoot),
    eventRoot: asDigest(record.eventRoot),
    views: asDigestRecord(record.views),
    schemaRoot: asDigest(record.schemaRoot),
    policyRoot: asDigest(record.policyRoot),
    runtimeContract: asDigest(record.runtimeContract),
    sequence: asPositive(record.sequence),
    actor: asText(record.actor),
    objectSegmentDigest: asDigest(record.objectSegmentDigest),
    eventSegmentDigest: asDigest(record.eventSegmentDigest),
  };
}

function asObjects(value: CborValue | undefined): KnowledgeCapsuleObjectV1[] {
  if (!Array.isArray(value))
    throw new Error('Malformed V5 exchange capsule objects.');
  return value.map((entry) => {
    const record = asRecord(entry);
    assertKeys(record, OBJECT_KEYS);
    const kind = asText(record.kind);
    if (!KINDS.has(kind))
      throw new Error('Malformed V5 exchange capsule object kind.');
    if (!(record.bytes instanceof Uint8Array))
      throw new Error('Malformed V5 exchange capsule object bytes.');
    return {
      id: asDigest(record.id),
      kind: kind as KnowledgeObjectV1['kind'],
      bytes: record.bytes,
      meta: asMeta(record.meta),
    };
  });
}

function asMeta(value: CborValue | undefined): Record<string, unknown> {
  const record = asRecord(value);
  return record;
}

function asDigestRecord(value: CborValue | undefined): Record<string, Digest> {
  const record = asRecord(value);
  const views: Record<string, Digest> = {};
  for (const [key, entry] of Object.entries(record))
    views[key] = asDigest(entry);
  return views;
}

function asDigestList(value: CborValue | undefined): Digest[] {
  if (!Array.isArray(value))
    throw new Error('Malformed V5 exchange capsule digest list.');
  return value.map((entry) => asDigest(entry));
}

function asDigest(value: CborValue | undefined): Digest {
  const text = asText(value);
  digestBytes(text);
  return text;
}

function asText(value: CborValue | undefined): string {
  if (typeof value !== 'string' || !value)
    throw new Error('Malformed V5 exchange capsule text.');
  return value;
}

function asPositive(value: CborValue | undefined): number {
  const number = asNumber(value);
  if (number < 1) throw new Error('Malformed V5 exchange capsule integer.');
  return number;
}

function asNumber(value: CborValue | undefined): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number))
    throw new Error('Malformed V5 exchange capsule integer.');
  return number;
}

function asRecord(value: CborValue | undefined): Record<string, CborValue> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Uint8Array
  ) {
    throw new Error('Malformed V5 exchange capsule map.');
  }
  return value;
}

function assertKeys(record: Record<string, CborValue>, keys: string[]): void {
  const allowed = new Set(keys);
  const present = Object.keys(record);
  if (
    present.length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    present.some((key) => !allowed.has(key))
  ) {
    throw new Error('Malformed V5 exchange capsule fields.');
  }
}

function isStrictlySorted(ids: readonly string[]): boolean {
  for (let i = 1; i < ids.length; i += 1) {
    if (ids[i - 1].localeCompare(ids[i]) >= 0) return false;
  }
  return true;
}
