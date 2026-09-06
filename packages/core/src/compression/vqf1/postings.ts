import { digestBytes, digestDomain } from '../../knowledge_image_v5.js';
import type { Pack } from '../../pack.runtime.js';
import { VqfByteReader, checkBufferLimit } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import {
  createLegacyLexicalPostingsReader,
  encodeLegacyLexicalPostings,
  type LexicalPosting,
  type LexicalPostingsReadOptions,
  type LexicalPostingsReader,
  type LexicalPostingsStats,
} from './lexical_postings.js';
import {
  DEFAULT_VQF_LEXICON_PAGE_SIZE,
  decodeFrontCodedPage,
  encodeLexiconPages,
  lookupLexiconTerm,
  requirePageSize,
  type VqfEncodedLexiconPages,
} from './lexicon.js';
import { compareBytes, decodeString, encodeString } from './table_utils.js';

const LEXICAL_INDEX_CODEC_VERSION = 1;
export const DEFAULT_VQF_MICROBLOCK_TARGET_BYTES = 65536;

export type VqfLexicalDocument = {
  blockId: number;
  positions: number[];
};

export type VqfLexicalStream = {
  termId: number;
  term: string;
  documents: VqfLexicalDocument[];
};

export type VqfLexicalIndexLimits = {
  maxTerms?: number;
  maxDocuments?: number;
  maxPositions?: number;
  maxBytes?: number;
};

export type VqfLexicalIndexOptions = {
  pageSize?: number;
  microblockTargetBytes?: number;
  limits?: VqfLexicalIndexLimits;
};

export type VqfLexicalIndexStatistics = {
  termCount: number;
  documentPostingCount: number;
  positionCount: number;
  pageCount: number;
  pageSize: number;
  microblockCount: number;
  microblockTargetBytes: number;
  lexiconBytes: number;
  postingStreamBytes: number;
  physicalBytes: number;
  v4PostingsBytes: number;
  v4LexiconBytes: number;
};

export type VqfEncodedLexicalIndex = {
  bytes: Uint8Array;
  statistics: VqfLexicalIndexStatistics;
  streams: VqfLexicalStream[];
};

type IndexLimits = {
  maxTerms: number;
  maxDocuments: number;
  maxPositions: number;
  maxBytes: number;
};

type DirectoryEntry = {
  termId: number;
  term: string;
  offset: number;
  length: number;
  documentFrequency: number;
};

type MicroblockEntry = {
  firstOrdinal: number;
  lastOrdinal: number;
  offset: number;
  length: number;
  digest: Uint8Array;
};

type ParsedLexicalIndex = {
  pageSize: number;
  microblockTargetBytes: number;
  lexicon: VqfEncodedLexiconPages;
  streamOrder: number[];
  directory: DirectoryEntry[];
  microblocks: MicroblockEntry[];
  postingStream: Uint8Array;
  streams: VqfLexicalStream[];
  statistics: VqfLexicalIndexStatistics;
};

const readerCache = new WeakMap<Uint8Array, LexicalPostingsReader>();

function codecLimits(options: VqfLexicalIndexLimits = {}): IndexLimits {
  const maxTerms = options.maxTerms ?? 1_000_000;
  const maxDocuments = options.maxDocuments ?? 1_000_000;
  const maxPositions = options.maxPositions ?? 16_000_000;
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  checkBufferLimit(maxBytes);
  for (const [name, value] of Object.entries({
    maxTerms,
    maxDocuments,
    maxPositions,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 16_000_000) {
      throw new RangeError(`Invalid VQF lexical-index ${name} limit.`);
    }
  }
  return { maxTerms, maxDocuments, maxPositions, maxBytes };
}

function requireTargetBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 512 * 1024 * 1024) {
    throw new RangeError('Invalid VQF microblock target size.');
  }
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
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

function canonicalDocuments(
  documents: VqfLexicalDocument[]
): VqfLexicalDocument[] {
  if (!Array.isArray(documents)) {
    throw new Error('Expected VQF posting documents.');
  }
  const sorted = documents.map((document) => {
    if (!document || typeof document !== 'object') {
      throw new Error('Expected VQF posting document.');
    }
    const blockId = document.blockId;
    if (!Number.isSafeInteger(blockId) || blockId < 0) {
      throw new RangeError('Invalid VQF posting block id.');
    }
    if (!Array.isArray(document.positions)) {
      throw new Error('Expected VQF posting positions.');
    }
    const positions = [...document.positions].sort((a, b) => a - b);
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      if (!Number.isSafeInteger(position) || position < 0) {
        throw new RangeError('Invalid VQF posting position.');
      }
      if (i > 0 && position <= positions[i - 1]) {
        throw new Error('VQF posting positions must be strictly increasing.');
      }
    }
    return { blockId, positions };
  });
  sorted.sort((a, b) => a.blockId - b.blockId);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].blockId === sorted[i - 1].blockId) {
      throw new Error('Duplicate VQF posting block id.');
    }
  }
  return sorted;
}

function canonicalizeStreams(streams: VqfLexicalStream[]): VqfLexicalStream[] {
  if (!Array.isArray(streams)) throw new Error('Expected VQF lexical streams.');
  const seenIds = new Set<number>();
  const seenTerms = new Set<string>();
  return streams.map((stream) => {
    if (!stream || typeof stream !== 'object') {
      throw new Error('Expected VQF lexical stream.');
    }
    const termId = stream.termId;
    if (!Number.isSafeInteger(termId) || termId < 1) {
      throw new RangeError('Invalid VQF posting term id.');
    }
    if (seenIds.has(termId)) throw new Error('Duplicate VQF posting term id.');
    seenIds.add(termId);
    if (typeof stream.term !== 'string') {
      throw new Error('Expected VQF lexicon term.');
    }
    if (seenTerms.has(stream.term)) {
      throw new Error('Duplicate VQF lexicon term.');
    }
    seenTerms.add(stream.term);
    return {
      termId,
      term: stream.term,
      documents: canonicalDocuments(stream.documents),
    };
  });
}

function writePostingList(
  writer: VqfByteWriter,
  documents: VqfLexicalDocument[]
): void {
  writer.writeUVarint(documents.length);
  let previousBlock = -1;
  for (const document of documents) {
    if (previousBlock < 0) {
      if (document.blockId === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('VQF posting block id overflows.');
      }
      writer.writeUVarint(document.blockId + 1);
    } else writer.writeUVarint(document.blockId - previousBlock);
    writer.writeUVarint(document.positions.length);
    let previousPosition = -1;
    for (const position of document.positions) {
      if (previousPosition < 0) {
        if (position === Number.MAX_SAFE_INTEGER) {
          throw new RangeError('VQF posting position overflows.');
        }
        writer.writeUVarint(position + 1);
      } else writer.writeUVarint(position - previousPosition);
      previousPosition = position;
    }
    previousBlock = document.blockId;
  }
}

function readPostingList(
  reader: VqfByteReader,
  limits: IndexLimits,
  remainingDocuments: number,
  remainingPositions: number
): VqfLexicalDocument[] {
  const documentFrequency = reader.readUVarintNumber(
    Math.min(limits.maxDocuments, remainingDocuments)
  );
  const documents: VqfLexicalDocument[] = [];
  let previousBlock = -1;
  let positionCount = 0;
  for (let i = 0; i < documentFrequency; i++) {
    const delta = reader.readUVarintNumber();
    if (delta < 1) throw new Error('Invalid VQF posting document delta.');
    let blockId: number;
    if (previousBlock < 0) blockId = delta - 1;
    else {
      if (previousBlock > Number.MAX_SAFE_INTEGER - delta) {
        throw new RangeError('VQF posting block id overflows.');
      }
      blockId = previousBlock + delta;
    }
    if (previousBlock >= 0 && blockId <= previousBlock) {
      throw new Error('VQF posting documents are not strictly increasing.');
    }
    const termFrequency = reader.readUVarintNumber(
      remainingPositions - positionCount
    );
    const positions: number[] = [];
    let previousPosition = -1;
    for (let j = 0; j < termFrequency; j++) {
      const positionDelta = reader.readUVarintNumber();
      if (positionDelta < 1) {
        throw new Error('Invalid VQF posting position delta.');
      }
      let position: number;
      if (previousPosition < 0) position = positionDelta - 1;
      else {
        if (previousPosition > Number.MAX_SAFE_INTEGER - positionDelta) {
          throw new RangeError('VQF posting position overflows.');
        }
        position = previousPosition + positionDelta;
      }
      if (previousPosition >= 0 && position <= previousPosition) {
        throw new Error('VQF posting positions are not strictly increasing.');
      }
      positions.push(position);
      previousPosition = position;
    }
    documents.push({ blockId, positions });
    previousBlock = blockId;
    positionCount += positions.length;
  }
  return documents;
}

function microblockDigest(bytes: Uint8Array): Uint8Array {
  return digestBytes(digestDomain('vqf-microblock', bytes));
}

function sortedTerms(streams: VqfLexicalStream[]): VqfLexicalStream[] {
  return [...streams].sort((left, right) =>
    compareBytes(
      encodeString(left.term, 512 * 1024 * 1024),
      encodeString(right.term, 512 * 1024 * 1024)
    )
  );
}

function encodeBody(
  streams: VqfLexicalStream[],
  options: VqfLexicalIndexOptions,
  limits: IndexLimits
): VqfEncodedLexicalIndex {
  if (streams.length > limits.maxTerms) {
    throw new RangeError('VQF lexical index exceeds the term limit.');
  }
  const pageSize = options.pageSize ?? DEFAULT_VQF_LEXICON_PAGE_SIZE;
  const microblockTargetBytes = requireTargetBytes(
    options.microblockTargetBytes ?? DEFAULT_VQF_MICROBLOCK_TARGET_BYTES
  );
  const canonical = canonicalizeStreams(streams);
  let documentPostingCount = 0;
  let positionCount = 0;
  for (const stream of canonical) {
    documentPostingCount += stream.documents.length;
    if (documentPostingCount > limits.maxDocuments) {
      throw new RangeError('VQF lexical index exceeds the document limit.');
    }
    for (const document of stream.documents) {
      positionCount += document.positions.length;
      if (positionCount > limits.maxPositions) {
        throw new RangeError('VQF lexical index exceeds the position limit.');
      }
    }
  }
  const ordered = sortedTerms(canonical);
  const lexicon = encodeLexiconPages(
    ordered.map((stream) => stream.term),
    { pageSize, maxBytes: limits.maxBytes }
  );
  const postingWriter = new VqfByteWriter(limits.maxBytes);
  const directory: DirectoryEntry[] = [];
  for (const stream of ordered) {
    const start = postingWriter.length;
    writePostingList(postingWriter, stream.documents);
    directory.push({
      termId: stream.termId,
      term: stream.term,
      offset: start,
      length: postingWriter.length - start,
      documentFrequency: stream.documents.length,
    });
  }
  const postingStream = postingWriter.finish();
  const microblocks: MicroblockEntry[] = [];
  let blockStart = 0;
  let blockOffset = 0;
  for (let i = 0; i <= directory.length; i++) {
    const atEnd = i === directory.length;
    const nextLength = atEnd ? 0 : directory[i].length;
    const currentLength = atEnd
      ? 0
      : directory[i].offset + directory[i].length - blockOffset;
    const shouldFlush =
      i > blockStart && (atEnd || currentLength > microblockTargetBytes);
    if (shouldFlush) {
      const last = i - 1;
      const offset = blockOffset;
      const length = directory[last].offset + directory[last].length - offset;
      const slice = postingStream.subarray(offset, offset + length);
      microblocks.push({
        firstOrdinal: blockStart,
        lastOrdinal: last,
        offset,
        length,
        digest: microblockDigest(slice),
      });
      blockStart = i;
      blockOffset = atEnd ? offset + length : directory[i].offset;
    }
    if (!atEnd && nextLength > microblockTargetBytes && i === blockStart) {
      const slice = postingStream.subarray(
        directory[i].offset,
        directory[i].offset + directory[i].length
      );
      microblocks.push({
        firstOrdinal: i,
        lastOrdinal: i,
        offset: directory[i].offset,
        length: directory[i].length,
        digest: microblockDigest(slice),
      });
      blockStart = i + 1;
      blockOffset = directory[i].offset + directory[i].length;
    }
  }
  const writer = new VqfByteWriter(limits.maxBytes);
  writer.writeByte(LEXICAL_INDEX_CODEC_VERSION);
  writer.writeByte(0);
  writer.writeUVarint(lexicon.pageSize);
  writer.writeUVarint(microblockTargetBytes);
  writer.writeUVarint(canonical.length);
  writer.writeUVarint(lexicon.directory.length);
  for (const entry of lexicon.directory) {
    writeLengthDelimited(writer, entry.firstTermBytes);
    writer.writeUVarint(entry.offset);
    writer.writeUVarint(entry.length);
  }
  writeLengthDelimited(writer, lexicon.pages);
  for (const stream of canonical) writer.writeUVarint(stream.termId);
  for (const entry of directory) {
    writer.writeUVarint(entry.termId);
    writer.writeUVarint(entry.offset);
    writer.writeUVarint(entry.length);
    writer.writeUVarint(entry.documentFrequency);
  }
  writer.writeUVarint(microblocks.length);
  for (const block of microblocks) {
    writer.writeUVarint(block.firstOrdinal);
    writer.writeUVarint(block.lastOrdinal);
    writer.writeUVarint(block.offset);
    writer.writeUVarint(block.length);
    writer.writeBytes(block.digest);
  }
  writeLengthDelimited(writer, postingStream);
  const bytes = writer.finish();
  const v4Postings = encodeLegacyLexicalPostings(
    canonical.map((stream) => ({
      termId: stream.termId,
      documents: stream.documents,
    }))
  );
  const v4LexiconBytes = encodeString(
    JSON.stringify(canonical.map((stream) => [stream.term, stream.termId])),
    limits.maxBytes
  ).length;
  return {
    bytes,
    streams: canonical,
    statistics: {
      termCount: canonical.length,
      documentPostingCount,
      positionCount,
      pageCount: lexicon.directory.length,
      pageSize: lexicon.pageSize,
      microblockCount: microblocks.length,
      microblockTargetBytes,
      lexiconBytes: lexicon.pages.length,
      postingStreamBytes: postingStream.length,
      physicalBytes: bytes.length,
      v4PostingsBytes: v4Postings.byteLength,
      v4LexiconBytes,
    },
  };
}

export function encodeVqfLexicalIndex(
  streams: VqfLexicalStream[],
  options: VqfLexicalIndexOptions = {}
): VqfEncodedLexicalIndex {
  return encodeBody(streams, options, codecLimits(options.limits));
}

export function encodeVqfLexicalIndexFromLegacy(
  lexicon: Map<string, number> | Iterable<readonly [string, number]>,
  postings: Uint32Array,
  options: VqfLexicalIndexOptions & { offsetBlockIds?: boolean } = {}
): VqfEncodedLexicalIndex {
  const entries = lexicon instanceof Map ? lexicon : new Map(lexicon);
  const idToTerm = new Map(
    [...entries.entries()].map(([term, termId]) => [termId, term])
  );
  const reader = createLegacyLexicalPostingsReader(postings, {
    offsetBlockIds: options.offsetBlockIds,
  });
  const seen = new Set<number>();
  const streams: VqfLexicalStream[] = [];
  for (const termId of reader.termIds()) {
    const term = idToTerm.get(termId);
    if (term === undefined) {
      throw new Error('V4 posting term is missing from the lexicon.');
    }
    seen.add(termId);
    streams.push({
      termId,
      term,
      documents: [...reader.read(termId)].map((posting) => ({
        blockId: posting.blockId,
        positions: posting.positions,
      })),
    });
  }
  for (const [term, termId] of entries) {
    if (seen.has(termId)) continue;
    streams.push({ termId, term, documents: [] });
  }
  return encodeVqfLexicalIndex(streams, options);
}

function parseLexicalIndex(
  bytes: Uint8Array,
  limits: IndexLimits
): ParsedLexicalIndex {
  const reader = new VqfByteReader(bytes, limits.maxBytes);
  if (reader.readByte() !== LEXICAL_INDEX_CODEC_VERSION) {
    throw new Error('Unsupported VQF lexical-index codec version.');
  }
  if (reader.readByte() !== 0) {
    throw new Error('Unsupported VQF lexical-index codec flags.');
  }
  const pageSize = requirePageSize(reader.readUVarintNumber(4096));
  const microblockTargetBytes = requireTargetBytes(
    reader.readUVarintNumber(512 * 1024 * 1024)
  );
  const termCount = reader.readUVarintNumber(limits.maxTerms);
  const pageCount = reader.readUVarintNumber(
    termCount === 0 ? 0 : Math.ceil(termCount / Math.max(pageSize, 1))
  );
  if (termCount > 0 && pageCount !== Math.ceil(termCount / pageSize)) {
    throw new Error('VQF lexicon page count does not match the term count.');
  }
  if (termCount === 0 && pageCount !== 0) {
    throw new Error('Empty VQF lexicon cannot contain pages.');
  }
  const directoryEntries = [];
  for (let i = 0; i < pageCount; i++) {
    const firstTermBytes = readLengthDelimited(reader, limits.maxBytes);
    const offset = reader.readUVarintNumber(limits.maxBytes);
    const length = reader.readUVarintNumber(limits.maxBytes);
    directoryEntries.push({
      firstTerm: decodeString(firstTermBytes),
      firstTermBytes,
      offset,
      length,
    });
  }
  const pages = readLengthDelimited(reader, limits.maxBytes);
  let expectedOffset = 0;
  const terms: string[] = [];
  for (let i = 0; i < directoryEntries.length; i++) {
    const entry = directoryEntries[i];
    if (entry.offset !== expectedOffset) {
      throw new Error('VQF lexicon page directory is not contiguous.');
    }
    if (entry.offset + entry.length > pages.length) {
      throw new RangeError('VQF lexicon page exceeds the encoded pages.');
    }
    const page = decodeFrontCodedPage(
      pages.subarray(entry.offset, entry.offset + entry.length),
      { pageSize, maxBytes: limits.maxBytes }
    );
    const remaining = termCount - terms.length;
    const expectedLength = Math.min(pageSize, remaining);
    if (page.length !== expectedLength) {
      throw new Error('VQF lexicon page has the wrong term count.');
    }
    if (page[0] !== entry.firstTerm) {
      throw new Error('VQF lexicon page leader does not match its directory.');
    }
    if (
      i > 0 &&
      compareBytes(
        directoryEntries[i - 1].firstTermBytes,
        entry.firstTermBytes
      ) >= 0
    ) {
      throw new Error('VQF lexicon page leaders are not strictly sorted.');
    }
    terms.push(...page);
    expectedOffset += entry.length;
  }
  if (expectedOffset !== pages.length) {
    throw new Error('VQF lexicon pages have trailing bytes.');
  }
  if (terms.length !== termCount) {
    throw new Error('VQF lexicon term count mismatch.');
  }
  const streamOrder: number[] = [];
  const seenStream = new Set<number>();
  for (let i = 0; i < termCount; i++) {
    const termId = reader.readUVarintNumber();
    if (termId < 1) throw new RangeError('Invalid VQF posting term id.');
    if (seenStream.has(termId))
      throw new Error('Duplicate VQF posting term id.');
    seenStream.add(termId);
    streamOrder.push(termId);
  }
  const directory: DirectoryEntry[] = [];
  let documentPostingCount = 0;
  let positionCount = 0;
  for (let i = 0; i < termCount; i++) {
    const termId = reader.readUVarintNumber();
    const offset = reader.readUVarintNumber(limits.maxBytes);
    const length = reader.readUVarintNumber(limits.maxBytes);
    const documentFrequency = reader.readUVarintNumber(limits.maxDocuments);
    directory.push({
      termId,
      term: terms[i],
      offset,
      length,
      documentFrequency,
    });
  }
  const microblockCount = reader.readUVarintNumber(termCount);
  const microblocks: MicroblockEntry[] = [];
  for (let i = 0; i < microblockCount; i++) {
    const firstOrdinal = reader.readUVarintNumber(
      termCount === 0 ? 0 : termCount - 1
    );
    const lastOrdinal = reader.readUVarintNumber(
      termCount === 0 ? 0 : termCount - 1
    );
    const offset = reader.readUVarintNumber(limits.maxBytes);
    const length = reader.readUVarintNumber(limits.maxBytes);
    const digest = reader.readBytes(32);
    microblocks.push({ firstOrdinal, lastOrdinal, offset, length, digest });
  }
  const postingStream = readLengthDelimited(reader, limits.maxBytes);
  reader.assertFinished();
  if (termCount === 0) {
    if (microblocks.length !== 0 || postingStream.length !== 0) {
      throw new Error('Empty VQF lexical index has leftover postings.');
    }
  } else if (microblocks.length === 0) {
    throw new Error('VQF lexical index is missing its microblock directory.');
  }
  let nextOrdinal = 0;
  let nextOffset = 0;
  for (const block of microblocks) {
    if (
      block.firstOrdinal !== nextOrdinal ||
      block.lastOrdinal < block.firstOrdinal
    ) {
      throw new Error('VQF microblock ordinal range is not contiguous.');
    }
    if (block.offset !== nextOffset) {
      throw new Error('VQF microblock physical range is not contiguous.');
    }
    if (block.offset + block.length > postingStream.length) {
      throw new RangeError('VQF microblock exceeds the posting stream.');
    }
    const slice = postingStream.subarray(
      block.offset,
      block.offset + block.length
    );
    if (!equalBytes(block.digest, microblockDigest(slice))) {
      throw new Error('VQF microblock digest mismatch.');
    }
    nextOrdinal = block.lastOrdinal + 1;
    nextOffset = block.offset + block.length;
  }
  if (
    termCount > 0 &&
    (nextOrdinal !== termCount || nextOffset !== postingStream.length)
  ) {
    throw new Error('VQF microblocks do not cover the posting stream.');
  }
  const streamsById = new Map<number, VqfLexicalStream>();
  let expectedPostingOffset = 0;
  for (let i = 0; i < directory.length; i++) {
    const entry = directory[i];
    if (!seenStream.has(entry.termId)) {
      throw new Error(
        'VQF posting directory term is missing from stream order.'
      );
    }
    if (entry.offset !== expectedPostingOffset) {
      throw new Error('VQF posting lists are not contiguous.');
    }
    if (entry.offset + entry.length > postingStream.length) {
      throw new RangeError('VQF posting list exceeds the posting stream.');
    }
    const block = microblocks.find(
      (entryBlock) =>
        i >= entryBlock.firstOrdinal && i <= entryBlock.lastOrdinal
    );
    if (
      !block ||
      entry.offset < block.offset ||
      entry.offset + entry.length > block.offset + block.length
    ) {
      throw new Error('VQF posting list crosses a microblock boundary.');
    }
    const listReader = new VqfByteReader(
      postingStream.subarray(entry.offset, entry.offset + entry.length),
      limits.maxBytes
    );
    const documents = readPostingList(
      listReader,
      limits,
      limits.maxDocuments - documentPostingCount,
      limits.maxPositions - positionCount
    );
    listReader.assertFinished();
    if (documents.length !== entry.documentFrequency) {
      throw new Error('VQF posting document frequency mismatch.');
    }
    documentPostingCount += documents.length;
    for (const document of documents) {
      positionCount += document.positions.length;
    }
    streamsById.set(entry.termId, {
      termId: entry.termId,
      term: entry.term,
      documents,
    });
    expectedPostingOffset += entry.length;
  }
  if (expectedPostingOffset !== postingStream.length) {
    throw new Error('VQF posting stream has unused bytes.');
  }
  if (streamsById.size !== termCount) {
    throw new Error('VQF posting directory has duplicate term ids.');
  }
  const streams = streamOrder.map((termId) => {
    const stream = streamsById.get(termId);
    if (!stream)
      throw new Error('VQF stream order references an unknown term.');
    return stream;
  });
  const lexicon: VqfEncodedLexiconPages = {
    pageSize,
    termCount,
    directory: directoryEntries,
    pages,
  };
  const v4Postings = encodeLegacyLexicalPostings(
    streams.map((stream) => ({
      termId: stream.termId,
      documents: stream.documents,
    }))
  );
  const v4LexiconBytes = encodeString(
    JSON.stringify(streams.map((stream) => [stream.term, stream.termId])),
    limits.maxBytes
  ).length;
  return {
    pageSize,
    microblockTargetBytes,
    lexicon,
    streamOrder,
    directory,
    microblocks,
    postingStream,
    streams,
    statistics: {
      termCount,
      documentPostingCount,
      positionCount,
      pageCount: directoryEntries.length,
      pageSize,
      microblockCount: microblocks.length,
      microblockTargetBytes,
      lexiconBytes: pages.length,
      postingStreamBytes: postingStream.length,
      physicalBytes: bytes.length,
      v4PostingsBytes: v4Postings.byteLength,
      v4LexiconBytes,
    },
  };
}

export function decodeVqfLexicalIndex(
  bytes: Uint8Array,
  options: VqfLexicalIndexOptions = {}
): {
  streams: VqfLexicalStream[];
  statistics: VqfLexicalIndexStatistics;
  lexicon: VqfEncodedLexiconPages;
} {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected VQF lexical-index bytes.');
  }
  const limits = codecLimits(options.limits);
  const parsed = parseLexicalIndex(bytes, limits);
  const canonical = encodeBody(
    parsed.streams,
    {
      pageSize: parsed.pageSize,
      microblockTargetBytes: parsed.microblockTargetBytes,
      limits,
    },
    limits
  );
  if (!equalBytes(canonical.bytes, bytes)) {
    throw new Error('Non-canonical VQF lexical-index body.');
  }
  return {
    streams: parsed.streams,
    statistics: canonical.statistics,
    lexicon: parsed.lexicon,
  };
}

export function lookupVqfLexicalTerm(
  bytes: Uint8Array,
  term: string,
  options: VqfLexicalIndexOptions = {}
): { termId: number; ordinal: number } | undefined {
  const decoded = decodeVqfLexicalIndex(bytes, options);
  const ordinal = lookupLexiconTerm(decoded.lexicon, term, {
    maxBytes: codecLimits(options.limits).maxBytes,
  });
  if (ordinal === undefined) return undefined;
  const stream = decoded.streams.find((entry) => entry.term === term);
  if (!stream) return undefined;
  return { termId: stream.termId, ordinal };
}

class VqfLexicalPostingsReader implements LexicalPostingsReader {
  private readonly terms = new Map<
    number,
    {
      order: number;
      ordinal: number;
      offset: number;
      length: number;
      documentFrequency: number;
    }
  >();
  private readonly streamOrder: number[];
  private readonly postingStream: Uint8Array;
  private readonly microblocks: MicroblockEntry[];
  private readonly construction: {
    termCount: number;
    documentPostingCount: number;
    positionCount: number;
    constructionIntegers: number;
    microblockCount: number;
  };
  private query = emptyQueryStats();
  private readonly seenMicroblocks = new Set<number>();

  constructor(parsed: ParsedLexicalIndex) {
    this.streamOrder = parsed.streamOrder;
    this.postingStream = parsed.postingStream;
    this.microblocks = parsed.microblocks;
    const order = new Map(
      parsed.streamOrder.map((termId, index) => [termId, index])
    );
    for (let ordinal = 0; ordinal < parsed.directory.length; ordinal++) {
      const entry = parsed.directory[ordinal];
      this.terms.set(entry.termId, {
        order: order.get(entry.termId) ?? ordinal,
        ordinal,
        offset: entry.offset,
        length: entry.length,
        documentFrequency: entry.documentFrequency,
      });
    }
    this.construction = {
      termCount: parsed.statistics.termCount,
      documentPostingCount: parsed.statistics.documentPostingCount,
      positionCount: parsed.statistics.positionCount,
      constructionIntegers: parsed.statistics.physicalBytes,
      microblockCount: parsed.statistics.microblockCount,
    };
  }

  hasTerm(termId: number): boolean {
    this.query.termsLookedUp++;
    const found = this.terms.has(termId);
    if (!found) this.query.missingTermLookups++;
    return found;
  }

  documentFrequency(termId: number): number {
    const term = this.terms.get(termId);
    if (!term) throw new Error('Absent VQF posting term.');
    return term.documentFrequency;
  }

  termIds(): Iterable<number> {
    return this.streamOrder;
  }

  termOrder(termId: number): number {
    const term = this.terms.get(termId);
    if (!term) throw new Error('Absent VQF posting term.');
    return term.order;
  }

  read(
    termId: number,
    options: LexicalPostingsReadOptions = {}
  ): Iterable<LexicalPosting> {
    const term = this.terms.get(termId);
    if (!term) throw new Error('Absent VQF posting term.');
    this.query.postingListsRead++;
    this.query.postingBytesRead += term.length;
    const blockIndex = this.microblocks.findIndex(
      (block) =>
        term.ordinal >= block.firstOrdinal && term.ordinal <= block.lastOrdinal
    );
    if (blockIndex >= 0) this.seenMicroblocks.add(blockIndex);
    const copyPositions = options.positions !== false;
    const reader = new VqfByteReader(
      this.postingStream.subarray(term.offset, term.offset + term.length)
    );
    const documents = readPostingList(
      reader,
      {
        maxTerms: 1_000_000,
        maxDocuments: 1_000_000,
        maxPositions: 16_000_000,
        maxBytes: 512 * 1024 * 1024,
      },
      1_000_000,
      16_000_000
    );
    reader.assertFinished();
    const out: LexicalPosting[] = [];
    for (const document of documents) {
      this.query.documentsVisited++;
      const positions = copyPositions ? document.positions.slice() : [];
      if (copyPositions) this.query.positionsCopied += positions.length;
      out.push({
        blockId: document.blockId,
        positions,
        termFrequency: document.positions.length,
      });
    }
    return out;
  }

  stats(): LexicalPostingsStats {
    return {
      ...this.construction,
      ...this.query,
      microblocksRead: this.seenMicroblocks.size,
    };
  }

  resetQueryStats(): void {
    this.query = emptyQueryStats();
    this.seenMicroblocks.clear();
  }
}

function emptyQueryStats(): {
  termsLookedUp: number;
  postingListsRead: number;
  documentsVisited: number;
  positionsCopied: number;
  missingTermLookups: number;
  microblocksRead: number;
  postingBytesRead: number;
} {
  return {
    termsLookedUp: 0,
    postingListsRead: 0,
    documentsVisited: 0,
    positionsCopied: 0,
    missingTermLookups: 0,
    microblocksRead: 0,
    postingBytesRead: 0,
  };
}

export function createVqfLexicalPostingsReader(
  bytes: Uint8Array,
  options: VqfLexicalIndexOptions = {}
): LexicalPostingsReader {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected VQF lexical-index bytes.');
  }
  const cached = readerCache.get(bytes);
  if (cached) return cached;
  const parsed = parseLexicalIndex(bytes, codecLimits(options.limits));
  const canonical = encodeBody(
    parsed.streams,
    {
      pageSize: parsed.pageSize,
      microblockTargetBytes: parsed.microblockTargetBytes,
      limits: options.limits,
    },
    codecLimits(options.limits)
  );
  if (!equalBytes(canonical.bytes, bytes)) {
    throw new Error('Non-canonical VQF lexical-index body.');
  }
  const reader = new VqfLexicalPostingsReader(parsed);
  readerCache.set(bytes, reader);
  return reader;
}

export function attachVqfLexicalIndex(
  pack: Pack,
  options: VqfLexicalIndexOptions = {}
): Pack {
  const encoded = encodeVqfLexicalIndexFromLegacy(pack.lexicon, pack.postings, {
    ...options,
    offsetBlockIds: (pack.meta?.version ?? 1) >= 3,
  });
  return { ...pack, vqfLexicalIndex: encoded.bytes };
}
