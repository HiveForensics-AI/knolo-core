import {
  mountKnowledgeImageV5,
  type KnowledgeImageV5,
  type KnowledgeObjectV1,
} from '../../knowledge_image_v5.js';
import { getTextDecoder } from '../../utils/utf8.js';
import { prepareImage, type PreparedImage } from './graph.js';
import { KarError } from './types.js';

export type KarImageInput = Uint8Array | ArrayBuffer | KnowledgeImageV5;

export type ProjectedKnowledgeImage = PreparedImage & {
  stateRoot: string;
  objectRoot: string;
  commitDigest: string;
  objects: Map<string, { id: string; text: string; source?: string; metadata: Record<string, unknown> }>;
};

function isMounted(value: unknown): value is KnowledgeImageV5 {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) return false;
  const record = value as Partial<KnowledgeImageV5>;
  return typeof record.stateRoot === 'string'
    && typeof record.commitDigest === 'string'
    && record.commit !== undefined
    && Array.isArray(record.objects)
    && record.bytes instanceof Uint8Array;
}

export function imageBytes(image: KarImageInput): Uint8Array {
  if (image instanceof Uint8Array) return image;
  if (image instanceof ArrayBuffer) return new Uint8Array(image);
  if (isMounted(image)) return image.bytes;
  throw new KarError('KAR_IMAGE_REJECTED', 'KAR image input must be V5 bytes or a mounted V5 image.');
}

/** Mount from the supplied bytes. A mounted object is remounted from its bytes. */
export function openKarImage(image: KarImageInput): KnowledgeImageV5 {
  try {
    return mountKnowledgeImageV5(imageBytes(image));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KarError('KAR_IMAGE_REJECTED', message);
  }
}

export function projectKnowledgeImage(image: KnowledgeImageV5): ProjectedKnowledgeImage {
  const decoder = getTextDecoder();
  const objects = new Map<string, { id: string; text: string; source?: string; metadata: Record<string, unknown> }>();
  const evidence = image.objects.map((object) => {
    const text = decoder.decode(object.bytes);
    const source = objectSource(object);
    const row: { id: string; text: string; source?: string; metadata: Record<string, unknown> } = {
      id: object.id,
      text,
      metadata: { kind: object.kind, meta: object.meta },
    };
    if (source !== undefined) row.source = source;
    objects.set(object.id, row);
    return { id: object.id, text };
  });
  const prepared = prepareImage({ version: 1, evidence });
  if (!prepared) throw new KarError('KAR_IMAGE_REJECTED', 'The mounted image did not project to a KAR evidence image.');
  return {
    ...prepared,
    stateRoot: image.stateRoot,
    objectRoot: image.commit.objectRoot,
    commitDigest: image.commitDigest,
    objects,
  };
}

function objectSource(object: KnowledgeObjectV1): string | undefined {
  const source = object.meta.source;
  if (typeof source === 'string' && source.length > 0) return source;
  return object.kind;
}
