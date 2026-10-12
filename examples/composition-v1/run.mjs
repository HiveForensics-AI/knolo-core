/**
 * Offline composition demo.
 *
 * The statute text is a demo. It is not certified law.
 * Run from the repository root after building @knolo/core:
 *   node examples/composition-v1/run.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import { createKarSession, evaluateKar } from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';
import {
  createCompositionAttestation,
  createCompositionRecord,
  evaluateComposedKar,
  karCompositionBinder,
  openComposedSession,
  verifyCompositionRecord,
} from '@knolo/core/composition';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const sourceText = `format: ceg-source-1
concepts:
  procedure:
    label: Procedure
  valve:
    label: Valve
evidence:
  step:
    source: statute.txt
relations:
  - from: procedure
    type: requires
    to: valve
bindings:
  - concept: valve
    evidence: step
    requirements:
      - close-valve
requirements:
  - close-valve
`;
const plan = {
  version: 1,
  anchor: { mode: 'supplied', witness: [{ nodeId: cegNodeId('procedure'), queryTerm: 'evidence' }] },
  frontierMap: { requires: 'F_S' },
  depth: 2,
  cardinalityBound: 4,
  coverageMode: 'requirements',
  requirements: { F_S: ['close-valve'], F_O: [], F_Q: [], F_T: [], F_A: [] },
  floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
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
    maxCoverVisits: 256,
  },
  lexical: null,
};
const proposition = 'What evidence shows the valve is closed?';

const host = createKnowledgeImageV5({
  actor: 'composition-demo-host',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode('The operator recorded that the valve was closed. This is a demo note.'), meta: { source: 'host.txt' } }],
});
const statute = createKnowledgeImageV5({
  actor: 'composition-demo-statute',
  sequence: 1,
  objects: [{ kind: 'chunk', bytes: encoder.encode('A demo statute says the valve must be closed. This is not certified law.'), meta: { source: 'statute.txt' } }],
});
const parsed = parseCegSource(sourceText);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
const compiled = compileCegSource({ source: parsed.source, image: statute.bytes });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
const graphBytes = encoder.encode(JSON.stringify(compiled.sidecar));
const graph = JSON.parse(new TextDecoder().decode(graphBytes));
const bound = karCompositionBinder(statute.bytes, graphBytes);
const before = statute.stateRoot;
const created = createCompositionRecord({
  availability: 'material',
  host: { kind: 'v5-image', bytes: host.bytes },
  members: [
    { alias: 'statute', kind: 'v5-image', bytes: statute.bytes, knowledgeRoot: bound.knowledgeRoot },
    { alias: 'witness', kind: 'kar-sidecar', bytes: graphBytes, bindsTo: 'statute' },
  ],
  karBinder: karCompositionBinder,
});
const verdict = verifyCompositionRecord(created.record, {
  hostBytes: host.bytes,
  members: {
    statute: { bytes: statute.bytes },
    witness: { bytes: graphBytes },
  },
  karBinder: karCompositionBinder,
});
if (!verdict.ok) throw new Error(verdict.code);
if (statute.stateRoot !== before) throw new Error('statute stateRoot changed');
const tampered = Uint8Array.from(statute.bytes);
tampered[tampered.length - 1] ^= 1;
const mismatch = verifyCompositionRecord(created.record, {
  hostBytes: host.bytes,
  members: {
    statute: { bytes: tampered },
    witness: { bytes: graphBytes },
  },
  karBinder: karCompositionBinder,
});
if (mismatch.ok || mismatch.code !== 'COMPOSITION_DIGEST_MISMATCH') throw new Error('tampered statute verified');
const direct = evaluateKar(createKarSession({ image: statute.bytes, graph }), { proposition, plan });
const composed = evaluateComposedKar(openComposedSession(created.record, {
  hostBytes: host.bytes,
  members: { statute: { bytes: statute.bytes }, witness: { bytes: graphBytes } },
  karBinder: karCompositionBinder,
}), { alias: 'witness', proposition, plan });
if (JSON.stringify(direct.certificate) !== JSON.stringify(composed.evaluation.certificate)) {
  throw new Error('cited evaluation changed karRoot');
}
const cited = createCompositionAttestation({
  record: created.record,
  statement: 'cited',
  subject: { kind: 'composition', compositionRoot: created.compositionRoot },
});
writeFileSync(path.join(here, 'host.knolo'), host.bytes);
writeFileSync(path.join(here, 'statute.knolo'), statute.bytes);
writeFileSync(path.join(here, 'statute.kar.json'), graphBytes);
writeFileSync(path.join(here, 'members.json'), `${JSON.stringify({
  format: 'composition-members-1',
  version: 1,
  members: [
    { alias: 'statute', kind: 'v5-image', path: 'statute.knolo', knowledgeRoot: bound.knowledgeRoot },
    { alias: 'witness', kind: 'kar-sidecar', path: 'statute.kar.json', bindsTo: 'statute' },
  ],
}, null, 2)}\n`);
console.log(created.compositionRoot);
console.log('VERIFIED');
console.log(mismatch.code);
console.log(direct.certificate.roots.karRoot);
console.log(cited.attestationRoot);
console.log('demo only; not certified law');
