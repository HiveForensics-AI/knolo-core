import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkpointKnowledgeRunV1,
  completeKnowledgeRunV1,
  createKnowledgeImageV5,
  createKnowledgeRunV1,
  deserializeKnowledgeRunV1,
  resumeKnowledgeRunV1,
  serializeKnowledgeRunV1,
  startKnowledgeRunV1,
  verifyKnowledgeRunV1,
} from '../dist/index.js';

function initialRun() {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('run image'), meta: {} }] });
  return createKnowledgeRunV1({ agentId: 'research-agent', imageStateRoot: image.stateRoot, input: { prompt: 'summarize', options: { topK: 3 } }, createdAt: 100 });
}

test('V5 durable run lifecycle is deterministic and resumable', () => {
  const pending = initialRun();
  const started = startKnowledgeRunV1(pending, 101);
  const paused = checkpointKnowledgeRunV1(started, { cursor: 2, pendingTool: 'lookup' }, 110);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.checkpoint.sequence, 2);
  const resumed = resumeKnowledgeRunV1(paused, 120);
  const completed = completeKnowledgeRunV1(resumed, { answer: 'done' }, 130);
  verifyKnowledgeRunV1(completed);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.sequence, 4);
  assert.equal(completed.events.length, 4);
  assert.deepEqual(deserializeKnowledgeRunV1(serializeKnowledgeRunV1(completed)), completed);
  assert.equal(initialRun().runId, pending.runId);
  assert.equal(initialRun().runRoot, pending.runRoot);
});

test('V5 durable run rejects tampering, invalid transitions, and backward time', () => {
  const pending = initialRun();
  assert.throws(() => resumeKnowledgeRunV1(pending, 101), /checkpoint/i);
  assert.throws(() => completeKnowledgeRunV1(pending, {}, 101), /transition/i);
  const started = startKnowledgeRunV1(pending, 101);
  assert.throws(() => checkpointKnowledgeRunV1(started, {}, 100), /backwards/i);
  const tampered = { ...started, status: 'completed' };
  assert.throws(() => verifyKnowledgeRunV1(tampered), /state transition|status/i);
  const corruptedEvent = { ...started, events: [{ ...started.events[0], payload: { changed: true } }] };
  assert.throws(() => verifyKnowledgeRunV1(corruptedEvent), /journal|root/i);
});
