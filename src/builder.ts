/*
 * builder.ts
 *
 * Build `.knolo` packs from input docs. Persists headings/docIds/token lengths
 * and stores avgBlockLen in meta for stable query-time normalization.
 */

import { buildIndex } from './indexer.js';
import type { Block } from './indexer.js';
import { tokenize } from './tokenize.js';
import { getTextEncoder } from './utils/utf8.js';

export type BuildInputDoc = { id?: string; heading?: string; namespace?: string; text: string };

export async function buildPack(docs: BuildInputDoc[]): Promise<Uint8Array> {
  const normalizedDocs = validateDocs(docs);

  // Prepare blocks (strip MD) and carry heading/docId for optional boosts.
  const blocks: Block[] = normalizedDocs.map((d, i) => ({
    id: i,
    text: stripMd(d.text),
    heading: d.heading,
  }));

  // Build index
  const { lexicon, postings } = buildIndex(blocks);

  const blockTokenLens = blocks.map((b) => tokenize(b.text).length);
  const totalTokens = blockTokenLens.reduce((sum, len) => sum + len, 0);
  const avgBlockLen = blocks.length ? totalTokens / blocks.length : 1;

  const meta = {
    version: 3,
    stats: {
      docs: normalizedDocs.length,
      blocks: blocks.length,
      terms: lexicon.length,
      avgBlockLen,
    },
  };

  // Persist blocks as objects to optionally carry heading/docId/token length.
  const blocksPayload = blocks.map((b, i) => ({
    text: b.text,
    heading: b.heading ?? null,
    docId: normalizedDocs[i]?.id ?? null,
    namespace: normalizedDocs[i]?.namespace ?? null,
    len: blockTokenLens[i] ?? 0,
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

function validateDocs(docs: BuildInputDoc[]): BuildInputDoc[] {
  if (!Array.isArray(docs)) {
    throw new Error('buildPack expects an array of docs: [{ text, id?, heading?, namespace? }, ...]');
  }

  return docs.map((doc, i) => {
    if (!doc || typeof doc !== 'object') {
      throw new Error(`Invalid doc at index ${i}: expected an object with a string "text" field.`);
    }
    if (typeof doc.text !== 'string' || !doc.text.trim()) {
      throw new Error(`Invalid doc at index ${i}: "text" must be a non-empty string.`);
    }
    if (doc.id !== undefined && typeof doc.id !== 'string') {
      throw new Error(`Invalid doc at index ${i}: "id" must be a string when provided.`);
    }
    if (doc.heading !== undefined && typeof doc.heading !== 'string') {
      throw new Error(`Invalid doc at index ${i}: "heading" must be a string when provided.`);
    }
    if (doc.namespace !== undefined && typeof doc.namespace !== 'string') {
      throw new Error(`Invalid doc at index ${i}: "namespace" must be a string when provided.`);
    }
    return doc;
  });
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
