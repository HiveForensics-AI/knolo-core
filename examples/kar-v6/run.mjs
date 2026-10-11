/**
 * V6 product demo.
 *
 * Three redistributable hand-authored examples:
 * contracts keeps support and opposition,
 * policy keeps a rule and an exception,
 * operations shows a satisfied procedure and an evidence-requirement gap.
 *
 * Run from the repository root after building @knolo/core:
 *   node examples/kar-v6/run.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';
import { createKarDossier, createKarSession, evaluateKar, karDossierStatusStatement, renderKarDossier, verifyKar, verifyKarDossier } from '@knolo/core/kar';
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

function plan(anchor, frontierMap, requirements, floors) {
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
    bounds,
    lexical: null,
  };
}

function imageFor(actor, documents) {
  return createKnowledgeImageV5({
    actor,
    sequence: 1,
    objects: documents.map((document) => ({
      kind: 'chunk',
      bytes: encoder.encode(document.text),
      meta: { source: document.source },
    })),
  });
}

function compile(actor, documents, sourceText) {
  const image = imageFor(actor, documents);
  const parsed = parseCegSource(sourceText);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return { image, compiled };
}

function writeCase(name, built, query, casePlan, expectStatus) {
  const directory = path.join(here, name);
  mkdirSync(directory, { recursive: true });
  const graph = built.compiled.sidecar;
  const dossier = createKarDossier({
    image: built.image.bytes,
    graph,
    plan: casePlan,
    proposition: query,
  });
  if (dossier.status !== expectStatus) {
    throw new Error(`${name} status ${dossier.status}, expected ${expectStatus}`);
  }
  if (dossier.statusStatement !== karDossierStatusStatement(expectStatus)) {
    throw new Error(`${name} status statement changed`);
  }
  const verdict = verifyKarDossier({
    image: built.image.bytes,
    graph,
    plan: casePlan,
    proposition: query,
    manifest: dossier.manifest,
    certificate: dossier.certificate,
    evaluation: dossier.evaluation,
    evidenceMarkdown: renderKarDossier(dossier),
  });
  if (!verdict.ok) throw new Error(`${name} dossier ${verdict.code} ${verdict.reason}`);
  writeFileSync(path.join(directory, 'knowledge.knolo'), built.image.bytes);
  writeFileSync(path.join(directory, 'knowledge.ceg.yaml'), built.sourceText);
  writeFileSync(path.join(directory, 'knowledge.kar.json'), built.compiled.bytes);
  writeFileSync(path.join(directory, 'plan.json'), `${JSON.stringify(casePlan, null, 2)}\n`);
  writeFileSync(path.join(directory, 'query.txt'), `${query}\n`);
  const dossierDir = path.join(directory, 'dossier');
  mkdirSync(dossierDir, { recursive: true });
  writeFileSync(path.join(dossierDir, 'knowledge.knolo'), built.image.bytes);
  writeFileSync(path.join(dossierDir, 'knowledge.kar.json'), built.compiled.bytes);
  writeFileSync(path.join(dossierDir, 'plan.json'), `${JSON.stringify(casePlan, null, 2)}\n`);
  writeFileSync(path.join(dossierDir, 'manifest.json'), `${JSON.stringify(dossier.manifest, null, 2)}\n`);
  writeFileSync(path.join(dossierDir, 'certificate.json'), `${JSON.stringify(dossier.certificate, null, 2)}\n`);
  writeFileSync(path.join(dossierDir, 'result.json'), `${JSON.stringify(dossier.evaluation, null, 2)}\n`);
  writeFileSync(path.join(dossierDir, 'evidence.md'), renderKarDossier(dossier));
  return dossier;
}

const contractsSource = `format: ceg-source-1
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

const policySource = `format: ceg-source-1
concepts:
  office:
    label: Office
  retention:
    label: Retention rule
  hold:
    label: Litigation hold
evidence:
  rule:
    source: rule.txt
  exception:
    source: exception.txt
relations:
  - from: office
    type: requires
    to: retention
  - from: office
    type: excepts
    to: hold
bindings:
  - concept: retention
    evidence: rule
    requirements:
      - retain-record
  - concept: hold
    evidence: exception
    requirements:
      - litigation-hold
requirements:
  - retain-record
  - litigation-hold
`;

const operationsSource = `format: ceg-source-1
concepts:
  procedure:
    label: Valve procedure
  step:
    label: Close valve
evidence:
  step:
    source: step.txt
relations:
  - from: procedure
    type: requires
    to: step
bindings:
  - concept: step
    evidence: step
    requirements:
      - close-valve
requirements:
  - close-valve
  - missing-permit
`;

const contracts = compile('kar-v6-contracts-demo', [
  { source: 'policy.txt', text: 'The customer may cancel. This sentence is evidence for the plan.' },
  { source: 'contract.txt', text: 'The customer may not cancel after signature. This sentence is evidence for the plan.' },
], contractsSource);
contracts.sourceText = contractsSource;
const contractsPlan = plan(cegNodeId('customer'), { permits: 'F_S', prohibits: 'F_O' }, {
  F_S: ['cancel-allowed'],
  F_O: ['cancel-barred'],
}, { F_S: '1', F_O: '1' });
const contractsDossier = writeCase(
  'contracts',
  contracts,
  'What evidence bears on customer cancellation?',
  contractsPlan,
  'SATISFIED',
);
if (contractsDossier.support.evidence.length === 0 || contractsDossier.opposition.evidence.length === 0) {
  throw new Error('Contracts demo dropped support or opposition.');
}

const policy = compile('kar-v6-policy-demo', [
  { source: 'rule.txt', text: 'The office must retain the record. This sentence is evidence for the plan.' },
  { source: 'exception.txt', text: 'A litigation hold excepts ordinary destruction. This sentence is evidence for the plan.' },
], policySource);
policy.sourceText = policySource;
const policyPlan = plan(cegNodeId('office'), { requires: 'F_S', excepts: 'F_Q' }, {
  F_S: ['retain-record'],
  F_Q: ['litigation-hold'],
}, { F_S: '1', F_Q: '1' });
const policyDossier = writeCase(
  'policy',
  policy,
  'What evidence bears on retaining the record?',
  policyPlan,
  'SATISFIED',
);
if (policyDossier.support.evidence.length === 0 || policyDossier.qualification.evidence.length === 0) {
  throw new Error('Policy demo dropped the rule or the exception.');
}

const operations = compile('kar-v6-operations-demo', [
  { source: 'step.txt', text: 'The operator must close the valve. This sentence is evidence for the plan.' },
], operationsSource);
operations.sourceText = operationsSource;
const satisfiedPlan = plan(cegNodeId('procedure'), { requires: 'F_S' }, {
  F_S: ['close-valve'],
}, { F_S: '1' });
writeCase(
  'operations',
  operations,
  'What evidence shows the valve is closed?',
  satisfiedPlan,
  'SATISFIED',
);
const gapPlan = plan(cegNodeId('procedure'), { requires: 'F_S' }, {
  F_S: ['missing-permit'],
}, { F_S: '1' });
const gap = evaluateKar(
  createKarSession({ image: operations.image.bytes, graph: operations.compiled.sidecar }),
  { proposition: 'What evidence shows the missing permit?', plan: gapPlan },
);
if (gap.status !== 'UNSATISFIED_EVIDENCE_REQUIREMENTS') {
  throw new Error(`Operations gap status ${gap.status}`);
}
if (karDossierStatusStatement(gap.status) !== 'Evidence requirements not satisfied') {
  throw new Error('Abstention statement changed.');
}
const gapVerdict = verifyKar({
  image: operations.image.bytes,
  graph: operations.compiled.sidecar,
  proposition: 'What evidence shows the missing permit?',
  plan: gapPlan,
  result: gap,
});
if (!gapVerdict.ok) throw new Error(gapVerdict.code);
const gapDir = path.join(here, 'operations', 'gap');
mkdirSync(gapDir, { recursive: true });
writeFileSync(path.join(gapDir, 'plan.json'), `${JSON.stringify(gapPlan, null, 2)}\n`);
writeFileSync(path.join(gapDir, 'query.txt'), 'What evidence shows the missing permit?\n');
writeFileSync(path.join(gapDir, 'result.json'), `${JSON.stringify(gap, null, 2)}\n`);

console.log('contracts SATISFIED support+opposition');
console.log('policy SATISFIED rule+exception');
console.log('operations SATISFIED close-valve');
console.log('operations UNSATISFIED_EVIDENCE_REQUIREMENTS missing-permit');
console.log('VERIFIED');
