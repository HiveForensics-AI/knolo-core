import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPilotImage } from '../adapter.mjs';
import { materializeScenario, runScenarioCase } from '../materialize.mjs';
import { SCENARIOS } from '../scenarios.mjs';
import { verifyKnoloKar } from '../verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function claimOf(envelope) {
  return {
    kar: envelope.kar,
    image: { stateRoot: envelope.image.stateRoot },
    evidence: envelope.evidence.map((row) => ({ ...row, metadata: row.metadata })),
    frontiers: envelope.frontiers,
  };
}

test('every committed tamper fails verification', () => {
  const spec = SCENARIOS[0];
  const built = materializeScenario(spec);
  const honest = runScenarioCase(built, spec.cases[0]);
  assert.equal(honest.envelope.status, 'SATISFIED');
  const imageBytes = built.image.bytes;
  const sidecar = built.sidecar;
  const query = spec.query;
  const plan = honest.plan;
  const claimed = claimOf(honest.envelope);
  const base = { imageBytes, sidecar, query, plan, claimed };
  assert.equal(verifyKnoloKar(base).ok, true);

  const matrix = [];
  const rejectInputs = (name, mutate) => {
    const next = mutate({
      imageBytes,
      sidecar: clone(sidecar),
      query,
      plan: clone(plan),
      claimed: clone(claimed),
    });
    const verdict = verifyKnoloKar(next);
    assert.equal(verdict.ok, false, `${name} ${verdict.reason}`);
    matrix.push({ name, pass: verdict.ok === false, reason: verdict.reason });
  };
  const rejectClaim = (name, mutate) => {
    const nextClaim = clone(claimed);
    mutate(nextClaim);
    const verdict = verifyKnoloKar({ imageBytes, sidecar, query, plan, claimed: nextClaim });
    assert.equal(verdict.ok, false, `${name} ${verdict.reason}`);
    matrix.push({ name, pass: verdict.ok === false, reason: verdict.reason });
  };

  const otherRoot = `sha256-${'ab'.repeat(32)}`;
  rejectInputs('KnowledgeRoot tamper', (input) => {
    input.sidecar.knowledgeRoot = otherRoot;
    input.sidecar.graph.knowledgeRoot = otherRoot;
    return input;
  });
  rejectInputs('SemanticRoot/CEG tamper', (input) => {
    input.sidecar.graph.provenance.note = 'tampered-ceg';
    return input;
  });
  rejectInputs('query tamper', (input) => {
    input.query = `${query} today`;
    return input;
  });
  rejectInputs('plan tamper', (input) => {
    input.plan.cardinalityBound = 1;
    return input;
  });
  rejectInputs('anchor witness tamper', (input) => {
    input.plan.anchor.witness[0].queryTerm = 'suite';
    return input;
  });
  rejectInputs('relation tamper', (input) => {
    input.sidecar.graph.relations[1].to = 'general-policy';
    return input;
  });
  rejectInputs('evidence binding tamper', (input) => {
    const first = input.sidecar.graph.bindings[0].evidenceId;
    input.sidecar.graph.bindings[0].evidenceId = input.sidecar.graph.bindings[1].evidenceId;
    input.sidecar.graph.bindings[1].evidenceId = first;
    return input;
  });
  rejectInputs('authority tamper', (input) => {
    input.sidecar.graph.bindings[0].authority = 1;
    return input;
  });
  rejectInputs('validity tamper', (input) => {
    input.sidecar.graph.bindings[0].validUntil = '2000-01-01';
    return input;
  });
  rejectInputs('frontier mapping tamper', (input) => {
    delete input.plan.frontierMap.prohibits;
    return input;
  });
  rejectInputs('threshold tamper', (input) => {
    input.plan.floors.F_O = '2';
    return input;
  });
  rejectInputs('as-of tamper', (input) => {
    input.plan.asOf = '1999-01-01';
    return input;
  });
  rejectClaim('frontier tamper', (next) => {
    next.kar.frontiers = { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
    next.frontiers = next.kar.frontiers;
  });
  rejectClaim('evidence set tamper', (next) => {
    next.kar.evidenceIds = [];
    next.kar.choices = [];
    next.evidence = [];
  });
  rejectClaim('decision tamper', (next) => {
    next.kar.decision = { ...next.kar.decision, status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS', cardinality: 0 };
  });
  rejectClaim('KARRoot tamper', (next) => {
    next.kar.roots = { ...next.kar.roots, karRoot: `sha256-${'cd'.repeat(32)}` };
  });
  rejectInputs('modified evidence bytes', () => {
    const documents = spec.documents.map((document, index) => index === 0 ? { ...document, text: `${document.text} tampered` } : document);
    const image = createPilotImage(documents);
    return { imageBytes: image.bytes, sidecar, query, plan, claimed };
  });
  rejectInputs('wrong Knowledge Image root', () => {
    const other = materializeScenario(SCENARIOS[1]);
    return { imageBytes: other.image.bytes, sidecar, query, plan, claimed };
  });
  rejectClaim('changed selected evidence', (next) => {
    next.kar.evidenceIds = [next.kar.evidenceIds[0]];
    next.evidence = [next.evidence[0]];
  });
  rejectInputs('corrupt container byte', () => {
    const bytes = new Uint8Array(imageBytes);
    bytes[bytes.length - 1] ^= 0xff;
    return { imageBytes: bytes, sidecar, query, plan, claimed };
  });
  rejectInputs('state root tamper', (input) => {
    input.sidecar.stateRoot = otherRoot;
    return input;
  });

  assert.equal(matrix.every((row) => row.pass), true);
  fs.mkdirSync(path.join(here, '..', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(here, '..', 'fixtures', 'tamper-matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`);
});
