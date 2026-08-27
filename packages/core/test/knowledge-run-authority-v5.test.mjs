import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  createKnowledgeRunV1,
  runAuthorityPayloadV1,
  runAuthorityRootV1,
  signKnowledgeRunAuthorityWithEd25519,
  verifyKnowledgeRunAuthorityV5,
  verifyKnowledgeRunAuthorityWithEd25519,
} from '../dist/index.js';

test('V5 run authority binds Ed25519 authorization to the durable run root', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('authority'), meta: {} }] });
  const run = createKnowledgeRunV1({ agentId: 'agent', imageStateRoot: image.stateRoot, input: { task: 'run' }, createdAt: 1 });
  const keyringRoot = 'sha256-' + 'a'.repeat(64);
  const unsigned = { version: 1, issuer: 'root', subject: 'agent', runId: run.runId, runRoot: run.runRoot, imageStateRoot: run.imageStateRoot, keyringRoot, issuedAt: 10, expiresAt: 30, algorithm: 'Ed25519', keyId: 'root-1', signature: new Uint8Array() };
  const envelope = await signKnowledgeRunAuthorityWithEd25519(unsigned, pair.privateKey, webcrypto);
  assert.match(runAuthorityRootV1(envelope), /^sha256-[0-9a-f]{64}$/);
  assert.equal(runAuthorityPayloadV1(envelope).length > 0, true);
  const keyring = { keyringRoot, keys: [{ principal: 'root', keyId: 'root-1', publicKey }] };
  const verified = await verifyKnowledgeRunAuthorityWithEd25519(run, envelope, keyring, 20, webcrypto);
  assert.equal(verified.valid, true);
  assert.equal(verified.runRoot, run.runRoot);
  const generic = verifyKnowledgeRunAuthorityV5(run, envelope, { now: 20, expectedKeyringRoot: keyringRoot, resolveKey: () => publicKey, verifySignature: () => true });
  assert.equal(generic.envelopeRoot, verified.envelopeRoot);
});

test('V5 run authority rejects root, keyring, and validity mismatches', async () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('authority'), meta: {} }] });
  const run = createKnowledgeRunV1({ agentId: 'agent', imageStateRoot: image.stateRoot, input: { task: 'run' }, createdAt: 1 });
  const keyringRoot = 'sha256-' + 'a'.repeat(64);
  const envelope = { version: 1, issuer: 'root', subject: 'agent', runId: run.runId, runRoot: run.runRoot, imageStateRoot: run.imageStateRoot, keyringRoot, issuedAt: 10, expiresAt: 30, algorithm: 'test', keyId: 'root-1', signature: Uint8Array.from([1]) };
  const options = { now: 20, expectedKeyringRoot: keyringRoot, resolveKey: () => Uint8Array.from([1]), verifySignature: () => true };
  assert.throws(() => verifyKnowledgeRunAuthorityV5(run, { ...envelope, runRoot: 'sha256-' + 'b'.repeat(64) }, options), /binding/i);
  assert.throws(() => verifyKnowledgeRunAuthorityV5(run, envelope, { ...options, expectedKeyringRoot: 'sha256-' + 'c'.repeat(64) }), /keyring/i);
  assert.throws(() => verifyKnowledgeRunAuthorityV5(run, envelope, { ...options, now: 30 }), /expired|validity/i);
});
