import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  authorityEnvelopePayloadV1,
  createKnowledgeImageV5,
  evaluateKnowledgeQueryPolicyV5,
  queryKnowledgeImageV5,
  verifyKnowledgeAuthoritySessionWithEd25519,
} from '../dist/index.js';

test('V5 authority session selects the requested keyring root and binds all roots', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const keyringRoot = 'sha256-' + 'a'.repeat(64);
  const policy = { version: 1, default: 'deny', rules: [{ effect: 'allow', action: 'query', principal: 'alice' }] };
  const image = createKnowledgeImageV5({ policy, objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('alpha'), meta: {} }] });
  const envelope = {
    version: 1,
    issuer: 'root',
    subject: 'alice',
    authorizationRoot: '',
    keyringRoot,
    issuedAt: 100,
    expiresAt: 300,
    algorithm: 'Ed25519',
    keyId: 'root-2026',
    delegations: [],
    signature: new Uint8Array(),
  };
  const queryExpression = 'FROM chunk SEARCH "alpha" LIMIT 10';
  const query = queryKnowledgeImageV5(image, queryExpression);
  envelope.authorizationRoot = evaluateKnowledgeQueryPolicyV5(image, query, policy, 'alice').authorizationRoot;
  envelope.signature = new Uint8Array(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, authorityEnvelopePayloadV1(envelope)));
  let selectedRoot;
  const result = await verifyKnowledgeAuthoritySessionWithEd25519({ image, expression: queryExpression, policy, envelope, now: 150 }, (root) => {
    selectedRoot = root;
    return { keyringRoot, keys: [{ principal: 'root', keyId: 'root-2026', publicKey, notBefore: 0 }] };
  }, webcrypto);
  assert.equal(selectedRoot, keyringRoot);
  assert.equal(result.stateRoot, image.stateRoot);
  assert.equal(result.keyringRoot, keyringRoot);
  assert.equal(result.authority.authorizationRoot, result.authorization.authorizationRoot);
  assert.match(result.sessionRoot, /^sha256-[0-9a-f]{64}$/);
  await assert.rejects(() => verifyKnowledgeAuthoritySessionWithEd25519({ image, expression: queryExpression, policy, envelope, now: 150 }, () => undefined, webcrypto), /keyring root is unavailable/i);
});
