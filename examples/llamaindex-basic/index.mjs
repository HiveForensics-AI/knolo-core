import { buildPack, mountPack } from '@knolo/core';
import { KnoLoRetriever } from '@knolo/llamaindex';

const bytes = await buildPack([
  { id: 'intro', namespace: 'docs', text: 'KnoLo retrieval can be adapted for LlamaIndex style pipelines.' },
  { id: 'node', namespace: 'docs', text: 'The retriever returns node and score objects.' }
]);
const pack = await mountPack({ src: bytes });
const retriever = new KnoLoRetriever({ pack, topK: 2 });

const nodes = await retriever.retrieve('How does KnoLo integrate with LlamaIndex-style integration?');
console.log('Retrieved nodes:');
for (const nodeWithScore of nodes) {
  console.log('-', nodeWithScore.node.text, nodeWithScore);
}
