import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, mountPack } from '@knolo/core';
import { KnoLoRetriever } from '../src/index.js';

test('KnoLoRetriever returns LangChain-style document metadata', async () => {
  const bytes = await buildPack([
    { id: 'doc-1', namespace: 'docs', text: 'KnoLo adapters integrate with LangChain retrievers.' },
  ]);
  const pack = await mountPack({ src: bytes });
  const retriever = new KnoLoRetriever({ pack, topK: 2 });

  const docs = await retriever.getRelevantDocuments('LangChain retriever');

  assert.ok(Array.isArray(docs));
  assert.ok(docs.length > 0);
  assert.equal(typeof docs[0].pageContent, 'string');
  assert.equal(typeof docs[0].metadata.score, 'number');
  assert.equal(docs[0].metadata.source, 'doc-1');
  assert.equal(docs[0].metadata.namespace, 'docs');
  assert.equal(typeof docs[0].metadata.id, 'number');
});
