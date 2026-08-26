import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  digestDomain,
  inspectKnowledgeImageV5,
  planKnowledgeSyncMergeV5,
} from '../dist/index.js';
import { DurableKnowledgeImageStoreV5 } from '../dist/node.js';

function temporaryStorePath() {
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-store-'));
  return { directory, path: join(directory, 'knowledge.v5') };
}

test('Node durable V5 store persists commits and reopens the verified image', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const initial = createKnowledgeImageV5({
      objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: { version: 1 } }],
    });
    const store = DurableKnowledgeImageStoreV5.open(path, initial);
    const tx = store.beginTransaction({ actor: 'disk-writer' });
    tx.addObject({ kind: 'source', bytes: new TextEncoder().encode('alpha'), meta: {} });
    const committed = tx.commit();

    assert.deepEqual([...readFileSync(path)], [...committed.bytes]);
    assert.throws(() => DurableKnowledgeImageStoreV5.open(path), /locked/i);

    store.close();
    const reopened = DurableKnowledgeImageStoreV5.open(path);
    assert.equal(reopened.stateRoot, committed.stateRoot);
    assert.deepEqual([...reopened.snapshot().bytes], [...committed.bytes]);
    reopened.close();
    assert.equal(readdirSync(directory).some((entry) => entry.endsWith('.tmp')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Node durable V5 store rejects corruption and removes its lock', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const store = DurableKnowledgeImageStoreV5.open(path, createKnowledgeImageV5({
      objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: {} }],
    }));
    store.close();

    const corrupted = new Uint8Array(readFileSync(path));
    corrupted[corrupted.length - 1] ^= 0x01;
    writeFileSync(path, corrupted);
    assert.throws(() => DurableKnowledgeImageStoreV5.open(path), /digest|root|CBOR|segment/i);
    assert.equal(readdirSync(directory).includes('knowledge.v5.lock'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Node durable V5 store recovers from a torn newer superblock', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const image = createKnowledgeImageV5({
      objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: {} }],
    });
    const store = DurableKnowledgeImageStoreV5.open(path, image);
    store.close();

    const torn = new Uint8Array(readFileSync(path));
    const newer = torn.slice(16, 144);
    const newerView = new DataView(newer.buffer);
    newerView.setBigUint64(8, 2n, true);
    newerView.setBigUint64(16, 0n, true);
    newer.set(Buffer.from(digestDomain('superblock', newer.slice(0, 96)).slice(7), 'hex'), 96);
    torn.set(newer, 144);
    writeFileSync(path, torn);

    const recovered = DurableKnowledgeImageStoreV5.open(path);
    assert.equal(inspectKnowledgeImageV5(recovered.snapshot().bytes).activeSuperblock, 'A');
    assert.equal(recovered.stateRoot, image.stateRoot);
    recovered.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Node durable V5 store atomically adopts only a verified fast-forward', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const base = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
    const remote = createKnowledgeImageV5({ baseImage: base, actor: 'remote', objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('next'), meta: {} }] });
    const branch = createKnowledgeImageV5({ baseImage: base, actor: 'branch', objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('other'), meta: {} }] });
    const store = DurableKnowledgeImageStoreV5.open(path, base);
    const adopted = store.fastForward(remote, 'sha256-' + 'a'.repeat(64), 'sha256-' + 'a'.repeat(64));
    assert.equal(adopted.commitDigest, remote.commitDigest);
    const persisted = new Uint8Array(readFileSync(path));
    assert.deepEqual([...persisted], [...remote.bytes]);
    assert.throws(() => store.fastForward(branch), /direct remote-ahead|diverged/i);
    assert.deepEqual([...readFileSync(path)], [...persisted]);
    store.close();
    const reopened = DurableKnowledgeImageStoreV5.open(path);
    assert.equal(reopened.stateRoot, remote.stateRoot);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Node durable V5 store atomically persists an authorized two-parent merge', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const base = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
    const local = createKnowledgeImageV5({ baseImage: base, actor: 'local', objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('local'), meta: {} }] });
    const remote = createKnowledgeImageV5({ baseImage: base, actor: 'remote', objects: [{ kind: 'chunk', bytes: new TextEncoder().encode('remote'), meta: {} }] });
    const keyringRoot = 'sha256-' + 'a'.repeat(64);
    const plan = planKnowledgeSyncMergeV5(local, remote, base, keyringRoot, keyringRoot, keyringRoot);
    const resolution = { decisions: plan.conflicts.map((conflict) => ({ kind: conflict.kind, key: conflict.key, choice: 'local' })) };
    const store = DurableKnowledgeImageStoreV5.open(path, local);
    const before = new Uint8Array(readFileSync(path));
    assert.throws(() => store.merge(remote, base, { plan, resolution, authorize: () => false }, keyringRoot, keyringRoot, keyringRoot), /authorization/i);
    assert.deepEqual([...readFileSync(path)], [...before]);
    const merged = store.merge(remote, base, { plan, resolution, authorize: () => true }, keyringRoot, keyringRoot, keyringRoot);
    assert.deepEqual(merged.commit.parents, [local.commitDigest, remote.commitDigest]);
    assert.deepEqual([...readFileSync(path)], [...merged.bytes]);
    store.close();
    const reopened = DurableKnowledgeImageStoreV5.open(path);
    assert.equal(reopened.stateRoot, merged.stateRoot);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
