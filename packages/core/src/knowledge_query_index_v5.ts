import {
  mountKnowledgeImageV5,
  type KnowledgeImageV5,
} from './knowledge_image_v5.js';
import {
  candidateObjectIdsForKnowledgeQueryIndexV1,
  createKnowledgeQueryIndexV5 as createKnowledgeQueryIndexFromImage,
  deserializeKnowledgeQueryIndexV1,
  queryIndexFromKnowledgeImageV5 as queryIndexFromMountedImage,
  serializeCompressedKnowledgeQueryIndexV1,
  serializeKnowledgeQueryIndexV1,
  verifyKnowledgeQueryIndexV5 as verifyMountedKnowledgeQueryIndexV5,
  type KnowledgeQueryIndexV1,
} from './knowledge_query_index_logic.js';

export type { KnowledgeQueryIndexV1 };
export {
  candidateObjectIdsForKnowledgeQueryIndexV1,
  deserializeKnowledgeQueryIndexV1,
  serializeCompressedKnowledgeQueryIndexV1,
  serializeKnowledgeQueryIndexV1,
};

export function createKnowledgeQueryIndexV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array
): KnowledgeQueryIndexV1 {
  return createKnowledgeQueryIndexFromImage(asImage(input));
}

export function verifyKnowledgeQueryIndexV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  index: KnowledgeQueryIndexV1
): void {
  verifyMountedKnowledgeQueryIndexV5(asImage(input), index);
}

export function queryIndexFromKnowledgeImageV5(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array
): KnowledgeQueryIndexV1 | undefined {
  return queryIndexFromMountedImage(asImage(input));
}

function asImage(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array
): KnowledgeImageV5 {
  return isImage(input) ? input : mountKnowledgeImageV5(input);
}

function isImage(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array
): input is KnowledgeImageV5 {
  return (
    typeof input === 'object' &&
    input !== null &&
    'stateRoot' in input &&
    'objects' in input
  );
}
