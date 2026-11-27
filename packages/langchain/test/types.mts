import {
  buildPack,
  createKnowledgeImageV5,
  mountPack,
  type KnowledgeQueryHitV1,
  type KnowledgeQueryResultV1,
} from '@knolo/core';
import {
  Document,
  KnoLoRetriever,
  type KnoLoDocumentMetadata,
} from '@knolo/langchain';

const bytes = await buildPack([
  { id: 'policy', namespace: 'docs', text: 'Annual refunds are available.' },
]);
const pack = await mountPack({ src: bytes });
const image = createKnowledgeImageV5({
  objects: [
    {
      kind: 'chunk',
      bytes: new TextEncoder().encode('Annual refunds are available.'),
      meta: {},
    },
  ],
});

const retrievers: KnoLoRetriever[] = [
  new KnoLoRetriever(),
  new KnoLoRetriever({ pack, topK: 2 }),
  new KnoLoRetriever({ packPath: './policy.knolo' }),
  new KnoLoRetriever({ image, topK: 2 }),
  new KnoLoRetriever({ imagePath: './policy.v5' }),
];

const documents: Document<KnoLoDocumentMetadata>[] =
  await retrievers[1].getRelevantDocuments('refunds');
for (const { pageContent, metadata } of documents) {
  pageContent satisfies string;
  metadata.score satisfies number;
  metadata.source satisfies string | null;
  metadata.namespace satisfies string | null;
  if (metadata.compatibility === 'knowledge-image-v5') {
    metadata.id satisfies KnowledgeQueryHitV1['objectId'];
    metadata.kind satisfies KnowledgeQueryHitV1['kind'];
    metadata.v5Query satisfies Pick<
      KnowledgeQueryResultV1,
      'version' | 'stateRoot' | 'planRoot' | 'resultRoot'
    >;
  } else {
    metadata.id satisfies number;
  }
}

const custom = new Document({
  pageContent: 'A custom document.',
  metadata: { sourceUri: 'file:///policy.md' },
});
custom.metadata.sourceUri satisfies string;
new Document({
  pageContent: 'A document without metadata.',
}) satisfies Document;

// @ts-expect-error Query text must be a string.
retrievers[1].getRelevantDocuments(42);
// @ts-expect-error topK must be a number.
new KnoLoRetriever({ pack, topK: '2' });
// @ts-expect-error A V5 image is not a legacy Pack.
new KnoLoRetriever({ pack: image });
