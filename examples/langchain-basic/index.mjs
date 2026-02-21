import { buildPack, mountPack } from '@knolo/core';
import { KnoLoRetriever } from '@knolo/langchain';

const bytes = await buildPack([
  { id: 'intro', namespace: 'docs', text: 'KnoLo is a local-first retrieval engine for LLM applications.' },
  { id: 'adapter', namespace: 'docs', text: 'The LangChain adapter exposes KnoLoRetriever for document retrieval.' }
]);
const pack = await mountPack({ src: bytes });
const retriever = new KnoLoRetriever({ pack, topK: 2 });

const docs = await retriever.getRelevantDocuments('What adapter does KnoLo expose for LangChain?');
console.log('Retrieved docs:');
for (const doc of docs) {
  console.log('-', doc.pageContent, doc.metadata);
}
