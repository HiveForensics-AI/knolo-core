import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorityEnvelopePayloadV1,
  createKnowledgeImageV5,
  delegationPayloadV1,
  digestBytes,
  digestDomain,
  evaluateKnowledgeQueryPolicyV5,
  queryKnowledgeImageV5,
  verifyKnowledgeAuthorityEnvelopeV5,
} from '../dist/index.js';

const keys = new Map([
  ['root', Uint8Array.from([1, 2, 3])],
]);

function sign(key, message) {
  return digestBytes(digestDomain('test-signature', concat(key, message)));
}

function concat(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function testVerifier(algorithm, key, message, signature) {
  return algorithm === 'test-v1' && Buffer.from(sign(key, message)).equals(Buffer.from(signature));
}

test('V5 authority envelopes bind external principals and delegation chains', () => {
  const policy = { version: 1, default: 'deny', rules: [{ effect: 'allow', action: 'query', principal: 'alice' }] };
  const image = createKnowledgeImageV5({ policy, objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('alpha'), meta: {} }] });
  const query = queryKnowledgeImageV5(image, 'FROM chunk SEARCH "alpha"');
  const authorization = evaluateKnowledgeQueryPolicyV5(image, query, policy, 'alice');
  const delegation = {
    version: 1,
    delegator: 'root',
    delegatee: 'alice',
    action: 'query',
    issuedAt: 0,
    expiresAt: 200,
    algorithm: 'test-v1',
    signature: new Uint8Array(),
  };
  delegation.signature = sign(keys.get('root'), delegationPayloadV1(delegation));
  const envelope = {
    version: 1,
    issuer: 'root',
    subject: 'alice',
    authorizationRoot: authorization.authorizationRoot,
    issuedAt: 0,
    expiresAt: 200,
    algorithm: 'test-v1',
    delegations: [delegation],
    signature: new Uint8Array(),
  };
  envelope.signature = sign(keys.get('root'), authorityEnvelopePayloadV1(envelope));
  const verified = verifyKnowledgeAuthorityEnvelopeV5(image, query, policy, authorization, envelope, {
    now: 100,
    resolveKey: (principal) => keys.get(principal),
    verifySignature: testVerifier,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.subject, 'alice');
  assert.equal(verified.delegationDepth, 1);
  assert.match(verified.envelopeRoot, /^sha256-[0-9a-f]{64}$/);
});

test('V5 authority envelopes fail closed on binding, expiry, and signature errors', () => {
  const policy = { version: 1, default: 'deny', rules: [{ effect: 'allow', action: 'query', principal: 'alice' }] };
  const image = createKnowledgeImageV5({ policy, objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('alpha'), meta: {} }] });
  const query = queryKnowledgeImageV5(image, 'FROM chunk SEARCH "alpha"');
  const authorization = evaluateKnowledgeQueryPolicyV5(image, query, policy, 'alice');
  const envelope = {
    version: 1,
    issuer: 'root',
    subject: 'alice',
    authorizationRoot: authorization.authorizationRoot,
    issuedAt: 0,
    expiresAt: 50,
    algorithm: 'test-v1',
    delegations: [],
    signature: new Uint8Array(),
  };
  envelope.signature = sign(keys.get('root'), authorityEnvelopePayloadV1(envelope));
  const options = { now: 100, resolveKey: (principal) => keys.get(principal), verifySignature: testVerifier };
  assert.throws(() => verifyKnowledgeAuthorityEnvelopeV5(image, query, policy, authorization, envelope, options), /validity window/i);
  const tampered = { ...envelope, expiresAt: 200, signature: envelope.signature.slice() };
  tampered.signature[0] ^= 1;
  assert.throws(() => verifyKnowledgeAuthorityEnvelopeV5(image, query, policy, authorization, tampered, options), /signature verification/i);
  assert.throws(() => verifyKnowledgeAuthorityEnvelopeV5(image, query, policy, { ...authorization, authorizationRoot: 'sha256-' + '0'.repeat(64) }, envelope, { ...options, now: 10 }), /authorization.*root|reproducible/i);
});
