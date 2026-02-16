/*
 * patch.ts
 *
 * Provides the makeContextPatch function that assembles search results into
 * structured context patches for consumption by language models. A context
 * patch includes a background summary and selected snippets. Future versions
 * may include definitions, facts and other structured artifacts.
 */

import type { Hit } from "./query.js";

export type ContextPatch = {
  background: string[];
  snippets: Array<{ text: string; source?: string }>;
  definitions: Array<{ term: string; def: string; evidence?: number[] }>;
  facts: Array<{ s: string; p: string; o: string; evidence?: number[] }>;
};

/** Assemble a context patch from an array of hits. The `budget` determines
 * how many snippets and how much text to include in each snippet. Currently
 * three budgets are supported:
 *  - `mini`: ~512 token contexts
 *  - `small`: ~1k token contexts
 *  - `full`: ~2k token contexts
 */
export function makeContextPatch(
  hits: Hit[],
  opts: { budget?: 'mini' | 'small' | 'full' } = {}
): ContextPatch {
  const budget = opts.budget ?? 'small';
  const limits = {
    mini: { snippets: 3, chars: 240 },
    small: { snippets: 6, chars: 420 },
    full: { snippets: 10, chars: 900 },
  } as const;
  const limit = limits[budget];
  const snippets = hits.slice(0, limit.snippets).map((h) => ({
    text: truncate(h.text, limit.chars),
    source: h.source,
  }));
  // Build background summary from first two snippets by extracting first sentence
  const background = snippets.slice(0, 2).map((s) => firstSentence(s.text));
  return {
    background,
    snippets,
    definitions: [],
    facts: [],
  };
}

/** Extract the first sentence from a block of text. If no terminal punctuation
 * is found, returns the first N characters up to a reasonable length.
 */
function firstSentence(text: string): string {
  const m = text.match(/^(.{10,200}?[.!?])\s/);
  if (m) return m[1];
  return text.slice(0, 160);
}

/** Truncate text to a maximum length and append an ellipsis if it was
 * truncated.
 */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}