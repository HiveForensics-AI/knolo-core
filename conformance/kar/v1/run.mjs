/**
 * Public KAR v1 conformance vectors.
 *
 * These cases are small, hand-authored, and redistributable. They exercise the
 * production TypeScript entry `@knolo/core/kar` on V5 Knowledge Images.
 * They are not the research oracle. The oracle remains `research/kar-1`.
 *
 *   node conformance/kar/v1/run.mjs
 *
 * Native Rust executes these V5 vectors from the emitted fixtures:
 *   npm run test:rust
 * The research oracle does not execute these vectors:
 *   cargo test --manifest-path research/kar-1/rust/Cargo.toml --offline
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import {
  createKarDossier,
  createKarSession,
  evaluateKar,
  renderKarDossier,
  verifyKar,
  verifyKarDossier,
} from '@knolo/core/kar';
import { cegNodeId, compileCegSource, parseCegSource } from '@knolo/core/kar/authoring';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const bounds = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 32,
  maxFrontierEvidence: 8,
  maxRequirementsPerFrontier: 4,
  maxEvidenceBindings: 8,
  maxCoverVisits: 1000,
};

function plan(anchor, frontierMap, requirements, floors, patch = {}) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: anchor, queryTerm: 'evidence' }] },
    frontierMap,
    depth: 2,
    cardinalityBound: 8,
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

function evaluate(actor, documents, sourceText, casePlan, proposition) {
  const built = build(actor, documents, sourceText);
  const session = createKarSession({ image: built.image, graph: built.graph });
  const first = evaluateKar(session, { proposition, plan: casePlan });
  const second = evaluateKar(session, { proposition, plan: casePlan });
  if (JSON.stringify(first.certificate) !== JSON.stringify(second.certificate)) {
    throw new Error(`${actor} certificate was not reproducible`);
  }
  const verdict = verifyKar({
    image: built.image,
    graph: built.graph,
    proposition,
    plan: casePlan,
    result: first,
  });
  return { built, result: first, verdict };
}

const supportSource = `format: ceg-source-1
concepts:
  customer:
    label: Customer
  cancellation:
    label: Cancellation
evidence:
  policy:
    source: policy.txt
relations:
  - from: customer
    type: permits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: policy
    requirements:
      - cancel-allowed
requirements:
  - cancel-allowed
`;

const oppositionSource = `format: ceg-source-1
concepts:
  customer:
    label: Customer
  cancellation:
    label: Cancellation
evidence:
  contract:
    source: contract.txt
relations:
  - from: customer
    type: prohibits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: contract
    requirements:
      - cancel-barred
requirements:
  - cancel-barred
`;

const qualificationSource = `format: ceg-source-1
concepts:
  office:
    label: Office
  record:
    label: Record
evidence:
  exception:
    source: exception.txt
relations:
  - from: office
    type: excepts
    to: record
bindings:
  - concept: record
    evidence: exception
    requirements:
      - litigation-hold
requirements:
  - litigation-hold
`;

const temporalSource = `format: ceg-source-1
concepts:
  office:
    label: Office
  window:
    label: Window
evidence:
  notice:
    source: notice.txt
relations:
  - from: office
    type: during
    to: window
bindings:
  - concept: window
    evidence: notice
    requirements:
      - in-force
    validFrom: 2026-01-01
requirements:
  - in-force
`;

const authoritySource = `format: ceg-source-1
concepts:
  office:
    label: Office
  ruling:
    label: Ruling
evidence:
  order:
    source: order.txt
relations:
  - from: office
    type: cites
    to: ruling
bindings:
  - concept: ruling
    evidence: order
    requirements:
      - cited-order
    authority: 90
requirements:
  - cited-order
`;

const supportDocs = [{ source: 'policy.txt', text: 'The customer may cancel. This sentence is evidence for the plan.' }];
const oppositionDocs = [{ source: 'contract.txt', text: 'The customer may not cancel. This sentence is evidence for the plan.' }];
const qualificationDocs = [{ source: 'exception.txt', text: 'A litigation hold excepts destruction. This sentence is evidence for the plan.' }];
const temporalDocs = [{ source: 'notice.txt', text: 'The notice applies from 2026-01-01. This sentence is evidence for the plan.' }];
const authorityDocs = [{ source: 'order.txt', text: 'The signed order is authority 90. This sentence is evidence for the plan.' }];

const cases = [
  {
    id: 'support',
    run: () => evaluate('kar-v1-support', supportDocs, supportSource, plan(cegNodeId('customer'), { permits: 'F_S' }, { F_S: ['cancel-allowed'] }, { F_S: '1' }), 'What evidence supports cancellation?'),
  },
  {
    id: 'opposition',
    run: () => evaluate('kar-v1-opposition', oppositionDocs, oppositionSource, plan(cegNodeId('customer'), { prohibits: 'F_O' }, { F_O: ['cancel-barred'] }, { F_O: '1' }), 'What evidence opposes cancellation?'),
  },
  {
    id: 'qualification',
    run: () => evaluate('kar-v1-qualification', qualificationDocs, qualificationSource, plan(cegNodeId('office'), { excepts: 'F_Q' }, { F_Q: ['litigation-hold'] }, { F_Q: '1' }), 'What evidence qualifies retention?'),
  },
  {
    id: 'temporal',
    run: () => evaluate('kar-v1-temporal', temporalDocs, temporalSource, plan(cegNodeId('office'), { during: 'F_T' }, { F_T: ['in-force'] }, { F_T: '1' }), 'What evidence is in force?'),
  },
  {
    id: 'authority',
    run: () => evaluate('kar-v1-authority', authorityDocs, authoritySource, plan(cegNodeId('office'), { cites: 'F_A' }, { F_A: ['cited-order'] }, { F_A: '1' }, { minAuthority: 50 }), 'What authority is cited?'),
  },
  {
    id: 'supplied-anchor',
    run: () => evaluate('kar-v1-supplied-anchor', supportDocs, supportSource, plan(cegNodeId('customer'), { permits: 'F_S' }, { F_S: ['cancel-allowed'] }, { F_S: '1' }), 'Which supplied anchor admits the evidence?'),
  },
  {
    id: 'abstention',
    run: () => evaluate('kar-v1-abstention', supportDocs, supportSource, plan(cegNodeId('customer'), { permits: 'F_S' }, { F_S: ['missing-permit'] }, { F_S: '1' }), 'What evidence shows the missing permit?'),
  },
  {
    id: 'search-bound',
    run: () => {
      const casePlan = plan(cegNodeId('customer'), { permits: 'F_S' }, { F_S: ['cancel-allowed'] }, { F_S: '1' });
      casePlan.bounds = { ...casePlan.bounds, maxCoverVisits: 0 };
      return evaluate('kar-v1-search-bound', supportDocs, supportSource, casePlan, 'What evidence supports cancellation?');
    },
  },
  {
    id: 'closure-bound',
    run: () => {
      const casePlan = plan(cegNodeId('customer'), { permits: 'F_S' }, { F_S: ['cancel-allowed'] }, { F_S: '1' });
      casePlan.bounds = { ...casePlan.bounds, maxClosureNodes: 0 };
      return evaluate('kar-v1-closure-bound', supportDocs, supportSource, casePlan, 'What evidence supports cancellation?');
    },
  },
  {
    id: 'anchor-rejected',
    run: () => evaluate(
      'kar-v1-anchor-rejected',
      supportDocs,
      supportSource,
      plan(`sha256-${'ab'.repeat(32)}`, { permits: 'F_S' }, { F_S: ['cancel-allowed'] }, { F_S: '1' }),
      'What evidence supports cancellation?',
    ),
  },
];

const frontierFor = {
  support: 'F_S',
  opposition: 'F_O',
  qualification: 'F_Q',
  temporal: 'F_T',
  authority: 'F_A',
  'supplied-anchor': 'F_S',
};

const actual = [];
for (const item of cases) {
  const ran = item.run();
  if (!ran.verdict.ok) throw new Error(`${item.id} verify ${ran.verdict.code} ${ran.verdict.reason}`);
  const frontier = frontierFor[item.id];
  actual.push({
    id: item.id,
    status: ran.result.status,
    code: ran.result.code,
    verified: true,
    frontier,
    frontierCount: frontier ? ran.result.frontiers[frontier].length : 0,
    selected: ran.result.selectedEvidence.length,
    karRoot: ran.result.certificate.roots.karRoot,
    knowledgeRoot: ran.result.certificate.roots.knowledgeRoot,
    semanticRoot: ran.result.certificate.roots.semanticRoot,
    anchorMode: ran.result.plan.anchor.mode,
  });
}

const tamperBase = cases[0].run();
const tampered = JSON.parse(JSON.stringify(tamperBase.result));
tampered.certificate.roots.karRoot = `${tampered.certificate.roots.karRoot.slice(0, -1)}${tampered.certificate.roots.karRoot.endsWith('0') ? '1' : '0'}`;
const tamperVerdict = verifyKar({
  image: tamperBase.built.image,
  graph: tamperBase.built.graph,
  proposition: 'What evidence supports cancellation?',
  plan: tamperBase.result.plan,
  result: tampered,
});
actual.push({
  id: 'tamper-rejection',
  status: tamperBase.result.status,
  verifyOk: tamperVerdict.ok,
  verifyCode: tamperVerdict.ok ? null : tamperVerdict.code,
  karRoot: tamperBase.result.certificate.roots.karRoot,
});

const dossier = createKarDossier({
  image: tamperBase.built.image,
  graph: tamperBase.built.graph,
  plan: tamperBase.result.plan,
  proposition: 'What evidence supports cancellation?',
});
const dossierAgain = createKarDossier({
  image: tamperBase.built.image,
  graph: tamperBase.built.graph,
  plan: tamperBase.result.plan,
  proposition: 'What evidence supports cancellation?',
});
if (JSON.stringify(dossier.manifest) !== JSON.stringify(dossierAgain.manifest)) {
  throw new Error('dossier manifest was not reproducible');
}
if (renderKarDossier(dossier) !== renderKarDossier(dossierAgain)) {
  throw new Error('dossier rendering was not reproducible');
}
const dossierVerdict = verifyKarDossier({
  image: tamperBase.built.image,
  graph: tamperBase.built.graph,
  plan: tamperBase.result.plan,
  proposition: dossier.proposition,
  manifest: dossier.manifest,
  certificate: dossier.certificate,
  evaluation: dossier.evaluation,
  evidenceMarkdown: renderKarDossier(dossier),
});
if (!dossierVerdict.ok) throw new Error(`dossier ${dossierVerdict.code}`);
const tamperedMarkdown = renderKarDossier(dossier).replace('Evidence requirements satisfied', 'Claim proven');
const markdownVerdict = verifyKarDossier({
  image: tamperBase.built.image,
  graph: tamperBase.built.graph,
  plan: tamperBase.result.plan,
  proposition: dossier.proposition,
  manifest: dossier.manifest,
  certificate: dossier.certificate,
  evaluation: dossier.evaluation,
  evidenceMarkdown: tamperedMarkdown,
});
actual.push({
  id: 'dossier-language-tamper',
  statusStatement: dossier.statusStatement,
  verifyOk: markdownVerdict.ok,
  verifyCode: markdownVerdict.ok ? null : markdownVerdict.code,
});

const expectedPath = path.join(here, 'expected.json');
const payload = { format: 'kar-conformance-v1', vectors: actual };
if (process.env.KAR_V1_ACCEPT === '1') {
  writeFileSync(expectedPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`accepted ${actual.length} vectors`);
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
console.log(`KAR conformance v1: ${payload.vectors.length} vectors matched`);
for (const vector of payload.vectors) {
  if (vector.verifyCode) console.log(`${vector.id} ${vector.verifyCode}`);
  else console.log(`${vector.id} ${vector.status}`);
}
