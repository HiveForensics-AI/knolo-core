export interface EmbeddingProvider {
  readonly modelId: string;
  embedQuery(text: string): Promise<Float32Array>;
  embedTexts(texts: string[]): Promise<Float32Array[]>;
}

export interface SemanticSidecar {
  version: 1;
  packFingerprint: string;
  modelId: string;
  dimension: number;
  metric: 'cosine';
  createdAt: string;
  blocks: Array<{
    blockId: number;
    vector: number[];
  }>;
}

export type SemanticQueryOptions = {
  enabled?: boolean;
  mode?: 'rerank';
  topN?: number;
  minLexConfidence?: number;
  minSemanticScore?: number;
  blend?: {
    enabled?: boolean;
    wLex?: number;
    wSem?: number;
  };
  provider?: {
    type: 'ollama';
    modelId: string;
    endpoint?: string;
  };
  sidecarPath?: string;
  queryEmbedding?: Float32Array;
  force?: boolean;
};

export type RetrievalEvidence = {
  retrieval: 'lexical' | 'hybrid';
  lexicalScore?: number;
  semanticScore?: number;
  blendedScore?: number;
  modelId?: string;
};
