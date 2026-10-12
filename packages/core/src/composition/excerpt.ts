import {
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
  type KnowledgeObjectV1,
} from '../knowledge_image_v5.js';
import { EXCERPT_DOMAIN, EXCERPT_FORMAT, EXCERPT_MAX_OBJECTS, OBJECT_KINDS } from './constants.js';
import { compareUtf16, exactKeys, isRecord, requireDigest, rooted } from './codec.js';
import { CompositionError } from './errors.js';

export type ExcerptObject = { id: Digest; kind: KnowledgeObjectV1['kind'] };

export type ExcerptRecord = {
  format: typeof EXCERPT_FORMAT;
  version: 1;
  excerptRoot: Digest;
  parent: { stateRoot: Digest; objectRoot: Digest; commitDigest: Digest };
  inclusion: 'included' | 'digest-bound';
  objects: ExcerptObject[];
};

export type ExcerptVerification =
  | { ok: true; excerptRoot: Digest; inclusion: ExcerptRecord['inclusion'] }
  | { ok: false; code: CompositionError['code']; path?: string };

export function createBoundedExcerpt(input: { image: Uint8Array | KnowledgeImageV5; objectIds: string[] }): { excerpt: ExcerptRecord; excerptRoot: Digest } {
  const image = mounted(input.image);
  if (!Array.isArray(input.objectIds) || input.objectIds.length === 0 || input.objectIds.length > EXCERPT_MAX_OBJECTS) {
    throw new CompositionError('EXCERPT_INVALID', `An excerpt contains 1–${EXCERPT_MAX_OBJECTS} objects.`, 'objects');
  }
  const ids = [...input.objectIds];
  if (new Set(ids).size !== ids.length) throw new CompositionError('EXCERPT_INVALID', 'Excerpt object ids must be unique.', 'objects');
  const objects: ExcerptObject[] = ids.map((id) => {
    const object = image.objects.find((item) => item.id === id);
    if (!object || !OBJECT_KINDS.includes(object.kind)) {
      throw new CompositionError('EXCERPT_NOT_INCLUDED', `Object ${id} is not in the parent image.`, id);
    }
    return { id: object.id, kind: object.kind };
  });
  objects.sort((left, right) => compareUtf16(left.id, right.id));
  const excerpt = finish({
    parent: { stateRoot: image.stateRoot, objectRoot: image.commit.objectRoot, commitDigest: image.commitDigest },
    inclusion: 'included',
    objects,
  });
  return { excerpt, excerptRoot: excerpt.excerptRoot };
}

export function verifyBoundedExcerpt(excerpt: unknown, options: { imageBytes?: Uint8Array; image?: KnowledgeImageV5 } = {}): ExcerptVerification {
  try {
    const parsed = parseExcerpt(excerpt);
    if (excerptRootOf(parsed) !== parsed.excerptRoot) {
      return { ok: false, code: 'EXCERPT_INCLUSION_MISMATCH', path: 'excerptRoot' };
    }
    const image = options.image ?? (options.imageBytes ? mountKnowledgeImageV5(options.imageBytes) : undefined);
    if (!image) {
      if (parsed.inclusion === 'included') return { ok: false, code: 'EXCERPT_PARENT_MISSING', path: 'parent' };
      return { ok: true, excerptRoot: parsed.excerptRoot, inclusion: parsed.inclusion };
    }
    if (image.stateRoot !== parsed.parent.stateRoot || image.commit.objectRoot !== parsed.parent.objectRoot || image.commitDigest !== parsed.parent.commitDigest) {
      return { ok: false, code: 'EXCERPT_INCLUSION_MISMATCH', path: 'parent' };
    }
    for (const object of parsed.objects) {
      const found = image.objects.find((item) => item.id === object.id);
      if (!found || found.kind !== object.kind) return { ok: false, code: 'EXCERPT_NOT_INCLUDED', path: object.id };
    }
    if (parsed.inclusion === 'digest-bound') return { ok: false, code: 'EXCERPT_INCLUSION_MISMATCH', path: 'inclusion' };
    return { ok: true, excerptRoot: parsed.excerptRoot, inclusion: 'included' };
  } catch (error) {
    if (error instanceof CompositionError) return { ok: false, code: error.code, ...(error.path ? { path: error.path } : {}) };
    return { ok: false, code: 'EXCERPT_INVALID' };
  }
}

export function parseExcerpt(value: unknown): ExcerptRecord {
  if (!isRecord(value)) throw new CompositionError('EXCERPT_INVALID', 'Excerpt must be an object.');
  exactKeys(value, ['format', 'version', 'excerptRoot', 'parent', 'inclusion', 'objects'], 'excerpt', 'EXCERPT_INVALID');
  if (value.format !== EXCERPT_FORMAT || value.version !== 1) {
    throw new CompositionError('COMPOSITION_UNSUPPORTED', 'Unsupported excerpt format.', 'format');
  }
  if (value.inclusion !== 'included' && value.inclusion !== 'digest-bound') {
    throw new CompositionError('EXCERPT_INVALID', 'inclusion must be included or digest-bound.', 'inclusion');
  }
  if (!isRecord(value.parent)) throw new CompositionError('EXCERPT_INVALID', 'Excerpt parent must be an object.', 'parent');
  exactKeys(value.parent, ['stateRoot', 'objectRoot', 'commitDigest'], 'parent', 'EXCERPT_INVALID');
  if (!Array.isArray(value.objects) || value.objects.length === 0 || value.objects.length > EXCERPT_MAX_OBJECTS) {
    throw new CompositionError('EXCERPT_INVALID', `An excerpt contains 1–${EXCERPT_MAX_OBJECTS} objects.`, 'objects');
  }
  const objects = value.objects.map((entry, index) => parseObject(entry, index));
  const sorted = [...objects].sort((left, right) => compareUtf16(left.id, right.id));
  if (objects.some((object, index) => object.id !== sorted[index].id)) {
    throw new CompositionError('EXCERPT_INVALID', 'Excerpt objects must be sorted by id.', 'objects');
  }
  if (new Set(objects.map((object) => object.id)).size !== objects.length) {
    throw new CompositionError('EXCERPT_INVALID', 'Excerpt object ids must be unique.', 'objects');
  }
  return {
    format: EXCERPT_FORMAT,
    version: 1,
    excerptRoot: requireDigest(value.excerptRoot, 'excerptRoot', 'EXCERPT_INVALID'),
    parent: {
      stateRoot: requireDigest(value.parent.stateRoot, 'parent.stateRoot', 'EXCERPT_INVALID'),
      objectRoot: requireDigest(value.parent.objectRoot, 'parent.objectRoot', 'EXCERPT_INVALID'),
      commitDigest: requireDigest(value.parent.commitDigest, 'parent.commitDigest', 'EXCERPT_INVALID'),
    },
    inclusion: value.inclusion,
    objects,
  };
}

function parseObject(value: unknown, index: number): ExcerptObject {
  if (!isRecord(value)) throw new CompositionError('EXCERPT_INVALID', 'Excerpt object must be an object.', `objects[${index}]`);
  exactKeys(value, ['id', 'kind'], `objects[${index}]`, 'EXCERPT_INVALID');
  if (typeof value.kind !== 'string' || !OBJECT_KINDS.includes(value.kind as ExcerptObject['kind'])) {
    throw new CompositionError('EXCERPT_INVALID', 'Excerpt object kind is invalid.', `objects[${index}].kind`);
  }
  return { id: requireDigest(value.id, `objects[${index}].id`, 'EXCERPT_INVALID'), kind: value.kind as ExcerptObject['kind'] };
}

function finish(parts: Omit<ExcerptRecord, 'format' | 'version' | 'excerptRoot'>): ExcerptRecord {
  const excerptRoot = rooted(EXCERPT_DOMAIN, excerptBody(parts));
  return { format: EXCERPT_FORMAT, version: 1, excerptRoot, ...parts };
}

function excerptRootOf(excerpt: ExcerptRecord): Digest {
  return rooted(EXCERPT_DOMAIN, excerptBody(excerpt));
}

function excerptBody(excerpt: Pick<ExcerptRecord, 'parent' | 'inclusion' | 'objects'>): CborValue {
  return {
    version: 1,
    format: EXCERPT_FORMAT,
    parent: excerpt.parent,
    inclusion: excerpt.inclusion,
    objects: excerpt.objects.map((object) => ({ id: object.id, kind: object.kind })),
  } as unknown as CborValue;
}

function mounted(image: Uint8Array | KnowledgeImageV5): KnowledgeImageV5 {
  if (image instanceof Uint8Array) {
    try {
      return mountKnowledgeImageV5(image);
    } catch (error) {
      throw new CompositionError('EXCERPT_INVALID', error instanceof Error ? error.message : String(error), 'image', error);
    }
  }
  if (image?.bytes instanceof Uint8Array && typeof image.stateRoot === 'string') return mountKnowledgeImageV5(image.bytes);
  throw new CompositionError('EXCERPT_INVALID', 'Excerpt image must be V5 bytes or a mounted image.', 'image');
}
