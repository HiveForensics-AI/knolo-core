import type { Pack } from './pack.runtime.js';
import type { QueryOptions, QueryWithPlanResult } from './query.js';
import { queryWithPlan } from './query.js';
import { createPackFingerprint } from './semantic/sidecar.js';
import { getTextEncoder } from './utils/utf8.js';
import { sha256Hex } from './utils/sha256.js';
import { normalize } from './tokenize.js';

export type ReceiptDecision = 'answer' | 'clarify' | 'abstain';
export type EvidenceSpan = { blockId: number; source?: string; start: number; end: number; text: string };
export type QueryReceipt = {
  version: 'receipt-v1';
  packDigest: string;
  manifestDigest?: string;
  engine: 'knolo-core';
  analyzer?: { id: string; digest: string };
  normalizedQuery: string;
  plan: QueryWithPlanResult['plan'];
  hits: Array<{ blockId: number; score: number; source?: string; namespace?: string; lexicalScore?: number; semanticScore?: number; blendedScore?: number; sourceDigest?: string; spans: EvidenceSpan[] }>;
  answerability: number;
  decision: ReceiptDecision;
  reasons: string[];
  replayHash: string;
  verified: boolean;
};

export type ReceiptOptions = QueryOptions & { policy?: { minAnswerability?: number; onEmpty?: ReceiptDecision } };

export function queryWithReceipt(pack: Pack, query: string, options: ReceiptOptions = {}): { hits: QueryWithPlanResult['hits']; receipt: QueryReceipt } {
  const { policy, ...queryOptions } = options;
  const result = queryWithPlan(pack, query, queryOptions);
  const answerability = calculateAnswerability(result.hits);
  const threshold = policy?.minAnswerability ?? 0.35;
  const decision: ReceiptDecision = result.hits.length === 0 ? (policy?.onEmpty ?? 'abstain') : answerability >= threshold ? 'answer' : 'clarify';
  const reasons = result.hits.length === 0 ? ['no-grounded-candidates'] : decision === 'clarify' ? ['low-answerability'] : [];
  const hits = result.hits.map((hit) => ({
    blockId: hit.blockId,
    score: hit.score,
    source: hit.source,
    namespace: hit.namespace,
    lexicalScore: hit.evidence?.lexicalScore,
    semanticScore: hit.evidence?.semanticScore,
    blendedScore: hit.evidence?.blendedScore,
    sourceDigest: sourceDigest(pack, hit.blockId),
    spans: [makeEvidenceSpan(pack, hit.blockId, query)],
  }));
  const partial = { version: 'receipt-v1' as const, packDigest: packDigest(pack), manifestDigest: pack.meta.manifestDigest, engine: 'knolo-core' as const, analyzer: result.plan.analyzer, normalizedQuery: normalize(query).replace(/\s+/g, ' ').trim(), plan: result.plan, hits, answerability, decision, reasons };
  const replayHash = `sha256-${sha256Hex(getTextEncoder().encode(JSON.stringify(partial)))}`;
  return { hits: result.hits, receipt: { ...partial, replayHash, verified: true } };
}

export function verifyReceipt(receipt: QueryReceipt, pack: Pack): void {
  if (!receipt || receipt.version !== 'receipt-v1') throw new Error('Unsupported receipt version.');
  if (receipt.packDigest !== packDigest(pack)) throw new Error(`Receipt pack digest mismatch: expected ${packDigest(pack)}, got ${receipt.packDigest}.`);
  if (receipt.manifestDigest && receipt.manifestDigest !== pack.meta.manifestDigest) throw new Error('Receipt manifest digest mismatch.');
  for (const hit of receipt.hits) {
    if (!Number.isInteger(hit.blockId) || hit.blockId < 0 || hit.blockId >= pack.blocks.length) throw new Error(`Receipt references invalid block ${hit.blockId}.`);
    if (hit.sourceDigest !== sourceDigest(pack, hit.blockId)) throw new Error(`Receipt source digest mismatch for block ${hit.blockId}.`);
    for (const span of hit.spans) {
      if (span.start < 0 || span.end < span.start || span.end > pack.blocks[hit.blockId].length || span.text !== pack.blocks[hit.blockId].slice(span.start, span.end)) throw new Error(`Receipt evidence span mismatch for block ${hit.blockId}.`);
    }
  }
  const { replayHash, verified, ...partial } = receipt;
  const expected = `sha256-${sha256Hex(getTextEncoder().encode(JSON.stringify(partial)))}`;
  if (replayHash !== expected) throw new Error('Receipt replay hash mismatch.');
  void verified;
}

export function packDigest(pack: Pack): string {
  return pack.meta.packDigest ?? `sha256-${sha256Hex(getTextEncoder().encode(JSON.stringify({ version: pack.meta.version, blocks: pack.blocks, docIds: pack.docIds ?? [], namespaces: pack.namespaces ?? [], analyzer: pack.meta.analyzer ?? null })))}`;
}

function sourceDigest(pack: Pack, blockId: number): string { return `sha256-${sha256Hex(getTextEncoder().encode(`${pack.docIds?.[blockId] ?? ''}\n${pack.blocks[blockId] ?? ''}`))}`; }
function calculateAnswerability(hits: Array<{ score: number }>): number { if (!hits.length) return 0; const top = Math.max(0, hits[0].score); return Math.max(0, Math.min(1, top / (top + 1))); }
function makeEvidenceSpan(pack: Pack, blockId: number, query: string): EvidenceSpan {
  const text = pack.blocks[blockId] ?? ''; const terms = normalize(query).split(/\s+/).filter(Boolean); const lower = text.toLocaleLowerCase(); const needle = terms[0] ?? '';
  const start = needle ? lower.indexOf(needle) : -1; const safeStart = start >= 0 ? start : 0; const end = start >= 0 ? Math.min(text.length, safeStart + needle.length) : text.length;
  return { blockId, source: pack.docIds?.[blockId] ?? undefined, start: safeStart, end, text: text.slice(safeStart, end) };
}
