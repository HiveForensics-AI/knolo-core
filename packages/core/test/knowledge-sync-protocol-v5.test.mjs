import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  createKnowledgeSyncRequestV1,
  createKnowledgeSyncResponseV1,
  createKnowledgeSyncSummaryV1,
  canonicalCbor,
  decodeKnowledgeSyncRequestV1,
  decodeKnowledgeSyncResponseV1,
  encodeKnowledgeSyncRequestV1,
  encodeKnowledgeSyncResponseV1,
  KNOWLEDGE_SYNC_MAX_WIRE_BYTES_V1,
  exchangeKnowledgeSyncOverTransportWithEd25519,
  signKnowledgeSyncRequestWithEd25519,
  signKnowledgeSyncResponseWithEd25519,
  syncRequestRootV1,
  syncResponseRootV1,
  KnowledgeSyncReplayCacheV1,
  verifyKnowledgeSyncExchangeWithEd25519,
  verifyKnowledgeSyncRequestWithEd25519,
  verifyKnowledgeSyncResponseWithEd25519,
} from '../dist/index.js';

async function makeKey() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return { pair, publicKey: new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)) };
}

test('V5 signed sync request/response exchange is root-bound and fail-closed', async () => {
  const local = await makeKey();
  const peer = await makeKey();
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
  const summary = createKnowledgeSyncSummaryV1(image, 'sha256-' + 'a'.repeat(64));
  const requestUnsigned = createKnowledgeSyncRequestV1({
    version: 1,
    kind: 'sync-request',
    sender: 'local',
    summary,
    wantObjectIds: [],
    wantEventIds: [],
    algorithm: 'Ed25519',
    keyId: 'local-1',
    keyringRoot: summary.keyringRoot,
    nonce: Uint8Array.from([1, 2, 3, 4]),
    issuedAt: 100,
    expiresAt: 300,
  });
  const request = await signKnowledgeSyncRequestWithEd25519(requestUnsigned, local.pair.privateKey, webcrypto);
  const keyring = { keyringRoot: summary.keyringRoot, keys: [{ principal: 'local', keyId: 'local-1', publicKey: local.publicKey }, { principal: 'peer', keyId: 'peer-1', publicKey: peer.publicKey }] };
  await verifyKnowledgeSyncRequestWithEd25519(request, keyring, 150, webcrypto);
  assert.match(syncRequestRootV1(request), /^sha256-[0-9a-f]{64}$/);
  const requestWire = encodeKnowledgeSyncRequestV1(request);
  assert.deepEqual([...requestWire], [...encodeKnowledgeSyncRequestV1(request)]);
  const decodedRequest = decodeKnowledgeSyncRequestV1(requestWire);
  await verifyKnowledgeSyncRequestWithEd25519(decodedRequest, keyring, 150, webcrypto);

  const responseUnsigned = createKnowledgeSyncResponseV1({
    request,
    version: 1,
    kind: 'sync-response',
    responder: 'peer',
    summary,
    relation: 'equal',
    objectIds: [],
    eventIds: [],
    algorithm: 'Ed25519',
    keyId: 'peer-1',
    keyringRoot: summary.keyringRoot,
    issuedAt: 100,
    expiresAt: 300,
  });
  const response = await signKnowledgeSyncResponseWithEd25519(responseUnsigned, peer.pair.privateKey, webcrypto);
  await verifyKnowledgeSyncResponseWithEd25519(request, response, keyring, 150, webcrypto);
  assert.match(syncResponseRootV1(response), /^sha256-[0-9a-f]{64}$/);
  const responseWire = encodeKnowledgeSyncResponseV1(response);
  const decodedResponse = decodeKnowledgeSyncResponseV1(responseWire);
  await verifyKnowledgeSyncResponseWithEd25519(decodedRequest, decodedResponse, keyring, 150, webcrypto);
  let transportCalls = 0;
  const transportCache = new KnowledgeSyncReplayCacheV1();
  const exchanged = await exchangeKnowledgeSyncOverTransportWithEd25519(request, keyring, transportCache, {
    request: (requestBytes) => {
      transportCalls += 1;
      assert.deepEqual([...decodeKnowledgeSyncRequestV1(requestBytes).nonce], [1, 2, 3, 4]);
      return responseWire;
    },
  }, 150, webcrypto);
  assert.equal(transportCalls, 1);
  assert.equal(exchanged.response.requestRoot, syncRequestRootV1(request));
  await assert.rejects(() => exchangeKnowledgeSyncOverTransportWithEd25519(request, keyring, transportCache, { request: () => responseWire }, 150, webcrypto), /replay/i);
  assert.equal(transportCalls, 1);

  const tampered = { ...response, objectIds: [image.objects[0].id] };
  const replayCache = new KnowledgeSyncReplayCacheV1({ maxEntries: 2 });
  await assert.rejects(() => verifyKnowledgeSyncExchangeWithEd25519(request, tampered, keyring, 150, replayCache, webcrypto), /signature/i);
  assert.equal(replayCache.size, 0);
  await verifyKnowledgeSyncExchangeWithEd25519(request, response, keyring, 150, replayCache, webcrypto);
  assert.equal(replayCache.size, 1);
  await assert.rejects(() => verifyKnowledgeSyncExchangeWithEd25519(request, response, keyring, 150, replayCache, webcrypto), /replay/i);
  assert.equal(replayCache.has(request.requestId, 150), true);
  assert.equal(replayCache.has(request.requestId, 300), false);

  await assert.rejects(() => verifyKnowledgeSyncResponseWithEd25519(request, tampered, keyring, 150, webcrypto), /signature/i);
  await assert.rejects(() => verifyKnowledgeSyncRequestWithEd25519(request, { ...keyring, keyringRoot: 'sha256-' + 'b'.repeat(64) }, 150, webcrypto), /keyring root mismatch/i);
  await assert.rejects(() => verifyKnowledgeSyncRequestWithEd25519(request, keyring, 300, webcrypto), /validity window/i);
  assert.throws(() => decodeKnowledgeSyncRequestV1(canonicalCbor({ ...request, unexpected: true })), /wire fields/i);
  assert.throws(() => decodeKnowledgeSyncResponseV1(new Uint8Array(KNOWLEDGE_SYNC_MAX_WIRE_BYTES_V1 + 1)), /size limit/i);
  const failedTransportCache = new KnowledgeSyncReplayCacheV1();
  const corruptWire = responseWire.slice();
  corruptWire[corruptWire.length - 1] ^= 1;
  await assert.rejects(() => exchangeKnowledgeSyncOverTransportWithEd25519(request, keyring, failedTransportCache, { request: () => corruptWire }, 150, webcrypto));
  assert.equal(failedTransportCache.size, 0);
});

test('V5 sync replay cache fails closed at capacity and prunes expired entries', () => {
  const cache = new KnowledgeSyncReplayCacheV1({ maxEntries: 1 });
  const first = 'sha256-' + '1'.repeat(64);
  const second = 'sha256-' + '2'.repeat(64);
  cache.acceptVerifiedRequest({ requestId: first, expiresAt: 10 }, 5);
  assert.throws(() => cache.acceptVerifiedRequest({ requestId: first, expiresAt: 10 }, 5), /replay/i);
  assert.throws(() => cache.acceptVerifiedRequest({ requestId: second, expiresAt: 20 }, 5), /capacity/i);
  cache.acceptVerifiedRequest({ requestId: second, expiresAt: 20 }, 10);
  assert.equal(cache.size, 1);
});
