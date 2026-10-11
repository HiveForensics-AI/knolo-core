import { digest } from '../dist/index.js';

export const BOUNDS = {
  maxAnchorNodes: 20,
  maxClosureNodes: 50,
  maxClosureEdges: 100,
  maxFrontierEvidence: 20,
  maxRequirementsPerFrontier: 10,
  maxEvidenceBindings: 50,
  maxCoverVisits: 10000,
};

export function makeImage(rows) {
  const evidence = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const image = { version: 1, evidence };
  return { image, knowledgeRoot: digest(image) };
}

export function makeGraph(knowledgeRoot, parts) {
  return {
    version: 1,
    knowledgeRoot,
    provenance: { producer: 'hand', ...(parts.note ? { note: parts.note } : {}) },
    nodes: parts.nodes.map((id) => ({ id })),
    relations: parts.relations,
    bindings: parts.bindings,
  };
}

export function makePlan(patch) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: 'anchor', queryTerm: 'room' }] },
    frontierMap: {},
    depth: 1,
    cardinalityBound: 5,
    coverageMode: 'requirements',
    requirements: { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-10-10',
    minAuthority: null,
    bounds: BOUNDS,
    lexical: null,
    ...patch,
  };
}

export function bind(id, nodeId, evidenceId, requirements, extra = {}) {
  return { id, nodeId, evidenceId, requirements, ...extra };
}
