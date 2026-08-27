import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  createKnowledgeQueryIndexV5,
  inspectKnowledgeStudioManagementV5,
  verifyKnowledgeStudioManagementV5,
} from '../dist/index.js';

function fixture() {
  return {
    image: createKnowledgeImageV5({
      objects: [{ kind: 'source', bytes: new TextEncoder().encode('studio'), meta: { owner: 'ops' } }],
    }),
  };
}

test('V5 Studio management snapshot is deterministic and read-only', () => {
  const input = fixture();
  const first = inspectKnowledgeStudioManagementV5(input);
  const second = inspectKnowledgeStudioManagementV5({ ...input, image: input.image.bytes });

  assert.deepEqual(second, first);
  assert.equal(first.surface, 'studio-management');
  assert.equal(first.readOnly, true);
  assert.equal(first.capabilities.inspectImage, true);
  assert.equal(first.capabilities.verifyImage, true);
  assert.equal(first.capabilities.mutateImage, false);
  assert.equal(first.capabilities.inspectQueryIndex, false);
  verifyKnowledgeStudioManagementV5(input, first);
});

test('V5 Studio management snapshot exposes supplied artifact panels', () => {
  const input = fixture();
  const snapshot = inspectKnowledgeStudioManagementV5({
    ...input,
    queryIndex: createKnowledgeQueryIndexV5(input.image),
  });

  assert.equal(snapshot.capabilities.inspectQueryIndex, true);
});

test('V5 Studio management verification rejects tampering and stale inputs', () => {
  const input = fixture();
  const snapshot = inspectKnowledgeStudioManagementV5(input);
  assert.throws(
    () => verifyKnowledgeStudioManagementV5(input, { ...snapshot, readOnly: false }),
    /malformed|root mismatch/i,
  );
  const other = {
    image: createKnowledgeImageV5({
      objects: [{ kind: 'source', bytes: new TextEncoder().encode('different'), meta: { owner: 'ops' } }],
    }),
  };
  assert.throws(
    () => verifyKnowledgeStudioManagementV5(other, snapshot),
    /root mismatch|identity|state root/i,
  );
});
