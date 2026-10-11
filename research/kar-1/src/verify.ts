import { canonicalize } from './canonicalize.js';
import { evaluate } from './evaluate.js';
import type { KarResult } from './types.js';

export function verify(image: unknown, graph: unknown, query: unknown, plan: unknown, claimed: KarResult): { ok: boolean; reason: string } {
  const actual = evaluate(image, graph, query, plan);
  if (canonicalize(actual) !== canonicalize(claimed)) {
    return { ok: false, reason: `status ${actual.status} did not match ${claimed.status}` };
  }
  return { ok: true, reason: '' };
}
