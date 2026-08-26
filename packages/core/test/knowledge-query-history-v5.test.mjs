import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendKnowledgeQueryHistoryV5,
  createKnowledgeImageV5,
  createKnowledgeQueryHistoryV5,
  deserializeKnowledgeQueryHistoryV1,
  queryKnowledgeImageV5,
  serializeKnowledgeQueryHistoryV1,
  verifyKnowledgeQueryHistoryV5,
} from '../dist/index.js';

test('V5 query history is append-only, deterministic, and replay-verifiable', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'source', bytes: new TextEncoder().encode('history'), meta: {} }] });
  const first = queryKnowledgeImageV5(image, 'FROM source LIMIT 10');
  const second = queryKnowledgeImageV5(image, 'FROM * SEARCH "history" LIMIT 10');
  const empty = createKnowledgeQueryHistoryV5();
  const recorded = appendKnowledgeQueryHistoryV5(empty, first, 10);
  const complete = appendKnowledgeQueryHistoryV5(recorded, second, 20);
  verifyKnowledgeQueryHistoryV5(complete);
  assert.equal(complete.entries.length, 2);
  assert.equal(complete.entries[0].sequence, 1);
  assert.equal(complete.entries[1].sequence, 2);
  assert.deepEqual(deserializeKnowledgeQueryHistoryV1(serializeKnowledgeQueryHistoryV1(complete)), complete);
  assert.equal(appendKnowledgeQueryHistoryV5(empty, first, 10).historyRoot, recorded.historyRoot);
});

test('V5 query history rejects backwards time and tampering', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'source', bytes: new TextEncoder().encode('history'), meta: {} }] });
  const result = queryKnowledgeImageV5(image, 'FROM source LIMIT 1');
  const history = appendKnowledgeQueryHistoryV5(createKnowledgeQueryHistoryV5(), result, 10);
  assert.throws(() => appendKnowledgeQueryHistoryV5(history, result, 9), /backwards/i);
  assert.throws(() => verifyKnowledgeQueryHistoryV5({ ...history, historyRoot: 'sha256-' + '0'.repeat(64) }), /root/i);
  const tampered = { ...history, entries: [{ ...history.entries[0], resultRoot: 'sha256-' + '1'.repeat(64) }] };
  assert.throws(() => verifyKnowledgeQueryHistoryV5(tampered), /entry root|plan root/i);
});
