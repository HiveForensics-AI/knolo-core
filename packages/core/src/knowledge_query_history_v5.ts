import { canonicalCbor, decodeCanonicalCbor, digestBytes, digestDomain, type CborValue, type Digest } from './knowledge_image_v5.js';
import type { KnowledgeQueryPlanV1, KnowledgeQueryResultV1 } from './knowledge_query_v5.js';

export type KnowledgeQueryHistoryEntryV1 = {
  version: 1;
  sequence: number;
  at: number;
  stateRoot: Digest;
  plan: KnowledgeQueryPlanV1;
  planRoot: Digest;
  resultRoot: Digest;
  entryRoot: Digest;
};

export type KnowledgeQueryHistoryV1 = {
  version: 1;
  entries: KnowledgeQueryHistoryEntryV1[];
  historyRoot: Digest;
};

export function createKnowledgeQueryHistoryV5(): KnowledgeQueryHistoryV1 {
  return rebuild({ version: 1, entries: [] });
}

export function appendKnowledgeQueryHistoryV5(history: KnowledgeQueryHistoryV1, result: KnowledgeQueryResultV1, at: number): KnowledgeQueryHistoryV1 {
  verifyKnowledgeQueryHistoryV5(history);
  validateAt(at);
  if (!result || result.version !== 1 || !isDigest(result.stateRoot) || !isDigest(result.planRoot) || !isDigest(result.resultRoot)) throw new Error('Malformed V5 query result for history.');
  validatePlan(result.plan);
  const expectedPlanRoot = digestDomain('query-plan', canonicalCbor(result.plan as unknown as CborValue));
  if (result.planRoot !== expectedPlanRoot) throw new Error('V5 query history plan root mismatch.');
  const previous = history.entries[history.entries.length - 1];
  if (previous && at < previous.at) throw new Error('V5 query history time cannot move backwards.');
  const body = { at, plan: result.plan, planRoot: result.planRoot, resultRoot: result.resultRoot, sequence: history.entries.length + 1, stateRoot: result.stateRoot, version: 1 as const };
  const entry: KnowledgeQueryHistoryEntryV1 = { ...body, entryRoot: digestDomain('query-history-entry', canonicalCbor(body as unknown as CborValue)) };
  return rebuild({ version: 1, entries: [...history.entries, entry] });
}

export function verifyKnowledgeQueryHistoryV5(history: KnowledgeQueryHistoryV1): void {
  if (!history || history.version !== 1 || !Array.isArray(history.entries) || !isDigest(history.historyRoot)) throw new Error('Malformed V5 query history.');
  let previousAt = -1;
  history.entries.forEach((entry, index) => {
    if (entry.version !== 1 || entry.sequence !== index + 1 || !Number.isSafeInteger(entry.at) || entry.at < previousAt || !isDigest(entry.stateRoot) || !isDigest(entry.planRoot) || !isDigest(entry.resultRoot) || !isDigest(entry.entryRoot)) throw new Error('Malformed V5 query history entry.');
    validatePlan(entry.plan);
    if (digestDomain('query-plan', canonicalCbor(entry.plan as unknown as CborValue)) !== entry.planRoot) throw new Error('V5 query history plan root mismatch.');
    const body = { at: entry.at, plan: entry.plan, planRoot: entry.planRoot, resultRoot: entry.resultRoot, sequence: entry.sequence, stateRoot: entry.stateRoot, version: 1 as const };
    if (digestDomain('query-history-entry', canonicalCbor(body as unknown as CborValue)) !== entry.entryRoot) throw new Error('V5 query history entry root mismatch.');
    previousAt = entry.at;
  });
  if (history.historyRoot !== computeHistoryRoot(history)) throw new Error('V5 query history root mismatch.');
}

export function serializeKnowledgeQueryHistoryV1(history: KnowledgeQueryHistoryV1): Uint8Array {
  verifyKnowledgeQueryHistoryV5(history);
  return canonicalCbor(historyToCbor(history));
}

export function deserializeKnowledgeQueryHistoryV1(bytes: Uint8Array): KnowledgeQueryHistoryV1 {
  const value = normalizeCbor(decodeCanonicalCbor(bytes));
  const record = asRecord(value);
  const entriesValue = record.entries;
  if (!Array.isArray(entriesValue)) throw new Error('Malformed V5 query history entries.');
  const history: KnowledgeQueryHistoryV1 = { version: asNumber(record.version) as 1, entries: entriesValue.map(asEntry), historyRoot: asDigest(record.historyRoot) };
  verifyKnowledgeQueryHistoryV5(history);
  return history;
}

function rebuild(history: Omit<KnowledgeQueryHistoryV1, 'historyRoot'>): KnowledgeQueryHistoryV1 { const next = { version: 1 as const, entries: history.entries.map((entry) => ({ ...entry })) }; return { ...next, historyRoot: computeHistoryRoot(next) }; }
function computeHistoryRoot(history: Pick<KnowledgeQueryHistoryV1, 'version' | 'entries'>): Digest { return digestDomain('query-history', canonicalCbor({ entries: history.entries.map(entryToCbor), version: history.version } as unknown as CborValue)); }
function historyToCbor(history: KnowledgeQueryHistoryV1): CborValue { return { entries: history.entries.map(entryToCbor), historyRoot: history.historyRoot, version: history.version }; }
function entryToCbor(entry: KnowledgeQueryHistoryEntryV1): CborValue { return { at: entry.at, entryRoot: entry.entryRoot, plan: entry.plan as unknown as CborValue, planRoot: entry.planRoot, resultRoot: entry.resultRoot, sequence: entry.sequence, stateRoot: entry.stateRoot, version: entry.version }; }
function asEntry(value: CborValue): KnowledgeQueryHistoryEntryV1 { const entry = asRecord(value); return { version: asNumber(entry.version) as 1, sequence: asNumber(entry.sequence), at: asNumber(entry.at), stateRoot: asDigest(entry.stateRoot), plan: asPlan(entry.plan), planRoot: asDigest(entry.planRoot), resultRoot: asDigest(entry.resultRoot), entryRoot: asDigest(entry.entryRoot) }; }
function asPlan(value: CborValue | undefined): KnowledgeQueryPlanV1 { const plan = asRecord(value as CborValue); const filters = plan.filters; if (!Array.isArray(filters)) throw new Error('Malformed V5 query history plan filters.'); const result: KnowledgeQueryPlanV1 = { version: asNumber(plan.version) as 1, source: asString(plan.source) as 'knowledge-image-v5', kind: plan.kind === null ? null : asString(plan.kind), filters: filters.map((filter) => { const item = asRecord(filter); return { field: asString(item.field), op: '=' as const, value: scalar(item.value) }; }), search: plan.search === null ? null : asString(plan.search), limit: asNumber(plan.limit) }; if (plan.orderBy !== undefined) { const order = asRecord(plan.orderBy); result.orderBy = { field: asString(order.field), direction: asString(order.direction) as 'asc' | 'desc' }; } if (plan.joins !== undefined) { if (!Array.isArray(plan.joins)) throw new Error('Malformed V5 query history joins.'); result.joins = plan.joins.map((join) => { const item = asRecord(join); return { kind: item.kind === null ? null : asString(item.kind), leftField: asString(item.leftField), rightField: asString(item.rightField) }; }); } validatePlan(result); return result; }
function validatePlan(plan: KnowledgeQueryPlanV1): void { if (!plan || plan.version !== 1 || plan.source !== 'knowledge-image-v5' || (plan.kind !== null && typeof plan.kind !== 'string') || !Array.isArray(plan.filters) || (plan.search !== null && typeof plan.search !== 'string') || !Number.isSafeInteger(plan.limit) || plan.limit < 1 || plan.limit > 1000) throw new Error('Malformed V5 query history plan.'); for (const filter of plan.filters) if (!filter || typeof filter.field !== 'string' || filter.op !== '=' || !isScalar(filter.value)) throw new Error('Malformed V5 query history filter.'); if (plan.orderBy && (typeof plan.orderBy.field !== 'string' || plan.orderBy.direction !== 'asc' && plan.orderBy.direction !== 'desc')) throw new Error('Malformed V5 query history ordering.'); if (plan.joins && (!Array.isArray(plan.joins) || plan.joins.some((join) => !join || typeof join.leftField !== 'string' || typeof join.rightField !== 'string' || join.kind !== null && typeof join.kind !== 'string'))) throw new Error('Malformed V5 query history joins.'); }
function scalar(value: CborValue | undefined): null | boolean | number | string { if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value; throw new Error('Malformed V5 query history scalar.'); }
function isScalar(value: unknown): value is null | boolean | number | string { return value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string'; }
function normalizeCbor(value: CborValue): CborValue { if (typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value); if (Array.isArray(value)) return value.map(normalizeCbor); if (value && typeof value === 'object' && !(value instanceof Uint8Array)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeCbor(item)])) as unknown as CborValue; return value; }
function asRecord(value: CborValue): Record<string, CborValue> { if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Malformed V5 query history record.'); return value as Record<string, CborValue>; }
function asString(value: CborValue | undefined): string { if (typeof value !== 'string') throw new Error('Malformed V5 query history text.'); return value; }
function asNumber(value: CborValue | undefined): number { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Malformed V5 query history integer.'); return value; }
function asDigest(value: CborValue | undefined): Digest { const digest = asString(value); try { digestBytes(digest); return digest; } catch { throw new Error('Malformed V5 query history digest.'); } }
function isDigest(value: unknown): value is Digest { if (typeof value !== 'string') return false; try { digestBytes(value); return true; } catch { return false; } }
function validateAt(at: number): void { if (!Number.isSafeInteger(at) || at < 0) throw new Error('V5 query history time must be a non-negative safe integer.'); }
