import { canonicalize, verify as verifyKar } from '../dist/index.js';
import { mountKnowledgeImageV5 } from '../../../packages/core/dist/index.js';
import { projectKnowledgeImage } from './adapter.mjs';

const textDecoder = new TextDecoder();

/**
 * Recompute KAR from the mounted image, the sidecar, the query, and the plan.
 * Rejects any claimed envelope that disagrees, including a wrong state root.
 */
export function verifyKnoloKar({ imageBytes, sidecar, query, plan, claimed }) {
  let image;
  try {
    image = mountKnowledgeImageV5(imageBytes);
  } catch (error) {
    return { ok: false, reason: `IMAGE_REJECTED ${error instanceof Error ? error.message : error}` };
  }
  if (!sidecar || sidecar.stateRoot !== image.stateRoot) {
    return { ok: false, reason: 'GRAPH_NOT_BOUND' };
  }
  const projection = projectKnowledgeImage(image);
  if (sidecar.knowledgeRoot !== projection.knowledgeRoot || sidecar.graph?.knowledgeRoot !== projection.knowledgeRoot) {
    return { ok: false, reason: 'GRAPH_NOT_BOUND' };
  }
  if (!claimed?.kar || claimed.image?.stateRoot !== image.stateRoot) {
    return { ok: false, reason: 'STATE_ROOT_MISMATCH' };
  }
  const verdict = verifyKar(projection.image, sidecar.graph, query, plan, claimed.kar);
  if (!verdict.ok) return { ok: false, reason: `RESULT_MISMATCH ${verdict.reason}` };
  const evidenceIds = (claimed.evidence ?? []).map((row) => row.id);
  if (canonicalize(evidenceIds) !== canonicalize(claimed.kar.evidenceIds)) {
    return { ok: false, reason: 'EVIDENCE_MISMATCH' };
  }
  const objects = new Map(image.objects.map((object) => [object.id, object]));
  for (const row of claimed.evidence ?? []) {
    const object = objects.get(row.id);
    if (!object) return { ok: false, reason: 'EVIDENCE_MISMATCH' };
    if (row.text !== undefined && row.text !== textDecoder.decode(object.bytes)) {
      return { ok: false, reason: 'EVIDENCE_BYTES_MISMATCH' };
    }
  }
  if (claimed.frontiers && canonicalize(claimed.frontiers) !== canonicalize(claimed.kar.frontiers)) {
    return { ok: false, reason: 'FRONTIER_MISMATCH' };
  }
  return { ok: true, reason: 'MATCH' };
}
