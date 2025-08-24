/*
 * builder.ts
 *
 * Provides a programmatic interface for building `.knolo` knowledge packs
 * from arrays of input documents. The input format accepts objects with
 * `id`, `heading` and `text` fields. The builder performs simple
 * Markdown stripping and calls the indexer to generate the inverted index. The
 * resulting pack binary can be persisted to disk or served directly to
 * clients.
 */

import { buildIndex } from './indexer.js';
import type { Block } from './indexer.js';
export type BuildInputDoc = { id?: string; heading?: string; text: string };

/** Build a `.knolo` pack from an array of input documents. At present each
 * document becomes a single block. Future versions may split documents into
 * multiple blocks based on headings or token count to improve retrieval
 * granularity.
 */
export async function buildPack(docs: BuildInputDoc[]): Promise<Uint8Array> {
  // Convert docs into blocks. For v0 each doc is a single block; heading is
  // ignored except possibly for future heading boosting in ranking.
  const blocks: Block[] = docs.map((d, i) => ({ id: i, text: stripMd(d.text), heading: d.heading }));
  const { lexicon, postings } = buildIndex(blocks);
  const meta = {
    version: 1,
    stats: { docs: docs.length, blocks: blocks.length, terms: lexicon.length },
  };
  // Encode sections to bytes
  const enc = new TextEncoder();
  const metaBytes = enc.encode(JSON.stringify(meta));
  const lexBytes = enc.encode(JSON.stringify(lexicon));
  const blocksBytes = enc.encode(JSON.stringify(blocks.map((b) => b.text)));
  // Compute lengths and allocate output
  const totalLength =
    4 + metaBytes.length +
    4 + lexBytes.length +
    4 + postings.length * 4 +
    4 + blocksBytes.length;
  const out = new Uint8Array(totalLength);
  const dv = new DataView(out.buffer);
  let offset = 0;
  // meta
  dv.setUint32(offset, metaBytes.length, true); offset += 4;
  out.set(metaBytes, offset); offset += metaBytes.length;
  // lexicon
  dv.setUint32(offset, lexBytes.length, true); offset += 4;
  out.set(lexBytes, offset); offset += lexBytes.length;
  // postings
  dv.setUint32(offset, postings.length, true); offset += 4;
  new Uint32Array(out.buffer, offset, postings.length).set(postings); offset += postings.length * 4;
  // blocks
  dv.setUint32(offset, blocksBytes.length, true); offset += 4;
  out.set(blocksBytes, offset);
  return out;
}

/** Strip Markdown syntax by converting to HTML and then removing tags. The
 * `marked` library is used for parsing and rendering. A very naive HTML tag
 * stripper removes tags by dropping anything between `<` and `>`. This is
 * simplistic but adequate for plain text extraction.
 */
function stripMd(md: string): string {
  // Remove code fences
  let text = md.replace(/```[^```]*```/g, ' ');
  // Remove inline code backticks
  text = text.replace(/`[^`]*`/g, ' ');
  // Remove emphasis markers (*, _, ~)
  text = text.replace(/[\*_~]+/g, ' ');
  // Remove headings (#)
  text = text.replace(/^#+\s*/gm, '');
  // Remove links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  // Remove any remaining brackets
  text = text.replace(/[\[\]()]/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}