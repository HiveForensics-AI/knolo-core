import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, mountPack } from '@knolo/core';
import { KnoLoRetriever } from '../src/index.js';

test('KnoLoRetriever returns LlamaIndex-style nodes', async () => {
  const bytes = await buildPack([
    { id: 'doc-2', namespace: 'guides', text: 'LlamaIndex can consume retrieval nodes and scores.' },
  ]);
  const pack = await mountPack({ src: bytes });
  const retriever = new KnoLoRetriever({ pack, topK: 3 });

  const results = await retriever.retrieve('retrieval nodes');

  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.equal(typeof results[0].node.text, 'string');
  assert.equal(typeof results[0].score, 'number');
  assert.equal(typeof results[0].node.metadata.score, 'number');
  assert.equal(results[0].node.metadata.source, 'doc-2');
  assert.equal(results[0].node.metadata.namespace, 'guides');
  assert.equal(typeof results[0].node.metadata.id, 'number');
});
