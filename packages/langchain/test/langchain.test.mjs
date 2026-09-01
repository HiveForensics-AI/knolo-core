import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, createKnowledgeImageV5, mountPack } from '@knolo/core';
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

test('KnoLoRetriever exposes V5 query roots in adapted document metadata', async () => {
  const image = createKnowledgeImageV5({
    objects: [
      {
        kind: 'chunk',
        bytes: new TextEncoder().encode('V5 adapter evidence'),
        meta: {},
      },
    ],
  });
  const retriever = new KnoLoRetriever({ image, topK: 2 });
  const docs = await retriever.getRelevantDocuments('adapter evidence');

  assert.equal(docs.length, 1);
  assert.equal(docs[0].metadata.compatibility, 'knowledge-image-v5');
  assert.equal(docs[0].metadata.v5Query.stateRoot, image.stateRoot);
  assert.match(docs[0].metadata.v5Query.planRoot, /^sha256-[0-9a-f]{64}$/);
  assert.match(docs[0].metadata.v5Query.resultRoot, /^sha256-[0-9a-f]{64}$/);
});
