import { evaluateBound } from './evaluate.js';
import { buildKarIndexes, prepareGraph, prepareImage, semanticRootOf, unresolvedEvidence, type PreparedImage } from './graph.js';
import { validatePlan } from './plan.js';
import {
  KAR_API,
  KAR_VERSION,
  KarError,
  karStatusCode,
  type Graph,
  type Image,
  type KarEvaluation,
  type KarImageIdentity,
  type KarIndexes,
  type KarResult,
  type KarSelectedEvidence,
  type Plan,
} from './types.js';
import { validateKarSidecar } from './validate.js';
import { projectKnowledgeImage, openKarImage, type KarImageInput } from './v5.js';

export type KarSession = {
  readonly experimental: true;
  readonly kind: 'v5' | 'projection';
  readonly image: KarImageIdentity;
  readonly graph: Graph;
  readonly projection: Image;
  readonly texts: ReadonlyMap<string, string>;
  readonly evidenceById: KarIndexes['evidenceById'];
  readonly nodeById: KarIndexes['nodeById'];
  readonly relationsByFrom: KarIndexes['relationsByFrom'];
  readonly bindingsByNode: KarIndexes['bindingsByNode'];
  readonly indexes: KarIndexes;
  readonly objects: ReadonlyMap<string, { id: string; text: string; source?: string; metadata?: Record<string, unknown> }>;
  readonly roots: {
    stateRoot: string | null;
    knowledgeRoot: string;
    semanticRoot: string;
    objectRoot: string | null;
    commitDigest: string | null;
  };
};

/**
 * Compile a session from a mounted V5 image and a CEG sidecar.
 * Indexes are built once. verifyKar does not accept this object.
 */
export function createKarSession(input: { image: KarImageInput; graph: unknown }): KarSession {
  const mounted = openKarImage(input.image);
  const sidecar = validateKarSidecar(input.graph);
  if (!sidecar.ok) throw new KarError(sidecar.errors[0].code, sidecar.errors[0].message, sidecar.errors);
  const projected = projectKnowledgeImage(mounted);
  const binding = bindingError(sidecar.value, projected);
  if (binding) throw new KarError(binding.code, binding.message, [binding]);
  return finishSession('v5', projected, sidecar.value.graph, {
    stateRoot: projected.stateRoot,
    objectRoot: projected.objectRoot,
    commitDigest: projected.commitDigest,
    objects: projected.objects,
  });
}

/**
 * Session over a research projection image and a CEG.
 * Used by conformance and by the scaling benchmark. V5 developers use createKarSession.
 */
export function createKarProjectionSession(input: { image: unknown; graph: unknown }): KarSession {
  const prepared = prepareImage(input.image);
  const graph = prepareGraph(input.graph);
  if (!prepared || !graph) {
    throw new KarError('KAR_GRAPH_INVALID', 'The projection image or committed evidence graph is not valid.');
  }
  if (graph.knowledgeRoot !== prepared.knowledgeRoot || unresolvedEvidence(graph, prepared.texts)) {
    throw new KarError('KAR_GRAPH_NOT_BOUND', 'The committed evidence graph is not bound to this projection.');
  }
  return finishSession('projection', prepared, graph, {
    stateRoot: null,
    objectRoot: null,
    commitDigest: null,
    objects: new Map([...prepared.texts].map(([id, text]) => [id, { id, text }])),
  });
}

function bindingError(
  sidecar: { stateRoot: string; objectRoot: string; commitDigest: string; knowledgeRoot: string },
  projected: { stateRoot: string; objectRoot: string; commitDigest: string; knowledgeRoot: string },
): { code: string; path: string; message: string } | null {
  if (sidecar.stateRoot !== projected.stateRoot) {
    return { code: 'KAR_GRAPH_NOT_BOUND', path: 'stateRoot', message: 'Sidecar stateRoot does not match the mounted V5 image.' };
  }
  if (sidecar.objectRoot !== projected.objectRoot) {
    return { code: 'KAR_GRAPH_NOT_BOUND', path: 'objectRoot', message: 'Sidecar objectRoot does not match the mounted V5 image.' };
  }
  if (sidecar.commitDigest !== projected.commitDigest) {
    return { code: 'KAR_GRAPH_NOT_BOUND', path: 'commitDigest', message: 'Sidecar commitDigest does not match the mounted V5 image.' };
  }
  if (sidecar.knowledgeRoot !== projected.knowledgeRoot) {
    return {
      code: 'KAR_GRAPH_NOT_BOUND',
      path: 'knowledgeRoot',
      message: 'Sidecar knowledgeRoot does not match the frozen KAR projection of this image.',
    };
  }
  return null;
}

function finishSession(
  kind: 'v5' | 'projection',
  prepared: PreparedImage,
  graph: Graph,
  identity: {
    stateRoot: string | null;
    objectRoot: string | null;
    commitDigest: string | null;
    objects: Map<string, { id: string; text: string; source?: string; metadata?: Record<string, unknown> }>;
  },
): KarSession {
  const indexes = buildKarIndexes(graph, prepared.texts);
  const image: KarImageIdentity = {
    stateRoot: identity.stateRoot,
    knowledgeRoot: prepared.knowledgeRoot,
    objectRoot: identity.objectRoot,
    commitDigest: identity.commitDigest,
  };
  return {
    experimental: true,
    kind,
    image,
    graph,
    projection: prepared.image,
    texts: prepared.texts,
    evidenceById: indexes.evidenceById,
    nodeById: indexes.nodeById,
    relationsByFrom: indexes.relationsByFrom,
    bindingsByNode: indexes.bindingsByNode,
    indexes,
    objects: identity.objects,
    roots: {
      stateRoot: image.stateRoot,
      knowledgeRoot: image.knowledgeRoot,
      semanticRoot: semanticRootOf(graph),
      objectRoot: image.objectRoot,
      commitDigest: image.commitDigest,
    },
  };
}

export function evaluateKar(session: KarSession, input: { proposition: string; plan: unknown }): KarEvaluation {
  const plan = validatePlan(input.plan);
  const certificate = evaluateBound({
    prepared: { image: session.projection, knowledgeRoot: session.image.knowledgeRoot, texts: session.texts as Map<string, string> },
    graph: session.graph,
    indexes: session.indexes,
    imageInput: session.projection,
    graphInput: session.graph,
    query: input.proposition,
    planInput: input.plan,
    knowledgeRoot: session.image.knowledgeRoot,
    semanticRoot: session.roots.semanticRoot,
  });
  return toEvaluation(session, input.proposition, plan, certificate);
}

export function toEvaluation(session: KarSession, proposition: string, plan: Plan | null, certificate: KarResult): KarEvaluation {
  const choiceById = new Map(certificate.choices.map((choice) => [choice.evidenceId, choice]));
  const selectedEvidence: KarSelectedEvidence[] = certificate.evidenceIds.map((id) => {
    const object = session.objects.get(id);
    const row: KarSelectedEvidence = {
      id,
      frontiers: choiceById.get(id)?.frontiers ?? [],
    };
    const text = object?.text ?? session.texts.get(id);
    if (text !== undefined) row.text = text;
    if (object?.source !== undefined) row.source = object.source;
    if (object?.metadata !== undefined) row.metadata = object.metadata;
    return row;
  });
  return {
    experimental: true,
    api: KAR_API,
    version: KAR_VERSION,
    status: certificate.status,
    code: karStatusCode(certificate.status),
    proposition,
    plan,
    image: session.image,
    frontiers: certificate.frontiers,
    selectedEvidence,
    witnesses: certificate.witnesses,
    certificate,
  };
}
