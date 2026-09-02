import assert from 'node:assert/strict';
import test from 'node:test';
import { executeKnowledgeAuthorizedOperationV5 } from '../dist/index.js';

test('V5 host authorization gates and audits every state-changing operation class', () => {
  const decisions = [];
  const boundary = {
    authorize: (request) => {
      decisions.push({ phase: 'authorize', request });
      return request.actor === 'host-admin';
    },
    audit: (event) => decisions.push({ phase: 'audit', event }),
  };
  const results = ['commit', 'merge', 'policy', 'authority', 'sync'].map(
    (operation) =>
      executeKnowledgeAuthorizedOperationV5(
        boundary,
        {
          operation,
          actor: 'host-admin',
          stateRoot: `sha256-${'a'.repeat(64)}`,
          details: { requestId: 'request-1' },
        },
        () => `${operation}-applied`
      )
  );

  assert.deepEqual(results, [
    'commit-applied',
    'merge-applied',
    'policy-applied',
    'authority-applied',
    'sync-applied',
  ]);
  assert.deepEqual(
    decisions
      .filter((entry) => entry.phase === 'audit')
      .map((entry) => [entry.event.operation, entry.event.allowed]),
    [
      ['commit', true],
      ['merge', true],
      ['policy', true],
      ['authority', true],
      ['sync', true],
    ]
  );
});

test('V5 denied host operations are audited and never invoke the mutation', () => {
  const events = [];
  let invoked = false;
  assert.throws(
    () =>
      executeKnowledgeAuthorizedOperationV5(
        {
          authorize: () => false,
          audit: (event) => events.push(event),
        },
        { operation: 'merge', actor: 'untrusted-host' },
        () => {
          invoked = true;
          return undefined;
        }
      ),
    /authorization denied/i
  );
  assert.equal(invoked, false);
  assert.deepEqual(
    events.map((event) => [event.operation, event.allowed]),
    [['merge', false]]
  );
});
