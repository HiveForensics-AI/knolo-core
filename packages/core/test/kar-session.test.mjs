import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { digest } from '../dist/experimental/kar/canonicalize.js';
import { evaluate as researchEvaluate } from '../../../research/kar-1/dist/index.js';
import {
  createKarSession,
  evaluateKar,
  explainKarResult,
  inspectKarComplexity,
  validateKarPlan,
  validateKarResult,
  validateKarSidecar,
  verifyKar,
  KarError,
} from '../dist/experimental/kar/index.js';
import { canonicalize } from '../dist/experimental/kar/canonicalize.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('root barrel does not load experimental KAR', () => {
  const dist = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.equal(dist.includes('experimental/kar'), false);
  assert.equal(source.includes('experimental/kar'), false);
});

test('V5 session evaluates, explains, and verifies the frozen certificate', () => {
  const built = buildEnterpriseExample();
  const session = createKarSession({ image: built.image.bytes, graph: built.sidecar, indexes: { ignored: true } });
  assert.notEqual(session.image.stateRoot, session.image.knowledgeRoot);
  assert.equal(session.image.stateRoot, built.image.stateRoot);
  assert.equal(session.roots.semanticRoot.startsWith('sha256-'), true);
  const relations = session.relationsByFrom;
  const result = evaluateKar(session, { proposition: built.query, plan: built.plan });
  const again = evaluateKar(session, { proposition: built.query, plan: built.plan });
  assert.equal(session.relationsByFrom, relations);
  assert.equal(result.certificate.roots.karRoot, again.certificate.roots.karRoot);
  assert.equal(result.status, 'SATISFIED');
  assert.equal(result.frontiers.F_S.length, 1);
  assert.equal(result.frontiers.F_O.length, 1);
  assert.equal(result.selectedEvidence.length, 2);
  assert.ok(result.selectedEvidence.every((row) => typeof row.text === 'string' && row.text.length > 0));
  assert.equal(result.certificate.version, 'kar-1-research-1');

  const research = researchEvaluate(built.projection, built.sidecar.graph, built.query, built.plan);
  assert.equal(canonicalize(result.certificate), canonicalize(research));

  const verification = verifyKar({
    image: built.image.bytes,
    graph: built.sidecar,
    proposition: built.query,
    plan: built.plan,
    result,
  });
  assert.equal(verification.ok, true, verification.reason);

  const tampered = structuredClone(result);
  tampered.certificate.roots.karRoot = `${tampered.certificate.roots.karRoot.slice(0, -1)}a`;
  const rejected = verifyKar({
    image: built.image.bytes,
    graph: built.sidecar,
    proposition: built.query,
    plan: built.plan,
    result: tampered,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'KAR_RESULT_MISMATCH');

  const explanation = explainKarResult(session, result);
  assert.match(explanation.lines.join('\n'), /status SATISFIED/);
  assert.ok(explanation.evidence.some((row) => row.selected && row.necessaryForSelectedSet === true));
  const complexity = inspectKarComplexity(session, built.plan, built.query);
  assert.equal(complexity.advisory, true);
  assert.equal(complexity.risk, 'low');
  const afterInspect = evaluateKar(session, { proposition: built.query, plan: built.plan });
  assert.equal(afterInspect.certificate.roots.karRoot, result.certificate.roots.karRoot);

  const invalidPlan = validateKarPlan({ version: 1 });
  assert.equal(invalidPlan.ok, false);
  assert.equal(invalidPlan.errors[0].code, 'KAR_PLAN_INVALID');
  const invalidResult = validateKarResult({ status: 'SATISFIED' });
  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.errors[0].code, 'KAR_RESULT_INVALID');
});

test('session creation rejects an unbound sidecar and a corrupt image', () => {
  const built = buildEnterpriseExample();
  const unbound = { ...built.sidecar, stateRoot: `${built.sidecar.stateRoot.slice(0, -1)}b` };
  assert.throws(() => createKarSession({ image: built.image.bytes, graph: unbound }), (error) => {
    assert.ok(error instanceof KarError);
    assert.equal(error.code, 'KAR_GRAPH_NOT_BOUND');
    return true;
  });
  const corrupt = Uint8Array.from(built.image.bytes);
  corrupt[corrupt.length - 1] ^= 0xff;
  const verdict = verifyKar({
    image: corrupt,
    graph: built.sidecar,
    proposition: built.query,
    plan: built.plan,
    result: { version: 'kar-1-research-1' },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'KAR_IMAGE_REJECTED');
  const sidecar = validateKarSidecar({ version: 1, stateRoot: 'nope' });
  assert.equal(sidecar.ok, false);
  assert.equal(sidecar.errors[0].code, 'KAR_SIDECAR_INVALID');
});

function buildEnterpriseExample() {
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
  const projection = { version: 1, evidence };
  const knowledgeRoot = digest(projection);
  const bySource = new Map(image.objects.map((object) => [object.meta.source, object.id]));
  const graph = {
    version: 1,
    knowledgeRoot,
    provenance: { producer: 'hand', note: 'enterprise-cancel' },
    nodes: [{ id: 'lodging' }, { id: 'policy' }, { id: 'contract' }],
    relations: [
      { id: 'r-support', from: 'lodging', relation: 'supports', to: 'policy' },
      { id: 'r-oppose', from: 'lodging', relation: 'prohibits', to: 'contract' },
    ],
    bindings: [
      { id: 'b-policy', nodeId: 'policy', evidenceId: bySource.get('front-desk/cancellation-policy'), requirements: ['cancel-allowed'] },
      { id: 'b-contract', nodeId: 'contract', evidenceId: bySource.get('contracts/enterprise-lodging'), requirements: ['cancel-barred'] },
    ],
  };
  const sidecar = {
    version: 1,
    stateRoot: image.stateRoot,
    objectRoot: image.commit.objectRoot,
    commitDigest: image.commitDigest,
    knowledgeRoot,
    graph,
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
  return { image, projection, sidecar, plan, query: 'Can this enterprise customer cancel?' };
}
