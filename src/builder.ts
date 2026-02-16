/*
 * builder.ts
 *
 * Build `.knolo` packs from input docs. Now persists optional headings/docIds
 * and stores avgBlockLen in meta for faster/easier normalization at query-time.
 */

import { buildIndex } from './indexer.js';
import type { Block } from './indexer.js';
import { tokenize } from './tokenize.js';
import { getTextEncoder } from './utils/utf8.js';

export type BuildInputDoc = { id?: string; heading?: string; text: string };

export async function buildPack(docs: BuildInputDoc[]): Promise<Uint8Array> {
  if (!Array.isArray(docs)) {
    throw new TypeError('buildPack(docs) expects an array of documents.');
  }

  // Prepare blocks (strip MD) and carry heading/docId for optional boosts.
  const blocks: Block[] = docs.map((d, i) => ({
    id: i,
    text: stripMd(typeof d?.text === 'string' ? d.text : ''),
    heading: d.heading,
  }));

  // Build index
  const { lexicon, postings } = buildIndex(blocks);

  // Compute avg token length once (store in meta)
  const blockTokenLens = blocks.map((b) => tokenize(b.text).length || 1);
  const totalTokens = blockTokenLens.reduce((sum, n) => sum + n, 0);
  const avgBlockLen = blocks.length ? totalTokens / blocks.length : 1;

  const meta = {
    version: 2,
    stats: {
      docs: docs.length,
      blocks: blocks.length,
      terms: lexicon.length,
      avgBlockLen,
    },
  };

  // Persist blocks as objects to optionally carry heading/docId
  const blocksPayload = blocks.map((b, i) => ({
    text: b.text,
    heading: b.heading ?? null,
    docId: docs[i]?.id ?? null,
    len: blockTokenLens[i],
  }));

  // Encode sections
  const enc = getTextEncoder();
  const metaBytes = enc.encode(JSON.stringify(meta));
  const lexBytes = enc.encode(JSON.stringify(lexicon));
  const blocksBytes = enc.encode(JSON.stringify(blocksPayload));

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

  // postings (alignment-safe via DataView)
  dv.setUint32(offset, postings.length, true); offset += 4;
  for (let i = 0; i < postings.length; i++) {
    dv.setUint32(offset, postings[i], true);
    offset += 4;
  }

  // blocks
  dv.setUint32(offset, blocksBytes.length, true); offset += 4;
  out.set(blocksBytes, offset);

  return out;
}

/** Strip Markdown syntax with lightweight regexes (no deps). */
function stripMd(md: string): string {
  let text = md.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`[^`]*`/g, ' ');
  text = text.replace(/[\*_~]+/g, ' ');
  text = text.replace(/^#+\s*/gm, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/[\[\]()]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}
