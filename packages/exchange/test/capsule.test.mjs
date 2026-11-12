import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKnowledgeCapsuleV1,
  createKnowledgeExchangeOfferV1,
  createKnowledgeImageV5,
  describeKnowledgeExchangeArtifactV1,
  signKnowledgeExchangeOfferWithEd25519,
} from '@knolo/core';
import { attachExchangeCapsule } from '../dist/index.js';

const NOW = 1_700_000_000_000;
const KEYRING_ROOT = `sha256-${'ab'.repeat(32)}`;

test('a capsule attaches only after a verified parent offer', async () => {
  const sender = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const recipient = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const keyring = {
    keyringRoot: KEYRING_ROOT,
    keys: [
      {
        principal: 'agent-a',
        keyId: 'agent-a-1',
        publicKey: new Uint8Array(
          await crypto.subtle.exportKey('raw', sender.publicKey)
        ),
      },
      {
        principal: 'agent-b',
        keyId: 'agent-b-1',
        publicKey: new Uint8Array(
          await crypto.subtle.exportKey('raw', recipient.publicKey)
        ),
      },
    ],
  };
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('capsule-parent'),
        meta: {},
      },
    ],
  });
  const described = describeKnowledgeExchangeArtifactV1(image.bytes);
  const capsule = createKnowledgeCapsuleV1({
    image,
    objectIds: [image.objects[0].id],
  });
  const offer = await signKnowledgeExchangeOfferWithEd25519(
    createKnowledgeExchangeOfferV1({
      sender: 'agent-a',
      recipient: 'agent-b',
      artifactKind: 'knowledge-image',
      sha256: described.sha256,
      stateRoot: described.stateRoot,
      sizeBytes: described.sizeBytes,
      algorithm: 'Ed25519',
      keyId: 'agent-a-1',
      keyringRoot: KEYRING_ROOT,
      nonce: Uint8Array.from([1, 2, 3, 4]),
      issuedAt: NOW,
      expiresAt: NOW + 300_000,
    }),
    sender.privateKey,
    crypto
  );
  const attached = await attachExchangeCapsule({
    offer,
    capsule,
    keyring,
    now: NOW,
    expectedRecipient: 'agent-b',
  });
  assert.equal(attached.stateRoot, image.stateRoot);
  assert.equal(attached.objects.length, 1);

  await assert.rejects(
    () =>
      attachExchangeCapsule({
        offer,
        capsule: {
          ...capsule,
          stateRoot: `sha256-${'ff'.repeat(32)}`,
        },
        keyring,
        now: NOW,
        expectedRecipient: 'agent-b',
      }),
    /state root mismatch/
  );
  await assert.rejects(
    () =>
      attachExchangeCapsule({
        offer: { ...offer, signature: new Uint8Array(64) },
        capsule,
        keyring,
        now: NOW,
        expectedRecipient: 'agent-b',
      }),
    /signature verification failed/
  );
});
