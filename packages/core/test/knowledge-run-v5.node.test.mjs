import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  createKnowledgeRunV1,
} from '../dist/index.js';
import { DurableKnowledgeRunStoreV5 } from '../dist/node.js';

function temporaryRunPath() {
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-run-'));
  return { directory, path: join(directory, 'run.v5') };
}

test('Node durable V5 run store atomically persists and resumes checkpoints', () => {
  const { directory, path } = temporaryRunPath();
  try {
    const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('run image'), meta: {} }] });
    const initial = createKnowledgeRunV1({ agentId: 'agent', imageStateRoot: image.stateRoot, input: { task: 'inspect' }, createdAt: 10 });
    const store = DurableKnowledgeRunStoreV5.open(path, initial);
    store.start(11);
    store.checkpoint({ cursor: 4 }, 12);
    const paused = store.snapshot();
    store.close();

    const reopened = DurableKnowledgeRunStoreV5.open(path);
    assert.equal(reopened.runRoot, paused.runRoot);
    const completed = reopened.resume(13);
    assert.equal(completed.status, 'running');
    reopened.complete({ result: 'ok' }, 14);
    const final = reopened.snapshot();
    assert.equal(final.status, 'completed');
    reopened.close();
    assert.equal(readdirSync(directory).some((entry) => entry.endsWith('.tmp')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Node durable V5 run store rejects corruption and releases its lock', () => {
  const { directory, path } = temporaryRunPath();
  try {
    const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('run image'), meta: {} }] });
    const initial = createKnowledgeRunV1({ agentId: 'agent', imageStateRoot: image.stateRoot, input: { task: 'inspect' }, createdAt: 10 });
    const store = DurableKnowledgeRunStoreV5.open(path, initial);
    store.close();
    const corrupted = new Uint8Array(readFileSync(path));
    corrupted[corrupted.length - 1] ^= 1;
    writeFileSync(path, corrupted);
    assert.throws(() => DurableKnowledgeRunStoreV5.open(path), /CBOR|root|run|Malformed/i);
    assert.equal(readdirSync(directory).includes('run.v5.lock'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
