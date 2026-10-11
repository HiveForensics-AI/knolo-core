import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { canonicalize } from '../dist/experimental/kar/canonicalize.js';
import { compileCegSource, coverageCasesFromDomainPack, domainPackRoot, validateCegSource } from '../dist/kar/authoring/index.js';
import {
  createKarCoverage,
  createKarSession,
  evaluateKar,
  karCoverageStatement,
  renderKarCoverage,
  verifyKarCoverage,
} from '../dist/kar/index.js';
import * as authoring from '../dist/experimental/kar/authoring/index.js';
import { loadDomainDirectory } from '../../cli/bin/kar-produce.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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

function plan(nodeId, requirements, floors, patch = {}) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId, queryTerm: 'evidence' }] },
    frontierMap: { requires: 'F_S', prohibits: 'F_O' },
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

function built() {
  const image = createKnowledgeImageV5({
    actor: 'kar-coverage-unit',
    sequence: 1,
    objects: [{
      kind: 'chunk',
      bytes: new TextEncoder().encode('The operator must close the valve. This sentence is evidence for the plan.'),
      meta: { source: 'step.txt' },
    }],
  });
  const parsed = validateCegSource(sourceText);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  return { image: image.bytes, graph: compiled.sidecar, nodeId: compiled.sidecar.graph.relations[0].from };
}

function flipDigest(value) {
  const last = value.at(-1) === '0' ? '1' : '0';
  return `${value.slice(0, -1)}${last}`;
}

function slot(row, frontier) {
  return row.slots.find((item) => item.frontier === frontier);
}

test('coverage reports met, gap, blocked, and a stable root', () => {
  const fixture = built();
  const metPlan = plan(fixture.nodeId, { F_S: ['close-valve'] }, { F_S: '1' });
  const supportPlan = plan(fixture.nodeId, { F_S: ['close-valve'] }, { F_S: '1', F_O: '0' });
  const gapPlan = plan(fixture.nodeId, { F_S: ['missing-permit'] }, { F_S: '1' });
  const rejectedPlan = plan('missing-node', { F_S: ['close-valve'] }, { F_S: '1' });
  const boundedPlan = plan(fixture.nodeId, { F_S: ['close-valve'] }, { F_S: '1' }, {
    bounds: { ...bounds, maxCoverVisits: 0 },
  });
  const cases = [
    { id: 'gap', proposition: 'Which permit is missing?', plan: gapPlan },
    { id: 'met', proposition: 'What evidence shows the valve is closed?', plan: metPlan },
  ];
  const report = createKarCoverage({ image: fixture.image, graph: fixture.graph, cases });
  const reversed = createKarCoverage({ image: fixture.image, graph: fixture.graph, cases: [...cases].reverse() });
  assert.equal(report.manifest.coverageRoot, reversed.manifest.coverageRoot);
  assert.equal(canonicalize(report), canonicalize(reversed));
  assert.notEqual(report.image.stateRoot, report.image.knowledgeRoot);
  assert.equal(report.cases.every((row) => row.certificate.roots.semanticRoot === report.semanticRoot), true);
  assert.deepEqual(report.cases.map((row) => row.id), ['gap', 'met']);

  const session = createKarSession({ image: fixture.image, graph: fixture.graph });
  for (const row of report.cases) {
    const evaluation = evaluateKar(session, { proposition: row.proposition, plan: cases.find((item) => item.id === row.id).plan });
    assert.equal(canonicalize(row.certificate), canonicalize(evaluation.certificate));
    assert.equal(row.statement, karCoverageStatement(row.status));
  }

  const met = report.cases[1];
  assert.equal(met.status, 'SATISFIED');
  assert.equal(met.disposition, 'met');
  assert.equal(met.statement, 'Evidence requirements satisfied');
  assert.equal(slot(met, 'F_S').slot, 'met');
  assert.deepEqual(slot(met, 'F_O').unadmittedTokens, []);
  assert.equal(slot(met, 'F_O').slot, 'not-required');

  const gap = report.cases[0];
  assert.equal(gap.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.equal(gap.disposition, 'gap');
  assert.equal(gap.statement, 'Evidence requirements not satisfied');
  assert.equal(slot(gap, 'F_S').slot, 'unadmitted');
  assert.deepEqual(slot(gap, 'F_S').unadmittedTokens, ['missing-permit']);
  assert.equal(gap.coverage.F_S.covered, 0);
  assert.equal(gap.coverage.F_S.required, 1);
  assert.equal(gap.certificate.evidenceIds.length, 0);

  const support = createKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases: [{ id: 'support', proposition: 'What evidence shows the valve is closed?', plan: supportPlan }],
  });
  assert.equal(slot(support.cases[0], 'F_O').slot, 'not-required');
  assert.equal(support.cases[0].disposition, 'met');

  const rejected = createKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases: [{ id: 'anchor', proposition: 'What evidence shows the valve is closed?', plan: rejectedPlan }],
  });
  assert.equal(rejected.cases[0].status, 'ANCHOR_REJECTED');
  assert.equal(rejected.cases[0].disposition, 'blocked');
  assert.equal(rejected.cases[0].slots.every((item) => item.slot === 'not-evaluated'), true);

  const bounded = createKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases: [{ id: 'bound', proposition: 'What evidence shows the valve is closed?', plan: boundedPlan }],
  });
  assert.equal(bounded.cases[0].status, 'SEARCH_BOUND_EXCEEDED');
  assert.equal(bounded.cases[0].disposition, 'blocked');
  assert.equal(bounded.cases[0].certificate.evidenceIds.length, 0);
  assert.equal(slot(bounded.cases[0], 'F_S').slot, 'admitted-but-uncovered');
  assert.deepEqual(slot(bounded.cases[0], 'F_S').unadmittedTokens, []);

  const dropped = createKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases: [cases[1]],
  });
  assert.notEqual(dropped.manifest.coverageRoot, report.manifest.coverageRoot);

  const verdict = verifyKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases,
    manifest: report.manifest,
    report,
    rendering: renderKarCoverage(report),
  });
  assert.equal(verdict.ok, true, verdict.reason);
  const flippedRoot = { ...report.manifest, coverageRoot: flipDigest(report.manifest.coverageRoot) };
  const rootVerdict = verifyKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases,
    manifest: flippedRoot,
    report,
  });
  assert.equal(rootVerdict.ok, false);
  assert.equal(rootVerdict.code, 'KAR_RESULT_MISMATCH');
  const flippedKar = structuredClone(report);
  flippedKar.cases[0].certificate.roots.karRoot = flipDigest(flippedKar.cases[0].certificate.roots.karRoot);
  const karVerdict = verifyKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases,
    manifest: report.manifest,
    report: flippedKar,
  });
  assert.equal(karVerdict.code, 'KAR_RESULT_MISMATCH');
  const claim = verifyKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases,
    manifest: report.manifest,
    report,
    rendering: renderKarCoverage(report).replace('Evidence requirements satisfied', 'Claim proven'),
  });
  assert.equal(claim.code, 'KAR_RESULT_MISMATCH');
  assert.equal(renderKarCoverage(report).includes('Claim proven'), false);
  assert.equal(renderKarCoverage(report).includes('Claim false'), false);

  const tampered = structuredClone(fixture.graph);
  tampered.graph.nodes[0].id = 'tampered-node';
  const graphVerdict = verifyKarCoverage({
    image: fixture.image,
    graph: tampered,
    cases,
    manifest: report.manifest,
    report,
  });
  assert.equal(graphVerdict.ok, false);
  assert.equal(graphVerdict.code, 'KAR_GRAPH_INVALID');

  const many = Array.from({ length: 33 }, (_, index) => ({
    id: `c${String(index).padStart(2, '0')}`,
    proposition: 'too many',
    plan: metPlan,
  }));
  assert.throws(() => createKarCoverage({ image: fixture.image, graph: fixture.graph, cases: many }), (error) => error.code === 'KAR_COVERAGE_INVALID');
  const manyVerdict = verifyKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases: many,
    manifest: report.manifest,
    report,
  });
  assert.equal(manyVerdict.code, 'KAR_COVERAGE_INVALID');
  assert.throws(() => createKarCoverage({ image: fixture.image, graph: fixture.graph, cases: [] }), (error) => error.code === 'KAR_COVERAGE_INVALID');
  assert.throws(() => createKarCoverage({
    image: fixture.image,
    graph: fixture.graph,
    cases: [
      { id: 'same', proposition: 'one', plan: metPlan },
      { id: 'same', proposition: 'two', plan: gapPlan },
    ],
  }), (error) => error.code === 'KAR_COVERAGE_INVALID');
});

test('domain pack expansion uses one question and keeps the contracts v4 root', () => {
  const loaded = loadDomainDirectory(authoring, path.join(repo, 'domains', 'contracts-v4'));
  assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
  assert.equal(domainPackRoot(loaded.pack), CONTRACTS_V4_ROOT);
  const expanded = coverageCasesFromDomainPack({
    pack: loaded.pack,
    proposition: 'May this agreement terminate?',
    templates: ['support-only', 'balanced-review'],
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.diagnostics));
  assert.deepEqual(expanded.cases.map((item) => item.id), ['balanced-review', 'support-only']);
  assert.equal(expanded.cases.every((item) => item.proposition === 'May this agreement terminate?'), true);
  assert.equal(expanded.domainPack.root, CONTRACTS_V4_ROOT);
  const queries = coverageCasesFromDomainPack({
    pack: loaded.pack,
    templates: ['balanced-review'],
    queries: { 'balanced-review': 'Which termination evidence is committed?' },
  });
  assert.equal(queries.ok, true, JSON.stringify(queries.diagnostics));
  assert.equal(queries.cases[0].proposition, 'Which termination evidence is committed?');
  const unknown = coverageCasesFromDomainPack({
    pack: loaded.pack,
    proposition: 'May this agreement terminate?',
    templates: ['not-a-template'],
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.diagnostics.some((item) => item.code === 'CEG_DOMAIN_PLAN_INVALID'), true);
});

test('coverage conformance lock matches', () => {
  const result = spawnSync(process.execPath, [path.join(repo, 'conformance', 'kar', 'coverage-v1', 'run.mjs')], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
