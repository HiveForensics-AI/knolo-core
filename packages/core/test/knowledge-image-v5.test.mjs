import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildPack,
  canonicalCbor,
  createKnowledgeImageV5,
  digestDomain,
  inspectKnowledgeImageV5,
  migrateV4ToV5,
  mountKnowledgeImageV5,
  verifyKnowledgeImageV5,
} from '../dist/index.js';

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function sharedFixture() {
  return Uint8Array.from(Buffer.from(readFileSync('../../conformance/v5/knowledge-image-v5.fixture.base64', 'utf8').trim(), 'base64'));
}

function legacyMigrationFixture() {
  return Uint8Array.from(Buffer.from(readFileSync('../../conformance/packs/legacy-v3-migration.fixture.base64', 'utf8').trim(), 'base64'));
}

test('shared V5 binary fixture verifies against the published roots', () => {
  const result = verifyKnowledgeImageV5(sharedFixture());
  assert.equal(result.stateRoot, 'sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694');
  assert.equal(result.commitDigest, 'sha256-7a6ed0a7e488ee085053d6d8d885141e0a8b6abd5c40bd552e4d2b10b721b177');
  assert.equal(result.segments.length, 3);
});

test('legacy migration matches the shared cross-runtime V5 image', async () => {
  const migration = await migrateV4ToV5(legacyMigrationFixture());
  const expected = Uint8Array.from(Buffer.from(readFileSync('../../conformance/v5/migrated-legacy-v3.fixture.base64', 'utf8').trim(), 'base64'));
  assert.deepEqual([...migration.image], [...expected]);
  assert.equal(migration.receipt.stateRoot, 'sha256-e49edad45514b6ca08f2d350a094ff7750bfc7b833ac8b2ed17ddf7cafd3037c');
});

test('V4 claims and agents migrate as traceable JSON objects', async () => {
  const source = Uint8Array.from(Buffer.from(readFileSync('../../conformance/packs/v4-claims-agents-migration.fixture.base64', 'utf8').trim(), 'base64'));
  const migration = await migrateV4ToV5(source);
  const image = mountKnowledgeImageV5(migration.image);
  assert.deepEqual(image.objects.map((object) => object.kind).sort(), ['agents', 'chunk', 'chunk', 'claims', 'metadata', 'source', 'source']);
  assert.equal(migration.receipt.stateRoot, 'sha256-fbd098cf220b414a1dea60fe237da2bfbe4728831db6bd6f43b3c8125987d059');
});

test('V5 canonical CBOR and state roots are deterministic', () => {
  const value = canonicalCbor({ b: 'x', a: 1 });
  assert.equal(hex(value), 'a261610161626178');

  const first = createKnowledgeImageV5({
    actor: 'fixture',
    objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: { version: 1 } }],
  });
  const second = createKnowledgeImageV5({
    actor: 'fixture',
    objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: { version: 1 } }],
  });
  assert.deepEqual([...first.bytes], [...second.bytes]);
  assert.equal(first.stateRoot, 'sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694');
  assert.equal(first.commitDigest, 'sha256-7a6ed0a7e488ee085053d6d8d885141e0a8b6abd5c40bd552e4d2b10b721b177');
  assert.deepEqual(verifyKnowledgeImageV5(first.bytes), inspectKnowledgeImageV5(first.bytes));
  assert.equal(mountKnowledgeImageV5(first.bytes).objects.length, 1);
  assert.equal(digestDomain('test', new TextEncoder().encode('x')), 'sha256-f2ef6e7155fb1d7440d3119fbbb0d9956b62e857332323ccaa1986763d079147');
});

test('V5 verifier fails closed on truncation, digest tampering, and missing superblocks', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: { version: 1 } }] });
  assert.throws(() => verifyKnowledgeImageV5(image.bytes.slice(0, -1)), /truncated|segment|superblock/i);

  const tampered = image.bytes.slice();
  tampered[400] ^= 0x01;
  assert.throws(() => verifyKnowledgeImageV5(tampered), /digest|root|CBOR/i);

  const noSuperblock = image.bytes.slice();
  noSuperblock.fill(0, 16, 16 + 128 * 2);
  assert.throws(() => verifyKnowledgeImageV5(noSuperblock), /superblock/i);
});

test('V5 verifier accepts unknown optional segments without changing the state root', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: { version: 1 } }] });
  const payload = new TextEncoder().encode('future');
  const optional = new Uint8Array(48 + payload.length);
  optional.set(new TextEncoder().encode('KSEG'), 0);
  const optionalView = new DataView(optional.buffer);
  optionalView.setUint8(4, 128);
  optionalView.setUint8(5, 1);
  optionalView.setBigUint64(8, BigInt(payload.length), true);
  optional.set(Buffer.from(digestDomain('segment', payload).slice(7), 'hex'), 16);
  optional.set(payload, 48);
  const extended = new Uint8Array(image.bytes.length + optional.length);
  extended.set(image.bytes);
  extended.set(optional, image.bytes.length);
  const result = verifyKnowledgeImageV5(extended);
  assert.equal(result.stateRoot, image.stateRoot);
  assert.equal(result.segments.at(-1)?.kind, 128);
});

test('V5 mount falls back to the last valid root after a torn newer superblock', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: { version: 1 } }] });
  const fallback = image.bytes.slice();
  const newer = fallback.slice(16, 144);
  const newerView = new DataView(newer.buffer);
  newerView.setBigUint64(8, 2n, true);
  newerView.setBigUint64(16, 0n, true);
  newer.set(digestDomain('superblock', newer.slice(0, 96)).slice(7).match(/../g).map((value) => Number.parseInt(value, 16)), 96);
  fallback.set(newer, 144);
  const result = inspectKnowledgeImageV5(fallback);
  assert.equal(result.activeSuperblock, 'A');
  assert.equal(result.stateRoot, image.stateRoot);
});

test('V4 migration is deterministic and preserves block evidence mappings', async () => {
  const v4 = await buildPack([
    { id: 'policy-a', heading: 'Retention', namespace: 'compliance', text: 'Retain records for seven years.' },
    { id: 'policy-b', namespace: 'compliance', text: 'Delete expired records securely.' },
  ]);
  const first = await migrateV4ToV5(v4);
  const second = await migrateV4ToV5(v4);
  assert.deepEqual([...first.image], [...second.image]);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(first.receipt.objectMappings.length, 2);
  assert.equal(first.receipt.sourceVersion, 4);
  assert.equal(first.receipt.sourceDigest, `sha256-${hex(await import('node:crypto').then(({ createHash }) => createHash('sha256').update(v4).digest()))}`);
  assert.equal(first.receipt.stateRoot, inspectKnowledgeImageV5(first.image).stateRoot);
  for (const mapping of first.receipt.objectMappings) {
    assert.match(mapping.sourceObject, /^sha256-[0-9a-f]{64}$/);
    assert.match(mapping.chunkObject, /^sha256-[0-9a-f]{64}$/);
  }

  const corrupted = v4.slice();
  corrupted[corrupted.length - 1] ^= 0x01;
  await assert.rejects(migrateV4ToV5(corrupted), /digest|corrupt|mismatch/i);
});
