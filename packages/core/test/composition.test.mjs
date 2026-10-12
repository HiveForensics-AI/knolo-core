import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPack, createKnowledgeImageV5 } from '../dist/index.js';
import {
  assertCompositionRoot,
  createCompositionAttestation,
  createCompositionRecord,
  openComposedSession,
  queryComposedSession,
  verifyCompositionAttestation,
  verifyCompositionRecord,
  withCompositionSignature,
} from '../dist/composition/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schemaDir = path.join(repo, 'schemas/experimental/composition');

test('composition schemas are closed and name their formats', () => {
  const names = readdirSync(schemaDir).filter((name) => name.endsWith('.schema.json')).sort();
  assert.deepEqual(names, [
    'composition-attestation-v1.schema.json',
    'composition-bundle-v1.schema.json',
    'composition-commerce-v1.schema.json',
    'composition-excerpt-v1.schema.json',
    'composition-record-v1.schema.json',
    'composition-signature-v1.schema.json',
  ]);
  for (const name of names) {
    const schema = JSON.parse(readFileSync(path.join(schemaDir, name), 'utf8'));
    assert.equal(schema.additionalProperties, false, name);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.properties.format.const, /^composition-/);
  }
  const root = readFileSync(path.join(repo, 'packages/core/src/index.ts'), 'utf8');
  assert.equal(root.includes('createCompositionRecord'), false);
  assert.equal(root.includes('composition-record-1'), false);
});

test('composed query keeps each member plan and can require image policy', async () => {
  const policy = { version: 1, default: 'allow' };
  const image = createKnowledgeImageV5({
    actor: 'composition-query',
    sequence: 1,
    policy,
    objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('billing demo sentence'), meta: { source: 'billing.txt' } }],
  });
  const pack = await buildPack([{ id: 'notes', text: 'billing appears in the pack' }]);
  const created = createCompositionRecord({
    availability: 'material',
    members: [
      { alias: 'pack', kind: 'v4-pack', bytes: pack },
      { alias: 'image', kind: 'v5-image', bytes: image.bytes },
    ],
  });
  const session = openComposedSession(created.record, {
    members: { image: { bytes: image.bytes }, pack: { bytes: pack } },
  });
  const result = queryComposedSession(session, { eql: 'FROM chunk SEARCH "billing" LIMIT 5', question: 'billing' });
  assert.deepEqual(result.results.map((row) => row.alias), ['image', 'pack']);
  assert.equal(result.results[0].status, 'queried');
  assert.equal(result.results[1].status, 'queried');
  assert.equal(typeof result.results[0].planRoot, 'string');
  assert.equal(result.results[1].planRoot, undefined);
  const direct = result.results[0].planRoot;
  const again = queryComposedSession(session, { eql: 'FROM chunk SEARCH "billing" LIMIT 5' });
  assert.equal(again.results[0].planRoot, direct);
  const authorized = queryComposedSession(session, {
    eql: 'FROM chunk SEARCH "billing" LIMIT 5',
    requirePolicy: true,
    policy,
    principal: 'local',
  });
  assert.equal(typeof authorized.results[0].authorizationRoot, 'string');
  assert.throws(
    () => queryComposedSession(session, { eql: 'FROM chunk SEARCH "billing" LIMIT 5', requirePolicy: true, principal: 'local' }),
    (error) => error.code === 'COMPOSITION_POLICY_INVALID',
  );
});

test('attestation rejects a stale composition root, an inactive key, and a nested host without its own bytes', async () => {
  const encoder = new TextEncoder();
  const image = createKnowledgeImageV5({
    actor: 'composition-root',
    sequence: 1,
    objects: [{ kind: 'chunk', bytes: encoder.encode('root check'), meta: { source: 'root.txt' } }],
  });
  const other = createKnowledgeImageV5({
    actor: 'composition-other',
    sequence: 1,
    objects: [{ kind: 'chunk', bytes: encoder.encode('other image'), meta: { source: 'other.txt' } }],
  });
  const created = createCompositionRecord({
    availability: 'material',
    members: [{ alias: 'image', kind: 'v5-image', bytes: image.bytes }],
  });
  const stale = { ...created.record, availability: 'digest' };
  assert.throws(
    () => createCompositionAttestation({ record: stale, statement: 'cited', subject: { kind: 'composition', compositionRoot: stale.compositionRoot } }),
    (error) => error.code === 'COMPOSITION_ROOT_MISMATCH',
  );
  assert.equal(assertCompositionRoot(created.record).compositionRoot, created.compositionRoot);
  const cited = createCompositionAttestation({
    record: created.record,
    statement: 'cited',
    subject: { kind: 'composition', compositionRoot: created.compositionRoot },
  });
  const signed = withCompositionSignature(cited.attestation, {
    principal: 'local',
    keyId: 'key-1',
    issuedAt: 10,
    expiresAt: 50,
    signature: new Uint8Array(64),
  });
  const publicKey = new Uint8Array(32);
  const revoked = await verifyCompositionAttestation(signed, {
    now: 20,
    keyring: { version: 1, sequence: 0, rotations: [], keys: [{ version: 1, principal: 'local', keyId: 'key-1', algorithm: 'Ed25519', publicKey, revokedAt: 15 }] },
    verifySignature: () => true,
  });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.code, 'ATTESTATION_KEY_MISMATCH');
  const active = await verifyCompositionAttestation(signed, {
    now: 20,
    keyring: { version: 1, sequence: 0, rotations: [], keys: [{ version: 1, principal: 'local', keyId: 'key-1', algorithm: 'Ed25519', publicKey }] },
    verifySignature: () => true,
  });
  assert.equal(active.ok, true);
  assert.equal(active.signature, 'verified');
  const child = createCompositionRecord({
    availability: 'material',
    host: { kind: 'v5-image', bytes: image.bytes },
    members: [{ alias: 'note', kind: 'v5-image', bytes: other.bytes }],
  });
  const parent = createCompositionRecord({
    availability: 'material',
    members: [{ alias: 'inner', kind: 'composition', record: child.record }],
  });
  const missingHost = verifyCompositionRecord(parent.record, {
    members: { inner: { record: child.record, members: { note: { bytes: other.bytes } } } },
  });
  assert.equal(missingHost.ok, false);
  assert.equal(missingHost.code, 'COMPOSITION_MEMBER_MISSING');
  assert.equal(missingHost.path, 'host');
  const nested = verifyCompositionRecord(parent.record, {
    members: { inner: { record: child.record, hostBytes: image.bytes, members: { note: { bytes: other.bytes } } } },
  });
  assert.equal(nested.ok, true);
});

test('composition conformance stays locked', () => {
  const result = spawnSync(process.execPath, [path.join(repo, 'conformance/composition/v1/run.mjs')], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /composition-conformance-v1 16/);
});
