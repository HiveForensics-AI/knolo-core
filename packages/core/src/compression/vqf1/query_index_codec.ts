import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestDomain,
  type CborValue,
} from '../../knowledge_image_v5.js';
import { VqfByteReader, checkBufferLimit } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import { VqfDigestTable } from './digest_table.js';
import {
  readIncreasingUIntList,
  writeIncreasingUIntList,
} from './integer_list.js';
import { VqfStringTable } from './string_table.js';
import {
  compareBytes,
  encodeString,
  tableLimits,
  type VqfTableLimits,
} from './table_utils.js';

const QUERY_INDEX_CODEC_VERSION = 1;

export type VqfQueryIndexCodecLimits = VqfTableLimits & {
  maxLogicalBytes?: number;
  maxPhysicalBytes?: number;
  maxObjects?: number;
  maxPostings?: number;
  maxKeys?: number;
  maxDigests?: number;
  maxStrings?: number;
};

export type VqfQueryIndexStatistics = {
  logicalBytes: number;
  physicalBytes: number;
  objectCount: number;
  kindKeyCount: number;
  fieldKeyCount: number;
  postingIdCount: number;
  digestCount: number;
  stringCount: number;
};

export type VqfEncodedQueryIndexPayload = {
  bytes: Uint8Array;
  statistics: VqfQueryIndexStatistics;
};

type ParsedIndex = {
  version: 1;
  stateRoot: string;
  objectIds: string[];
  kindPostings: Record<string, string[]>;
  fieldPostings: Record<string, string[]>;
  indexRoot: string;
};

type IndexLimits = Required<
  Omit<VqfQueryIndexCodecLimits, 'maxEntries' | 'maxBytes'>
> & { maxTableBytes: number };

function codecLimits(options: VqfQueryIndexCodecLimits = {}): IndexLimits {
  const table = tableLimits(options);
  const maxLogicalBytes = options.maxLogicalBytes ?? 512 * 1024 * 1024;
  const maxPhysicalBytes = options.maxPhysicalBytes ?? 512 * 1024 * 1024;
  const maxObjects = options.maxObjects ?? table.maxEntries;
  const maxPostings = options.maxPostings ?? table.maxEntries;
  const maxKeys = options.maxKeys ?? table.maxEntries;
  const maxDigests = options.maxDigests ?? table.maxEntries;
  const maxStrings = options.maxStrings ?? table.maxEntries;
  checkBufferLimit(maxLogicalBytes);
  checkBufferLimit(maxPhysicalBytes);
  for (const [name, value] of Object.entries({
    maxObjects,
    maxPostings,
    maxKeys,
    maxDigests,
    maxStrings,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
      throw new RangeError(`Invalid VQF query-index codec ${name} limit.`);
    }
  }
  return {
    maxLogicalBytes,
    maxPhysicalBytes,
    maxObjects,
    maxPostings,
    maxKeys,
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
  if (typeof value !== 'string')
    throw new Error(`Invalid VQF query-index ${label}.`);
  VqfDigestTable.build([value], { maxEntries: 1, maxBytes: 33 });
  return value;
}

function compareUtf8(left: string, right: string): number {
  return compareBytes(
    encodeString(left, Number.MAX_SAFE_INTEGER),
    encodeString(right, Number.MAX_SAFE_INTEGER)
  );
}

function asSortedDigests(
  value: CborValue | undefined,
  allowed: Set<string> | undefined,
  label: string,
  maximum: number
): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid VQF ${label}.`);
  if (value.length > maximum)
    throw new RangeError(`VQF ${label} exceed their limit.`);
  const ids = value.map((entry) => asDigest(entry, label));
  for (let i = 0; i < ids.length; i++) {
    if (i > 0 && compareUtf8(ids[i - 1], ids[i]) >= 0)
      throw new Error(`VQF ${label} are not strictly sorted.`);
    if (allowed && !allowed.has(ids[i]))
      throw new Error(`VQF ${label} reference unknown objects.`);
  }
  return ids;
}

function asPostings(
  value: CborValue | undefined,
  objectIds: Set<string>,
  label: string,
  limits: IndexLimits,
  postingCount: { value: number }
): Record<string, string[]> {
  const record = asRecord(value, label);
  const keys = Object.keys(record).sort(compareUtf8);
  if (keys.length > limits.maxKeys)
    throw new RangeError(`VQF ${label} exceed their key limit.`);
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    encodeString(key, limits.maxLogicalBytes);
    const ids = asSortedDigests(
      record[key],
      objectIds,
      `${label} postings`,
      limits.maxPostings - postingCount.value
    );
    postingCount.value += ids.length;
    if (postingCount.value > limits.maxPostings)
      throw new RangeError('VQF query-index postings exceed their limit.');
    out[key] = ids;
  }
  return out;
}

function parseIndex(
  logicalPayload: Uint8Array,
  limits: IndexLimits
): ParsedIndex {
  if (logicalPayload.length > limits.maxLogicalBytes)
    throw new RangeError('VQF logical query-index payload exceeds its limit.');
  const record = asRecord(
    decodeCanonicalCbor(logicalPayload),
    'query-index payload'
  );
  const version = record.version;
  if (version !== 1 && version !== 1n)
    throw new Error('Unsupported VQF query-index version.');
  const stateRoot = asDigest(record.stateRoot, 'state root');
  const objectIds = asSortedDigests(
    record.objectIds,
    undefined,
    'query-index object IDs',
    limits.maxObjects
  );
  const allowed = new Set(objectIds);
  const postingCount = { value: 0 };
  const kindPostings = asPostings(
    record.kindPostings,
    allowed,
    'kind postings',
    limits,
    postingCount
  );
  const fieldPostings = asPostings(
    record.fieldPostings,
    allowed,
    'field postings',
    limits,
    postingCount
  );
  const indexRoot = asDigest(record.indexRoot, 'index root');
  const body = {
    fieldPostings,
    kindPostings,
    objectIds,
    stateRoot,
    version: 1 as const,
  };
  if (digestDomain('query-index', canonicalCbor(body)) !== indexRoot)
    throw new Error('VQF query-index root mismatch.');
  return {
    version: 1,
    stateRoot,
    objectIds,
    kindPostings,
    fieldPostings,
    indexRoot,
  };
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

function postingKeys(index: ParsedIndex): string[] {
  return [
    ...Object.keys(index.kindPostings),
    ...Object.keys(index.fieldPostings),
  ];
}

function writePostings(
  writer: VqfByteWriter,
  postings: Record<string, string[]>,
  objectOrdinals: Map<string, number>,
  stringTable: VqfStringTable,
  maxPostings: number
): number {
  const keys = Object.keys(postings).sort(compareUtf8);
  writer.writeUVarint(keys.length);
  let postingIdCount = 0;
  for (const key of keys) {
    stringTable.writeValue(key, writer);
    const ordinals = postings[key].map((id) => {
      const ordinal = objectOrdinals.get(id);
      if (ordinal === undefined)
        throw new Error(
          'VQF query-index posting references an unknown object.'
        );
      return ordinal;
    });
    postingIdCount += ordinals.length;
    if (postingIdCount > maxPostings)
      throw new RangeError('VQF query-index postings exceed their limit.');
    writeIncreasingUIntList(ordinals, writer);
  }
  return postingIdCount;
}

function readPostings(
  reader: VqfByteReader,
  objectIds: string[],
  stringTable: VqfStringTable,
  limits: IndexLimits,
  postingCount: { value: number }
): Record<string, string[]> {
  const keyCount = reader.readUVarintNumber(limits.maxKeys);
  const out: Record<string, string[]> = {};
  let previousKey: string | undefined;
  for (let i = 0; i < keyCount; i++) {
    const key = stringTable.readValue(reader);
    if (previousKey !== undefined && compareUtf8(previousKey, key) >= 0)
      throw new Error('VQF query-index posting keys are not strictly sorted.');
    const remaining = limits.maxPostings - postingCount.value;
    const maxCount =
      objectIds.length === 0 ? 0 : Math.min(remaining, objectIds.length);
    const ordinals = readIncreasingUIntList(reader, {
      maxCount,
      maxValue: objectIds.length === 0 ? 0 : objectIds.length - 1,
    });
    postingCount.value += ordinals.length;
    if (postingCount.value > limits.maxPostings)
      throw new RangeError('VQF query-index postings exceed their limit.');
    out[key] = ordinals.map((ordinal) => {
      if (ordinal >= objectIds.length)
        throw new RangeError('Invalid VQF query-index object ordinal.');
      return objectIds[ordinal];
    });
    previousKey = key;
  }
  return out;
}

function encodeIndex(
  logicalPayload: Uint8Array,
  limits: IndexLimits
): VqfEncodedQueryIndexPayload {
  const index = parseIndex(logicalPayload, limits);
  const digestTable = VqfDigestTable.build(
    [...index.objectIds, index.stateRoot, index.indexRoot],
    { maxEntries: limits.maxDigests, maxBytes: limits.maxTableBytes }
  );
  const stringTable = VqfStringTable.build(postingKeys(index), {
    maxEntries: limits.maxStrings,
    maxBytes: limits.maxTableBytes,
  });
  const objectOrdinals = new Map(index.objectIds.map((id, i) => [id, i]));
  const writer = new VqfByteWriter(limits.maxPhysicalBytes);
  writer.writeByte(QUERY_INDEX_CODEC_VERSION);
  writer.writeByte(0);
  writeLengthDelimited(writer, digestTable.encode());
  writeLengthDelimited(writer, stringTable.encode());
  writer.writeUVarint(index.objectIds.length);
  for (const id of index.objectIds)
    writer.writeUVarint(digestTable.ordinalOf(id));
  const kindPostingIds = writePostings(
    writer,
    index.kindPostings,
    objectOrdinals,
    stringTable,
    limits.maxPostings
  );
  const fieldPostingIds = writePostings(
    writer,
    index.fieldPostings,
    objectOrdinals,
    stringTable,
    limits.maxPostings - kindPostingIds
  );
  writer.writeUVarint(digestTable.ordinalOf(index.stateRoot));
  writer.writeUVarint(digestTable.ordinalOf(index.indexRoot));
  const bytes = writer.finish();
  return {
    bytes,
    statistics: {
      logicalBytes: logicalPayload.length,
      physicalBytes: bytes.length,
      objectCount: index.objectIds.length,
      kindKeyCount: Object.keys(index.kindPostings).length,
      fieldKeyCount: Object.keys(index.fieldPostings).length,
      postingIdCount: kindPostingIds + fieldPostingIds,
      digestCount: digestTable.count,
      stringCount: stringTable.count,
    },
  };
}

export function encodeVqfQueryIndexPayload(
  logicalPayload: Uint8Array,
  options: { limits?: VqfQueryIndexCodecLimits } = {}
): VqfEncodedQueryIndexPayload {
  if (!(logicalPayload instanceof Uint8Array))
    throw new Error('Expected VQF logical query-index bytes.');
  return encodeIndex(logicalPayload, codecLimits(options.limits));
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
        'VQF reconstructed query-index payload exceeds its limit.'
      );
  }
  return length;
}

export function decodeVqfQueryIndexPayload(
  physicalBody: Uint8Array,
  options: { limits?: VqfQueryIndexCodecLimits } = {}
): { logicalPayload: Uint8Array; statistics: VqfQueryIndexStatistics } {
  if (!(physicalBody instanceof Uint8Array))
    throw new Error('Expected VQF query-index body bytes.');
  const limits = codecLimits(options.limits);
  const reader = new VqfByteReader(physicalBody, limits.maxPhysicalBytes);
  if (reader.readByte() !== QUERY_INDEX_CODEC_VERSION)
    throw new Error('Unsupported VQF query-index codec version.');
  if (reader.readByte() !== 0)
    throw new Error('Unsupported VQF query-index codec flags.');
  const digestTable = VqfDigestTable.decode(
    readLengthDelimited(reader, limits.maxTableBytes),
    { maxEntries: limits.maxDigests, maxBytes: limits.maxTableBytes }
  );
  const stringTable = VqfStringTable.decode(
    readLengthDelimited(reader, limits.maxTableBytes),
    { maxEntries: limits.maxStrings, maxBytes: limits.maxTableBytes }
  );
  const objectCount = reader.readUVarintNumber(limits.maxObjects);
  if (objectCount > reader.remaining)
    throw new Error('Truncated VQF query-index object IDs.');
  const objectIds: string[] = [];
  for (let i = 0; i < objectCount; i++) {
    const id = digestTable.digestAt(reader.readUVarintNumber());
    if (i > 0 && compareUtf8(objectIds[i - 1], id) >= 0)
      throw new Error('VQF query-index object IDs are not strictly sorted.');
    objectIds.push(id);
  }
  const postingCount = { value: 0 };
  const kindPostings = readPostings(
    reader,
    objectIds,
    stringTable,
    limits,
    postingCount
  );
  const fieldPostings = readPostings(
    reader,
    objectIds,
    stringTable,
    limits,
    postingCount
  );
  const stateRoot = digestTable.digestAt(reader.readUVarintNumber());
  const indexRoot = digestTable.digestAt(reader.readUVarintNumber());
  reader.assertFinished();
  const body = {
    fieldPostings,
    kindPostings,
    objectIds,
    stateRoot,
    version: 1 as const,
  };
  if (digestDomain('query-index', canonicalCbor(body)) !== indexRoot)
    throw new Error('VQF query-index root mismatch.');
  const reconstructed: Record<string, CborValue> = {
    fieldPostings,
    indexRoot,
    kindPostings,
    objectIds,
    stateRoot,
    version: 1,
  };
  const logicalLength = cborLength(reconstructed, limits.maxLogicalBytes);
  if (logicalLength > limits.maxLogicalBytes)
    throw new RangeError('VQF logical query-index payload exceeds its limit.');
  const logicalPayload = canonicalCbor(reconstructed);
  if (logicalPayload.length !== logicalLength)
    throw new Error('VQF query-index payload length accounting mismatch.');
  const canonical = encodeIndex(logicalPayload, limits);
  if (
    canonical.bytes.length !== physicalBody.length ||
    canonical.bytes.some((byte, index) => byte !== physicalBody[index])
  ) {
    throw new Error('Non-canonical VQF query-index body.');
  }
  return { logicalPayload, statistics: canonical.statistics };
}
