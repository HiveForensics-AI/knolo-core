/*
 * tokenize.ts
 *
 * Provides functions for normalizing strings and splitting them into tokens
 * suitable for indexing and querying. This module deliberately avoids any
 * language‑specific stemming or lemmatization to keep the core simple and
 * deterministic across platforms. Basic Unicode normalization and diacritic
 * stripping are applied to ensure consistent matches.
 */

export type Token = { term: string; pos: number };

/** Normalize a string by:
 *  - Applying NFKD Unicode normalization
 *  - Stripping combining diacritics
 *  - Converting to lowercase
 *  - Replacing non‑alphanumeric characters (except hyphen and space) with space
 *
 * This normalization ensures that accents and case do not affect matching.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ');
}

/** Split a piece of text into tokens with positional information. Each token
 * contains the normalized term and its position in the sequence. Positions
 * increment only on actual tokens, ignoring multiple whitespace separators.
 */
export function tokenize(text: string): Token[] {
  const norm = normalize(text);
  const out: Token[] = [];
  let pos = 0;
  for (const w of norm.split(/\s+/).filter(Boolean)) {
    out.push({ term: w, pos: pos++ });
  }
  return out;
}

/** Parse quoted phrases in a query string. A phrase is a sequence of words
 * enclosed in double quotes. Returns an array of term arrays representing
 * each phrase. Single words outside quotes are ignored here and handled
 * separately by tokenize().
 */
export function parsePhrases(q: string): string[][] {
  const parts: string[][] = [];
  const regex = /"([^\"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(q)) !== null) {
    const phrase = match[1].trim().split(/\s+/);
    if (phrase.length > 0) parts.push(phrase);
  }
  return parts;
}