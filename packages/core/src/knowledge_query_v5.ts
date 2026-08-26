import {
  canonicalCbor,
  digestDomain,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
  type KnowledgeObjectV1,
} from './knowledge_image_v5.js';
import { getTextDecoder, getTextEncoder } from './utils/utf8.js';
import { candidateObjectIdsForKnowledgeQueryIndexV1, verifyKnowledgeQueryIndexV5, type KnowledgeQueryIndexV1 } from './knowledge_query_index_v5.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export type KnowledgeQueryScalarV1 = null | boolean | number | string;
export type KnowledgeQueryFilterV1 = { field: string; op: '='; value: KnowledgeQueryScalarV1 };
export type KnowledgeQueryOrderV1 = { field: string; direction: 'asc' | 'desc' };
export type KnowledgeQueryJoinV1 = { kind: string | null; leftField: string; rightField: string };
export type KnowledgeQueryPlanV1 = {
  version: 1;
  source: 'knowledge-image-v5';
  kind: string | null;
  filters: KnowledgeQueryFilterV1[];
  search: string | null;
  limit: number;
  orderBy?: KnowledgeQueryOrderV1;
  joins?: KnowledgeQueryJoinV1[];
};
export type KnowledgeQueryHitV1 = { objectId: Digest; kind: KnowledgeObjectV1['kind']; joinedObjectIds?: Digest[] };
export type KnowledgeQueryResultV1 = {
  version: 1;
  stateRoot: Digest;
  plan: KnowledgeQueryPlanV1;
  planRoot: Digest;
  hits: KnowledgeQueryHitV1[];
  resultRoot: Digest;
};

/**
 * Parse bounded EQL v1:
 * FROM <kind|*> [WHERE <field> = <literal> AND ...]
 *      [JOIN <kind|*> ON <field> = <field> ...]
 *      [SEARCH "text"] [ORDER BY <field> [ASC|DESC]] [LIMIT <positive integer>]
 *
 * Fields are `id`, `kind`, and scalar `meta.<key>` values. SEARCH matches
 * every normalized term against the UTF-8 object bytes. Joins are bounded
 * equality joins over scalar fields and ordering has a stable object-id tie
 * break. Mutation, authority, and embedded expressions remain unsupported.
 */
export function parseKnowledgeQueryV5(expression: string): KnowledgeQueryPlanV1 {
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('V5 EQL query must be a non-empty string.');
  const tokens = lex(expression);
  let cursor = 0;
  expectWord(tokens, cursor++, 'FROM');
  const kindToken = tokens[cursor++];
  if (!kindToken || kindToken.type !== 'word') throw new Error('V5 EQL FROM requires an object kind or *.');
  const kind = kindToken.value === '*' ? null : normalizeQueryText(kindToken.value);
  if (kind !== null && !kind) throw new Error('V5 EQL object kind cannot be empty.');

  const filters: KnowledgeQueryFilterV1[] = [];
  const joins: KnowledgeQueryJoinV1[] = [];
  while (isWord(tokens[cursor], 'JOIN')) {
    cursor++;
    const joinKindToken = tokens[cursor++];
    if (!joinKindToken || joinKindToken.type !== 'word') throw new Error('V5 EQL JOIN requires an object kind or *.');
    const joinKind = joinKindToken.value === '*' ? null : normalizeQueryText(joinKindToken.value);
    if (joinKind !== null && !joinKind) throw new Error('V5 EQL JOIN object kind cannot be empty.');
    if (!isWord(tokens[cursor], 'ON')) throw new Error('V5 EQL JOIN requires ON.');
    cursor++;
    const leftField = tokens[cursor++];
    if (!leftField || leftField.type !== 'word' || !isSupportedField(leftField.value)) throw new Error(`Unsupported V5 EQL join field: ${leftField?.value ?? ''}.`);
    const operator = tokens[cursor++];
    if (!operator || operator.type !== 'equals') throw new Error('V5 EQL JOIN currently supports only equality (=).');
    const rightField = tokens[cursor++];
    if (!rightField || rightField.type !== 'word' || !isSupportedField(rightField.value)) throw new Error(`Unsupported V5 EQL join field: ${rightField?.value ?? ''}.`);
    joins.push({ kind: joinKind, leftField: normalizeField(leftField.value), rightField: normalizeField(rightField.value) });
    if (joins.length > 4) throw new Error('V5 EQL JOIN is limited to 4 clauses.');
  }
  if (isWord(tokens[cursor], 'WHERE')) {
    cursor++;
    while (true) {
      const field = tokens[cursor++];
      if (!field || field.type !== 'word' || !isSupportedField(field.value)) throw new Error(`Unsupported V5 EQL field: ${field?.value ?? ''}.`);
      const operator = tokens[cursor++];
      if (!operator || operator.type !== 'equals') throw new Error('V5 EQL WHERE currently supports only equality (=).');
      filters.push({ field: normalizeField(field.value), op: '=', value: parseLiteral(tokens[cursor++]) });
      if (isWord(tokens[cursor], 'AND')) {
        cursor++;
        continue;
      }
      break;
    }
  }

  let search: string | null = null;
  if (isWord(tokens[cursor], 'SEARCH')) {
    cursor++;
    const token = tokens[cursor++];
    if (!token || token.type !== 'string') throw new Error('V5 EQL SEARCH requires a quoted string.');
    search = normalizeQueryText(token.value);
    if (!search) throw new Error('V5 EQL SEARCH cannot be empty.');
  }

  let orderBy: KnowledgeQueryOrderV1 | undefined;
  if (isWord(tokens[cursor], 'ORDER')) {
    cursor++;
    if (!isWord(tokens[cursor], 'BY')) throw new Error('V5 EQL ORDER requires BY.');
    cursor++;
    const field = tokens[cursor++];
    if (!field || field.type !== 'word' || !isSupportedField(field.value)) throw new Error(`Unsupported V5 EQL order field: ${field?.value ?? ''}.`);
    let direction: KnowledgeQueryOrderV1['direction'] = 'asc';
    if (isWord(tokens[cursor], 'ASC') || isWord(tokens[cursor], 'DESC')) direction = tokens[cursor++].value.toLowerCase() as KnowledgeQueryOrderV1['direction'];
    orderBy = { field: normalizeField(field.value), direction };
  }

  let limit = DEFAULT_LIMIT;
  if (isWord(tokens[cursor], 'LIMIT')) {
    cursor++;
    const token = tokens[cursor++];
    if (!token || token.type !== 'word' || !/^\d+$/.test(token.value)) throw new Error('V5 EQL LIMIT requires a positive integer.');
    limit = Number(token.value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`V5 EQL LIMIT must be between 1 and ${MAX_LIMIT}.`);
  }
  if (cursor !== tokens.length) throw new Error(`Unexpected V5 EQL token: ${tokens[cursor]?.value ?? ''}.`);

  filters.sort((left, right) => compareUtf8Text(left.field, right.field) || compareUtf8Text(scalarKey(left.value), scalarKey(right.value)));
  return { version: 1, source: 'knowledge-image-v5', kind, filters, search, limit, ...(orderBy ? { orderBy } : {}), ...(joins.length ? { joins } : {}) };
}

export function queryKnowledgeImageV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  expression: string | KnowledgeQueryPlanV1,
  index?: KnowledgeQueryIndexV1,
): KnowledgeQueryResultV1 {
  const image = isKnowledgeImage(input) ? input : mountKnowledgeImageV5(input);
  const plan = typeof expression === 'string' ? parseKnowledgeQueryV5(expression) : expression;
  if (index) verifyKnowledgeQueryIndexV5(image, index);
  const candidates = index ? candidateObjectIdsForKnowledgeQueryIndexV1(index, plan) : undefined;
  const planRoot = digestDomain('query-plan', canonicalCbor(plan as unknown as CborValue));
  const matched = image.objects
    .filter((object) => candidates === undefined || candidates.has(object.id))
    .filter((object) => matchesPlan(object, plan))
    .map((object) => ({ object, joinedObjectIds: resolveJoins(image.objects, object, plan.joins ?? []) }))
    .filter((entry) => entry.joinedObjectIds !== undefined)
    .sort((left, right) => compareQueryObjects(left.object, right.object, plan.orderBy))
    .slice(0, plan.limit)
    .map(({ object, joinedObjectIds }) => (joinedObjectIds ?? []).length ? ({ objectId: object.id, kind: object.kind, joinedObjectIds: joinedObjectIds ?? [] }) : ({ objectId: object.id, kind: object.kind }));
  const hits = matched;
  const resultBody: Record<string, CborValue> = {
    stateRoot: image.stateRoot,
    planRoot,
    objectIds: hits.map((hit) => hit.objectId),
  };
  if (plan.joins?.length) resultBody.joinedObjectIds = hits.map((hit) => hit.joinedObjectIds ?? []);
  const resultRoot = digestDomain('query-result', canonicalCbor({
    ...resultBody,
  } as unknown as CborValue));
  return { version: 1, stateRoot: image.stateRoot, plan, planRoot, hits, resultRoot };
}

export function verifyKnowledgeQueryResultV5(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, result: KnowledgeQueryResultV1): void {
  const image = isKnowledgeImage(input) ? input : mountKnowledgeImageV5(input);
  if (!result || result.version !== 1 || result.stateRoot !== image.stateRoot) throw new Error('V5 query result state root mismatch.');
  const expected = queryKnowledgeImageV5(image, result.plan);
  if (expected.planRoot !== result.planRoot || expected.resultRoot !== result.resultRoot || JSON.stringify(expected.hits) !== JSON.stringify(result.hits)) {
    throw new Error('V5 query result root mismatch.');
  }
}

type Token = { type: 'word' | 'string' | 'equals'; value: string };

function lex(expression: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    while (/\s/u.test(expression[cursor] ?? '')) cursor++;
    if (cursor >= expression.length) break;
    if (expression[cursor] === '=') {
      tokens.push({ type: 'equals', value: '=' });
      cursor++;
      continue;
    }
    if (expression[cursor] === '"') {
      cursor++;
      let value = '';
      let closed = false;
      while (cursor < expression.length) {
        const char = expression[cursor++];
        if (char === '"') {
          closed = true;
          break;
        }
        if (char === '\\') {
          const escaped = expression[cursor++];
          if (escaped !== '"' && escaped !== '\\') throw new Error('V5 EQL only supports escaped quotes and backslashes.');
          value += escaped;
        } else {
          value += char;
        }
      }
      if (!closed) throw new Error('Unterminated V5 EQL string literal.');
      tokens.push({ type: 'string', value });
      continue;
    }
    const start = cursor;
    while (cursor < expression.length && !/\s/u.test(expression[cursor] ?? '') && expression[cursor] !== '=') cursor++;
    const value = expression.slice(start, cursor);
    if (!/^[A-Za-z0-9_.*-]+$/u.test(value)) throw new Error(`Invalid V5 EQL token: ${value}.`);
    tokens.push({ type: 'word', value });
  }
  return tokens;
}

function expectWord(tokens: Token[], index: number, expected: string): void {
  if (!isWord(tokens[index], expected)) throw new Error(`V5 EQL query must start with ${expected}.`);
}
function isWord(token: Token | undefined, expected: string): boolean { return token?.type === 'word' && token.value.toUpperCase() === expected; }

function parseLiteral(token: Token | undefined): KnowledgeQueryScalarV1 {
  if (!token) throw new Error('V5 EQL WHERE requires a literal.');
  if (token.type === 'string') return normalizeQueryText(token.value);
  if (token.type !== 'word') throw new Error('V5 EQL WHERE requires a scalar literal.');
  if (token.value === 'true') return true;
  if (token.value === 'false') return false;
  if (token.value === 'null') return null;
  if (/^-?\d+$/u.test(token.value)) {
    const value = Number(token.value);
    if (Number.isSafeInteger(value)) return value;
  }
  throw new Error(`Invalid V5 EQL literal: ${token.value}.`);
}

function isSupportedField(field: string): boolean { return field.toLowerCase() === 'id' || field.toLowerCase() === 'kind' || /^meta\.[A-Za-z0-9_-]+$/u.test(field); }
function normalizeField(field: string): string { const lower = field.toLowerCase(); return lower === 'id' || lower === 'kind' ? lower : `meta.${lower.slice(5)}`; }
function normalizeQueryText(value: string): string { return value.toLowerCase().replace(/\s+/gu, ' ').trim(); }
function scalarKey(value: KnowledgeQueryScalarV1): string { return value === null ? 'null:' : `${typeof value}:${String(value)}`; }
function compareUtf8Text(left: string, right: string): number {
  const a = getTextEncoder().encode(left);
  const b = getTextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

function matchesPlan(object: KnowledgeObjectV1, plan: KnowledgeQueryPlanV1): boolean {
  if (plan.kind !== null && object.kind !== plan.kind) return false;
  for (const filter of plan.filters) {
    const actual = filter.field === 'id' ? object.id : filter.field === 'kind' ? object.kind : object.meta[filter.field.slice(5)];
    if (!isScalar(actual) || !sameScalar(actual, filter.value)) return false;
  }
  if (plan.search !== null) {
    const text = normalizeQueryText(getTextDecoder().decode(object.bytes));
    if (!plan.search.split(' ').every((term) => text.includes(term))) return false;
  }
  return true;
}

function resolveJoins(objects: KnowledgeObjectV1[], source: KnowledgeObjectV1, joins: KnowledgeQueryJoinV1[]): Digest[] | undefined {
  if (!joins.length) return [];
  const joined: Digest[] = [];
  for (const join of joins) {
    const left = queryField(source, join.leftField);
    const matches = objects.filter((candidate) => (join.kind === null || candidate.kind === join.kind) && isScalar(left) && sameScalar(queryField(candidate, join.rightField), left)).map((candidate) => candidate.id).sort(compareUtf8Text);
    if (!matches.length) return undefined;
    joined.push(...matches);
  }
  return [...new Set(joined)].sort(compareUtf8Text);
}

function compareQueryObjects(left: KnowledgeObjectV1, right: KnowledgeObjectV1, orderBy?: KnowledgeQueryOrderV1): number {
  if (orderBy) {
    const comparison = compareScalars(queryField(left, orderBy.field), queryField(right, orderBy.field));
    if (comparison !== 0) return orderBy.direction === 'desc' ? -comparison : comparison;
  }
  return compareUtf8Text(left.id, right.id);
}

function queryField(object: KnowledgeObjectV1, field: string): unknown { return field === 'id' ? object.id : field === 'kind' ? object.kind : object.meta[field.slice(5)]; }
function compareScalars(left: unknown, right: unknown): number {
  const leftMissing = !isScalar(left);
  const rightMissing = !isScalar(right);
  if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
  if (left === right) return 0;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  if ((typeof left === 'number' || typeof left === 'bigint') && (typeof right === 'number' || typeof right === 'bigint')) {
    const leftInteger = typeof left === 'bigint' ? left : BigInt(left);
    const rightInteger = typeof right === 'bigint' ? right : BigInt(right);
    return leftInteger < rightInteger ? -1 : 1;
  }
  if (typeof left === 'string' && typeof right === 'string') return compareUtf8Text(normalizeQueryText(left), normalizeQueryText(right));
  if (typeof left === 'boolean' && typeof right === 'boolean') return left ? 1 : -1;
  return scalarKey(left as KnowledgeQueryScalarV1).localeCompare(scalarKey(right as KnowledgeQueryScalarV1));
}

function isScalar(value: unknown): value is KnowledgeQueryScalarV1 | bigint { return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint'; }
function sameScalar(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'bigint' && typeof expected === 'number') return Number.isSafeInteger(expected) && actual === BigInt(expected);
  if (typeof actual === 'string' && typeof expected === 'string') return normalizeQueryText(actual) === expected;
  return actual === expected || typeof actual === 'number' && typeof expected === 'number' && Object.is(actual, expected);
}
function isKnowledgeImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 { return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input; }
