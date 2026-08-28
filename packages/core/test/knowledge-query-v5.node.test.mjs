import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createKnowledgeImageV5, createKnowledgeQueryHistoryV5, createKnowledgeQueryIndexV5, queryKnowledgeImageV5 } from '../dist/index.js';
import { DurableKnowledgeQueryHistoryStoreV5, DurableKnowledgeQueryIndexStoreV5 } from '../dist/node.js';

function temp(name) { const directory = mkdtempSync(join(tmpdir(), `knolo-v5-${name}-`)); return { directory, path: join(directory, `${name}.v5`) }; }

test('Node V5 query stores atomically persist, reopen, and refresh root-bound state', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'source', bytes: new TextEncoder().encode('one'), meta: { n: 1 } }] });
  const nextImage = createKnowledgeImageV5({ baseImage: image, objects: [{ kind: 'source', bytes: new TextEncoder().encode('two'), meta: { n: 2 } }] });
  const indexFile = temp('index');
  const historyFile = temp('history');
  try {
    const indexStore = DurableKnowledgeQueryIndexStoreV5.open(indexFile.path, image);
    const historyStore = DurableKnowledgeQueryHistoryStoreV5.open(historyFile.path, createKnowledgeQueryHistoryV5());
    const result = queryKnowledgeImageV5(image, 'FROM source LIMIT 10', indexStore.snapshot());
    historyStore.append(result, 1);
    const root = indexStore.refresh(nextImage).indexRoot;
    indexStore.close();
    historyStore.close();
    const reopenedIndex = DurableKnowledgeQueryIndexStoreV5.open(indexFile.path, nextImage);
    const reopenedHistory = DurableKnowledgeQueryHistoryStoreV5.open(historyFile.path);
    assert.equal(reopenedIndex.indexRoot, root);
    assert.equal(reopenedHistory.snapshot().entries.length, 1);
    reopenedIndex.close();
    reopenedHistory.close();
    assert.equal(readdirSync(indexFile.directory).some((entry) => entry.endsWith('.tmp')), false);
    assert.equal(readdirSync(historyFile.directory).some((entry) => entry.endsWith('.tmp')), false);
  } finally {
    rmSync(indexFile.directory, { recursive: true, force: true });
    rmSync(historyFile.directory, { recursive: true, force: true });
  }
});

test('Node V5 query stores reject corruption and preserve lock safety', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'source', bytes: new TextEncoder().encode('one'), meta: {} }] });
  const files = [temp('index-corrupt'), temp('history-corrupt')];
  try {
    const index = DurableKnowledgeQueryIndexStoreV5.open(files[0].path, image, createKnowledgeQueryIndexV5(image));
    index.close();
    const history = DurableKnowledgeQueryHistoryStoreV5.open(files[1].path, createKnowledgeQueryHistoryV5());
    history.close();
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(file.path));
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(file.path, bytes);
    }
    assert.throws(() => DurableKnowledgeQueryIndexStoreV5.open(files[0].path, image), /CBOR|root|index|Malformed/i);
    assert.throws(() => DurableKnowledgeQueryHistoryStoreV5.open(files[1].path), /CBOR|root|history|Malformed/i);
    assert.equal(readdirSync(files[0].directory).includes('index-corrupt.v5.lock'), false);
    assert.equal(readdirSync(files[1].directory).includes('history-corrupt.v5.lock'), false);
  } finally { for (const file of files) rmSync(file.directory, { recursive: true, force: true }); }
});
