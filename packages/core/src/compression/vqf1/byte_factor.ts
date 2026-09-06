import { sha256Hex } from '../../utils/sha256.js';
import {
  checkOrdinal,
  compareBytes,
  tableLimits,
  type VqfTableLimits,
} from './table_utils.js';

export type VqfByteFactoringOptions = VqfTableLimits & {
  /** Candidate lookup only. Injectable for collision tests; never an identity. */
  candidateHash?: (bytes: Uint8Array) => string;
};

/** Returns the lowest exact byte offset, including zero for an empty target. */
export function findLowestByteOffset(
  source: Uint8Array,
  target: Uint8Array
): number | undefined {
  if (target.length > source.length) return undefined;
  outer: for (
    let offset = 0;
    offset <= source.length - target.length;
    offset++
  ) {
    for (let i = 0; i < target.length; i++) {
      if (source[offset + i] !== target[i]) continue outer;
    }
    return offset;
  }
  return undefined;
}

export class VqfByteStore {
  private constructor(
    private readonly blobs: Uint8Array[],
    private readonly references: number[],
    readonly logicalBytes: number
  ) {}
  get count(): number {
    return this.blobs.length;
  }
  get ordinals(): number[] {
    return [...this.references];
  }
  get physicalBlobBytes(): number {
    return this.blobs.reduce((sum, blob) => sum + blob.length, 0);
  }
  /** Payload-only savings; record/table/envelope overhead is not included. */
  get duplicateBlobBytesSaved(): number {
    return this.logicalBytes - this.physicalBlobBytes;
  }

  static build(
    input: Iterable<Uint8Array>,
    options: VqfByteFactoringOptions = {}
  ): VqfByteStore {
    const limits = tableLimits(options);
    const hash = options.candidateHash ?? sha256Hex;
    const candidates = new Map<string, Uint8Array[]>();
    const references: Uint8Array[] = [];
    const unique: Uint8Array[] = [];
    let logicalBytes = 0;
    for (const inputBytes of input) {
      if (references.length >= limits.maxEntries)
        throw new RangeError('VQF blobs exceed the entry limit.');
      if (
        !(inputBytes instanceof Uint8Array) ||
        inputBytes.length > limits.maxBytes - logicalBytes
      )
        throw new RangeError('VQF blobs exceed the byte limit.');
      logicalBytes += inputBytes.length;
      // Own bytes before retaining; Buffer inputs must not alias their source.
      const bytes = Uint8Array.from(inputBytes);
      const key = hash(options.candidateHash ? bytes.slice() : bytes);
      const bucket = candidates.get(key) ?? [];
      let blob = bucket.find(
        (candidate) => compareBytes(candidate, bytes) === 0
      );
      if (!blob) {
        blob = bytes;
        bucket.push(blob);
        candidates.set(key, bucket);
        unique.push(blob);
      }
      references.push(blob);
    }
    unique.sort(compareBytes);
    const ordinals = new Map(unique.map((blob, i) => [blob, i]));
    return new VqfByteStore(
      unique,
      references.map((blob) => ordinals.get(blob)!),
      logicalBytes
    );
  }

  blobAt(ordinal: number): Uint8Array {
    checkOrdinal(ordinal, this.count);
    return this.blobs[ordinal].slice();
  }
}
