// src/quality/similarity.ts
import { normalize } from '../tokenize.js';

export function ngramSet(s: string, n = 5): Set<string> {
  const t = normalize(s);
  const out = new Set<string>();
  if (t.length < n) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

export function jaccardFromSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

export function jaccard5(s1: string, s2: string): number {
  return jaccardFromSets(ngramSet(s1, 5), ngramSet(s2, 5));
}
