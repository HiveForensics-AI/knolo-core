import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  KnowledgeSyncReplayCacheV1,
  KnowledgeSyncTransferErrorV1,
  createKnowledgeImageV5,
  createKnowledgeSyncRequestV1,
  createKnowledgeSyncResponseV1,
  createKnowledgeSyncSummaryV1,
  encodeKnowledgeSyncResponseV1,
  executeKnowledgeSyncHostDeploymentV5,
} from '../dist/index.js';
import {
  DurableKnowledgeImageStoreV5,
  InMemoryKnowledgeSyncHostAdapterV5,
  executeKnowledgeSyncHostFastForwardV5,
} from '../dist/node.js';

function fixture() {
  const base = createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('host base'),
        meta: {},
      },
    ],
  });
  const remote = createKnowledgeImageV5({
    baseImage: base,
    actor: 'remote',
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('host remote'),
        meta: {},
      },
    ],
  });
  const keyringRoot = `sha256-${'a'.repeat(64)}`;
  const request = createKnowledgeSyncRequestV1({
    version: 1,
    kind: 'sync-request',
    sender: 'local',
    summary: createKnowledgeSyncSummaryV1(base, keyringRoot),
    wantObjectIds: [],
    wantEventIds: [],
    algorithm: 'test',
    nonce: Uint8Array.from([1, 2, 3]),
    issuedAt: 100,
    expiresAt: 300,
  });
  request.signature = Uint8Array.from([1]);
  const response = createKnowledgeSyncResponseV1({
    request,
    version: 1,
    kind: 'sync-response',
    responder: 'remote',
    summary: createKnowledgeSyncSummaryV1(remote, keyringRoot),
    relation: 'remote-ahead',
    objectIds: remote.objects.map((object) => object.id).sort(),
    eventIds: remote.events.map((event) => event.id).sort(),
    algorithm: 'test',
    issuedAt: 100,
    expiresAt: 300,
  });
  response.signature = Uint8Array.from([2]);
  return { base, remote, request, response, keyringRoot };
}

function verification(replayCache) {
  return {
    replayCache,
    expectedKeyringRoot: `sha256-${'a'.repeat(64)}`,
    resolveKey: () => Uint8Array.from([9]),
    verifySignature: () => true,
  };
}

function responseFor(fixtureValue) {
  return {
    responseBytes: encodeKnowledgeSyncResponseV1(fixtureValue.response),
    imageBytes: fixtureValue.remote.bytes,
  };
}

test('V5 host deployment discovers and verifies one peer through the reference adapter', async () => {
  const value = fixture();
  const events = [];
  let calls = 0;
  const adapter = new InMemoryKnowledgeSyncHostAdapterV5([
    {
      peerId: 'remote',
      handler: (requestBytes, checkpoint) => {
        calls += 1;
        assert.ok(requestBytes.length > 0);
        assert.equal(checkpoint, undefined);
        return responseFor(value);
      },
    },
  ]);

  const result = await executeKnowledgeSyncHostDeploymentV5({
    request: value.request,
    discovery: adapter,
    transport: adapter,
    verification: verification(new KnowledgeSyncReplayCacheV1()),
    now: 150,
    peerId: 'remote',
    monitor: (event) => events.push(event),
  });

  assert.equal(result.peer.peerId, 'remote');
  assert.equal(result.attempts, 1);
  assert.equal(result.image.stateRoot, value.remote.stateRoot);
  assert.equal(result.checkpoint.offset, value.remote.bytes.length);
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.kind),
    [
      'deployment.started',
      'peer.discovery',
      'transfer.attempt',
      'deployment.succeeded',
    ]
  );
});

test('V5 host deployment retries from the last transfer checkpoint', async () => {
  const value = fixture();
  const replayCache = new KnowledgeSyncReplayCacheV1();
  const offsets = [];
  const checkpoints = [];
  let calls = 0;
  const checkpointStore = {
    load: () => undefined,
    save: (_key, checkpoint) => checkpoints.push(checkpoint),
  };
  const adapter = new InMemoryKnowledgeSyncHostAdapterV5([
    {
      peerId: 'remote',
      handler: (_requestBytes, checkpoint) => {
        calls += 1;
        offsets.push(checkpoint?.offset ?? 0);
        if (calls === 1) {
          throw new KnowledgeSyncTransferErrorV1(
            'temporary transfer interruption',
            {
              requestId: value.request.requestId,
              offset: 64,
              totalBytes: value.remote.bytes.length,
            }
          );
        }
        return responseFor(value);
      },
    },
  ]);
  const events = [];

  const result = await executeKnowledgeSyncHostDeploymentV5({
    request: value.request,
    discovery: adapter,
    transport: adapter,
    verification: verification(replayCache),
    now: 150,
    peerId: 'remote',
    maxAttempts: 3,
    checkpointStore,
    monitor: (event) => events.push(event),
  });

  assert.deepEqual(offsets, [0, 64]);
  assert.equal(result.attempts, 2);
  assert.equal(replayCache.size, 1);
  assert.deepEqual(
    checkpoints.map((checkpoint) => checkpoint.offset),
    [64, value.remote.bytes.length]
  );
  assert.ok(events.some((event) => event.kind === 'transfer.retry'));
});

test('V5 host deployment can resume a checkpoint supplied by a durable host store', async () => {
  const value = fixture();
  const replayCache = new KnowledgeSyncReplayCacheV1();
  let persisted;
  let mode = 'fail';
  let observedOffset = 0;
  const checkpointStore = {
    load: () => persisted,
    save: (_key, checkpoint) => {
      persisted = { ...checkpoint };
    },
  };
  const adapter = new InMemoryKnowledgeSyncHostAdapterV5([
    {
      peerId: 'remote',
      handler: (_requestBytes, checkpoint) => {
        observedOffset = checkpoint?.offset ?? 0;
        if (mode === 'fail') {
          throw new KnowledgeSyncTransferErrorV1('host stopped', {
            requestId: value.request.requestId,
            offset: 48,
            totalBytes: value.remote.bytes.length,
          });
        }
        return responseFor(value);
      },
    },
  ]);

  await assert.rejects(
    () =>
      executeKnowledgeSyncHostDeploymentV5({
        request: value.request,
        discovery: adapter,
        transport: adapter,
        verification: verification(replayCache),
        now: 150,
        peerId: 'remote',
        maxAttempts: 1,
        checkpointStore,
      }),
    /host stopped/
  );
  assert.equal(persisted.offset, 48);
  assert.equal(replayCache.size, 0);

  mode = 'success';
  const result = await executeKnowledgeSyncHostDeploymentV5({
    request: value.request,
    discovery: adapter,
    transport: adapter,
    verification: verification(replayCache),
    now: 150,
    peerId: 'remote',
    checkpointStore,
  });
  assert.equal(observedOffset, 48);
  assert.equal(result.checkpoint.offset, value.remote.bytes.length);
  assert.equal(persisted.offset, value.remote.bytes.length);
});

test('V5 host deployment does not retry expired or replayed requests', async () => {
  const value = fixture();
  let expiredCalls = 0;
  const expiredAdapter = new InMemoryKnowledgeSyncHostAdapterV5([
    {
      peerId: 'remote',
      handler: () => {
        expiredCalls += 1;
        return responseFor(value);
      },
    },
  ]);
  const expiredEvents = [];
  await assert.rejects(
    () =>
      executeKnowledgeSyncHostDeploymentV5({
        request: value.request,
        discovery: expiredAdapter,
        transport: expiredAdapter,
        verification: verification(new KnowledgeSyncReplayCacheV1()),
        now: 300,
        peerId: 'remote',
        maxAttempts: 3,
        monitor: (event) => expiredEvents.push(event),
      }),
    /validity window/i
  );
  assert.equal(expiredCalls, 0);
  assert.ok(expiredEvents.some((event) => event.kind === 'deployment.expired'));

  let replayCalls = 0;
  const replayCache = new KnowledgeSyncReplayCacheV1();
  const replayAdapter = new InMemoryKnowledgeSyncHostAdapterV5([
    {
      peerId: 'remote',
      handler: () => {
        replayCalls += 1;
        return responseFor(value);
      },
    },
  ]);
  const options = {
    request: value.request,
    discovery: replayAdapter,
    transport: replayAdapter,
    verification: verification(replayCache),
    now: 150,
    peerId: 'remote',
  };
  await executeKnowledgeSyncHostDeploymentV5(options);
  const replayEvents = [];
  await assert.rejects(
    () =>
      executeKnowledgeSyncHostDeploymentV5({
        ...options,
        monitor: (event) => replayEvents.push(event),
      }),
    /replay/i
  );
  assert.equal(replayCalls, 1);
  assert.ok(replayEvents.some((event) => event.kind === 'deployment.replayed'));
});

test('V5 host deployment reports failed transfers and preserves replay state', async () => {
  const value = fixture();
  const replayCache = new KnowledgeSyncReplayCacheV1();
  let calls = 0;
  const offsets = [];
  const adapter = new InMemoryKnowledgeSyncHostAdapterV5([
    {
      peerId: 'remote',
      handler: () => {
        calls += 1;
        offsets.push(calls === 1 ? 0 : 32);
        throw new KnowledgeSyncTransferErrorV1('peer disconnected', {
          requestId: value.request.requestId,
          offset: calls === 1 ? 32 : 64,
          totalBytes: value.remote.bytes.length,
        });
      },
    },
  ]);
  const events = [];

  await assert.rejects(
    () =>
      executeKnowledgeSyncHostDeploymentV5({
        request: value.request,
        discovery: adapter,
        transport: adapter,
        verification: verification(replayCache),
        now: 150,
        peerId: 'remote',
        maxAttempts: 2,
        monitor: (event) => events.push(event),
      }),
    /peer disconnected/
  );
  assert.equal(calls, 2);
  assert.deepEqual(offsets, [0, 32]);
  assert.equal(replayCache.size, 0);
  assert.ok(events.some((event) => event.kind === 'deployment.failed'));
});

test('V5 host deployment requires explicit peer selection for ambiguous discovery', async () => {
  const value = fixture();
  const events = [];
  const adapter = new InMemoryKnowledgeSyncHostAdapterV5([
    { peerId: 'a', handler: () => responseFor(value) },
    { peerId: 'b', handler: () => responseFor(value) },
  ]);

  await assert.rejects(
    () =>
      executeKnowledgeSyncHostDeploymentV5({
        request: value.request,
        discovery: adapter,
        transport: adapter,
        verification: verification(new KnowledgeSyncReplayCacheV1()),
        now: 150,
        monitor: (event) => events.push(event),
      }),
    /explicit peer/i
  );
  assert.ok(events.some((event) => event.kind === 'peer.discovery.failed'));
});

test('V5 production sync applies a verified remote-ahead image only after host authorization', async () => {
  const value = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-sync-apply-'));
  const path = join(directory, 'knowledge.v5');
  try {
    const store = DurableKnowledgeImageStoreV5.open(path, value.base, {
      lease: {
        ownerId: 'sync-writer',
        token: 'sync-lease',
        ttlMs: 1000,
        now: () => 150,
      },
    });
    const audit = [];
    const adapter = new InMemoryKnowledgeSyncHostAdapterV5([
      { peerId: 'remote', handler: () => responseFor(value) },
    ]);
    const result = await executeKnowledgeSyncHostFastForwardV5({
      deployment: {
        request: value.request,
        discovery: adapter,
        transport: adapter,
        verification: verification(new KnowledgeSyncReplayCacheV1()),
        now: 150,
        peerId: 'remote',
      },
      store,
      actor: 'sync-host',
      authorization: {
        authorize: (request) =>
          request.operation === 'sync' && request.actor === 'sync-host',
        audit: (event) => audit.push(event),
      },
    });

    assert.equal(result.beforeStateRoot, value.base.stateRoot);
    assert.equal(result.afterStateRoot, value.remote.stateRoot);
    assert.equal(store.stateRoot, value.remote.stateRoot);
    assert.deepEqual(
      audit.map((event) => [event.operation, event.allowed]),
      [['sync', true]]
    );
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
