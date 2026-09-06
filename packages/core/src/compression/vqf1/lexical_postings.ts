/**
 * Directly addressable lexical postings. The V4 adapter preserves existing
 * sentinel-array block-ID and position conventions. Native varint streams,
 * lexicon pages and microblocks live in postings.ts.
 */

export type LexicalPosting = {
  blockId: number;
  positions: number[];
  termFrequency: number;
};

export type LexicalPostingsReadOptions = {
  positions?: boolean;
};

export type LexicalPostingsStats = {
  termCount: number;
  documentPostingCount: number;
  positionCount: number;
  constructionIntegers: number;
  termsLookedUp: number;
  postingListsRead: number;
  documentsVisited: number;
  positionsCopied: number;
  missingTermLookups: number;
  microblockCount: number;
  microblocksRead: number;
  postingBytesRead: number;
  phraseCount: number;
  phraseStreamsRead: number;
  phraseBytesRead: number;
};

export interface LexicalPostingsReader {
  hasTerm(termId: number): boolean;
  documentFrequency(termId: number): number;
  termIds(): Iterable<number>;
  termOrder(termId: number): number;
  read(
    termId: number,
    options?: LexicalPostingsReadOptions
  ): Iterable<LexicalPosting>;
  stats(): LexicalPostingsStats;
  resetQueryStats(): void;
}

type LegacyDocument = {
  blockId: number;
  positions: number[];
};

type LegacyTerm = {
  order: number;
  documents: LegacyDocument[];
};

const readerCache = new WeakMap<
  Uint32Array,
  { offsetBlockIds: boolean; reader: LexicalPostingsReader }
>();

export function createLegacyLexicalPostingsReader(
  postings: Uint32Array,
  options: { offsetBlockIds?: boolean } = {}
): LexicalPostingsReader {
  if (!(postings instanceof Uint32Array)) {
    throw new Error('Expected V4 postings.');
  }
  const offsetBlockIds = options.offsetBlockIds !== false;
  const cached = readerCache.get(postings);
  if (cached && cached.offsetBlockIds === offsetBlockIds) return cached.reader;
  const reader = new LegacyLexicalPostingsReader(postings, offsetBlockIds);
  readerCache.set(postings, { offsetBlockIds, reader });
  return reader;
}

export function encodeLegacyLexicalPostings(
  streams: Array<{
    termId: number;
    documents: Array<{ blockId: number; positions: number[] }>;
  }>,
  options: { offsetBlockIds?: boolean } = {}
): Uint32Array {
  const offsetBlockIds = options.offsetBlockIds !== false;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const stream of streams) {
    const termId = stream.termId;
    if (!Number.isSafeInteger(termId) || termId < 1 || termId > 0xffffffff) {
      throw new RangeError('Invalid V4 posting term id.');
    }
    if (seen.has(termId)) throw new Error('Duplicate V4 posting term.');
    seen.add(termId);
    out.push(termId);
    for (const document of stream.documents) {
      const encodedBid = offsetBlockIds
        ? document.blockId + 1
        : document.blockId;
      if (
        !Number.isSafeInteger(encodedBid) ||
        encodedBid < 1 ||
        encodedBid > 0xffffffff
      ) {
        throw new RangeError('Invalid V4 posting block id.');
      }
      out.push(encodedBid);
      for (const position of document.positions) {
        if (
          !Number.isSafeInteger(position) ||
          position < 0 ||
          position >= 0xffffffff
        ) {
          throw new RangeError('Invalid V4 posting position.');
        }
        out.push(position + 1);
      }
      out.push(0);
    }
    out.push(0);
  }
  return Uint32Array.from(out);
}

class LegacyLexicalPostingsReader implements LexicalPostingsReader {
  private readonly terms = new Map<number, LegacyTerm>();
  private readonly construction: {
    termCount: number;
    documentPostingCount: number;
    positionCount: number;
    constructionIntegers: number;
    microblockCount: number;
    phraseCount: number;
  };
  private query = emptyQueryStats();

  constructor(postings: Uint32Array, offsetBlockIds: boolean) {
    let i = 0;
    let constructionIntegers = 0;
    let documentPostingCount = 0;
    let positionCount = 0;
    while (i < postings.length) {
      const termId = postings[i++];
      constructionIntegers++;
      if (termId === 0) continue;
      if (this.terms.has(termId)) throw new Error('Duplicate V4 posting term.');
      const documents: LegacyDocument[] = [];
      while (true) {
        if (i >= postings.length) throw new Error('Truncated V4 postings.');
        const encodedBid = postings[i++];
        constructionIntegers++;
        if (encodedBid === 0) break;
        const blockId = offsetBlockIds ? encodedBid - 1 : encodedBid;
        const positions: number[] = [];
        while (true) {
          if (i >= postings.length) throw new Error('Truncated V4 postings.');
          const encodedPos = postings[i++];
          constructionIntegers++;
          if (encodedPos === 0) break;
          positions.push(encodedPos - 1);
        }
        documents.push({ blockId, positions });
        documentPostingCount++;
        positionCount += positions.length;
      }
      this.terms.set(termId, { order: this.terms.size, documents });
    }
    this.construction = {
      termCount: this.terms.size,
      documentPostingCount,
      positionCount,
      constructionIntegers,
      microblockCount: 0,
      phraseCount: 0,
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
    if (!term) throw new Error('Absent V4 posting term.');
    return term.documents.length;
  }

  termIds(): Iterable<number> {
    return this.terms.keys();
  }

  termOrder(termId: number): number {
    const term = this.terms.get(termId);
    if (!term) throw new Error('Absent V4 posting term.');
    return term.order;
  }

  read(
    termId: number,
    options: LexicalPostingsReadOptions = {}
  ): Iterable<LexicalPosting> {
    const term = this.terms.get(termId);
    if (!term) throw new Error('Absent V4 posting term.');
    this.query.postingListsRead++;
    const copyPositions = options.positions !== false;
    const out: LexicalPosting[] = [];
    for (const document of term.documents) {
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
    return { ...this.construction, ...this.query };
  }

  resetQueryStats(): void {
    this.query = emptyQueryStats();
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
  phraseStreamsRead: number;
  phraseBytesRead: number;
} {
  return {
    termsLookedUp: 0,
    postingListsRead: 0,
    documentsVisited: 0,
    positionsCopied: 0,
    missingTermLookups: 0,
    microblocksRead: 0,
    postingBytesRead: 0,
    phraseStreamsRead: 0,
    phraseBytesRead: 0,
  };
}
