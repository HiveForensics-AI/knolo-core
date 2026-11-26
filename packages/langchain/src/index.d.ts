import type {
  Hit,
  KnowledgeImageV5,
  KnowledgeQueryHitV1,
  KnowledgeQueryResultV1,
  Pack,
} from '@knolo/core';

export type KnoLoDocumentMetadata =
  | {
      id: Hit['blockId'];
      score: number;
      source: string | null;
      namespace: string | null;
      compatibility?: never;
    }
  | {
      id: KnowledgeQueryHitV1['objectId'];
      kind: KnowledgeQueryHitV1['kind'];
      score: 1;
      source: null;
      namespace: null;
      compatibility: 'knowledge-image-v5';
      v5Query: Pick<
        KnowledgeQueryResultV1,
        'version' | 'stateRoot' | 'planRoot' | 'resultRoot'
      >;
    };

export declare class Document<Metadata extends object = object> {
  constructor(fields: { pageContent: string; metadata?: Metadata });
  pageContent: string;
  metadata: Metadata;
}

export type KnoLoRetrieverOptions = {
  packPath?: string;
  pack?: Pack;
  imagePath?: string;
  image?: KnowledgeImageV5;
  topK?: number;
};

export declare class KnoLoRetriever {
  constructor(options?: KnoLoRetrieverOptions);
  packPath: string | undefined;
  pack: Pack | undefined;
  imagePath: string | undefined;
  image: KnowledgeImageV5 | undefined;
  topK: number;
  getRelevantDocuments(
    queryText: string
  ): Promise<Document<KnoLoDocumentMetadata>[]>;
}
