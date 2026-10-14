import { digest } from '../experimental/kar/canonicalize.js';
import { isKnowledgeImageV5, mountKnowledgeImageV5, type KnowledgeImageV5, type KnowledgeObjectV1 } from '../knowledge_image_v5.js';
import { queryKnowledgeImageV5 } from '../knowledge_query_v5.js';
import { mountPackFromBuffer, type Pack } from '../pack.runtime.js';
import { packDigest, queryWithReceipt } from '../receipt.js';
import { normalize } from '../tokenize.js';
import { sha256Hex } from '../utils/sha256.js';
import { getTextDecoder, getTextEncoder } from '../utils/utf8.js';
import { CortexError } from './errors.js';
import { CORTEX_LIMITS } from './policy.js';
import type { CortexImageIdentity, CortexPolicyV1, CortexQueryReceiptV1 } from './types.js';

export type RetrievedHit = {
  id: string;
  score: number;
  source?: string;
  excerpt: string;
  sourceDigest: string;
};

export type CortexRetriever = (input: { query: string; limit: number }) => CortexRetrieverResult | Promise<CortexRetrieverResult>;

export type CortexRetrieverResult = {
  hits: Array<{ id: string; score?: number }>;
};

export type CortexMounted = {
  image: CortexImageIdentity;
  bytes: Uint8Array;
  pack?: Pack;
  v5?: KnowledgeImageV5;
  ids: ReadonlySet<string>;
  byId: ReadonlyMap<string, RetrievedHit>;
};

export function mountCortexImage(input: Uint8Array | ArrayBuffer): CortexMounted {
  const bytes = copyBytes(input);
  try {
    if (isKnowledgeImageV5(bytes)) return mountV5(bytes);
    return mountV4(bytes);
  } catch (error) {
    if (error instanceof CortexError) throw error;
    throw new CortexError('CORTEX_IMAGE_INVALID', error instanceof Error ? error.message : 'Image could not be mounted.', 'image', error);
  }
}

export function normalizeCortexQuery(query: string): string {
  return normalize(query).replace(/\s+/gu, ' ').trim();
}

export function roundScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(score * 1e6) / 1e6;
}

export async function retrieveHits(
  mounted: CortexMounted,
  policy: CortexPolicyV1,
  query: string,
  retriever: CortexRetriever | undefined,
  queryEmbedding?: Float32Array,
): Promise<{ hits: RetrievedHit[]; receipt: CortexQueryReceiptV1; normalizedQuery: string }> {
  const normalizedQuery = normalizeCortexQuery(query);
  if (!normalizedQuery) {
    throw new CortexError('CORTEX_POLICY_INVALID', 'Retrieval query is empty.', 'query');
  }
  if (retriever) return retrieveHost(mounted, policy, query, normalizedQuery, retriever);
  if (mounted.v5) return retrieveV5(mounted.v5, policy, query, normalizedQuery);
  if (!mounted.pack) throw new CortexError('CORTEX_IMAGE_INVALID', 'No pack is mounted.', 'image');
  return retrieveV4(mounted.pack, policy, query, normalizedQuery, queryEmbedding);
}

function mountV4(bytes: Uint8Array): CortexMounted {
  const pack = mountPackFromBuffer(asArrayBuffer(bytes));
  const byId = new Map<string, RetrievedHit>();
  for (let blockId = 0; blockId < pack.blocks.length; blockId++) {
    const hit = hitFromBlock(pack, blockId, 0);
    byId.set(hit.id, hit);
  }
  return {
    image: { kind: 'v4-pack', stateRoot: packDigest(pack) },
    bytes,
    pack,
    ids: new Set(byId.keys()),
    byId,
  };
}

function mountV5(bytes: Uint8Array): CortexMounted {
  const image = mountKnowledgeImageV5(bytes);
  const byId = new Map<string, RetrievedHit>();
  for (const object of image.objects) byId.set(object.id, hitFromObject(object, 0));
  return {
    image: { kind: 'v5-image', stateRoot: image.stateRoot, commitDigest: image.commitDigest },
    bytes,
    v5: image,
    ids: new Set(byId.keys()),
    byId,
  };
}

function retrieveV4(
  pack: Pack,
  policy: CortexPolicyV1,
  query: string,
  normalizedQuery: string,
  queryEmbedding?: Float32Array,
): { hits: RetrievedHit[]; receipt: CortexQueryReceiptV1; normalizedQuery: string } {
  if (policy.allowSemanticRerank && queryEmbedding && !pack.semantic) {
    throw new CortexError('CORTEX_POLICY_INVALID', 'Semantic rerank needs vectors already stored on the pack.', 'queryEmbedding');
  }
  const semantic = policy.allowSemanticRerank && queryEmbedding
    ? { enabled: true as const, force: true, queryEmbedding, topN: policy.maxCandidatesPerRound }
    : { enabled: false as const };
  const result = queryWithReceipt(pack, query, {
    topK: policy.maxCandidatesPerRound,
    queryExpansion: { enabled: false },
    semantic,
  });
  const hits = result.hits.slice(0, policy.maxCandidatesPerRound).map((hit) => hitFromBlock(pack, hit.blockId, hit.score));
  const receiptHit = result.receipt;
  return {
    hits,
    normalizedQuery,
    receipt: {
      kind: 'v4-receipt',
      replayHash: receiptHit.replayHash,
      packDigest: receiptHit.packDigest,
      normalizedQuery,
    },
  };
}

function retrieveV5(
  image: KnowledgeImageV5,
  policy: CortexPolicyV1,
  query: string,
  normalizedQuery: string,
): { hits: RetrievedHit[]; receipt: CortexQueryReceiptV1; normalizedQuery: string } {
  const limit = Math.min(policy.maxCandidatesPerRound, 1000);
  const result = queryKnowledgeImageV5(image, `FROM chunk SEARCH "${escapeEql(query)}" LIMIT ${limit}`);
  const hits = result.hits.map((hit, index) => {
    const object = image.objects.find((item) => item.id === hit.objectId);
    if (!object) throw new CortexError('CORTEX_EVIDENCE_UNBOUND', `V5 hit ${hit.objectId} is not in the image.`, hit.objectId);
    return hitFromObject(object, result.hits.length - index);
  });
  return {
    hits,
    normalizedQuery,
    receipt: {
      kind: 'v5-result',
      planRoot: result.planRoot,
      resultRoot: result.resultRoot,
      stateRoot: result.stateRoot,
      normalizedQuery,
    },
  };
}

async function retrieveHost(
  mounted: CortexMounted,
  policy: CortexPolicyV1,
  query: string,
  normalizedQuery: string,
  retriever: CortexRetriever,
): Promise<{ hits: RetrievedHit[]; receipt: CortexQueryReceiptV1; normalizedQuery: string }> {
  const returned = await retriever({ query, limit: policy.maxCandidatesPerRound });
  if (!returned || !Array.isArray(returned.hits)) {
    throw new CortexError('CORTEX_EVIDENCE_UNBOUND', 'Host retriever did not return hits.', 'retriever');
  }
  const hits: RetrievedHit[] = [];
  const seen = new Set<string>();
  for (const hit of returned.hits) {
    if (hits.length >= policy.maxCandidatesPerRound) break;
    if (!hit || typeof hit.id !== 'string' || seen.has(hit.id)) continue;
    const known = mounted.byId.get(hit.id);
    if (!known) throw new CortexError('CORTEX_EVIDENCE_UNBOUND', `Retriever id ${hit.id} is not in the image.`, hit.id);
    seen.add(hit.id);
    hits.push({ ...known, score: roundScore(typeof hit.score === 'number' ? hit.score : 0) });
  }
  const retrieverRoot = digest({
    ids: hits.map((hit) => hit.id),
    normalizedQuery,
    scores: hits.map((hit) => hit.score),
  });
  return {
    hits,
    normalizedQuery,
    receipt: { kind: 'host-retriever', retrieverRoot, normalizedQuery },
  };
}

function hitFromBlock(pack: Pack, blockId: number, score: number): RetrievedHit {
  const text = pack.blocks[blockId] ?? '';
  const source = pack.docIds?.[blockId];
  const hit: RetrievedHit = {
    id: `block:${blockId}`,
    score: roundScore(score),
    excerpt: text.slice(0, CORTEX_LIMITS.excerptChars),
    sourceDigest: `sha256-${sha256Hex(getTextEncoder().encode(`${source ?? ''}\n${text}`))}`,
  };
  if (source) hit.source = source;
  return hit;
}

function hitFromObject(object: KnowledgeObjectV1, score: number): RetrievedHit {
  const text = getTextDecoder().decode(object.bytes);
  const source = typeof object.meta.source === 'string' ? object.meta.source : undefined;
  const hit: RetrievedHit = {
    id: object.id,
    score: roundScore(score),
    excerpt: text.slice(0, CORTEX_LIMITS.excerptChars),
    sourceDigest: `sha256-${sha256Hex(object.bytes)}`,
  };
  if (source) hit.source = source;
  return hit;
}

function escapeEql(query: string): string {
  return query.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function copyBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return new Uint8Array(input);
  return new Uint8Array(input);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}
