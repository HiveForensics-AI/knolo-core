import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestDomain,
  type CborValue,
} from '../../knowledge_image_v5.js';
import { VqfByteReader, checkBufferLimit } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import { VqfDigestTable } from './digest_table.js';
import { VqfStringTable } from './string_table.js';
import {
  encodeString,
  tableLimits,
  type VqfTableLimits,
} from './table_utils.js';

const EVENT_CODEC_VERSION = 1;
const KNOWN_EVENT_KEYS = new Set([
  'version',
  'id',
  'transactionId',
  'parents',
  'actor',
  'actorCounter',
  'kind',
  'target',
  'payload',
  'provenance',
]);

export type VqfEventCodecLimits = VqfTableLimits & {
  maxLogicalBytes?: number;
  maxPhysicalBytes?: number;
  maxEvents?: number;
  maxParents?: number;
  maxDigests?: number;
  maxStrings?: number;
};

export type VqfEventStatistics = {
  logicalBytes: number;
  physicalBytes: number;
  eventCount: number;
  parentReferenceCount: number;
  digestCount: number;
  stringCount: number;
};

export type VqfEncodedEventPayload = {
  bytes: Uint8Array;
  statistics: VqfEventStatistics;
};

type ParsedEvent = {
  version: number;
  id: string;
  transactionId: string;
  parents: string[];
  actor: string;
  actorCounter: number;
  kind: string;
  target: string;
  payload: string;
  provenance: Record<string, CborValue>;
  extra: Record<string, CborValue>;
};

type EventLimits = Required<
  Omit<VqfEventCodecLimits, 'maxEntries' | 'maxBytes'>
> & { maxTableBytes: number };

function codecLimits(options: VqfEventCodecLimits = {}): EventLimits {
  const table = tableLimits(options);
  const maxLogicalBytes = options.maxLogicalBytes ?? 512 * 1024 * 1024;
  const maxPhysicalBytes = options.maxPhysicalBytes ?? 512 * 1024 * 1024;
  const maxEvents = options.maxEvents ?? table.maxEntries;
  const maxParents = options.maxParents ?? table.maxEntries;
  const maxDigests = options.maxDigests ?? table.maxEntries;
  const maxStrings = options.maxStrings ?? table.maxEntries;
  checkBufferLimit(maxLogicalBytes);
  checkBufferLimit(maxPhysicalBytes);
  for (const [name, value] of Object.entries({
    maxEvents,
    maxParents,
    maxDigests,
    maxStrings,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
      throw new RangeError(`Invalid VQF event codec ${name} limit.`);
    }
  }
  return {
    maxLogicalBytes,
    maxPhysicalBytes,
    maxEvents,
    maxParents,
    maxDigests,
    maxStrings,
    maxTableBytes: table.maxBytes,
  };
}

function asRecord(
  value: CborValue | undefined,
  label: string
): Record<string, CborValue> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Uint8Array
  ) {
    throw new Error(`Invalid VQF ${label}.`);
  }
  return value as Record<string, CborValue>;
}

function asDigest(value: CborValue | undefined, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid VQF event ${label}.`);
  VqfDigestTable.build([value], { maxEntries: 1, maxBytes: 33 });
  return value;
}

function asSafeNumber(value: CborValue | undefined, label: string): number {
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Invalid VQF event ${label}.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`Invalid VQF event ${label}.`);
  return number;
}

function parseEvents(
  logicalPayload: Uint8Array,
  limits: EventLimits
): ParsedEvent[] {
  if (logicalPayload.length > limits.maxLogicalBytes)
    throw new RangeError('VQF logical event payload exceeds its limit.');
  const value = decodeCanonicalCbor(logicalPayload);
  if (!Array.isArray(value)) throw new Error('Invalid VQF event payload.');
  if (value.length > limits.maxEvents)
    throw new RangeError('VQF event count exceeds its limit.');
  let parentCount = 0;
  return value.map((entry) => {
    const record = asRecord(entry, 'event record');
    const version = asSafeNumber(record.version, 'version');
    const id = asDigest(record.id, 'id');
    const transactionId = asDigest(record.transactionId, 'transaction ID');
    if (!Array.isArray(record.parents))
      throw new Error('Invalid VQF event parents.');
    const parents = record.parents.map((parent) =>
      asDigest(parent, 'parent digest')
    );
    parentCount += parents.length;
    if (parentCount > limits.maxParents)
      throw new RangeError('VQF event parent count exceeds its limit.');
    const actor = record.actor;
    const actorCounter = asSafeNumber(record.actorCounter, 'actor counter');
    const kind = record.kind;
    const target = asDigest(record.target, 'target');
    const payload = asDigest(record.payload, 'payload');
    const provenance = asRecord(record.provenance, 'event provenance');
    if (
      version !== 1 ||
      typeof actor !== 'string' ||
      actor.length === 0 ||
      actorCounter < 1 ||
      typeof kind !== 'string'
    ) {
      throw new Error('Invalid VQF event identity fields.');
    }
    const identity: Record<string, CborValue> = {
      version,
      transactionId,
      parents,
      actor,
      actorCounter,
      kind,
      target,
      payload,
      provenance,
    };
    if (digestDomain('event', canonicalCbor(identity)) !== id)
      throw new Error('VQF event identity mismatch.');
    const extra = Object.fromEntries(
      Object.entries(record).filter(([key]) => !KNOWN_EVENT_KEYS.has(key))
    );
    return {
      version,
      id,
      transactionId,
      parents,
      actor,
      actorCounter,
      kind,
      target,
      payload,
      provenance,
      extra,
    };
  });
}

function writeLengthDelimited(writer: VqfByteWriter, bytes: Uint8Array): void {
  writer.writeUVarint(bytes.length);
  writer.writeBytes(bytes);
}

function readLengthDelimited(
  reader: VqfByteReader,
  maximum: number
): Uint8Array {
  const length = reader.readUVarintNumber(Math.min(maximum, reader.remaining));
  return reader.readBytes(length);
}

function allDigests(events: ParsedEvent[]): string[] {
  return events.flatMap((event) => [
    event.id,
    event.transactionId,
    ...event.parents,
    event.target,
    event.payload,
  ]);
}

function encodeEvents(
  logicalPayload: Uint8Array,
  limits: EventLimits
): VqfEncodedEventPayload {
  const events = parseEvents(logicalPayload, limits);
  const digestTable = VqfDigestTable.build(allDigests(events), {
    maxEntries: limits.maxDigests,
    maxBytes: limits.maxTableBytes,
  });
  const stringTable = VqfStringTable.build(
    events.flatMap((event) => [event.actor, event.kind]),
    { maxEntries: limits.maxStrings, maxBytes: limits.maxTableBytes }
  );
  const writer = new VqfByteWriter(limits.maxPhysicalBytes);
  writer.writeByte(EVENT_CODEC_VERSION);
  writer.writeByte(0);
  writeLengthDelimited(writer, digestTable.encode());
  writeLengthDelimited(writer, stringTable.encode());
  writer.writeUVarint(events.length);
  let parentReferenceCount = 0;
  for (const event of events) {
    writer.writeUVarint(event.version);
    writer.writeUVarint(digestTable.ordinalOf(event.id));
    writer.writeUVarint(digestTable.ordinalOf(event.transactionId));
    writer.writeUVarint(event.parents.length);
    for (const parent of event.parents)
      writer.writeUVarint(digestTable.ordinalOf(parent));
    parentReferenceCount += event.parents.length;
    stringTable.writeValue(event.actor, writer);
    writer.writeUVarint(event.actorCounter);
    stringTable.writeValue(event.kind, writer);
    writer.writeUVarint(digestTable.ordinalOf(event.target));
    writer.writeUVarint(digestTable.ordinalOf(event.payload));
    writeLengthDelimited(writer, canonicalCbor(event.provenance));
    writeLengthDelimited(writer, canonicalCbor(event.extra));
  }
  const bytes = writer.finish();
  return {
    bytes,
    statistics: {
      logicalBytes: logicalPayload.length,
      physicalBytes: bytes.length,
      eventCount: events.length,
      parentReferenceCount,
      digestCount: digestTable.count,
      stringCount: stringTable.count,
    },
  };
}

export function encodeVqfEventPayload(
  logicalPayload: Uint8Array,
  options: { limits?: VqfEventCodecLimits } = {}
): VqfEncodedEventPayload {
  if (!(logicalPayload instanceof Uint8Array))
    throw new Error('Expected VQF logical event bytes.');
  return encodeEvents(logicalPayload, codecLimits(options.limits));
}

function cborHeadLength(value: number | bigint): number {
  const integer = BigInt(value);
  if (integer < 24n) return 1;
  if (integer <= 0xffn) return 2;
  if (integer <= 0xffffn) return 3;
  if (integer <= 0xffffffffn) return 5;
  return 9;
}

function cborLength(value: CborValue, maximum: number): number {
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'number' || typeof value === 'bigint') {
    const integer = typeof value === 'number' ? BigInt(value) : value;
    return cborHeadLength(integer >= 0n ? integer : -1n - integer);
  }
  if (typeof value === 'string') {
    const length = encodeString(value, maximum).length;
    return cborHeadLength(length) + length;
  }
  if (value instanceof Uint8Array)
    return cborHeadLength(value.length) + value.length;
  let length = cborHeadLength(
    Array.isArray(value) ? value.length : Object.keys(value).length
  );
  const children = Array.isArray(value)
    ? value
    : Object.entries(value).flatMap(([key, entry]) => [key, entry]);
  for (const child of children) {
    length += cborLength(child as CborValue, maximum);
    if (length > maximum)
      throw new RangeError(
        'VQF reconstructed event payload exceeds its limit.'
      );
  }
  return length;
}

export function decodeVqfEventPayload(
  physicalBody: Uint8Array,
  options: { limits?: VqfEventCodecLimits } = {}
): { logicalPayload: Uint8Array; statistics: VqfEventStatistics } {
  if (!(physicalBody instanceof Uint8Array))
    throw new Error('Expected VQF event body bytes.');
  const limits = codecLimits(options.limits);
  const reader = new VqfByteReader(physicalBody, limits.maxPhysicalBytes);
  if (reader.readByte() !== EVENT_CODEC_VERSION)
    throw new Error('Unsupported VQF event codec version.');
  if (reader.readByte() !== 0)
    throw new Error('Unsupported VQF event codec flags.');
  const digestTable = VqfDigestTable.decode(
    readLengthDelimited(reader, limits.maxTableBytes),
    { maxEntries: limits.maxDigests, maxBytes: limits.maxTableBytes }
  );
  const stringTable = VqfStringTable.decode(
    readLengthDelimited(reader, limits.maxTableBytes),
    { maxEntries: limits.maxStrings, maxBytes: limits.maxTableBytes }
  );
  const eventCount = reader.readUVarintNumber(limits.maxEvents);
  if (eventCount > reader.remaining)
    throw new Error('Truncated VQF event records.');
  const records: Record<string, CborValue>[] = [];
  let parentReferenceCount = 0;
  for (let i = 0; i < eventCount; i++) {
    const version = reader.readUVarintNumber();
    const id = digestTable.digestAt(reader.readUVarintNumber());
    const transactionId = digestTable.digestAt(reader.readUVarintNumber());
    const parentCount = reader.readUVarintNumber(
      limits.maxParents - parentReferenceCount
    );
    if (parentCount > reader.remaining)
      throw new Error('Truncated VQF event parents.');
    const parents: string[] = [];
    for (let j = 0; j < parentCount; j++)
      parents.push(digestTable.digestAt(reader.readUVarintNumber()));
    parentReferenceCount += parentCount;
    const actor = stringTable.readValue(reader);
    const actorCounter = reader.readUVarintNumber();
    const kind = stringTable.readValue(reader);
    const target = digestTable.digestAt(reader.readUVarintNumber());
    const payload = digestTable.digestAt(reader.readUVarintNumber());
    const provenance = asRecord(
      decodeCanonicalCbor(readLengthDelimited(reader, limits.maxLogicalBytes)),
      'event provenance'
    );
    const extra = asRecord(
      decodeCanonicalCbor(readLengthDelimited(reader, limits.maxLogicalBytes)),
      'event extensions'
    );
    if (Object.keys(extra).some((key) => KNOWN_EVENT_KEYS.has(key)))
      throw new Error('VQF event extensions contain a reserved key.');
    if (version !== 1 || actor.length === 0 || actorCounter < 1)
      throw new Error('Invalid VQF event identity fields.');
    const identity: Record<string, CborValue> = {
      version,
      transactionId,
      parents,
      actor,
      actorCounter,
      kind,
      target,
      payload,
      provenance,
    };
    if (digestDomain('event', canonicalCbor(identity)) !== id)
      throw new Error('VQF event identity mismatch.');
    records.push({ ...extra, id, ...identity } as Record<string, CborValue>);
  }
  reader.assertFinished();
  const logicalLength = cborLength(records, limits.maxLogicalBytes);
  if (logicalLength > limits.maxLogicalBytes)
    throw new RangeError('VQF logical event payload exceeds its limit.');
  const logicalPayload = canonicalCbor(records);
  if (logicalPayload.length !== logicalLength)
    throw new Error('VQF event payload length accounting mismatch.');
  const canonical = encodeEvents(logicalPayload, limits);
  if (
    canonical.bytes.length !== physicalBody.length ||
    canonical.bytes.some((byte, index) => byte !== physicalBody[index])
  ) {
    throw new Error('Non-canonical VQF event body.');
  }
  return { logicalPayload, statistics: canonical.statistics };
}
