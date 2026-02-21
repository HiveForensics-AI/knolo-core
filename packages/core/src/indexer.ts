/*
 * indexer.ts
 *
 * Implements a basic inverted index builder. Given an array of blocks, it
 * produces a lexicon mapping each unique term to a term identifier and a
 * flattened postings array. This representation is intentionally naïve to
 * prioritise clarity and portability over maximum compression. The pack
 * builder can later swap this implementation for a more compact format.
 */

import { tokenize } from "./tokenize.js";

export type Block = { id: number; text: string; heading?: string };

export type IndexBuildResult = {
  lexicon: Array<[string, number]>;
  postings: Uint32Array;
};

/**
 * Build an inverted index from an array of blocks. The postings list format
 * encodes, for each term, a header containing the termId, followed by
 * sequences of blockId and positions for that term, with zeros as delimiters.
 * The structure looks like:
 *
 *     [termId, blockId+1, pos, pos, 0, blockId+1, pos, 0, 0, termId, ...]
 *
 * Block IDs are stored as bid+1 so that 0 can remain a sentinel delimiter.
 * Each block section ends with a 0, and each term section ends with a 0. The
 * entire array can be streamed sequentially without needing to know the sizes
 * of individual lists ahead of time.
 */
export function buildIndex(blocks: Block[]): IndexBuildResult {
  // Map term to termId and interim map of termId -> blockId -> positions
  const term2id = new Map<string, number>();
  const termBlockPositions: Map<number, Map<number, number[]>> = new Map();

  const getTermId = (t: string): number => {
    let id = term2id.get(t);
    if (id === undefined) {
      id = term2id.size + 1; // term IDs start at 1
      term2id.set(t, id);
    }
    return id;
  };

  // Build a local term frequency map per block, then populate the global map
  for (const block of blocks) {
    const toks = tokenize(block.text);
    const perTermPositions = new Map<number, number[]>();
    for (const tk of toks) {
      const id = getTermId(tk.term);
      let positions = perTermPositions.get(id);
      if (!positions) {
        positions = [];
        perTermPositions.set(id, positions);
      }
      positions.push(tk.pos);
    }
    // Merge into global structure
    for (const [tid, positions] of perTermPositions) {
      let blockMap = termBlockPositions.get(tid);
      if (!blockMap) {
        blockMap = new Map();
        termBlockPositions.set(tid, blockMap);
      }
      blockMap.set(block.id, positions);
    }
  }

  // Flatten postings into a single Uint32Array
  const postings: number[] = [];
  for (const [tid, blockMap] of termBlockPositions) {
    postings.push(tid);
    for (const [bid, positions] of blockMap) {
      postings.push(bid + 1, ...positions, 0);
    }
    postings.push(0); // end of term
  }
  // Convert lexicon to array for serialization
  const lexicon = Array.from(term2id.entries());
  return { lexicon, postings: new Uint32Array(postings) };
}
