import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KnowledgeSyncReplayCacheV1,
  acceptKnowledgeExchangeTransferWithEd25519,
  canonicalCbor,
  createKnowledgeExchangeDecisionV1,
  createKnowledgeExchangeOfferV1,
  createKnowledgeExchangeReceiptV1,
  createKnowledgeImageV5,
  decodeCanonicalCbor,
  decodeKnowledgeExchangeDecisionV1,
  decodeKnowledgeExchangeOfferV1,
  decodeKnowledgeExchangeReceiptV1,
  describeKnowledgeExchangeArtifactV1,
  encodeKnowledgeExchangeDecisionV1,
  encodeKnowledgeExchangeOfferV1,
  encodeKnowledgeExchangeReceiptV1,
  exchangeOfferRootV1,
  signKnowledgeExchangeDecisionWithEd25519,
  signKnowledgeExchangeOfferWithEd25519,
  signKnowledgeExchangeReceiptWithEd25519,
  verifyKnowledgeExchangeDecisionWithEd25519,
  verifyKnowledgeExchangeReceiptWithEd25519,
} from '../../../packages/core/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const done = new Set();
const keyringRoot = `sha256-${'ab'.repeat(32)}`;
const otherRoot = `sha256-${'cd'.repeat(32)}`;

function finish(name) {
  done.add(name);
}

async function makeKey() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    pair,
    publicKey: new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

function imageBytes() {
  return createKnowledgeImageV5({
    objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('exchange-offer'), meta: {} }],
  }).bytes;
}

function offerDraft(bytes, recipient, overrides = {}) {
  const described = describeKnowledgeExchangeArtifactV1(bytes);
  return {
    sender: 'agent-a',
    recipient,
    artifactKind: 'knowledge-image',
    sha256: described.sha256,
    stateRoot: described.stateRoot,
    sizeBytes: described.sizeBytes,
    algorithm: 'Ed25519',
    keyId: 'agent-a-1',
    keyringRoot,
    nonce: Uint8Array.from([7, 7, 7, 7]),
    issuedAt: 100,
    expiresAt: 300,
    ...overrides,
  };
}

function keyringFor(sender, recipient, senderKey, options = {}) {
  return {
    keyringRoot,
    keys: [
      { principal: 'agent-a', keyId: 'agent-a-1', publicKey: sender.publicKey, ...senderKey },
      { principal: 'agent-b', keyId: 'agent-b-1', publicKey: recipient.publicKey, ...(options.recipientKey ?? {}) },
    ],
  };
}

async function signedOffer(sender, bytes, recipient, overrides) {
  const draft = createKnowledgeExchangeOfferV1(offerDraft(bytes, recipient, overrides));
  return signKnowledgeExchangeOfferWithEd25519(draft, sender.pair.privateKey, webcrypto);
}

export async function runExchangeConformance() {
  const sender = await makeKey();
  const recipient = await makeKey();
  const bytes = imageBytes();
  const described = describeKnowledgeExchangeArtifactV1(bytes);
  const offer = await signedOffer(sender, bytes, 'agent-b');
  const peers = keyringFor(sender, recipient);

  const cache = new KnowledgeSyncReplayCacheV1();
  const accepted = await acceptKnowledgeExchangeTransferWithEd25519(offer, bytes, peers, cache, 150, webcrypto, 'agent-b');
  assert.equal(accepted.stateRoot, described.stateRoot);
  assert.equal(cache.size, 1);
  const decision = await signKnowledgeExchangeDecisionWithEd25519(
    createKnowledgeExchangeDecisionV1({
      offer,
      decision: 'accept',
      algorithm: 'Ed25519',
      keyId: 'agent-b-1',
      keyringRoot,
      nonce: Uint8Array.from([8, 8, 8, 8]),
      issuedAt: 120,
      expiresAt: 300,
    }),
    recipient.pair.privateKey,
    webcrypto,
  );
  await verifyKnowledgeExchangeDecisionWithEd25519(offer, decision, peers, 150, webcrypto);
  const receipt = await signKnowledgeExchangeReceiptWithEd25519(
    createKnowledgeExchangeReceiptV1({
      offer,
      role: 'recipient',
      decision: 'accept',
      verification: 'verified',
      policy: 'receive',
      algorithm: 'Ed25519',
      keyId: 'agent-b-1',
      keyringRoot,
      nonce: Uint8Array.from([9, 9, 9, 9]),
      issuedAt: 130,
      expiresAt: 300,
    }),
    recipient.pair.privateKey,
    webcrypto,
  );
  await verifyKnowledgeExchangeReceiptWithEd25519(offer, receipt, peers, 150, webcrypto);
  assert.equal(decodeKnowledgeExchangeReceiptV1(encodeKnowledgeExchangeReceiptV1(receipt)).receiptId, receipt.receiptId);
  finish('valid-offer');

  const wire = encodeKnowledgeExchangeOfferV1(offer);
  const decoded = decodeKnowledgeExchangeOfferV1(wire);
  assert.equal(decoded.offerId, offer.offerId);
  assert.deepEqual([...encodeKnowledgeExchangeOfferV1(decoded)], [...wire]);
  assert.match(exchangeOfferRootV1(decoded), /^sha256-[0-9a-f]{64}$/);
  const decisionWire = encodeKnowledgeExchangeDecisionV1(decision);
  assert.equal(decodeKnowledgeExchangeDecisionV1(decisionWire).decision, 'accept');
  finish('wire-roundtrip');

  const flipped = bytes.slice();
  flipped[flipped.length - 1] ^= 0xff;
  const tamperCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(offer, flipped, peers, tamperCache, 150, webcrypto, 'agent-b'),
    /artifact digest mismatch/,
  );
  assert.equal(tamperCache.size, 0);
  finish('tampered-digest');

  const lied = await signedOffer(sender, bytes, 'agent-b', {
    stateRoot: otherRoot,
    nonce: Uint8Array.from([1, 1, 1, 1]),
  });
  const rootCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(lied, bytes, peers, rootCache, 150, webcrypto, 'agent-b'),
    /state root mismatch/,
  );
  assert.equal(rootCache.size, 0);
  finish('state-root-mismatch');

  const foreign = await signedOffer(sender, bytes, 'agent-c', { nonce: Uint8Array.from([2, 2, 2, 2]) });
  const foreignCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(foreign, bytes, peers, foreignCache, 150, webcrypto, 'agent-b'),
    /recipient mismatch/,
  );
  assert.equal(foreignCache.size, 0);
  finish('unauthorized-recipient');

  const expiredCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(offer, bytes, peers, expiredCache, 300, webcrypto, 'agent-b'),
    /validity window/,
  );
  assert.equal(expiredCache.size, 0);
  finish('expired-offer');

  const replayCache = new KnowledgeSyncReplayCacheV1();
  await acceptKnowledgeExchangeTransferWithEd25519(offer, bytes, peers, replayCache, 150, webcrypto, 'agent-b');
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(offer, bytes, peers, replayCache, 160, webcrypto, 'agent-b'),
    /replay/,
  );
  assert.equal(replayCache.size, 1);
  finish('replayed-offer');

  const revoked = keyringFor(sender, recipient, { revokedAt: 100 });
  const revokedCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(offer, bytes, revoked, revokedCache, 150, webcrypto, 'agent-b'),
    /revoked/,
  );
  assert.equal(revokedCache.size, 0);
  finish('revoked-key');

  const inactive = keyringFor(sender, recipient, { notBefore: 200 });
  const inactiveCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(offer, bytes, inactive, inactiveCache, 150, webcrypto, 'agent-b'),
    /validity window/,
  );
  assert.equal(inactiveCache.size, 0);
  finish('inactive-key');

  const wrongDecision = await signKnowledgeExchangeDecisionWithEd25519(
    createKnowledgeExchangeDecisionV1({
      offer,
      decision: 'accept',
      algorithm: 'Ed25519',
      keyId: 'agent-b-1',
      keyringRoot,
      nonce: Uint8Array.from([3, 3, 3, 3]),
      issuedAt: 120,
      expiresAt: 300,
    }),
    sender.pair.privateKey,
    webcrypto,
  );
  await assert.rejects(
    () => verifyKnowledgeExchangeDecisionWithEd25519(offer, wrongDecision, peers, 150, webcrypto),
    /signature verification failed/,
  );
  finish('decision-wrong-signer');

  assert.throws(
    () => createKnowledgeExchangeReceiptV1({
      offer,
      role: 'recipient',
      decision: 'reject',
      verification: 'verified',
      policy: 'denied',
      algorithm: 'Ed25519',
      keyId: 'agent-b-1',
      keyringRoot,
      nonce: Uint8Array.from([4, 4, 4, 4]),
      issuedAt: 120,
      expiresAt: 300,
    }),
    /verified rejection/,
  );
  finish('reject-cannot-verify');

  const junk = new TextEncoder().encode('not-a-knowledge-image');
  const junkOffer = await signKnowledgeExchangeOfferWithEd25519(
    createKnowledgeExchangeOfferV1({
      sender: 'agent-a',
      recipient: 'agent-b',
      artifactKind: 'knowledge-image',
      sha256: createHash('sha256').update(junk).digest('hex'),
      stateRoot: otherRoot,
      sizeBytes: junk.length,
      algorithm: 'Ed25519',
      keyId: 'agent-a-1',
      keyringRoot,
      nonce: Uint8Array.from([5, 5, 5, 5]),
      issuedAt: 100,
      expiresAt: 300,
    }),
    sender.pair.privateKey,
    webcrypto,
  );
  const junkCache = new KnowledgeSyncReplayCacheV1();
  await assert.rejects(
    () => acceptKnowledgeExchangeTransferWithEd25519(junkOffer, junk, peers, junkCache, 150, webcrypto, 'agent-b'),
    /failed to mount/,
  );
  assert.equal(junkCache.size, 0);
  finish('mount-failed');

  const record = decodeCanonicalCbor(wire);
  record.unexpected = true;
  assert.throws(() => decodeKnowledgeExchangeOfferV1(canonicalCbor(record)), /wire fields/);
  finish('extra-wire-field');

  const expected = JSON.parse(readFileSync(path.join(here, 'expected.json'), 'utf8'));
  assert.deepEqual([...done].sort(), [...expected.cases].sort());
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  runExchangeConformance().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
