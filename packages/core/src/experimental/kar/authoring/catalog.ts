import type { KnowledgeObjectV1 } from '../../../knowledge_image_v5.js';
import { projectKnowledgeImage, openKarImage, type KarImageInput } from '../v5.js';
import { KarError } from '../types.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';
import type { CegEvidenceSelector } from './model.js';

export type EvidenceObject = {
  id: string;
  kind: string;
  source?: string;
  namespace?: string;
  locator?: string;
  meta: Record<string, string>;
  text: string;
};

export type EvidenceCatalog = {
  objects: EvidenceObject[];
  stateRoot: string;
  objectRoot: string;
  commitDigest: string;
  knowledgeRoot: string;
};

export function openEvidenceCatalog(image: KarImageInput): { ok: true; catalog: EvidenceCatalog } | { ok: false; diagnostics: CegDiagnostic[] } {
  try {
    const mounted = openKarImage(image);
    const projected = projectKnowledgeImage(mounted);
    const objects = mounted.objects.map((object) => toEvidenceObject(object, projected.objects.get(object.id)?.text ?? ''));
    return {
      ok: true,
      catalog: {
        objects,
        stateRoot: projected.stateRoot,
        objectRoot: projected.objectRoot,
        commitDigest: projected.commitDigest,
        knowledgeRoot: projected.knowledgeRoot,
      },
    };
  } catch (error) {
    const message = error instanceof KarError ? error.message : error instanceof Error ? error.message : 'Image rejected.';
    const code = error instanceof KarError ? error.code : 'KAR_IMAGE_REJECTED';
    return { ok: false, diagnostics: [diagnostic('error', code === 'KAR_IMAGE_REJECTED' ? 'CEG_IMAGE_REJECTED' : code, 'image', message)] };
  }
}

export function resolveEvidenceSelector(
  selector: CegEvidenceSelector,
  catalog: EvidenceCatalog,
  path: string,
): { ok: true; id: string; text: string } | { ok: false; diagnostic: CegDiagnostic } {
  const matches = catalog.objects.filter((object) => selectorMatches(selector, object));
  if (matches.length === 0) {
    return {
      ok: false,
      diagnostic: diagnostic('error', 'CEG_EVIDENCE_NOT_FOUND', path, 'No Knowledge Image object matches this evidence selector.'),
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      diagnostic: diagnostic('error', 'CEG_EVIDENCE_AMBIGUOUS', path, `Evidence selector matches ${matches.length} objects. Name an objectId.`),
    };
  }
  const match = matches[0];
  if (!match) {
    return { ok: false, diagnostic: diagnostic('error', 'CEG_EVIDENCE_NOT_FOUND', path, 'No Knowledge Image object matches this evidence selector.') };
  }
  return { ok: true, id: match.id, text: match.text };
}

function selectorMatches(selector: CegEvidenceSelector, object: EvidenceObject): boolean {
  if ('objectId' in selector) return object.id === selector.objectId;
  if ('locator' in selector) return object.locator === selector.locator;
  if ('source' in selector) {
    if (object.source !== selector.source) return false;
    if (selector.namespace !== undefined && object.namespace !== selector.namespace) return false;
    return true;
  }
  for (const [key, value] of Object.entries(selector.meta)) {
    if (key === 'kind') {
      if (object.kind !== value) return false;
      continue;
    }
    if (object.meta[key] !== value) return false;
  }
  return true;
}

function toEvidenceObject(object: KnowledgeObjectV1, text: string): EvidenceObject {
  const meta: Record<string, string> = {};
  for (const [key, value] of Object.entries(object.meta)) {
    if (typeof value === 'string') meta[key] = value;
  }
  const row: EvidenceObject = { id: object.id, kind: object.kind, meta, text };
  if (typeof object.meta.source === 'string' && object.meta.source.length > 0) row.source = object.meta.source;
  if (typeof object.meta.namespace === 'string' && object.meta.namespace.length > 0) row.namespace = object.meta.namespace;
  if (typeof object.meta.locator === 'string' && object.meta.locator.length > 0) row.locator = object.meta.locator;
  return row;
}
