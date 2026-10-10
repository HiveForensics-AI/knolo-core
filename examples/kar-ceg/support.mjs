import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createKnowledgeImageV5 } from '../../packages/core/dist/index.js';
import { cegNodeId, serializeCegBuild } from '../../packages/core/dist/experimental/kar/authoring/index.js';
import { createKarSession, evaluateKar, verifyKar } from '../../packages/core/dist/experimental/kar/index.js';

const encoder = new TextEncoder();

export function chunkImage(actor, documents, extra = []) {
  return createKnowledgeImageV5({
    actor,
    sequence: 1,
    objects: [
      ...documents.map((document) => ({
        kind: 'chunk',
        bytes: encoder.encode(document.text),
        meta: { source: document.source },
      })),
      ...extra,
    ],
  });
}

export function cancelPlan() {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: cegNodeId('customer'), queryTerm: 'cancel' }] },
    frontierMap: { permits: 'F_S', prohibits: 'F_O' },
    depth: 1,
    cardinalityBound: 4,
    coverageMode: 'requirements',
    requirements: { F_S: ['cancel-allowed'], F_O: ['cancel-barred'], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: {
      maxAnchorNodes: 4,
      maxClosureNodes: 16,
      maxClosureEdges: 16,
      maxFrontierEvidence: 8,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 8,
      maxCoverVisits: 100,
    },
    lexical: null,
  };
}

export function writeKarOutputs(directory, image, compiled) {
  writeFileSync(path.join(directory, 'knowledge.knolo'), image.bytes);
  writeFileSync(path.join(directory, 'knowledge.kar.json'), compiled.bytes);
  writeFileSync(path.join(directory, 'knowledge.kar.build.json'), serializeCegBuild(compiled.buildInfo));
  writeFileSync(path.join(directory, 'plan.json'), `${JSON.stringify(cancelPlan(), null, 2)}\n`);
}

export function evaluateCompiled(image, compiled) {
  const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
  const result = evaluateKar(session, {
    proposition: 'Can this enterprise customer cancel?',
    plan: cancelPlan(),
  });
  const verdict = verifyKar({
    image: image.bytes,
    graph: compiled.sidecar,
    proposition: 'Can this enterprise customer cancel?',
    plan: cancelPlan(),
    result,
  });
  return { result, verdict };
}
