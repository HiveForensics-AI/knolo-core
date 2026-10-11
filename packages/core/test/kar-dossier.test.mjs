import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { digest } from '../dist/experimental/kar/canonicalize.js';
import {
  createKarDossier,
  karDossierStatusStatement,
  renderKarDossier,
  verifyKarDossier,
} from '../dist/experimental/kar/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('dossier packaging repeats and fails closed without changing KAR semantics', () => {
  const built = buildEnterpriseExample();
  const first = createKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: built.plan,
    proposition: built.query,
  });
  const second = createKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: built.plan,
    proposition: built.query,
  });
  assert.equal(first.format, 'kar-evidence-dossier-1');
  assert.equal(first.status, 'SATISFIED');
  assert.equal(first.statusStatement, 'Evidence requirements satisfied');
  assert.equal(karDossierStatusStatement('UNSATISFIED_EVIDENCE_REQUIREMENTS'), 'Evidence requirements not satisfied');
  assert.equal(first.manifest.karRoot, first.certificate.roots.karRoot);
  assert.equal(first.manifest.resultDigest, digest(first.certificate));
  assert.equal(first.manifest.queryDigest, digest(built.query));
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
  assert.equal(JSON.stringify(first.certificate), JSON.stringify(second.certificate));
  assert.equal(renderKarDossier(first), renderKarDossier(second));
  assert.match(renderKarDossier(first), /Evidence requirements satisfied/);
  assert.doesNotMatch(renderKarDossier(first), /Claim proven true|Claim false/);
  assert.equal(first.support.evidence.length, 1);
  assert.equal(first.opposition.evidence.length, 1);
  assert.ok(first.selectedEvidence.every((row) => typeof row.text === 'string' && row.text.length > 0));

  const verified = verifyKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: built.plan,
    proposition: built.query,
    manifest: first.manifest,
    certificate: first.certificate,
    evaluation: first.evaluation,
    evidenceMarkdown: renderKarDossier(first),
  });
  assert.equal(verified.ok, true, verified.reason);

  const tamperedManifest = { ...first.manifest, karRoot: `${first.manifest.karRoot.slice(0, -1)}0` };
  const manifestFail = verifyKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: built.plan,
    proposition: built.query,
    manifest: tamperedManifest,
    certificate: first.certificate,
    evaluation: first.evaluation,
    evidenceMarkdown: renderKarDossier(first),
  });
  assert.equal(manifestFail.ok, false);
  assert.equal(manifestFail.code, 'KAR_RESULT_MISMATCH');

  const tamperedCertificate = structuredClone(first.certificate);
  tamperedCertificate.status = 'UNSATISFIED_EVIDENCE_REQUIREMENTS';
  const certificateFail = verifyKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: built.plan,
    proposition: built.query,
    manifest: first.manifest,
    certificate: tamperedCertificate,
  });
  assert.equal(certificateFail.ok, false);

  const proseFail = verifyKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: built.plan,
    proposition: built.query,
    manifest: first.manifest,
    certificate: first.certificate,
    evidenceMarkdown: renderKarDossier(first).replace('Evidence requirements satisfied', 'Claim proven true'),
  });
  assert.equal(proseFail.ok, false);
  assert.match(proseFail.reason, /rendering/);

  const gapPlan = structuredClone(built.plan);
  gapPlan.requirements.F_A = ['named-authority'];
  gapPlan.floors.F_A = '1';
  const gap = createKarDossier({
    image: built.image.bytes,
    graph: built.sidecar,
    plan: gapPlan,
    proposition: 'Which office has authority to waive the cancellation bar?',
  });
  assert.equal(gap.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.equal(gap.statusStatement, 'Evidence requirements not satisfied');
  assert.match(renderKarDossier(gap), /Evidence requirements not satisfied/);
  assert.doesNotMatch(renderKarDossier(gap), /Claim false/);
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
    actor: 'kar-dossier',
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
  return { image, sidecar, plan, query: 'Can this enterprise customer cancel?' };
}
