import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  authorityEnvelopePayloadV1,
  createKnowledgeImageV5,
  evaluateKnowledgeQueryPolicyV5,
  queryKnowledgeImageV5,
  verifyKnowledgeAuthorityEnvelopeWithEd25519,
} from '../dist/index.js';

test('V5 WebCrypto Ed25519 adapter verifies a rotated authority key', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const policy = { version: 1, default: 'deny', rules: [{ effect: 'allow', action: 'query', principal: 'alice' }] };
  const image = createKnowledgeImageV5({ policy, objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('alpha'), meta: {} }] });
  const query = queryKnowledgeImageV5(image, 'FROM chunk SEARCH "alpha"');
  const authorization = evaluateKnowledgeQueryPolicyV5(image, query, policy, 'alice');
  const envelope = {
    version: 1,
    issuer: 'root',
    subject: 'alice',
    authorizationRoot: authorization.authorizationRoot,
    issuedAt: 100,
    expiresAt: 300,
    algorithm: 'Ed25519',
    keyId: 'root-2026',
    delegations: [],
    signature: new Uint8Array(),
  };
  envelope.signature = new Uint8Array(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, authorityEnvelopePayloadV1(envelope)));
  const verified = await verifyKnowledgeAuthorityEnvelopeWithEd25519(image, query, policy, authorization, envelope, {
    keys: [
      { principal: 'root', keyId: 'root-old', publicKey, notBefore: 0, notAfter: 100 },
      { principal: 'root', keyId: 'root-2026', publicKey, notBefore: 100 },
    ],
  }, 150, webcrypto);
  assert.equal(verified.valid, true);
  assert.equal(verified.delegationDepth, 0);

  const expiredKeyEnvelope = { ...envelope, keyId: 'root-old' };
  assert.rejects(() => verifyKnowledgeAuthorityEnvelopeWithEd25519(image, query, policy, authorization, expiredKeyEnvelope, {
    keys: [{ principal: 'root', keyId: 'root-old', publicKey, notBefore: 0, notAfter: 100 }],
  }, 150, webcrypto), /signature verification|failed/i);
});

test('V5 authority envelopes bind the persisted keyring root', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const policy = { version: 1, default: 'deny', rules: [{ effect: 'allow', action: 'query', principal: 'alice' }] };
  const image = createKnowledgeImageV5({ policy, objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('alpha'), meta: {} }] });
  const query = queryKnowledgeImageV5(image, 'FROM chunk SEARCH "alpha"');
  const authorization = evaluateKnowledgeQueryPolicyV5(image, query, policy, 'alice');
  const keyringRoot = 'sha256-' + '1'.repeat(64);
  const envelope = { version: 1, issuer: 'root', subject: 'alice', authorizationRoot: authorization.authorizationRoot, keyringRoot, issuedAt: 100, expiresAt: 300, algorithm: 'Ed25519', keyId: 'root-2026', delegations: [], signature: new Uint8Array() };
  envelope.signature = new Uint8Array(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, authorityEnvelopePayloadV1(envelope)));
  const baseKeyring = { keys: [{ principal: 'root', keyId: 'root-2026', publicKey, notBefore: 0 }], keyringRoot };
  const verified = await verifyKnowledgeAuthorityEnvelopeWithEd25519(image, query, policy, authorization, envelope, baseKeyring, 150, webcrypto);
  assert.equal(verified.keyringRoot, keyringRoot);
  await assert.rejects(() => verifyKnowledgeAuthorityEnvelopeWithEd25519(image, query, policy, authorization, envelope, { ...baseKeyring, keyringRoot: 'sha256-' + '2'.repeat(64) }, 150, webcrypto), /keyring root mismatch/i);
});
