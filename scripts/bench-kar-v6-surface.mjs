/**
 * Split timings for the public V6 surface.
 *
 * This does not replace research/kar-1 benchmarks and does not write their
 * result files. It measures one small committed graph:
 * session creation, warm evaluation, cold verification, and CEG compilation.
 *
 *   node scripts/bench-kar-v6-surface.mjs
 */
import { performance } from 'node:perf_hooks';
import { createKnowledgeImageV5 } from '@knolo/core';
import { createKarSession, evaluateKar, verifyKar } from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';

const encoder = new TextEncoder();
const reps = 30;
const sourceText = `format: ceg-source-1
concepts:
  customer:
    label: Customer
  allowance:
    label: Cancellation allowance
  bar:
    label: Cancellation bar
evidence:
  policy:
    source: policy.txt
  contract:
    source: contract.txt
relations:
  - from: customer
    type: permits
    to: allowance
  - from: customer
    type: prohibits
    to: bar
bindings:
  - concept: allowance
    evidence: policy
    requirements:
      - cancel-allowed
  - concept: bar
    evidence: contract
    requirements:
      - cancel-barred
requirements:
  - cancel-allowed
  - cancel-barred
`;
const documents = [
  { source: 'policy.txt', text: 'The customer may cancel. evidence' },
  { source: 'contract.txt', text: 'The customer may not cancel. evidence' },
];
const plan = {
  version: 1,
  anchor: { mode: 'supplied', witness: [{ nodeId: cegNodeId('customer'), queryTerm: 'evidence' }] },
  frontierMap: { permits: 'F_S', prohibits: 'F_O' },
  depth: 2,
  cardinalityBound: 8,
  coverageMode: 'requirements',
  requirements: { F_S: ['cancel-allowed'], F_O: ['cancel-barred'], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
  profile: 'minimum-cover',
  asOf: '2026-06-01',
  minAuthority: null,
  bounds: {
    maxAnchorNodes: 8,
    maxClosureNodes: 32,
    maxClosureEdges: 32,
    maxFrontierEvidence: 8,
    maxRequirementsPerFrontier: 4,
    maxEvidenceBindings: 8,
    maxCoverVisits: 1000,
  },
  lexical: null,
};
const proposition = 'The customer may cancel.';

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function time(fn) {
  const samples = [];
  for (let index = 0; index < reps; index += 1) samples.push(fn());
  return median(samples);
}

const image = createKnowledgeImageV5({
  actor: 'kar-v6-surface-bench',
  sequence: 1,
  objects: documents.map((document) => ({
    kind: 'chunk',
    bytes: encoder.encode(document.text),
    meta: { source: document.source },
  })),
});
const parsed = parseCegSource(sourceText);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));

const compileMs = time(() => {
  const started = performance.now();
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  const elapsed = performance.now() - started;
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return elapsed;
});
const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

const sessionMs = time(() => {
  const started = performance.now();
  createKarSession({ image: image.bytes, graph: compiled.sidecar });
  return performance.now() - started;
});
const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
evaluateKar(session, { proposition, plan });
const warmEvalMs = time(() => {
  const started = performance.now();
  const result = evaluateKar(session, { proposition, plan });
  const elapsed = performance.now() - started;
  if (result.status !== 'SATISFIED') throw new Error(result.status);
  return elapsed;
});
const coldVerifyMs = time(() => {
  const result = evaluateKar(session, { proposition, plan });
  const started = performance.now();
  const verification = verifyKar({
    image: image.bytes,
    graph: compiled.sidecar,
    proposition,
    plan,
    result,
  });
  const elapsed = performance.now() - started;
  if (!verification.ok) throw new Error(verification.code ?? 'verify failed');
  return elapsed;
});

console.log(JSON.stringify({
  reps,
  nodes: 3,
  relations: 2,
  compileMs,
  sessionMs,
  warmEvalMs,
  coldVerifyMs,
  status: 'SATISFIED',
}, null, 2));
