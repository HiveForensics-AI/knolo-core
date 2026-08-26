import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestBytes,
  digestDomain,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
} from './knowledge_image_v5.js';
import type { KnowledgeQueryPlanV1 } from './knowledge_query_v5.js';

export type KnowledgeQueryIndexV1 = {
  version: 1;
  stateRoot: Digest;
  objectIds: Digest[];
  kindPostings: Record<string, Digest[]>;
  fieldPostings: Record<string, Digest[]>;
  indexRoot: Digest;
};

export function createKnowledgeQueryIndexV5(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): KnowledgeQueryIndexV1 {
  const image = isImage(input) ? input : mountKnowledgeImageV5(input);
  const objectIds = image.objects.map((object) => object.id).sort(compareUtf8);
  const kindPostings: Record<string, Digest[]> = {};
  const fieldPostings: Record<string, Digest[]> = {};
  for (const object of image.objects) {
    addPosting(kindPostings, object.kind, object.id);
    addFieldPosting(fieldPostings, 'id', object.id, object.id);
    addFieldPosting(fieldPostings, 'kind', object.kind, object.id);
    for (const [key, value] of Object.entries(object.meta)) {
      if (isScalar(value)) addFieldPosting(fieldPostings, `meta.${key.toLowerCase()}`, value, object.id);
    }
  }
  normalizePostings(kindPostings);
  normalizePostings(fieldPostings);
  const body = { fieldPostings, kindPostings, objectIds, stateRoot: image.stateRoot, version: 1 as const };
  return { ...body, indexRoot: digestDomain('query-index', canonicalCbor(body as unknown as CborValue)) };
}

export function verifyKnowledgeQueryIndexV5(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, index: KnowledgeQueryIndexV1): void {
  const image = isImage(input) ? input : mountKnowledgeImageV5(input);
  if (!index || index.version !== 1 || index.stateRoot !== image.stateRoot || !Array.isArray(index.objectIds) || !isDigest(index.indexRoot)) throw new Error('Malformed V5 query index.');
  validateSortedIds(index.objectIds, 'V5 query index object IDs');
  validatePostings(index.kindPostings, index.objectIds, 'V5 query index kind postings');
  validatePostings(index.fieldPostings, index.objectIds, 'V5 query index field postings');
  const body = { fieldPostings: index.fieldPostings, kindPostings: index.kindPostings, objectIds: index.objectIds, stateRoot: index.stateRoot, version: 1 as const };
  if (digestDomain('query-index', canonicalCbor(body as unknown as CborValue)) !== index.indexRoot) throw new Error('V5 query index root mismatch.');
  const expected = createKnowledgeQueryIndexV5(image);
  if (expected.indexRoot !== index.indexRoot) throw new Error('V5 query index contents do not match the image.');
}

export function serializeKnowledgeQueryIndexV1(index: KnowledgeQueryIndexV1): Uint8Array {
  if (!index || !isDigest(index.stateRoot) || !isDigest(index.indexRoot)) throw new Error('Malformed V5 query index.');
  const body = { fieldPostings: index.fieldPostings, indexRoot: index.indexRoot, kindPostings: index.kindPostings, objectIds: index.objectIds, stateRoot: index.stateRoot, version: index.version };
  return canonicalCbor(body as unknown as CborValue);
}

export function deserializeKnowledgeQueryIndexV1(bytes: Uint8Array): KnowledgeQueryIndexV1 {
  const value = asRecord(decodeCanonicalCbor(bytes));
  const index: KnowledgeQueryIndexV1 = {
    version: asNumber(value.version) as 1,
    stateRoot: asDigest(value.stateRoot),
    objectIds: asIds(value.objectIds),
    kindPostings: asPostings(value.kindPostings),
    fieldPostings: asPostings(value.fieldPostings),
    indexRoot: asDigest(value.indexRoot),
  };
  if (index.version !== 1) throw new Error('Unsupported V5 query index version.');
  validateSortedIds(index.objectIds, 'V5 query index object IDs');
  validatePostings(index.kindPostings, index.objectIds, 'V5 query index kind postings');
  validatePostings(index.fieldPostings, index.objectIds, 'V5 query index field postings');
  const body = { fieldPostings: index.fieldPostings, kindPostings: index.kindPostings, objectIds: index.objectIds, stateRoot: index.stateRoot, version: 1 as const };
  if (digestDomain('query-index', canonicalCbor(body as unknown as CborValue)) !== index.indexRoot) throw new Error('V5 query index root mismatch.');
  return index;
}

/** Returns a safe candidate set; the query evaluator still performs full semantic checks. */
export function candidateObjectIdsForKnowledgeQueryIndexV1(index: KnowledgeQueryIndexV1, plan: KnowledgeQueryPlanV1): Set<Digest> {
  let candidate: Set<Digest> | undefined;
  const intersect = (ids: Digest[] | undefined): void => {
    if (!ids) {
      candidate = new Set();
      return;
    }
    if (!candidate) candidate = new Set(ids);
    else candidate = new Set(ids.filter((id) => candidate?.has(id)));
  };
  if (plan.kind !== null) intersect(index.kindPostings[plan.kind]);
  for (const filter of plan.filters) intersect(index.fieldPostings[indexKey(filter.field, filter.value)]);
  return candidate ?? new Set(index.objectIds);
}

function isImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 { return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input; }
function addPosting(postings: Record<string, Digest[]>, key: string, id: Digest): void { (postings[key] ??= []).push(id); }
function addFieldPosting(postings: Record<string, Digest[]>, field: string, value: unknown, id: Digest): void { addPosting(postings, indexKey(field, value), id); }
function normalizePostings(postings: Record<string, Digest[]>): void { for (const ids of Object.values(postings)) ids.sort(compareUtf8); }
function indexKey(field: string, value: unknown): string { return `${field.length}:${field}|${scalarKey(value)}`; }
function scalarKey(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') { const normalized = value.toLowerCase().replace(/\s+/gu, ' ').trim(); return `string:${normalized.length}:${normalized}`; }
  if (typeof value === 'boolean') return `boolean:${value ? '1' : '0'}`;
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return `number:${value}`;
  return `unsupported:${String(value)}`;
}
function isScalar(value: unknown): value is null | boolean | number | string | bigint { return value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string' || typeof value === 'bigint'; }
function compareUtf8(left: string, right: string): number { const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
function isDigest(value: unknown): value is Digest { if (typeof value !== 'string') return false; try { digestBytes(value); return true; } catch { return false; } }
function asRecord(value: CborValue): Record<string, CborValue> { if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Malformed V5 query index record.'); return value as Record<string, CborValue>; }
function asNumber(value: CborValue | undefined): number { const number = typeof value === 'bigint' ? Number(value) : value; if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('Malformed V5 query index integer.'); return number; }
function asDigest(value: CborValue | undefined): Digest { if (typeof value !== 'string' || !isDigest(value)) throw new Error('Malformed V5 query index digest.'); return value; }
function asIds(value: CborValue | undefined): Digest[] { if (!Array.isArray(value)) throw new Error('Malformed V5 query index IDs.'); return value.map(asDigest); }
function asPostings(value: CborValue | undefined): Record<string, Digest[]> { const record = asRecord(value as CborValue); const out: Record<string, Digest[]> = {}; for (const [key, ids] of Object.entries(record)) out[key] = asIds(ids); return out; }
function validateSortedIds(ids: Digest[], label: string): void { for (let i = 0; i < ids.length; i++) { if (!isDigest(ids[i]) || i > 0 && compareUtf8(ids[i - 1], ids[i]) >= 0) throw new Error(`${label} are not strictly sorted.`); } }
function validatePostings(postings: Record<string, Digest[]>, objectIds: Digest[], label: string): void { if (!postings || typeof postings !== 'object' || Array.isArray(postings)) throw new Error(`${label} are malformed.`); const allowed = new Set(objectIds); for (const ids of Object.values(postings)) { validateSortedIds(ids, label); if (ids.some((id) => !allowed.has(id))) throw new Error(`${label} reference unknown objects.`); } }
