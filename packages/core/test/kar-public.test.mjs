import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import {
  createKarDossier,
  createKarSession,
  evaluateKar,
  explainKarCertificate,
  explainKarResult,
  inspectKarComplexity,
  verifyKar,
} from '../dist/kar/index.js';
import { compileCegSource, parseCegSource, validateCegSource } from '../dist/kar/authoring/index.js';
import { createKarSession as experimentalSession } from '../dist/experimental/kar/index.js';

const root = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
const publicKar = readFileSync(new URL('../dist/kar/index.js', import.meta.url), 'utf8');

test('root entry does not load KAR or authoring', () => {
  assert.equal(root.includes('experimental/kar'), false);
  assert.equal(root.includes('/kar/index'), false);
  assert.equal(publicKar.includes('/authoring'), false);
  assert.equal(publicKar.includes('node:fs'), false);
  assert.equal(publicKar.includes('node:crypto'), false);
});

test('public and experimental sessions evaluate the same status', () => {
  const image = createKnowledgeImageV5({
    actor: 'kar-public-test',
    sequence: 1,
    objects: [{
      kind: 'chunk',
      bytes: new TextEncoder().encode('The customer may cancel. This sentence is evidence for the plan.'),
      meta: { source: 'policy.txt' },
    }],
  });
  const source = `format: ceg-source-1
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
  const parsed = validateCegSource(source);
  assert.equal(parsed.ok, true);
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  assert.equal(compiled.ok, true);
  const plan = {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: compiled.sidecar.graph.relations[0].from, queryTerm: 'evidence' }] },
    frontierMap: { permits: 'F_S' },
    depth: 2,
    cardinalityBound: 4,
    coverageMode: 'requirements',
    requirements: { F_S: ['cancel-allowed'], F_O: [], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '1', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: {
      maxAnchorNodes: 4,
      maxClosureNodes: 8,
      maxClosureEdges: 8,
      maxFrontierEvidence: 4,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 4,
      maxCoverVisits: 100,
    },
    lexical: null,
  };
  const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
  const again = experimentalSession({ image: image.bytes, graph: compiled.sidecar });
  const result = evaluateKar(session, { proposition: 'What evidence supports cancellation?', plan });
  const experimental = evaluateKar(again, { proposition: 'What evidence supports cancellation?', plan });
  assert.equal(result.status, 'SATISFIED');
  assert.equal(result.certificate.roots.karRoot, experimental.certificate.roots.karRoot);
  assert.equal(verifyKar({ image: image.bytes, graph: compiled.sidecar, proposition: result.proposition, plan, result }).ok, true);
  const dossierA = createKarDossier({ image: image.bytes, graph: compiled.sidecar, plan, proposition: result.proposition });
  const dossierB = createKarDossier({ image: image.bytes, graph: compiled.sidecar, plan, proposition: result.proposition });
  assert.equal(JSON.stringify(dossierA.manifest), JSON.stringify(dossierB.manifest));
  assert.equal(dossierA.statusStatement, 'Evidence requirements satisfied');
  assert.equal(explainKarResult(session, result).status, 'SATISFIED');
  assert.ok(explainKarResult(session, result).lines.length > 0);
  assert.equal(explainKarCertificate(result.certificate).status, 'SATISFIED');
  assert.equal(typeof inspectKarComplexity(session, plan, result.proposition).risk, 'string');
});

test('YAML rejects prototype keys and validateCegSource rejects a bad object', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const parsed = parseCegSource(`${key}:\n  label: Customer\n`);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.diagnostics[0].code, 'CEG_PARSE');
  }
  const invalid = validateCegSource({ format: 'not-ceg' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].code, 'CEG_SOURCE_INVALID');
  const json = parseCegSource('{"__proto__":{"label":"Customer"}}');
  assert.equal(json.ok, false);
  assert.equal(json.diagnostics[0].code, 'CEG_PARSE');
  const concepts = {};
  Object.defineProperty(concepts, '__proto__', {
    value: { label: 'Customer' },
    enumerable: true,
    configurable: true,
  });
  const objectSource = validateCegSource({
    format: 'ceg-source-1',
    concepts,
    evidence: {},
    relations: [],
    bindings: [],
    requirements: [],
  });
  assert.equal(objectSource.ok, false);
  assert.equal(objectSource.diagnostics.some((item) => item.code === 'CEG_INVALID_IDENTIFIER'), true);
});
