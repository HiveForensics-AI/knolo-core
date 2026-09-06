import { VqfByteReader, checkBufferLimit } from './byte_reader.js';
import { VqfByteWriter } from './byte_writer.js';
import { compareBytes, decodeString, encodeString } from './table_utils.js';

export const DEFAULT_VQF_LEXICON_PAGE_SIZE = 128;
export const MAX_VQF_LEXICON_PAGE_SIZE = 4096;

export type VqfLexiconPageDirectoryEntry = {
  firstTerm: string;
  firstTermBytes: Uint8Array;
  offset: number;
  length: number;
};

export type VqfEncodedLexiconPages = {
  pageSize: number;
  termCount: number;
  directory: VqfLexiconPageDirectoryEntry[];
  pages: Uint8Array;
};

export function requirePageSize(pageSize: number): number {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_VQF_LEXICON_PAGE_SIZE
  ) {
    throw new RangeError('Invalid VQF lexicon page size.');
  }
  return pageSize;
}

export function sharedPrefixLength(
  left: Uint8Array,
  right: Uint8Array
): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index++;
  return index;
}

export function encodeFrontCodedPage(
  terms: string[],
  maxBytes: number
): Uint8Array {
  if (!Array.isArray(terms) || terms.length === 0) {
    throw new Error('VQF lexicon page requires at least one term.');
  }
  checkBufferLimit(maxBytes);
  const writer = new VqfByteWriter(maxBytes);
  const encoded = terms.map((term) => encodeString(term, maxBytes));
  writer.writeUVarint(encoded[0].length);
  writer.writeBytes(encoded[0]);
  for (let i = 1; i < encoded.length; i++) {
    if (compareBytes(encoded[i - 1], encoded[i]) >= 0) {
      throw new Error('VQF lexicon page terms are not strictly sorted.');
    }
    const shared = sharedPrefixLength(encoded[i - 1], encoded[i]);
    writer.writeUVarint(shared);
    const suffix = encoded[i].subarray(shared);
    writer.writeUVarint(suffix.length);
    writer.writeBytes(suffix);
  }
  return writer.finish();
}

export function decodeFrontCodedPage(
  bytes: Uint8Array,
  options: { pageSize: number; maxBytes?: number } = {
    pageSize: DEFAULT_VQF_LEXICON_PAGE_SIZE,
  }
): string[] {
  const pageSize = requirePageSize(options.pageSize);
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  checkBufferLimit(maxBytes);
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected VQF lexicon page bytes.');
  }
  if (bytes.length > maxBytes) {
    throw new RangeError('VQF lexicon page exceeds the byte limit.');
  }
  const reader = new VqfByteReader(bytes, maxBytes);
  const firstLength = reader.readUVarintNumber(reader.remaining);
  let previous = reader.readBytes(firstLength);
  const terms = [decodeString(previous)];
  while (reader.remaining > 0) {
    if (terms.length >= pageSize) {
      throw new Error('VQF lexicon page exceeds its term limit.');
    }
    const shared = reader.readUVarintNumber(previous.length);
    if (shared > previous.length) {
      throw new RangeError(
        'VQF lexicon shared prefix exceeds the previous term.'
      );
    }
    const suffix = reader.readBytes(reader.readUVarintNumber(reader.remaining));
    const current = new Uint8Array(shared + suffix.length);
    current.set(previous.subarray(0, shared));
    current.set(suffix, shared);
    if (compareBytes(previous, current) >= 0) {
      throw new Error('VQF lexicon page terms are not strictly sorted.');
    }
    terms.push(decodeString(current));
    previous = current;
  }
  reader.assertFinished();
  return terms;
}

export function encodeLexiconPages(
  terms: string[],
  options: { pageSize?: number; maxBytes?: number } = {}
): VqfEncodedLexiconPages {
  const pageSize = requirePageSize(
    options.pageSize ?? DEFAULT_VQF_LEXICON_PAGE_SIZE
  );
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  checkBufferLimit(maxBytes);
  if (!Array.isArray(terms)) throw new Error('Expected VQF lexicon terms.');
  const encodedTerms = terms.map((term) => encodeString(term, maxBytes));
  for (let i = 1; i < encodedTerms.length; i++) {
    if (compareBytes(encodedTerms[i - 1], encodedTerms[i]) >= 0) {
      throw new Error('VQF lexicon terms are not strictly sorted.');
    }
  }
  const directory: VqfLexiconPageDirectoryEntry[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (let start = 0; start < terms.length; start += pageSize) {
    const pageTerms = terms.slice(start, start + pageSize);
    const encoded = encodeFrontCodedPage(pageTerms, maxBytes - offset);
    directory.push({
      firstTerm: pageTerms[0],
      firstTermBytes: encodedTerms[start].slice(),
      offset,
      length: encoded.length,
    });
    parts.push(encoded);
    offset += encoded.length;
    if (offset > maxBytes) {
      throw new RangeError('VQF lexicon pages exceed the byte limit.');
    }
  }
  const pages = new Uint8Array(offset);
  let cursor = 0;
  for (const part of parts) {
    pages.set(part, cursor);
    cursor += part.length;
  }
  return {
    pageSize,
    termCount: terms.length,
    directory,
    pages,
  };
}

export function lookupLexiconPage(
  directory: readonly VqfLexiconPageDirectoryEntry[],
  termBytes: Uint8Array
): number {
  let low = 0;
  let high = directory.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (compareBytes(directory[mid].firstTermBytes, termBytes) <= 0) {
      low = mid + 1;
    } else high = mid;
  }
  return low - 1;
}

export function lookupLexiconTerm(
  encoded: VqfEncodedLexiconPages,
  term: string,
  options: { maxBytes?: number } = {}
): number | undefined {
  if (encoded.directory.length === 0) return undefined;
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  const termBytes = encodeString(term, maxBytes);
  const pageIndex = lookupLexiconPage(encoded.directory, termBytes);
  if (pageIndex < 0) return undefined;
  const entry = encoded.directory[pageIndex];
  const page = decodeFrontCodedPage(
    encoded.pages.subarray(entry.offset, entry.offset + entry.length),
    { pageSize: encoded.pageSize, maxBytes }
  );
  for (let i = 0; i < page.length; i++) {
    if (page[i] === term) return pageIndex * encoded.pageSize + i;
  }
  return undefined;
}
