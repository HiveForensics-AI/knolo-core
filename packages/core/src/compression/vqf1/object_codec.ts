import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestDomain,
  type CborValue,
} from '../../knowledge_image_v5.js';
import { VqfByteReader, checkBufferLimit } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import { findLowestByteOffset, VqfByteStore } from './byte_factor.js';
import { VqfDigestTable } from './digest_table.js';
import { VqfStringTable } from './string_table.js';
import {
  compareBytes,
  encodeString,
  tableLimits,
  type VqfTableLimits,
} from './table_utils.js';

const OBJECT_CODEC_VERSION = 1;
const SOURCE_SPANS_FLAG = 1;
const KNOWN_OBJECT_KEYS = new Set(['id', 'kind', 'bytes', 'meta']);

export type VqfObjectCodecOptions = {
  sourceSpans?: boolean;
  limits?: VqfObjectCodecLimits;
};

export type VqfObjectCodecLimits = VqfTableLimits & {
  maxLogicalBytes?: number;
  maxPhysicalBytes?: number;
  maxObjects?: number;
  maxDigests?: number;
  maxStrings?: number;
  maxBlobs?: number;
};

export type VqfObjectStatistics = {
  logicalBytes: number;
  physicalBytes: number;
  objectCount: number;
  digestCount: number;
  stringCount: number;
  blobCount: number;
  duplicateBlobBytesSaved: number;
  sourceSpanBytesSaved: number;
  sourceSpanCount: number;
};

export type VqfEncodedObjectPayload = {
  bytes: Uint8Array;
  statistics: VqfObjectStatistics;
};

type ParsedObject = {
  id: string;
  kind: string;
  bytes: Uint8Array;
  meta: Record<string, CborValue>;
  extra: Record<string, CborValue>;
};

type ObjectLimits = Required<
  Omit<VqfObjectCodecLimits, 'maxEntries' | 'maxBytes'>
> & { maxTableBytes: number };

function codecLimits(options: VqfObjectCodecLimits = {}): ObjectLimits {
  const table = tableLimits(options);
  const maxLogicalBytes = options.maxLogicalBytes ?? 512 * 1024 * 1024;
  const maxPhysicalBytes = options.maxPhysicalBytes ?? 512 * 1024 * 1024;
  const maxObjects = options.maxObjects ?? table.maxEntries;
  const maxDigests = options.maxDigests ?? table.maxEntries;
  const maxStrings = options.maxStrings ?? table.maxEntries;
  const maxBlobs = options.maxBlobs ?? table.maxEntries;
  checkBufferLimit(maxLogicalBytes);
  checkBufferLimit(maxPhysicalBytes);
  for (const [name, value] of Object.entries({
    maxObjects,
    maxDigests,
    maxStrings,
    maxBlobs,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
      throw new RangeError(`Invalid VQF object codec ${name} limit.`);
    }
  }
  return {
    maxLogicalBytes,
    maxPhysicalBytes,
    maxObjects,
    maxDigests,
    maxStrings,
    maxBlobs,
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

function parseObjects(
  logicalPayload: Uint8Array,
  limits: ObjectLimits
): ParsedObject[] {
  if (logicalPayload.length > limits.maxLogicalBytes) {
    throw new RangeError('VQF logical object payload exceeds its limit.');
  }
  const value = decodeCanonicalCbor(logicalPayload);
  if (!Array.isArray(value)) throw new Error('Invalid VQF object payload.');
  if (value.length > limits.maxObjects) {
    throw new RangeError('VQF object count exceeds its limit.');
  }
  return value.map((entry) => {
    const record = asRecord(entry, 'object record');
    const id = record.id;
    const kind = record.kind;
    const bytes = record.bytes;
    const meta = asRecord(record.meta, 'object metadata');
    if (typeof id !== 'string' || typeof kind !== 'string') {
      throw new Error('Invalid VQF object identity fields.');
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('Invalid VQF object bytes.');
    }
    // Reuse the digest table's strict canonical digest validation.
    VqfDigestTable.build([id], {
      maxEntries: 1,
      maxBytes: limits.maxTableBytes,
    });
    if (
      digestDomain(
        'object',
        canonicalCbor({ kind, bytes, meta } as CborValue)
      ) !== id
    ) {
      throw new Error('VQF object identity mismatch.');
    }
    const extra = Object.fromEntries(
      Object.entries(record).filter(([key]) => !KNOWN_OBJECT_KEYS.has(key))
    );
    return { id, kind, bytes, meta, extra };
  });
}

function sourceBytesById(objects: ParsedObject[]): Map<string, Uint8Array> {
  const sources = new Map<string, Uint8Array | null>();
  for (const object of objects) {
    if (object.kind !== 'source') continue;
    const existing = sources.get(object.id);
    if (existing === undefined) sources.set(object.id, object.bytes);
    else if (existing === null || compareBytes(existing, object.bytes) !== 0)
      sources.set(object.id, null);
  }
  return new Map(
    [...sources].filter(
      (entry): entry is [string, Uint8Array] => entry[1] !== null
    )
  );
}

function chooseSpans(
  objects: ParsedObject[],
  enabled: boolean
): Array<{ sourceId: string; offset: number; length: number } | undefined> {
  const sources = sourceBytesById(objects);
  return objects.map((object) => {
    if (!enabled || object.kind !== 'chunk') return undefined;
    const sourceId = object.meta.sourceObject;
    if (typeof sourceId !== 'string') return undefined;
    const source = sources.get(sourceId);
    if (!source) return undefined;
    const offset = findLowestByteOffset(source, object.bytes);
    return offset === undefined
      ? undefined
      : { sourceId, offset, length: object.bytes.length };
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

function encodeObjects(
  logicalPayload: Uint8Array,
  useSourceSpans: boolean,
  limits: ObjectLimits,
  selectedSpans?: boolean[]
): VqfEncodedObjectPayload {
  const objects = parseObjects(logicalPayload, limits);
  const eligibleSpans = chooseSpans(objects, useSourceSpans);
  if (useSourceSpans && selectedSpans === undefined) {
    let selection = objects.map(() => false);
    let best = encodeObjects(logicalPayload, true, limits, selection);
    const groups: number[][] = [];
    for (let i = 0; i < objects.length; i++) {
      if (!eligibleSpans[i]) continue;
      const group = groups.find(
        (indices) =>
          compareBytes(objects[indices[0]].bytes, objects[i].bytes) === 0
      );
      if (group) group.push(i);
      else groups.push([i]);
    }
    for (const group of groups) {
      const trialSelection = [...selection];
      for (const index of group) trialSelection[index] = true;
      const trial = encodeObjects(logicalPayload, true, limits, trialSelection);
      if (trial.bytes.length < best.bytes.length) {
        selection = trialSelection;
        best = trial;
      }
    }
    return best;
  }
  const spans = eligibleSpans.map((span, index) =>
    selectedSpans?.[index] ? span : undefined
  );
  const storedObjects: number[] = [];
  const storedInputIndex = new Map<number, number>();
  for (let i = 0; i < objects.length; i++) {
    if (spans[i]) continue;
    storedInputIndex.set(i, storedObjects.length);
    storedObjects.push(i);
  }
  const blobs = VqfByteStore.build(
    storedObjects.map((index) => objects[index].bytes),
    { maxEntries: limits.maxBlobs, maxBytes: limits.maxLogicalBytes }
  );
  const blobOrdinals = blobs.ordinals;
  const sourceBlobOrdinals = new Map<string, number>();
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].kind !== 'source') continue;
    const inputIndex = storedInputIndex.get(i);
    if (inputIndex === undefined)
      throw new Error('VQF source blob is missing.');
    const ordinal = blobOrdinals[inputIndex];
    const prior = sourceBlobOrdinals.get(objects[i].id);
    if (prior === undefined) sourceBlobOrdinals.set(objects[i].id, ordinal);
    else if (prior !== ordinal) sourceBlobOrdinals.delete(objects[i].id);
  }
  const digestTable = VqfDigestTable.build(
    objects.map((object) => object.id),
    { maxEntries: limits.maxDigests, maxBytes: limits.maxTableBytes }
  );
  const stringTable = VqfStringTable.build(
    objects.map((object) => object.kind),
    { maxEntries: limits.maxStrings, maxBytes: limits.maxTableBytes }
  );
  const writer = new VqfByteWriter(limits.maxPhysicalBytes);
  writer.writeByte(OBJECT_CODEC_VERSION);
  writer.writeByte(useSourceSpans ? SOURCE_SPANS_FLAG : 0);
  writeLengthDelimited(writer, digestTable.encode());
  writeLengthDelimited(writer, stringTable.encode());
  writer.writeUVarint(blobs.count);
  for (let ordinal = 0; ordinal < blobs.count; ordinal++) {
    writeLengthDelimited(writer, blobs.blobAt(ordinal));
  }
  writer.writeUVarint(objects.length);
  let sourceSpanBytesSaved = 0;
  let sourceSpanCount = 0;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    writer.writeUVarint(digestTable.ordinalOf(object.id));
    stringTable.writeValue(object.kind, writer);
    const span = spans[i];
    if (span) {
      const sourceOrdinal = sourceBlobOrdinals.get(span.sourceId);
      if (sourceOrdinal === undefined)
        throw new Error('VQF source span has no unambiguous source blob.');
      writer.writeByte(1);
      writer.writeUVarint(sourceOrdinal);
      writer.writeUVarint(span.offset);
      writer.writeUVarint(span.length);
      sourceSpanBytesSaved += span.length;
      sourceSpanCount++;
    } else {
      writer.writeByte(0);
      writer.writeUVarint(blobOrdinals[storedInputIndex.get(i)!]);
    }
    writeLengthDelimited(writer, canonicalCbor(object.meta));
    writeLengthDelimited(writer, canonicalCbor(object.extra));
  }
  const bytes = writer.finish();
  return {
    bytes,
    statistics: {
      logicalBytes: logicalPayload.length,
      physicalBytes: bytes.length,
      objectCount: objects.length,
      digestCount: digestTable.count,
      stringCount: stringTable.count,
      blobCount: blobs.count,
      duplicateBlobBytesSaved: blobs.duplicateBlobBytesSaved,
      sourceSpanBytesSaved,
      sourceSpanCount,
    },
  };
}

export function encodeVqfObjectPayload(
  logicalPayload: Uint8Array,
  options: VqfObjectCodecOptions = {}
): VqfEncodedObjectPayload {
  const limits = codecLimits(options.limits);
  if (!(logicalPayload instanceof Uint8Array)) {
    throw new Error('Expected VQF logical object bytes.');
  }
  return encodeObjects(logicalPayload, options.sourceSpans === true, limits);
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
        'VQF reconstructed object payload exceeds its limit.'
      );
  }
  return length;
}

export function decodeVqfObjectPayload(
  physicalBody: Uint8Array,
  options: { limits?: VqfObjectCodecLimits } = {}
): { logicalPayload: Uint8Array; statistics: VqfObjectStatistics } {
  if (!(physicalBody instanceof Uint8Array)) {
    throw new Error('Expected VQF object body bytes.');
  }
  const limits = codecLimits(options.limits);
  const reader = new VqfByteReader(physicalBody, limits.maxPhysicalBytes);
  if (reader.readByte() !== OBJECT_CODEC_VERSION)
    throw new Error('Unsupported VQF object codec version.');
  const flags = reader.readByte();
  if ((flags & ~SOURCE_SPANS_FLAG) !== 0)
    throw new Error('Unsupported VQF object codec flags.');
  const useSourceSpans = (flags & SOURCE_SPANS_FLAG) !== 0;
  const digestTable = VqfDigestTable.decode(
    readLengthDelimited(reader, limits.maxTableBytes),
    { maxEntries: limits.maxDigests, maxBytes: limits.maxTableBytes }
  );
  const stringTable = VqfStringTable.decode(
    readLengthDelimited(reader, limits.maxTableBytes),
    { maxEntries: limits.maxStrings, maxBytes: limits.maxTableBytes }
  );
  const blobCount = reader.readUVarintNumber(limits.maxBlobs);
  if (blobCount > reader.remaining)
    throw new Error('Truncated VQF object blob table.');
  const blobs: Uint8Array[] = [];
  let blobBytes = 0;
  for (let i = 0; i < blobCount; i++) {
    const blob = readLengthDelimited(
      reader,
      limits.maxLogicalBytes - blobBytes
    );
    blobBytes += blob.length;
    if (i > 0 && compareBytes(blobs[i - 1], blob) >= 0)
      throw new Error('VQF object blobs are not strictly sorted.');
    blobs.push(blob);
  }
  const objectCount = reader.readUVarintNumber(limits.maxObjects);
  if (objectCount > reader.remaining)
    throw new Error('Truncated VQF object records.');
  const records: Record<string, CborValue>[] = [];
  let sourceSpanBytesSaved = 0;
  let sourceSpanCount = 0;
  for (let i = 0; i < objectCount; i++) {
    const id = digestTable.digestAt(reader.readUVarintNumber());
    const kind = stringTable.readValue(reader);
    const mode = reader.readByte();
    let bytes: Uint8Array;
    if (mode === 0) {
      const ordinal = reader.readUVarintNumber();
      if (ordinal >= blobs.length)
        throw new RangeError('Invalid VQF object blob ordinal.');
      bytes = blobs[ordinal];
    } else if (mode === 1 && useSourceSpans) {
      const ordinal = reader.readUVarintNumber();
      if (ordinal >= blobs.length)
        throw new RangeError('Invalid VQF source blob ordinal.');
      const source = blobs[ordinal];
      const offset = reader.readUVarintNumber(source.length);
      const length = reader.readUVarintNumber(source.length - offset);
      bytes = source.slice(offset, offset + length);
      sourceSpanBytesSaved += length;
      sourceSpanCount++;
    } else {
      throw new Error('Invalid VQF object byte mode.');
    }
    const metaBytes = readLengthDelimited(reader, limits.maxLogicalBytes);
    const extraBytes = readLengthDelimited(reader, limits.maxLogicalBytes);
    const meta = asRecord(decodeCanonicalCbor(metaBytes), 'object metadata');
    const extra = asRecord(
      decodeCanonicalCbor(extraBytes),
      'object extensions'
    );
    if (Object.keys(extra).some((key) => KNOWN_OBJECT_KEYS.has(key)))
      throw new Error('VQF object extensions contain a reserved key.');
    const record = { ...extra, id, kind, bytes, meta } as Record<
      string,
      CborValue
    >;
    if (
      digestDomain(
        'object',
        canonicalCbor({ kind, bytes, meta } as CborValue)
      ) !== id
    ) {
      throw new Error('VQF object identity mismatch.');
    }
    records.push(record);
  }
  reader.assertFinished();
  const logicalLength = cborLength(records, limits.maxLogicalBytes);
  if (logicalLength > limits.maxLogicalBytes)
    throw new RangeError('VQF reconstructed object payload exceeds its limit.');
  const logicalPayload = canonicalCbor(records);
  if (logicalPayload.length !== logicalLength)
    throw new Error('VQF object payload length calculation mismatch.');
  const canonical = encodeObjects(logicalPayload, useSourceSpans, limits);
  if (compareBytes(canonical.bytes, physicalBody) !== 0)
    throw new Error('Non-canonical VQF object encoding.');
  return {
    logicalPayload,
    statistics: {
      ...canonical.statistics,
      sourceSpanBytesSaved,
      sourceSpanCount,
    },
  };
}
