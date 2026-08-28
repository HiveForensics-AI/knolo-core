import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KnowledgeSyncReplayCacheV1,
  appendKnowledgeQueryHistoryV5,
  createKnowledgeImageV5,
  createKnowledgeQueryHistoryV5,
  createKnowledgeQueryIndexV5,
  createKnowledgeRunV1,
  inspectKnowledgeRuntimeV5,
  queryKnowledgeImageV5,
  verifyKnowledgeRuntimeDiagnosticsV5,
} from '../dist/index.js';

function fixture() {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'source', bytes: new TextEncoder().encode('diagnostics'), meta: { owner: 'ops' } }] });
  const query = queryKnowledgeImageV5(image, 'FROM source SEARCH "diagnostics" LIMIT 1');
  const history = appendKnowledgeQueryHistoryV5(createKnowledgeQueryHistoryV5(), query, 10);
  const index = createKnowledgeQueryIndexV5(image);
  const run = createKnowledgeRunV1({ agentId: 'agent', imageStateRoot: image.stateRoot, input: { task: 'diagnostics' }, createdAt: 1 });
  const replayCache = new KnowledgeSyncReplayCacheV1();
  replayCache.acceptVerifiedRequest({ requestId: 'sha256-' + '1'.repeat(64), expiresAt: 100 }, 5);
  return { image, queryHistory: history, queryIndex: index, replayState: replayCache.snapshot(), run };
}

test('V5 runtime diagnostics is deterministic and verifies supplied artifacts', () => {
  const input = fixture();
  const first = inspectKnowledgeRuntimeV5(input);
  const second = inspectKnowledgeRuntimeV5({ ...input, image: input.image.bytes });
  assert.deepEqual(second, first);
  assert.equal(first.image.objectCount, 1);
  assert.equal(first.queryIndex.objectCount, 1);
  assert.equal(first.queryHistory.entryCount, 1);
  assert.equal(first.run.status, 'pending');
  assert.equal(first.replay.entryCount, 1);
  verifyKnowledgeRuntimeDiagnosticsV5(input, first);
});

test('V5 runtime diagnostics rejects stale artifacts and tampered reports', () => {
  const input = fixture();
  const other = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('other'), meta: {} }] });
  assert.throws(() => inspectKnowledgeRuntimeV5({ ...input, image: other }), /state root|image root|index|mismatch/i);
  const diagnostics = inspectKnowledgeRuntimeV5(input);
  assert.throws(() => verifyKnowledgeRuntimeDiagnosticsV5(input, { ...diagnostics, diagnosticsRoot: 'sha256-' + '0'.repeat(64) }), /root mismatch/i);
  assert.throws(() => verifyKnowledgeRuntimeDiagnosticsV5({ ...input, run: { ...input.run, imageStateRoot: other.stateRoot } }, diagnostics), /run image root|root mismatch|identity/i);
});
