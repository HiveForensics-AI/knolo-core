/**
 * Small experimental KAR example.
 *
 * It builds a V5 Knowledge Image, loads a hand-authored Committed Evidence
 * Graph, evaluates one proposition, prints support and opposition, and
 * verifies the certificate. No semantic compiler is involved.
 *
 * Run from the repository root:
 *   node examples/kar/run.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../../packages/core/dist/index.js';
import { digest } from '../../packages/core/dist/experimental/kar/canonicalize.js';
import {
  createKarSession,
  evaluateKar,
  verifyKar,
} from '../../packages/core/dist/experimental/kar/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const documents = [
  {
    source: 'front-desk/cancellation-policy',
    text: 'A guest may cancel a lodging reservation before the day of arrival.',
  },
  {
    source: 'contracts/enterprise-lodging',
    text: 'An enterprise customer may not cancel after the contract is signed.',
  },
];

const image = createKnowledgeImageV5({
  actor: 'kar-example',
  sequence: 1,
  objects: documents.map((document) => ({
    kind: 'chunk',
    bytes: encoder.encode(document.text),
    meta: { source: document.source },
  })),
});

const evidence = image.objects.map((object) => ({ id: object.id, text: decoder.decode(object.bytes) }));
evidence.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
const knowledgeRoot = digest({ version: 1, evidence });
const bySource = new Map(image.objects.map((object) => [object.meta.source, object.id]));

const sidecar = {
  version: 1,
  stateRoot: image.stateRoot,
  objectRoot: image.commit.objectRoot,
  commitDigest: image.commitDigest,
  knowledgeRoot,
  graph: {
    version: 1,
    knowledgeRoot,
    provenance: { producer: 'hand', note: 'enterprise-cancel' },
    nodes: [{ id: 'lodging' }, { id: 'policy' }, { id: 'contract' }],
    relations: [
      { id: 'r-support', from: 'lodging', relation: 'supports', to: 'policy' },
      { id: 'r-oppose', from: 'lodging', relation: 'prohibits', to: 'contract' },
    ],
    bindings: [
      {
        id: 'b-policy',
        nodeId: 'policy',
        evidenceId: bySource.get('front-desk/cancellation-policy'),
        requirements: ['cancel-allowed'],
      },
      {
        id: 'b-contract',
        nodeId: 'contract',
        evidenceId: bySource.get('contracts/enterprise-lodging'),
        requirements: ['cancel-barred'],
      },
    ],
  },
};

const plan = {
  version: 1,
  anchor: { mode: 'supplied', witness: [{ nodeId: 'lodging', queryTerm: 'cancel' }] },
  frontierMap: { supports: 'F_S', prohibits: 'F_O' },
  depth: 1,
  cardinalityBound: 4,
  coverageMode: 'requirements',
  requirements: { F_S: ['cancel-allowed'], F_O: ['cancel-barred'], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
  profile: 'minimum-cover',
  asOf: '2026-10-10',
  minAuthority: null,
  bounds: {
    maxAnchorNodes: 4,
    maxClosureNodes: 16,
    maxClosureEdges: 16,
    maxFrontierEvidence: 8,
    maxRequirementsPerFrontier: 4,
    maxEvidenceBindings: 8,
    maxCoverVisits: 1000,
  },
  lexical: null,
};

const query = 'Can this enterprise customer cancel?';
const session = createKarSession({ image: image.bytes, graph: sidecar });
const result = evaluateKar(session, { proposition: query, plan });
const verification = verifyKar({
  image: image.bytes,
  graph: sidecar,
  proposition: query,
  plan,
  result,
});
if (!verification.ok) {
  console.error(verification.code);
  console.error(verification.reason);
  process.exit(1);
}

writeFileSync(path.join(here, 'knowledge.knolo'), image.bytes);
writeFileSync(path.join(here, 'knowledge.kar.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
writeFileSync(path.join(here, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
writeFileSync(path.join(here, 'query.txt'), `${query}\n`);
writeFileSync(path.join(here, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

console.log('STATUS');
console.log(result.status);
console.log('');
console.log('SUPPORT');
for (const id of result.frontiers.F_S) console.log(lineFor(result, id));
console.log('');
console.log('OPPOSITION');
for (const id of result.frontiers.F_O) console.log(lineFor(result, id));
console.log('');
console.log('KAR ROOT');
console.log(result.certificate.roots.karRoot);
console.log('');
console.log('V5 STATE ROOT');
console.log(result.image.stateRoot);
console.log('');
console.log('KAR KNOWLEDGE ROOT');
console.log(result.image.knowledgeRoot);
console.log('');
console.log('VERIFIED');

function lineFor(evaluation, id) {
  const row = evaluation.selectedEvidence.find((item) => item.id === id);
  return `${id}  ${row?.source ?? ''}  ${row?.text ?? ''}`;
}
