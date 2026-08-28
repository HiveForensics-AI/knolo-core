import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  KnowledgeSyncReplayCacheV1,
  createKnowledgeImageV5,
  createKnowledgeSyncRequestV1,
  createKnowledgeSyncResponseV1,
  createKnowledgeSyncSummaryV1,
  deserializeKnowledgeSyncReplayStateV1,
  decodeKnowledgeSyncRequestV1,
  encodeKnowledgeSyncResponseV1,
  exchangeKnowledgeSyncImageOverTransportV5,
  serializeKnowledgeSyncReplayStateV1,
} from '../dist/index.js';
import { DurableKnowledgeSyncReplayStoreV5 } from '../dist/node.js';

function exchangeFixture() {
  const base = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
  const remote = createKnowledgeImageV5({ baseImage: base, actor: 'remote', objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('remote'), meta: {} }] });
  const keyringRoot = 'sha256-' + 'a'.repeat(64);
  const request = createKnowledgeSyncRequestV1({ version: 1, kind: 'sync-request', sender: 'local', summary: createKnowledgeSyncSummaryV1(base, keyringRoot), wantObjectIds: [], wantEventIds: [], algorithm: 'test', nonce: Uint8Array.from([1, 2, 3]), issuedAt: 100, expiresAt: 300 });
  request.signature = Uint8Array.from([1]);
  const response = createKnowledgeSyncResponseV1({ request, version: 1, kind: 'sync-response', responder: 'remote', summary: createKnowledgeSyncSummaryV1(remote, keyringRoot), relation: 'remote-ahead', objectIds: remote.objects.map((object) => object.id).sort(), eventIds: remote.events.map((event) => event.id).sort(), algorithm: 'test', issuedAt: 100, expiresAt: 300 });
  response.signature = Uint8Array.from([2]);
  return { base, remote, request, response, keyringRoot };
}

const verifyOptions = (replayCache) => ({ replayCache, now: 150, expectedKeyringRoot: 'sha256-' + 'a'.repeat(64), resolveKey: () => Uint8Array.from([9]), verifySignature: () => true });

test('V5 sync image transfer verifies metadata and image before replay admission', async () => {
  const fixture = exchangeFixture();
  const replayCache = new KnowledgeSyncReplayCacheV1();
  let calls = 0;
  const result = await exchangeKnowledgeSyncImageOverTransportV5(fixture.request, { ...verifyOptions(replayCache), transport: { requestImage: (requestBytes) => { calls++; assert.deepEqual([...decodeKnowledgeSyncRequestV1(requestBytes).nonce], [1, 2, 3]); return { responseBytes: encodeKnowledgeSyncResponseV1(fixture.response), imageBytes: fixture.remote.bytes }; } } });
  assert.equal(result.image.stateRoot, fixture.remote.stateRoot);
  assert.equal(calls, 1);
  assert.equal(replayCache.size, 1);
  await assert.rejects(() => exchangeKnowledgeSyncImageOverTransportV5(fixture.request, { ...verifyOptions(replayCache), transport: { requestImage: () => { calls++; return { responseBytes: encodeKnowledgeSyncResponseV1(fixture.response), imageBytes: fixture.remote.bytes }; } } }), /replay/i);
  assert.equal(calls, 1);

  const failedCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(() => exchangeKnowledgeSyncImageOverTransportV5(fixture.request, { ...verifyOptions(failedCache), transport: { requestImage: () => ({ responseBytes: encodeKnowledgeSyncResponseV1(fixture.response), imageBytes: fixture.base.bytes }) } }), /state root/i);
  assert.equal(failedCache.size, 0);
});

test('V5 replay state is canonical and durably recoverable', () => {
  const cache = new KnowledgeSyncReplayCacheV1({ maxEntries: 2 });
  cache.acceptVerifiedRequest({ requestId: 'sha256-' + '2'.repeat(64), expiresAt: 20 }, 5);
  cache.acceptVerifiedRequest({ requestId: 'sha256-' + '1'.repeat(64), expiresAt: 30 }, 5);
  const restored = deserializeKnowledgeSyncReplayStateV1(serializeKnowledgeSyncReplayStateV1(cache.snapshot()));
  assert.deepEqual(restored, cache.snapshot());

  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-replay-'));
  const path = join(directory, 'replay.v5');
  try {
    const store = DurableKnowledgeSyncReplayStoreV5.open(path, { maxEntries: 2 });
    store.replayCache.acceptVerifiedRequest({ requestId: 'sha256-' + '3'.repeat(64), expiresAt: 40 }, 5);
    store.close();
    const reopened = DurableKnowledgeSyncReplayStoreV5.open(path);
    assert.equal(reopened.replayCache.has('sha256-' + '3'.repeat(64), 10), true);
    reopened.close();
    const corrupted = new Uint8Array(readFileSync(path));
    corrupted[corrupted.length - 1] ^= 1;
    writeFileSync(path, corrupted);
    assert.throws(() => DurableKnowledgeSyncReplayStoreV5.open(path), /CBOR|root|replay|Malformed/i);
    assert.equal(readdirSync(directory).includes('replay.v5.lock'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
