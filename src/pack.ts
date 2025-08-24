/*
 * pack.ts
 *
 * Defines the pack structure and implements the mountPack function that loads
 * a `.knolo` pack from a variety of sources. A pack consists of a header
 * containing metadata, followed by JSON‑encoded lexicon and blocks and a
 * flattened postings list encoded as a 32‑bit integer array. The pack is
 * portable across Node.js and browser environments.
 */

export type MountOptions = { src: string | ArrayBufferLike | Uint8Array };

/** Metadata about the pack. Version numbers should increment with format
 *  changes, allowing the runtime to adapt accordingly. */
export type PackMeta = {
  version: number;
  stats: { docs: number; blocks: number; terms: number };
};

/**
 * A mounted pack exposing the inverted index, block text and optional field
 * metadata. The core runtime reads from these structures directly at query
 * time.
 */
export type Pack = {
  meta: PackMeta;
  /** Map of token to term identifier used in the postings list. */
  lexicon: Map<string, number>;
  /** Flattened postings list where each term section starts with the termId
   * followed by (blockId, positions..., 0) tuples, ending with a 0.
   */
  postings: Uint32Array;
  /** Array of block texts. Each block corresponds to a chunk of the original
   * documents. The blockId used in the postings list indexes into this array.
   */
  blocks: string[];
};

/**
 * Load a `.knolo` pack from a variety of sources. The pack binary layout is
 * currently:
 *
 *  [metaLen:u32][meta JSON][lexLen:u32][lexicon JSON][postCount:u32][postings][blocksLen:u32][blocks JSON]
 *
 * All integers are little endian. `metaLen`, `lexLen` and `blocksLen` denote
 * the byte lengths of the subsequent JSON sections. `postCount` is the number
 * of 32‑bit integers in the postings array. This simple layout is sufficient
 * for v0 and avoids any additional dependencies beyond standard typed arrays.
 *
 * @param opts Options specifying how to load the pack. Accepts a URL string,
 *        ArrayBuffer, or Uint8Array.
 * @returns A Promise resolving to a mounted pack with the index and blocks.
 */
export async function mountPack(opts: MountOptions): Promise<Pack> {
  const buf = await resolveToBuffer(opts.src);
  const dv = new DataView(buf);
  let offset = 0;

  // Read meta section
  const metaLen = dv.getUint32(offset, true);
  offset += 4;
  const metaJson = new TextDecoder().decode(new Uint8Array(buf, offset, metaLen));
  offset += metaLen;
  const meta: PackMeta = JSON.parse(metaJson);

  // Read lexicon
  const lexLen = dv.getUint32(offset, true);
  offset += 4;
  const lexJson = new TextDecoder().decode(new Uint8Array(buf, offset, lexLen));
  offset += lexLen;
  const lexEntries: Array<[string, number]> = JSON.parse(lexJson);
  const lexicon = new Map<string, number>(lexEntries);

  // Read postings
  const postCount = dv.getUint32(offset, true);
  offset += 4;
  const postings = new Uint32Array(buf, offset, postCount);
  offset += postCount * 4;

  // Read blocks
  const blocksLen = dv.getUint32(offset, true);
  offset += 4;
  const blocksJson = new TextDecoder().decode(new Uint8Array(buf, offset, blocksLen));
  const blocks: string[] = JSON.parse(blocksJson);

  return { meta, lexicon, postings, blocks };
}

/** Resolve the `src` field of MountOptions into an ArrayBuffer. Supports:
 *  - strings interpreted as URLs (via fetch)
 *  - Uint8Array and ArrayBuffer inputs
 */
async function resolveToBuffer(src: MountOptions['src']): Promise<ArrayBuffer> {
  if (typeof src === 'string') {
    // Use fetch for browser and Node environments. For Node this requires the
    // global fetch API (available since Node 18). Error handling is delegated
    // to the caller.
    const res = await fetch(src);
    const ab = await res.arrayBuffer();
    return ab;
  }
if (src instanceof Uint8Array) {
  // If the view covers the whole buffer, return it directly (cast to ArrayBuffer).
  if (src.byteOffset === 0 && src.byteLength === src.buffer.byteLength) {
    return src.buffer as ArrayBuffer;
  }
  // Otherwise, copy to a new buffer so we return exactly the bytes for this view.
  const copy = src.slice();           // makes a copy of the bytes for this range
  return copy.buffer as ArrayBuffer;  // typed as ArrayBuffer
}

  return src as ArrayBuffer;
}