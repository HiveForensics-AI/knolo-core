import { createKnowledgeImageV5, mountKnowledgeImageV5 } from '../../../packages/core/dist/index.js';
import { digest, evaluate } from '../dist/index.js';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * V5 `stateRoot` is the mounted image identity.
 * Frozen KAR `KnowledgeRoot` is the research digest of `{ version: 1, evidence }`.
 * The spec forbids treating that research digest as a V5 state root, so the
 * sidecar stores both and KAR's `G.knowledgeRoot` is the projection root.
 * A state-root mismatch is `GRAPH_NOT_BOUND` at this boundary.
 */

export function projectKnowledgeImage(image) {
  const evidence = image.objects.map((object) => ({
    id: object.id,
    text: textDecoder.decode(object.bytes),
  }));
  evidence.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const projection = { version: 1, evidence };
  return {
    image: projection,
    knowledgeRoot: digest(projection),
    stateRoot: image.stateRoot,
    objectRoot: image.commit.objectRoot,
    commitDigest: image.commitDigest,
  };
}

export function openKarImage(imageBytes) {
  const image = mountKnowledgeImageV5(imageBytes);
  const projection = projectKnowledgeImage(image);
  const objects = new Map(image.objects.map((object) => [object.id, object]));
  return {
    stateRoot: image.stateRoot,
    projectionRoot: projection.knowledgeRoot,
    objectRoot: image.commit.objectRoot,
    commitDigest: image.commitDigest,
    projection,
    evidenceIds() {
      return projection.image.evidence.map((row) => row.id);
    },
    hasEvidence(id) {
      return objects.has(id);
    },
    evidenceText(id) {
      const object = objects.get(id);
      return object ? textDecoder.decode(object.bytes) : undefined;
    },
    evidenceMetadata(id) {
      const object = objects.get(id);
      if (!object) return undefined;
      return { kind: object.kind, meta: object.meta };
    },
  };
}

export function createPilotImage(documents) {
  return createKnowledgeImageV5({
    actor: 'kar-1-integration',
    sequence: 1,
    objects: documents.map((document) => ({
      kind: 'chunk',
      bytes: textEncoder.encode(document.text),
      meta: { source: document.source, label: document.label },
    })),
  });
}

function emptyFrontiers() {
  return { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
}

function resolveEvidence(image, evidenceIds) {
  const objects = new Map(image.objects.map((object) => [object.id, object]));
  return evidenceIds.map((id) => {
    const object = objects.get(id);
    if (!object) return { id };
    const source = typeof object.meta?.source === 'string' ? object.meta.source : object.kind;
    return {
      id,
      text: textDecoder.decode(object.bytes),
      source,
      metadata: { kind: object.kind, meta: object.meta },
    };
  });
}

export function runKar(imageBytes, sidecar, query, plan) {
  let image;
  try {
    image = mountKnowledgeImageV5(imageBytes);
  } catch (error) {
    const kar = evaluate({ version: 1, evidence: [] }, sidecar?.graph ?? null, query, plan);
    return {
      status: 'IMAGE_REJECTED',
      reason: error instanceof Error ? error.message : String(error),
      kar,
      image: { stateRoot: '' },
      evidence: [],
      frontiers: emptyFrontiers(),
      anchor: anchorView(plan, kar),
    };
  }

  const projection = projectKnowledgeImage(image);
  const stateBound = sidecar?.stateRoot === image.stateRoot;
  const rootBound = sidecar?.knowledgeRoot === projection.knowledgeRoot && sidecar?.graph?.knowledgeRoot === projection.knowledgeRoot;
  const graph = stateBound && rootBound ? sidecar.graph : forceUnbound(sidecar?.graph, image.stateRoot, sidecar?.stateRoot ?? null);
  const kar = evaluate(projection.image, graph, query, plan);
  const status = stateBound && rootBound ? kar.status : kar.status === 'GRAPH_INVALID' || kar.status === 'PLAN_INVALID' ? kar.status : 'GRAPH_NOT_BOUND';
  const evidenceIds = status === kar.status ? kar.evidenceIds : [];
  return {
    status,
    kar: status === kar.status ? kar : { ...kar, status, evidenceIds, choices: [] },
    image: { stateRoot: image.stateRoot },
    evidence: resolveEvidence(image, evidenceIds),
    frontiers: status === kar.status ? kar.frontiers : emptyFrontiers(),
    anchor: anchorView(plan, kar),
  };
}

function forceUnbound(graph, stateRoot, claimed) {
  if (!graph || typeof graph !== 'object') return graph ?? null;
  return {
    ...graph,
    knowledgeRoot: digest({ unboundStateRoot: claimed, imageStateRoot: stateRoot }),
  };
}

function anchorView(plan, kar) {
  const anchor = plan && typeof plan === 'object' ? plan.anchor ?? null : null;
  return {
    mode: anchor?.mode ?? null,
    witness: anchor?.mode === 'supplied' ? anchor.witness ?? null : null,
    procedure: anchor?.mode === 'recompute' ? anchor.procedure ?? null : null,
    anchorRoot: kar?.roots?.anchorRoot ?? null,
  };
}
