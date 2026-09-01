import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import {
  DurableKnowledgeImageStoreV5,
  DurableKnowledgeWriterLeaseV5,
  recoverStaleWriterLeaseV5,
} from '../dist/node.js';

function temporaryStorePath() {
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-coordination-'));
  return { directory, path: join(directory, 'knowledge.v5') };
}

function initialImage() {
  return createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('coordination base'),
        meta: {},
      },
    ],
  });
}

test('V5 durable writer leases exclude live writers and require explicit stale recovery', () => {
  const { directory, path } = temporaryStorePath();
  let now = 100;
  try {
    const first = DurableKnowledgeImageStoreV5.open(path, initialImage(), {
      lease: {
        ownerId: 'writer-a',
        token: 'lease-a',
        ttlMs: 20,
        now: () => now,
      },
    });
    assert.equal(first.snapshot().stateRoot, first.stateRoot);
    assert.throws(
      () =>
        DurableKnowledgeImageStoreV5.open(path, undefined, {
          lease: {
            ownerId: 'writer-b',
            token: 'lease-b',
            ttlMs: 20,
            now: () => now,
          },
        }),
      /already held/i
    );

    now = 105;
    const renewed = DurableKnowledgeWriterLeaseV5.acquire(
      join(directory, 'independent.lease'),
      {
        ownerId: 'renew-owner',
        token: 'renew-token',
        ttlMs: 10,
        now: () => now,
      }
    );
    now = 110;
    assert.equal(renewed.renew().expiresAt, 120);
    now = 121;
    assert.throws(() => renewed.assertActive(), /expired/i);
    assert.equal(
      recoverStaleWriterLeaseV5(renewed.leasePath, () => now),
      true
    );

    assert.throws(
      () =>
        DurableKnowledgeImageStoreV5.open(path, undefined, {
          lease: {
            ownerId: 'writer-b',
            token: 'lease-b',
            ttlMs: 20,
            now: () => now,
          },
        }),
      /expired.*explicit recovery/i
    );
    now = 121;
    const recovered = DurableKnowledgeImageStoreV5.open(path, undefined, {
      lease: {
        ownerId: 'writer-b',
        token: 'lease-b',
        ttlMs: 20,
        now: () => now,
        recoverStale: true,
      },
    });
    assert.throws(() => first.snapshot(), /ownership was lost|expired/i);
    recovered.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('V5 atomic durable commits leave the previous image usable after a crashed temp write', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const base = initialImage();
    const store = DurableKnowledgeImageStoreV5.open(path, base);
    const before = store.snapshot();
    const tx = store.beginTransaction({ actor: 'atomic-writer' });
    tx.addObject({
      kind: 'source',
      bytes: new TextEncoder().encode('committed'),
      meta: {},
    });
    const committed = tx.commit();
    store.close();

    // A process dying after writing a temp image but before rename must not
    // make the next open select that uncommitted byte sequence.
    const crashedTemp = `${path}.crashed-writer.tmp`;
    writeFileSync(crashedTemp, new Uint8Array([0, 1, 2, 3]));
    const reopened = DurableKnowledgeImageStoreV5.open(path);
    assert.equal(reopened.stateRoot, committed.stateRoot);
    assert.notEqual(reopened.stateRoot, before.stateRoot);
    assert.deepEqual([...readFileSync(path)], [...committed.bytes]);
    reopened.close();
    rmSync(crashedTemp, { force: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('V5 durable snapshots remain detached while a writer commits the next image', () => {
  const { directory, path } = temporaryStorePath();
  try {
    const store = DurableKnowledgeImageStoreV5.open(path, initialImage());
    const readerSnapshot = store.snapshot();
    const tx = store.beginTransaction({ actor: 'reader-writer' });
    tx.addObject({
      kind: 'chunk',
      bytes: new TextEncoder().encode('next'),
      meta: {},
    });
    const committed = tx.commit();
    assert.notEqual(readerSnapshot.stateRoot, committed.stateRoot);
    assert.equal(store.snapshot().stateRoot, committed.stateRoot);
    assert.equal(readerSnapshot.objects.length, 1);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
