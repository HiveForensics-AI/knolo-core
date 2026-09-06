import { digestDomain } from '../../knowledge_image_v5.js';
import { VqfByteReader, checkBufferLimit } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import {
  decodeVqfEventPayload,
  encodeVqfEventPayload,
  type VqfEventStatistics,
} from './event_codec.js';
import {
  decodeVqfObjectPayload,
  encodeVqfObjectPayload,
  type VqfObjectStatistics,
} from './object_codec.js';
import {
  decodeVqfQueryIndexPayload,
  encodeVqfQueryIndexPayload,
  type VqfQueryIndexStatistics,
} from './query_index_codec.js';

const ENVELOPE_MAGIC = Uint8Array.of(0x56, 0x51, 0x46, 0x31); // VQF1
const ENVELOPE_VERSION = 1;
export const VQF_ENVELOPE_HEADER_SIZE = 56;
export const VQF_OBJECT_CODEC_KIND = 1;
export const VQF_EVENT_CODEC_KIND = 2;
export const VQF_QUERY_INDEX_CODEC_KIND = 3;

export type VqfEnvelopeStatistics =
  VqfObjectStatistics | VqfEventStatistics | VqfQueryIndexStatistics;

export type VqfEncodedEnvelope = {
  bytes: Uint8Array;
  logicalPayload: Uint8Array;
  body: Uint8Array;
  statistics: VqfEnvelopeStatistics;
};

function digestBytes(digest: string): Uint8Array {
  if (!/^sha256-[0-9a-f]{64}$/.test(digest))
    throw new Error('Invalid VQF digest.');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(digest.slice(7 + i * 2, 9 + i * 2), 16);
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length && left.every((byte, i) => byte === right[i])
  );
}

export function isVqfEnvelope(bytes: Uint8Array): boolean {
  return (
    bytes instanceof Uint8Array &&
    bytes.length >= 4 &&
    equalBytes(bytes.subarray(0, 4), ENVELOPE_MAGIC)
  );
}

function physicalDigest(body: Uint8Array): Uint8Array {
  return digestBytes(digestDomain('vqf-physical', body));
}

export type VqfEnvelopeEncodeOptions = {
  sourceSpans?: boolean;
};

function codecBody(
  codecKind: number,
  logicalPayload: Uint8Array,
  options: VqfEnvelopeEncodeOptions = {}
): { bytes: Uint8Array; statistics: VqfEnvelopeStatistics } {
  if (codecKind === VQF_OBJECT_CODEC_KIND) {
    const encoded = encodeVqfObjectPayload(logicalPayload, {
      sourceSpans: options.sourceSpans !== false,
    });
    return encoded;
  }
  if (codecKind === VQF_EVENT_CODEC_KIND)
    return encodeVqfEventPayload(logicalPayload);
  if (codecKind === VQF_QUERY_INDEX_CODEC_KIND)
    return encodeVqfQueryIndexPayload(logicalPayload);
  throw new Error('Unsupported VQF envelope codec kind.');
}

function decodeBody(
  codecKind: number,
  body: Uint8Array
): { logicalPayload: Uint8Array; statistics: VqfEnvelopeStatistics } {
  if (codecKind === VQF_OBJECT_CODEC_KIND) return decodeVqfObjectPayload(body);
  if (codecKind === VQF_EVENT_CODEC_KIND) return decodeVqfEventPayload(body);
  if (codecKind === VQF_QUERY_INDEX_CODEC_KIND)
    return decodeVqfQueryIndexPayload(body);
  throw new Error('Unsupported VQF envelope codec kind.');
}

export function encodeVqfEnvelope(
  codecKind: number,
  logicalPayload: Uint8Array,
  options: VqfEnvelopeEncodeOptions = {}
): VqfEncodedEnvelope {
  if (!(logicalPayload instanceof Uint8Array))
    throw new Error('Expected VQF logical payload bytes.');
  checkBufferLimit(logicalPayload.length);
  const encoded = codecBody(codecKind, logicalPayload, options);
  if (encoded.bytes.length > 512 * 1024 * 1024 - VQF_ENVELOPE_HEADER_SIZE)
    throw new RangeError('VQF physical envelope exceeds the segment limit.');
  const writer = new VqfByteWriter(512 * 1024 * 1024);
  writer.writeBytes(ENVELOPE_MAGIC);
  writer.writeByte(ENVELOPE_VERSION);
  writer.writeByte(codecKind);
  writer.writeUint16LE(0);
  writer.writeUint64LE(logicalPayload.length);
  writer.writeUint64LE(encoded.bytes.length);
  writer.writeBytes(physicalDigest(encoded.bytes));
  writer.writeBytes(encoded.bytes);
  return {
    bytes: writer.finish(),
    logicalPayload: logicalPayload.slice(),
    body: encoded.bytes,
    statistics: encoded.statistics,
  };
}

export function decodeVqfEnvelope(
  bytes: Uint8Array,
  expectedCodecKind: number
): {
  logicalPayload: Uint8Array;
  body: Uint8Array;
  statistics: VqfEnvelopeStatistics;
} {
  if (!(bytes instanceof Uint8Array))
    throw new Error('Expected VQF envelope bytes.');
  checkBufferLimit(bytes.length);
  if (bytes.length < VQF_ENVELOPE_HEADER_SIZE)
    throw new Error('Truncated VQF envelope.');
  const reader = new VqfByteReader(bytes);
  if (!equalBytes(reader.readBytes(4), ENVELOPE_MAGIC))
    throw new Error('Invalid VQF envelope magic.');
  if (reader.readByte() !== ENVELOPE_VERSION)
    throw new Error('Unsupported VQF envelope version.');
  const codecKind = reader.readByte();
  if (codecKind !== expectedCodecKind)
    throw new Error('VQF envelope codec kind does not match its segment.');
  if (reader.readUint16LE() !== 0)
    throw new Error('Unsupported VQF envelope flags.');
  const logicalLength = reader.readUint64LE();
  const bodyLength = reader.readUint64LE();
  if (
    logicalLength > BigInt(512 * 1024 * 1024) ||
    bodyLength > BigInt(bytes.length - VQF_ENVELOPE_HEADER_SIZE) ||
    bodyLength !== BigInt(bytes.length - VQF_ENVELOPE_HEADER_SIZE)
  ) {
    throw new Error('Invalid VQF envelope lengths.');
  }
  const declaredDigest = reader.readBytes(32);
  const body = reader.readBytes(Number(bodyLength));
  reader.assertFinished();
  if (!equalBytes(declaredDigest, physicalDigest(body)))
    throw new Error('VQF physical body digest mismatch.');
  const decoded = decodeBody(codecKind, body);
  if (decoded.logicalPayload.length !== Number(logicalLength))
    throw new Error('VQF logical payload length mismatch.');
  return {
    logicalPayload: decoded.logicalPayload,
    body,
    statistics: decoded.statistics,
  };
}
