import { getTextEncoder } from './utils/utf8.js';
import { sha256Hex } from './utils/sha256.js';

export type RetrievalPlan = {
  version: 'retrieval-v4.0';
  analyzer?: { id: string; digest: string };
  normalize: string;
  scope: { namespace?: string[]; source?: string[]; requiredPhrases?: string[][] };
  generate: string[];
  constrain: string[];
  expand: { enabled: boolean; graph: boolean };
  rescore: string[];
  semantic: { enabled: boolean; grounded: boolean };
  diversify: string;
  /** Normalized result-affecting query settings included in planHash. */
  options: Record<string, unknown>;
  planHash: string;
};

export function createRetrievalPlan(input: Omit<RetrievalPlan, 'planHash'>): RetrievalPlan {
  const canonical = JSON.stringify(input);
  return { ...input, planHash: `sha256-${sha256Hex(getTextEncoder().encode(canonical))}` };
}
