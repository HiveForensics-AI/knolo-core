import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  createKnowledgeQueryIndexV5,
  deserializeKnowledgeQueryIndexV1,
  parseKnowledgeQueryV5,
  queryKnowledgeImageV5,
  serializeKnowledgeQueryIndexV1,
  verifyKnowledgeQueryIndexV5,
} from '../dist/index.js';

function image() {
  return createKnowledgeImageV5({ objects: [
    { kind: 'source', bytes: new TextEncoder().encode('Alpha source'), meta: { owner: 'Team A', rank: 1 } },
    { kind: 'chunk', bytes: new TextEncoder().encode('Beta chunk'), meta: { owner: 'Team B', rank: 2 } },
    { kind: 'metadata', bytes: new TextEncoder().encode('Runtime metadata'), meta: { owner: 'Team A', rank: 3 } },
  ] });
}

test('V5 query index is deterministic, state-root-bound, and preserves query roots', () => {
  const current = image();
  const index = createKnowledgeQueryIndexV5(current);
  const expression = 'FROM * WHERE meta.owner = "team a" ORDER BY meta.rank ASC LIMIT 10';
  const scanned = queryKnowledgeImageV5(current, expression);
  const indexed = queryKnowledgeImageV5(current, expression, index);
  verifyKnowledgeQueryIndexV5(current, index);
  assert.deepEqual(indexed.hits, scanned.hits);
  assert.equal(indexed.resultRoot, scanned.resultRoot);
  assert.deepEqual(deserializeKnowledgeQueryIndexV1(serializeKnowledgeQueryIndexV1(index)), index);
  assert.equal(createKnowledgeQueryIndexV5(current).indexRoot, index.indexRoot);
});

test('V5 query index rejects stale, corrupted, and malformed indexes', () => {
  const current = image();
  const index = createKnowledgeQueryIndexV5(current);
  const other = createKnowledgeImageV5({ objects: [{ kind: 'source', bytes: new TextEncoder().encode('other'), meta: {} }] });
  assert.throws(() => verifyKnowledgeQueryIndexV5(other, index), /state root|contents|malformed/i);
  const tampered = { ...index, objectIds: [...index.objectIds].reverse() };
  assert.throws(() => verifyKnowledgeQueryIndexV5(current, tampered), /sorted|root|contents/i);
  assert.throws(() => queryKnowledgeImageV5(current, parseKnowledgeQueryV5('FROM source LIMIT 1'), tampered), /sorted|root|contents/i);
});
