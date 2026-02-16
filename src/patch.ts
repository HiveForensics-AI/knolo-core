/*
 * patch.ts
 *
 * Produces a compact, deterministic “context patch” from ranked hits.
 */

import type { Hit } from './query.js';

export type ContextPatch = {
  background: string[];
  snippets: Array<{ text: string; source?: string }>;
  definitions: Array<{ term: string; def: string; evidence?: number[] }>;
  facts: Array<{ s: string; p: string; o: string; evidence?: number[] }>;
};

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

function firstSentence(text: string): string {
  const m = text.match(/^(.{10,200}?[.!?])\s/);
  if (m) return m[1];
  return text.slice(0, 160);
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}
