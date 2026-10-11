/**
 * Public KAR coverage vectors.
 *
 * These cases are small, hand-authored, and redistributable. They exercise
 * createKarCoverage on V5 Knowledge Images. They do not change kar-1-research-1
 * and they do not edit conformance/kar/v1.
 *
 *   node conformance/kar/coverage-v1/run.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import {
  createKarCoverage,
  createKarSession,
  evaluateKar,
  karCoverageStatement,
  karStatusCode,
  renderKarCoverage,
  verifyKarCoverage,
} from '@knolo/core/kar';
import { cegNodeId, compileCegSource, coverageCasesFromDomainPack, domainPackRoot, parseCegSource } from '@knolo/core/kar/authoring';
import * as authoring from '@knolo/core/experimental/kar/authoring';
import { canonicalize } from '../../../packages/core/dist/experimental/kar/canonicalize.js';
import { loadDomainDirectory } from '../../../packages/cli/bin/kar-produce.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const encoder = new TextEncoder();
const CONTRACTS_V4_ROOT = 'sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5';
const bounds = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 32,
  maxFrontierEvidence: 8,
  maxRequirementsPerFrontier: 4,
  maxEvidenceBindings: 8,
  maxCoverVisits: 256,
};

function plan(anchor, frontierMap, requirements, floors, patch = {}) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: anchor, queryTerm: 'evidence' }] },
    frontierMap,
    depth: 2,
    cardinalityBound: 4,
    coverageMode: 'requirements',
    requirements: { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [], ...requirements },
    floors: { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0', ...floors },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: { ...bounds },
    lexical: null,
    ...patch,
  };
}

function build(actor, documents, sourceText) {
  const image = createKnowledgeImageV5({
    actor,
    sequence: 1,
    objects: documents.map((document) => ({
      kind: 'chunk',
      bytes: encoder.encode(document.text),
      meta: { source: document.source },
    })),
  });
  const parsed = parseCegSource(sourceText);
  if (!parsed.ok) throw new Error(`${actor} source ${JSON.stringify(parsed.diagnostics)}`);
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  if (!compiled.ok) throw new Error(`${actor} compile ${JSON.stringify(compiled.diagnostics)}`);
  return { image: image.bytes, graph: compiled.sidecar };
}

function assertCertificates(builtGraph, report, cases) {
  if (report.image.stateRoot === report.image.knowledgeRoot) throw new Error('stateRoot matched knowledgeRoot');
  const session = createKarSession({ image: builtGraph.image, graph: builtGraph.graph });
  for (const row of report.cases) {
    if (row.certificate.roots.semanticRoot !== report.semanticRoot) throw new Error(`${row.id} semantic root drifted`);
    const input = cases.find((item) => item.id === row.id);
    const evaluation = evaluateKar(session, { proposition: input.proposition, plan: input.plan });
    if (canonicalize(row.certificate) !== canonicalize(evaluation.certificate)) {
      throw new Error(`${row.id} certificate bytes changed`);
    }
    if (row.statement !== karCoverageStatement(row.status)) throw new Error(`${row.id} statement changed`);
  }
}

function flipDigest(value) {
  const last = value.at(-1) === '0' ? '1' : '0';
  return `${value.slice(0, -1)}${last}`;
}

function lockCase(row) {
  return {
    id: row.id,
    status: row.status,
    code: karStatusCode(row.status),
    disposition: row.disposition,
    statement: row.statement,
    planRoot: row.planRoot,
    karRoot: row.karRoot,
    selectedCount: row.certificate.evidenceIds.length,
    slots: row.slots.map((slot) => ({
      frontier: slot.frontier,
      slot: slot.slot,
      unadmittedTokens: slot.unadmittedTokens,
    })),
  };
}

const procedureSource = `format: ceg-source-1
concepts:
  procedure:
    label: Procedure
  valve:
    label: Valve
evidence:
  step:
    source: step.txt
  bar:
    source: bar.txt
relations:
  - from: procedure
    type: requires
    to: valve
  - from: procedure
    type: prohibits
    to: valve
bindings:
  - concept: valve
    evidence: step
    requirements:
      - close-valve
  - concept: valve
    evidence: bar
    requirements:
      - valve-barred
requirements:
  - close-valve
  - valve-barred
`;

const procedure = build('kar-coverage-procedure', [
  { source: 'step.txt', text: 'The operator must close the valve. This sentence is evidence for the plan.' },
  { source: 'bar.txt', text: 'The operator may not leave the valve open. This sentence is evidence for the plan.' },
], procedureSource);
const procedureNode = procedure.graph.graph.relations[0].from;
const metPlan = plan(procedureNode, { requires: 'F_S', prohibits: 'F_O' }, {
  F_S: ['close-valve'],
  F_O: ['valve-barred'],
}, { F_S: '1', F_O: '1' });
const supportPlan = plan(procedureNode, { requires: 'F_S', prohibits: 'F_O' }, { F_S: ['close-valve'] }, { F_S: '1' });
const gapPlan = plan(procedureNode, { requires: 'F_S', prohibits: 'F_O' }, { F_S: ['missing-permit'] }, { F_S: '1' });
const rejectedPlan = plan('missing-node', { requires: 'F_S' }, { F_S: ['close-valve'] }, { F_S: '1' });
const boundedPlan = plan(procedureNode, { requires: 'F_S', prohibits: 'F_O' }, {
  F_S: ['close-valve'],
  F_O: ['valve-barred'],
}, { F_S: '1', F_O: '1' }, {
  bounds: { ...bounds, maxCoverVisits: 0 },
});

const metCases = [{ id: 'balanced', proposition: 'What evidence shows the valve is closed?', plan: metPlan }];
const metReport = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: metCases });
assertCertificates(procedure, metReport, metCases);
if (metReport.cases[0].disposition !== 'met') throw new Error(`balanced disposition ${metReport.cases[0].disposition}`);
const metSlots = Object.fromEntries(metReport.cases[0].slots.map((slot) => [slot.frontier, slot.slot]));
if (metSlots.F_S !== 'met' || metSlots.F_O !== 'met') throw new Error(`balanced slots ${metSlots.F_S} ${metSlots.F_O}`);

const supportCases = [{ id: 'support-only', proposition: 'What evidence shows the valve is closed?', plan: supportPlan }];
const supportReport = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: supportCases });
assertCertificates(procedure, supportReport, supportCases);
const opposition = supportReport.cases[0].slots.find((slot) => slot.frontier === 'F_O');
if (opposition.slot !== 'not-required') throw new Error(`F_O slot ${opposition.slot}`);
if (supportReport.cases[0].planRoot === metReport.cases[0].planRoot) throw new Error('support-only plan matched the balanced plan');
if (supportReport.semanticRoot !== metReport.semanticRoot) throw new Error('shared semantic root drifted');

const gapCases = [{ id: 'operations', proposition: 'What evidence shows the missing permit?', plan: gapPlan }];
const gapReport = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: gapCases });
assertCertificates(procedure, gapReport, gapCases);
if (gapReport.cases[0].disposition !== 'gap') throw new Error(`operations disposition ${gapReport.cases[0].disposition}`);
if (gapReport.cases[0].statement !== 'Evidence requirements not satisfied') throw new Error('gap statement changed');
const gapSlot = gapReport.cases[0].slots.find((slot) => slot.frontier === 'F_S');
if (gapSlot.slot !== 'unadmitted' || gapSlot.unadmittedTokens.join(',') !== 'missing-permit') {
  throw new Error(`operations slot ${gapSlot.slot} ${gapSlot.unadmittedTokens.join(',')}`);
}
if (gapReport.cases[0].coverage.F_S.covered !== 0) throw new Error('unsatisfied coverage was rewritten');

const rejectedCases = [{ id: 'anchor', proposition: 'What evidence shows the valve is closed?', plan: rejectedPlan }];
const rejectedReport = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: rejectedCases });
assertCertificates(procedure, rejectedReport, rejectedCases);
if (rejectedReport.cases[0].status !== 'ANCHOR_REJECTED') throw new Error(rejectedReport.cases[0].status);
if (!rejectedReport.cases[0].slots.every((slot) => slot.slot === 'not-evaluated')) throw new Error('anchor slots were evaluated');

const boundedCases = [{ id: 'search-bound', proposition: 'What evidence shows the valve is closed?', plan: boundedPlan }];
const boundedReport = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: boundedCases });
assertCertificates(procedure, boundedReport, boundedCases);
if (boundedReport.cases[0].status !== 'SEARCH_BOUND_EXCEEDED') throw new Error(boundedReport.cases[0].status);
if (boundedReport.cases[0].certificate.evidenceIds.length !== 0) throw new Error('search bound selected evidence');
const boundedSupport = boundedReport.cases[0].slots.find((slot) => slot.frontier === 'F_S');
const boundedOpposition = boundedReport.cases[0].slots.find((slot) => slot.frontier === 'F_O');
if (boundedSupport.slot !== 'admitted-but-uncovered' || boundedOpposition.slot !== 'admitted-but-uncovered') {
  throw new Error(`search bound slots ${boundedSupport.slot} ${boundedOpposition.slot}`);
}

const pair = [
  { id: 'zeta', proposition: 'Second question?', plan: gapPlan },
  { id: 'alpha', proposition: 'First question?', plan: metPlan },
];
const forward = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: pair });
const backward = createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: [...pair].reverse() });
if (forward.manifest.coverageRoot !== backward.manifest.coverageRoot) throw new Error('case order changed CoverageRoot');

const rootVerdict = verifyKarCoverage({
  image: procedure.image,
  graph: procedure.graph,
  cases: metCases,
  manifest: { ...metReport.manifest, coverageRoot: flipDigest(metReport.manifest.coverageRoot) },
  report: metReport,
});
const flipped = structuredClone(metReport);
flipped.cases[0].certificate.roots.karRoot = flipDigest(flipped.cases[0].certificate.roots.karRoot);
const karVerdict = verifyKarCoverage({
  image: procedure.image,
  graph: procedure.graph,
  cases: metCases,
  manifest: metReport.manifest,
  report: flipped,
});
const rendering = renderKarCoverage(metReport);
if (rendering.includes('Claim proven') || rendering.includes('Claim false')) throw new Error('rendering used a proof sentence');
const renderingVerdict = verifyKarCoverage({
  image: procedure.image,
  graph: procedure.graph,
  cases: metCases,
  manifest: metReport.manifest,
  report: metReport,
  rendering: rendering.replace('Evidence requirements satisfied', 'Claim proven'),
});

const tamperedGraph = structuredClone(procedure.graph);
tamperedGraph.graph.nodes[0].id = 'tampered-node';
const graphVerdict = verifyKarCoverage({
  image: procedure.image,
  graph: tamperedGraph,
  cases: metCases,
  manifest: metReport.manifest,
  report: metReport,
});

let tooManyCode = '';
const many = Array.from({ length: 33 }, (_, index) => ({
  id: `c${String(index).padStart(2, '0')}`,
  proposition: 'too many',
  plan: metPlan,
}));
try {
  createKarCoverage({ image: procedure.image, graph: procedure.graph, cases: many });
} catch (error) {
  tooManyCode = error.code ?? '';
}
const manyVerdict = verifyKarCoverage({
  image: procedure.image,
  graph: procedure.graph,
  cases: many,
  manifest: metReport.manifest,
  report: metReport,
});

const agreementSource = `format: ceg-source-1
concepts:
  agreement:
    label: Agreement
  termination:
    label: Termination
evidence:
  right:
    source: right.txt
  bar:
    source: bar.txt
relations:
  - from: agreement
    type: permits
    to: termination
  - from: agreement
    type: prohibits
    to: termination
bindings:
  - concept: termination
    evidence: right
    requirements:
      - termination-right
  - concept: termination
    evidence: bar
    requirements:
      - termination-barred
requirements:
  - termination-right
  - termination-barred
`;
const agreement = build('kar-coverage-contracts', [
  { source: 'right.txt', text: 'The agreement may terminate. This sentence is evidence for the plan.' },
  { source: 'bar.txt', text: 'The agreement may not terminate. This sentence is evidence for the plan.' },
], agreementSource);
if (!agreement.graph.graph.nodes.some((node) => node.id === cegNodeId('agreement'))) {
  throw new Error('agreement anchor node was not compiled');
}
const loaded = loadDomainDirectory(authoring, path.join(repo, 'domains', 'contracts-v4'));
if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
if (domainPackRoot(loaded.pack) !== CONTRACTS_V4_ROOT) throw new Error('contracts-v4 DomainPackRoot changed');
const expanded = coverageCasesFromDomainPack({
  pack: loaded.pack,
  proposition: 'May this agreement terminate?',
  templates: ['balanced-review', 'support-only'],
});
if (!expanded.ok) throw new Error(JSON.stringify(expanded.diagnostics));
const packReport = createKarCoverage({
  image: agreement.image,
  graph: agreement.graph,
  cases: expanded.cases,
  domainPack: expanded.domainPack,
});
assertCertificates(agreement, packReport, expanded.cases);
if (packReport.domainPack.root !== CONTRACTS_V4_ROOT) throw new Error('recorded pack root changed');
const packSupport = packReport.cases.find((row) => row.id === 'support-only');
if (packSupport.slots.find((slot) => slot.frontier === 'F_O').slot !== 'not-required') {
  throw new Error('contracts support-only F_O was required');
}

const actual = [
  {
    id: 'balanced-met',
    coverageRoot: metReport.manifest.coverageRoot,
    semanticRoot: metReport.semanticRoot,
    case: lockCase(metReport.cases[0]),
  },
  {
    id: 'support-only-met',
    coverageRoot: supportReport.manifest.coverageRoot,
    semanticRoot: supportReport.semanticRoot,
    case: lockCase(supportReport.cases[0]),
  },
  {
    id: 'operations-gap',
    coverageRoot: gapReport.manifest.coverageRoot,
    semanticRoot: gapReport.semanticRoot,
    case: lockCase(gapReport.cases[0]),
  },
  {
    id: 'anchor-rejected',
    coverageRoot: rejectedReport.manifest.coverageRoot,
    semanticRoot: rejectedReport.semanticRoot,
    case: lockCase(rejectedReport.cases[0]),
  },
  {
    id: 'search-bound',
    coverageRoot: boundedReport.manifest.coverageRoot,
    semanticRoot: boundedReport.semanticRoot,
    case: lockCase(boundedReport.cases[0]),
  },
  {
    id: 'reorder',
    coverageRoot: forward.manifest.coverageRoot,
    same: forward.manifest.coverageRoot === backward.manifest.coverageRoot,
  },
  { id: 'coverage-root-tamper', verifyOk: rootVerdict.ok, verifyCode: rootVerdict.code },
  { id: 'kar-root-tamper', verifyOk: karVerdict.ok, verifyCode: karVerdict.code },
  { id: 'rendering-tamper', verifyOk: renderingVerdict.ok, verifyCode: renderingVerdict.code },
  { id: 'graph-tamper', verifyOk: graphVerdict.ok, verifyCode: graphVerdict.code },
  { id: 'too-many-cases', code: tooManyCode, verifyCode: manyVerdict.code },
  {
    id: 'contracts-v4-templates',
    domainPackRoot: packReport.domainPack.root,
    coverageRoot: packReport.manifest.coverageRoot,
    semanticRoot: packReport.semanticRoot,
    cases: packReport.cases.map(lockCase),
  },
];

const expectedPath = path.join(here, 'expected.json');
const payload = { format: 'kar-coverage-conformance-v1', vectors: actual };
if (process.env.KAR_COVERAGE_ACCEPT === '1') {
  writeFileSync(expectedPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`accepted ${actual.length} coverage vectors`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const failures = [];
if (expected.format !== payload.format || expected.vectors.length !== payload.vectors.length) {
  failures.push('expected envelope does not match the runner');
}
for (let index = 0; index < payload.vectors.length; index += 1) {
  const left = JSON.stringify(expected.vectors[index]);
  const right = JSON.stringify(payload.vectors[index]);
  if (left !== right) failures.push(`${payload.vectors[index].id}\n expected ${left}\n actual   ${right}`);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`KAR coverage conformance: ${payload.vectors.length} vectors matched`);
for (const vector of payload.vectors) console.log(vector.id);
