/**
 * Blind frontier generators for KAR Experiment 2.
 *
 * Inputs are the query string and, for the cue harvester, raw document
 * text. This module does not read relation labels, fact ids, required
 * frontiers, or any hand-authored opposing query.
 *
 * The cue list and the morphological operators were frozen before the
 * run. They are general English function cues and rewrites of the query's
 * own tokens. They are not a list of terms copied from hidden evidence.
 */

export const FRONTIER_VERSION = 'kar-frontier-blind-1';

const CUES = [
  'cannot',
  'except',
  'unless',
  'notwithstanding',
  'prohibited',
  'forbidden',
  'waiver',
  'exception',
  'ineligible',
  'supersede',
  'superseded',
  'void',
];

const STOP = new Set([
  'that',
  'with',
  'from',
  'this',
  'under',
  'when',
  'only',
  'same',
  'text',
  'copy',
  'into',
  'than',
  'then',
  'them',
  'they',
  'have',
  'been',
  'were',
  'will',
  'would',
  'could',
  'should',
  'about',
  'after',
  'before',
  'there',
  'their',
  'which',
  'where',
  'while',
]);

function contentTokens(tokenize, query) {
  const seen = new Set();
  const out = [];
  for (const token of tokenize(query)) {
    const term = token.term;
    if (term.length < 4) continue;
    if (STOP.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

/** Query-only rewrites. No corpus and no fixture metadata. */
export function morphologicalFrontier(query, tokenize) {
  const tokens = contentTokens(tokenize, query);
  const pieces = [];
  for (const token of tokens) {
    pieces.push(`non-${token}`);
    pieces.push(`cannot ${token}`);
    pieces.push(`may not ${token}`);
    pieces.push(`no ${token}`);
    pieces.push(`${token} prohibited`);
    pieces.push(`without ${token}`);
  }
  return {
    version: FRONTIER_VERSION,
    kind: 'morphology',
    query: pieces.join(' '),
    terms: pieces,
  };
}

/** Closed-class cue query. The words are the frozen list, not harvested terms. */
export function cueFrontier() {
  return {
    version: FRONTIER_VERSION,
    kind: 'cues',
    query: CUES.join(' '),
    terms: CUES.slice(),
  };
}

/**
 * Terms that sit in a sentence containing a frozen cue.
 * Document order does not affect the counts. Ties break on the term string.
 */
export function harvestFrontier(query, texts, tokenize, limit = 8) {
  const queryTerms = new Set(tokenize(query).map((token) => token.term));
  const counts = new Map();
  let cueSentences = 0;
  for (const text of texts) {
    const sentences = String(text).split(/(?<=[.?!])\s+/);
    for (const sentence of sentences) {
      const tokens = tokenize(sentence).map((token) => token.term);
      if (!tokens.some((term) => CUES.includes(term))) continue;
      cueSentences += 1;
      const local = new Set(tokens);
      for (const term of local) {
        if (term.length < 4) continue;
        if (queryTerms.has(term)) continue;
        if (CUES.includes(term)) continue;
        if (STOP.has(term)) continue;
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const selected = ranked.slice(0, limit);
  return {
    version: FRONTIER_VERSION,
    kind: 'cue-harvest',
    query: selected.map(([term]) => term).join(' '),
    terms: selected.map(([term, count]) => ({ term, count })),
    cueSentences,
    distinctTerms: counts.size,
  };
}
