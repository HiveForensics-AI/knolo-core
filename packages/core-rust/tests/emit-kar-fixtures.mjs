/**
 * Emit the public KAR v1 image bytes and sidecars for the native Rust evaluator.
 *
 * The cases match conformance/kar/v1/run.mjs. This script does not evaluate them.
 * Rust reads the emitted files and checks conformance/kar/v1/expected.json.
 *
 *   node packages/core-rust/tests/emit-kar-fixtures.mjs
 *   node packages/core-rust/tests/emit-kar-fixtures.mjs --check
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import {
  cegNodeId,
  compileCegSource,
  parseCegSource,
} from '@knolo/core/kar/authoring';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'fixtures/kar-v1');
const check = process.argv.includes('--check');
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
    anchor: {
      mode: 'supplied',
      witness: [{ nodeId: anchor, queryTerm: 'evidence' }],
    },
    frontierMap,
    depth: 2,
    cardinalityBound: 8,
    coverageMode: 'requirements',
    requirements: {
      F_S: [],
      F_O: [],
      F_Q: [],
      F_T: [],
      F_A: [],
      ...requirements,
    },
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
  if (!parsed.ok)
    throw new Error(`${actor} source ${JSON.stringify(parsed.diagnostics)}`);
  const compiled = compileCegSource({
    source: parsed.source,
    image: image.bytes,
  });
  if (!compiled.ok)
    throw new Error(`${actor} compile ${JSON.stringify(compiled.diagnostics)}`);
  return { image: image.bytes, sidecar: compiled.sidecar };
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

const supportDocs = [
  {
    source: 'policy.txt',
    text: 'The customer may cancel. This sentence is evidence for the plan.',
  },
];
const oppositionDocs = [
  {
    source: 'contract.txt',
    text: 'The customer may not cancel. This sentence is evidence for the plan.',
  },
];
const qualificationDocs = [
  {
    source: 'exception.txt',
    text: 'A litigation hold excepts destruction. This sentence is evidence for the plan.',
  },
];
const temporalDocs = [
  {
    source: 'notice.txt',
    text: 'The notice applies from 2026-01-01. This sentence is evidence for the plan.',
  },
];
const authorityDocs = [
  {
    source: 'order.txt',
    text: 'The signed order is authority 90. This sentence is evidence for the plan.',
  },
];

const cases = [
  {
    id: 'support',
    frontier: 'F_S',
    proposition: 'What evidence supports cancellation?',
    ...build('kar-v1-support', supportDocs, supportSource),
    plan: plan(
      cegNodeId('customer'),
      { permits: 'F_S' },
      { F_S: ['cancel-allowed'] },
      { F_S: '1' }
    ),
  },
  {
    id: 'opposition',
    frontier: 'F_O',
    proposition: 'What evidence opposes cancellation?',
    ...build('kar-v1-opposition', oppositionDocs, oppositionSource),
    plan: plan(
      cegNodeId('customer'),
      { prohibits: 'F_O' },
      { F_O: ['cancel-barred'] },
      { F_O: '1' }
    ),
  },
  {
    id: 'qualification',
    frontier: 'F_Q',
    proposition: 'What evidence qualifies retention?',
    ...build('kar-v1-qualification', qualificationDocs, qualificationSource),
    plan: plan(
      cegNodeId('office'),
      { excepts: 'F_Q' },
      { F_Q: ['litigation-hold'] },
      { F_Q: '1' }
    ),
  },
  {
    id: 'temporal',
    frontier: 'F_T',
    proposition: 'What evidence is in force?',
    ...build('kar-v1-temporal', temporalDocs, temporalSource),
    plan: plan(
      cegNodeId('office'),
      { during: 'F_T' },
      { F_T: ['in-force'] },
      { F_T: '1' }
    ),
  },
  {
    id: 'authority',
    frontier: 'F_A',
    proposition: 'What authority is cited?',
    ...build('kar-v1-authority', authorityDocs, authoritySource),
    plan: plan(
      cegNodeId('office'),
      { cites: 'F_A' },
      { F_A: ['cited-order'] },
      { F_A: '1' },
      { minAuthority: 50 }
    ),
  },
  {
    id: 'supplied-anchor',
    frontier: 'F_S',
    proposition: 'Which supplied anchor admits the evidence?',
    ...build('kar-v1-supplied-anchor', supportDocs, supportSource),
    plan: plan(
      cegNodeId('customer'),
      { permits: 'F_S' },
      { F_S: ['cancel-allowed'] },
      { F_S: '1' }
    ),
  },
  {
    id: 'abstention',
    frontier: null,
    proposition: 'What evidence shows the missing permit?',
    ...build('kar-v1-abstention', supportDocs, supportSource),
    plan: plan(
      cegNodeId('customer'),
      { permits: 'F_S' },
      { F_S: ['missing-permit'] },
      { F_S: '1' }
    ),
  },
  {
    id: 'search-bound',
    frontier: null,
    proposition: 'What evidence supports cancellation?',
    ...build('kar-v1-search-bound', supportDocs, supportSource),
    plan: (() => {
      const casePlan = plan(
        cegNodeId('customer'),
        { permits: 'F_S' },
        { F_S: ['cancel-allowed'] },
        { F_S: '1' }
      );
      casePlan.bounds = { ...casePlan.bounds, maxCoverVisits: 0 };
      return casePlan;
    })(),
  },
  {
    id: 'closure-bound',
    frontier: null,
    proposition: 'What evidence supports cancellation?',
    ...build('kar-v1-closure-bound', supportDocs, supportSource),
    plan: (() => {
      const casePlan = plan(
        cegNodeId('customer'),
        { permits: 'F_S' },
        { F_S: ['cancel-allowed'] },
        { F_S: '1' }
      );
      casePlan.bounds = { ...casePlan.bounds, maxClosureNodes: 0 };
      return casePlan;
    })(),
  },
  {
    id: 'anchor-rejected',
    frontier: null,
    proposition: 'What evidence supports cancellation?',
    ...build('kar-v1-anchor-rejected', supportDocs, supportSource),
    plan: plan(
      `sha256-${'ab'.repeat(32)}`,
      { permits: 'F_S' },
      { F_S: ['cancel-allowed'] },
      { F_S: '1' }
    ),
  },
];

const manifest = {
  format: 'kar-v1-rust-fixtures',
  cases: cases.map((item) => ({
    id: item.id,
    imageHex: Buffer.from(item.image).toString('hex'),
    frontier: item.frontier,
    proposition: item.proposition,
    plan: item.plan,
    sidecar: item.sidecar,
  })),
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const manifestPath = path.join(outDir, 'cases.json');
  if (
    !existsSync(manifestPath) ||
    readFileSync(manifestPath, 'utf8') !== manifestText
  ) {
    console.error('cases.json does not match the TypeScript image compiler');
    process.exit(1);
  }
  console.log(`KAR v1 Rust fixtures match ${cases.length} cases`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'cases.json'), manifestText);
console.log(`emitted ${cases.length} KAR v1 Rust fixtures`);
