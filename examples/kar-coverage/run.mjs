/**
 * Evidence gap report on a hand-authored procedure.
 *
 * One requirement is met. One required permit is absent.
 * Run from the repository root after building @knolo/core:
 *   node examples/kar-coverage/run.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import {
  createKarCoverage,
  createKarSession,
  evaluateKar,
  renderKarCoverage,
  verifyKarCoverage,
} from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const metQuery = 'What evidence shows the valve is closed?';
const gapQuery = 'What evidence shows the missing permit?';

const sourceText = `format: ceg-source-1
concepts:
  procedure:
    label: Procedure
  valve:
    label: Valve
evidence:
  step:
    source: step.txt
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

const bounds = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 32,
  maxFrontierEvidence: 8,
  maxRequirementsPerFrontier: 4,
  maxEvidenceBindings: 8,
  maxCoverVisits: 256,
};

function plan(requirements, floors) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: cegNodeId('procedure'), queryTerm: 'evidence' }] },
    frontierMap: { requires: 'F_S' },
    depth: 2,
    cardinalityBound: 4,
    coverageMode: 'requirements',
    requirements: { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [], ...requirements },
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0', ...floors },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds,
    lexical: null,
  };
}

const image = createKnowledgeImageV5({
  actor: 'kar-coverage-example',
  sequence: 1,
  objects: [{
    kind: 'chunk',
    bytes: encoder.encode('The operator must close the valve. This sentence is evidence for the plan.'),
    meta: { source: 'step.txt' },
  }],
});
const parsed = parseCegSource(sourceText);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

const metPlan = plan({ F_S: ['close-valve'] }, { F_S: '1' });
const gapPlan = plan({ F_S: ['missing-permit'] }, { F_S: '1' });
const cases = [
  { id: 'met', proposition: metQuery, plan: metPlan },
  { id: 'gap', proposition: gapQuery, plan: gapPlan },
];
const report = createKarCoverage({ image: image.bytes, graph: compiled.sidecar, cases });
const gap = report.cases.find((row) => row.id === 'gap');
const met = report.cases.find((row) => row.id === 'met');
if (met.disposition !== 'met' || met.statement !== 'Evidence requirements satisfied') {
  throw new Error(`met row ${met.status} ${met.statement}`);
}
if (gap.disposition !== 'gap' || gap.statement !== 'Evidence requirements not satisfied') {
  throw new Error(`gap row ${gap.status} ${gap.statement}`);
}
if (gap.coverage.F_S.covered !== 0) throw new Error('gap coverage count was rewritten');
const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
for (const row of report.cases) {
  const evaluation = evaluateKar(session, { proposition: row.proposition, plan: cases.find((item) => item.id === row.id).plan });
  if (JSON.stringify(evaluation.certificate) !== JSON.stringify(row.certificate)) {
    throw new Error(`${row.id} certificate changed`);
  }
}
const verdict = verifyKarCoverage({
  image: image.bytes,
  graph: compiled.sidecar,
  cases,
  manifest: report.manifest,
  report,
  rendering: renderKarCoverage(report),
});
if (!verdict.ok) throw new Error(`${verdict.code} ${verdict.reason}`);
const tampered = verifyKarCoverage({
  image: image.bytes,
  graph: compiled.sidecar,
  cases,
  manifest: report.manifest,
  report,
  rendering: renderKarCoverage(report).replace('Evidence requirements satisfied', 'Claim proven'),
});
if (tampered.ok || tampered.code !== 'KAR_RESULT_MISMATCH') {
  throw new Error('tampered rendering verified');
}

writeFileSync(path.join(here, 'source.ceg.yaml'), sourceText);
writeFileSync(path.join(here, 'knowledge.knolo'), image.bytes);
writeFileSync(path.join(here, 'knowledge.kar.json'), compiled.bytes);
writeFileSync(path.join(here, 'met.json'), `${JSON.stringify(metPlan, null, 2)}\n`);
writeFileSync(path.join(here, 'gap.json'), `${JSON.stringify(gapPlan, null, 2)}\n`);
console.log(`${met.id} ${met.disposition} ${met.statement}`);
console.log(`${gap.id} ${gap.disposition} ${gap.statement}`);
console.log(report.manifest.coverageRoot);
