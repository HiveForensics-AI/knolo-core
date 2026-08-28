import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyKnowledgeKeyRotationWithEd25519,
  authorityKeyringRootV1,
  deserializeAuthorityKeyringV1,
  keyRotationRootV1,
  serializeAuthorityKeyringV1,
  signKnowledgeKeyRotationWithEd25519,
} from '../dist/index.js';
import { DurableAuthorityKeyringStoreV5 } from '../dist/node.js';

const vector = JSON.parse(readFileSync('../../conformance/v5/key-rotation-v1.fixture.json', 'utf8'));

async function keyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, publicKey };
}

function initialKey(publicKey) {
  return { version: 1, principal: 'root', keyId: 'root-old', algorithm: 'Ed25519', publicKey, notBefore: 0 };
}

test('V5 key rotation golden vector matches the canonical roots', () => {
  const key = { ...vector.key, publicKey: Uint8Array.from(Buffer.from(vector.key.publicKeyHex, 'hex')) };
  delete key.publicKeyHex;
  const record = { ...vector.record, publicKey: Uint8Array.from(Buffer.from(vector.record.publicKeyHex, 'hex')), signature: Uint8Array.from(Buffer.from(vector.record.signatureHex, 'hex')) };
  delete record.publicKeyHex;
  delete record.signatureHex;
  const keyring = { version: 1, sequence: 1, keys: [key], rotations: [record] };
  assert.equal(keyRotationRootV1(record), vector.rotationRoot);
  assert.equal(authorityKeyringRootV1(keyring), vector.keyringRoot);
});

test('V5 signed key rotations are canonical, verifiable, and predecessor-aware', async () => {
  const old = await keyPair();
  const next = await keyPair();
  const keyring = { version: 1, sequence: 0, keys: [initialKey(old.publicKey)], rotations: [] };
  const unsigned = {
    version: 1,
    kind: 'key-rotation',
    issuer: 'root',
    issuerKeyId: 'root-old',
    principal: 'root',
    previousKeyId: 'root-old',
    keyId: 'root-2027',
    algorithm: 'Ed25519',
    publicKey: next.publicKey,
    notBefore: 100,
    issuedAt: 100,
    expiresAt: 500,
  };
  const record = await signKnowledgeKeyRotationWithEd25519(unsigned, old.pair.privateKey, webcrypto);
  const applied = await applyKnowledgeKeyRotationWithEd25519(keyring, record, 150, webcrypto);
  assert.equal(applied.sequence, 1);
  assert.equal(applied.keys.find((key) => key.keyId === 'root-old').revokedAt, 100);
  assert.equal(applied.keys.find((key) => key.keyId === 'root-2027').notBefore, 100);
  const encoded = serializeAuthorityKeyringV1(applied);
  const decoded = deserializeAuthorityKeyringV1(encoded);
  assert.deepEqual([...encoded], [...serializeAuthorityKeyringV1(decoded)]);
  assert.equal(authorityKeyringRootV1(decoded), authorityKeyringRootV1(applied));
  assert.equal(keyRotationRootV1(record), keyRotationRootV1(decoded.rotations[0]));
  await assert.rejects(() => applyKnowledgeKeyRotationWithEd25519(applied, record, 150, webcrypto), /already present/i);
  const tampered = { ...record, publicKey: new Uint8Array(record.publicKey) };
  tampered.publicKey[0] ^= 1;
  await assert.rejects(() => applyKnowledgeKeyRotationWithEd25519(keyring, tampered, 150, webcrypto), /signature/i);
});

test('Node V5 keyring store persists and reopens a verified rotation', async () => {
  const old = await keyPair();
  const next = await keyPair();
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-keyring-'));
  const path = join(directory, 'authority.keys.v5');
  try {
    const store = DurableAuthorityKeyringStoreV5.open(path, { version: 1, sequence: 0, keys: [initialKey(old.publicKey)], rotations: [] });
    const record = await signKnowledgeKeyRotationWithEd25519({
      version: 1, kind: 'key-rotation', issuer: 'root', issuerKeyId: 'root-old', principal: 'root', previousKeyId: 'root-old', keyId: 'root-2027', algorithm: 'Ed25519', publicKey: next.publicKey, notBefore: 100, issuedAt: 100, expiresAt: 500,
    }, old.pair.privateKey, webcrypto);
    const beforeFailure = store.snapshot();
    const persist = store.persist;
    store.persist = () => { throw new Error('simulated persistence failure'); };
    await assert.rejects(() => store.appendRotationAsync(record, {
      now: 150,
      resolveKey: (principal, algorithm, keyId) => store.snapshot().keys.find((key) => key.principal === principal && key.algorithm === algorithm && key.keyId === keyId)?.publicKey,
      verifySignature: async (algorithm, key, message, signature) => {
        const publicKey = await webcrypto.subtle.importKey('raw', key, { name: algorithm }, false, ['verify']);
        return webcrypto.subtle.verify({ name: algorithm }, publicKey, signature, message);
      },
    }), /simulated persistence failure/);
    store.persist = persist;
    assert.deepEqual(store.snapshot(), beforeFailure);
    const committed = await store.appendRotationAsync(record, {
      now: 150,
      resolveKey: (principal, algorithm, keyId) => store.snapshot().keys.find((key) => key.principal === principal && key.algorithm === algorithm && key.keyId === keyId)?.publicKey,
      verifySignature: async (algorithm, key, message, signature) => {
        const publicKey = await webcrypto.subtle.importKey('raw', key, { name: algorithm }, false, ['verify']);
        return webcrypto.subtle.verify({ name: algorithm }, publicKey, signature, message);
      },
    });
    assert.equal(committed.sequence, 1);
    const persisted = readFileSync(path);
    store.close();
    const reopened = DurableAuthorityKeyringStoreV5.open(path);
    assert.equal(reopened.root, authorityKeyringRootV1(committed));
    assert.deepEqual([...persisted], [...readFileSync(path)]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Node V5 keyring store fails closed on corruption and releases its lock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-keyring-corrupt-'));
  const path = join(directory, 'authority.keys.v5');
  try {
    const store = DurableAuthorityKeyringStoreV5.open(path, { version: 1, sequence: 0, keys: [], rotations: [] });
    store.close();
    const corrupted = new Uint8Array(readFileSync(path));
    corrupted[corrupted.length - 1] ^= 1;
    writeFileSync(path, corrupted);
    assert.throws(() => DurableAuthorityKeyringStoreV5.open(path), /canonical|CBOR|keyring/i);
    assert.equal(readdirSync(directory).includes('authority.keys.v5.lock'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
