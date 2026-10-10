import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { digest } from '../dist/experimental/kar/canonicalize.js';
import { createKarSession, evaluateKar } from '../dist/experimental/kar/index.js';
import {
  CEG_COMPILER_PRODUCER,
  buildDistributionFiles,
  checkCegFreshness,
  compileCegSource,
  createCegSource,
  diffCegGraphs,
  emitCegSourceJson,
  emitCegSourceYaml,
  importClaimGraph,
  importJsonGraph,
  inspectCegQuality,
  inspectKarReadiness,
  loadKarBundle,
  parseCegSource,
  produceCegSource,
  rebuildCegSource,
  reviewCegSource,
} from '../dist/experimental/kar/authoring/index.js';

const encoder = new TextEncoder();

function imageFrom(documents, sequence = 1) {
  return createKnowledgeImageV5({
    actor: 'ceg-authoring-test',
    sequence,
    objects: documents.map((document) => ({
      kind: 'chunk',
      bytes: encoder.encode(document.text),
      meta: document.meta,
    })),
  });
}

const baseDocuments = [
  { text: 'A guest may cancel.', meta: { source: 'policy.md', namespace: 'front' } },
  { text: 'Enterprise customers may not cancel.', meta: { source: 'contract.md', namespace: 'legal' } },
];

const yaml = `format: ceg-source-1
concepts:
  contract:
    label: Enterprise contract
  cancel:
    label: Cancellation
relations:
  - from: contract
    type: prohibits
    to: cancel
evidence:
  clause:
    source: contract.md
    namespace: legal
bindings:
  - concept: cancel
    evidence: clause
    requirements:
      - cancel-barred
    authority: 80
    validFrom: 2026-01-01
requirements:
  - cancel-barred
`;

test('yaml and json compile to the same frozen sidecar', () => {
  const image = imageFrom(baseDocuments);
  const parsed = parseCegSource(yaml);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
  const json = parseCegSource(emitCegSourceJson(parsed.source));
  const again = parseCegSource(emitCegSourceYaml(parsed.source));
  assert.equal(json.ok, true);
  assert.equal(again.ok, true);
  assert.equal(JSON.stringify(json.source), JSON.stringify(parsed.source));
  assert.equal(JSON.stringify(again.source), JSON.stringify(parsed.source));
  const compiled = compileCegSource({ source: parsed.source, image: image.bytes });
  const fromJson = compileCegSource({ source: json.source, image: image.bytes });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(fromJson.bytes, compiled.bytes);
  assert.equal(compiled.semanticRoot, 'sha256-b2803967e4de84ffd8e047dcb1dcca6063974cc8f7ca1da601e96b3db2c67a03');
  assert.equal(compiled.sidecar.graph.provenance.producer, CEG_COMPILER_PRODUCER);
  assert.equal(compiled.sidecar.graph.provenance.note, undefined);
  assert.equal(compiled.buildInfo.identity.semanticRoot, compiled.semanticRoot);
  const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
  const anchor = compiled.sidecar.graph.relations[0].from;
  const result = evaluateKar(session, {
    proposition: 'Can the enterprise customer cancel?',
    plan: planFor(anchor),
  });
  assert.equal(result.status, 'SATISFIED');
  assert.equal(result.certificate.evidenceIds.length, 1);
});

test('builder call order does not change the compiled graph', () => {
  const image = imageFrom(baseDocuments);
  const left = createCegSource()
    .concept('contract', { label: 'Enterprise contract' })
    .concept('cancel', { label: 'Cancellation' })
    .evidence('clause', { source: 'contract.md', namespace: 'legal' })
    .relation('contract', 'prohibits', 'cancel')
    .bind('cancel', { evidence: 'clause', requirements: ['cancel-barred'], authority: 80, validFrom: '2026-01-01' })
    .requirement('cancel-barred')
    .build();
  const right = createCegSource()
    .requirement('cancel-barred')
    .bind('cancel', { evidence: 'clause', requirements: ['cancel-barred'], authority: 80, validFrom: '2026-01-01' })
    .relation('contract', 'prohibits', 'cancel')
    .evidence('clause', { namespace: 'legal', source: 'contract.md' })
    .concept('cancel', { label: 'Cancellation' })
    .concept('contract', { label: 'Enterprise contract' })
    .build();
  assert.deepEqual(left.diagnostics, []);
  assert.equal(JSON.stringify(left.source), JSON.stringify(right.source));
  const a = compileCegSource({ source: left.source, image: image.bytes });
  const b = compileCegSource({ source: right.source, image: image.bytes });
  assert.equal(a.bytes, b.bytes);
});

test('unrelated concepts keep existing compiler ids', () => {
  const image = imageFrom(baseDocuments);
  const first = sourceWith();
  const second = sourceWith({ extra: {} });
  const before = compileCegSource({ source: first, image: image.bytes });
  const after = compileCegSource({ source: second, image: image.bytes });
  assert.equal(before.ok && after.ok, true);
  const beforeIds = new Set(before.sidecar.graph.nodes.map((node) => node.id));
  for (const id of beforeIds) assert.equal(after.sidecar.graph.nodes.some((node) => node.id === id), true);
  assert.equal(after.sidecar.graph.relations[0].id, before.sidecar.graph.relations[0].id);
  assert.equal(after.sidecar.graph.bindings[0].id, before.sidecar.graph.bindings[0].id);
  assert.notEqual(after.semanticRoot, before.semanticRoot);
  assert.equal(after.sidecar.graph.nodes.length, before.sidecar.graph.nodes.length + 1);
});

test('validity, evidence, and requirement edits change the binding id', () => {
  const image = imageFrom(baseDocuments);
  const base = compileCegSource({ source: sourceWith(), image: image.bytes });
  const until = compileCegSource({
    source: sourceWith({}, 'prohibits', 80, { source: 'contract.md', namespace: 'legal' }, { validUntil: '2026-12-31' }),
    image: image.bytes,
  });
  const otherEvidence = compileCegSource({
    source: sourceWith({}, 'prohibits', 80, { source: 'policy.md', namespace: 'front' }),
    image: image.bytes,
  });
  const requirement = compileCegSource({
    source: sourceWith({}, 'prohibits', 80, { source: 'contract.md', namespace: 'legal' }, { requirement: 'other-rule' }),
    image: image.bytes,
  });
  assert.equal(base.ok && until.ok && otherEvidence.ok && requirement.ok, true);
  assert.notEqual(until.sidecar.graph.bindings[0].id, base.sidecar.graph.bindings[0].id);
  assert.equal(until.sidecar.graph.relations[0].id, base.sidecar.graph.relations[0].id);
  assert.notEqual(until.semanticRoot, base.semanticRoot);
  const validity = diffCegGraphs(base.sidecar, until.sidecar);
  assert.equal(validity.ok, true);
  assert.equal(validity.validity.length, 1);
  assert.equal(validity.validity[0].after.validUntil, '2026-12-31');
  assert.notEqual(otherEvidence.sidecar.graph.bindings[0].evidenceId, base.sidecar.graph.bindings[0].evidenceId);
  assert.equal(otherEvidence.sidecar.graph.nodes.map((node) => node.id).join(), base.sidecar.graph.nodes.map((node) => node.id).join());
  assert.notEqual(requirement.sidecar.graph.bindings[0].id, base.sidecar.graph.bindings[0].id);
  assert.deepEqual(requirement.sidecar.graph.bindings[0].requirements, ['other-rule']);
  assert.equal(requirement.sidecar.graph.relations[0].id, base.sidecar.graph.relations[0].id);
});

test('intentional edits change only the affected ids', () => {
  const image = imageFrom(baseDocuments);
  const base = compileCegSource({ source: sourceWith(), image: image.bytes });
  const prohibited = compileCegSource({ source: sourceWith({}, 'permits'), image: image.bytes });
  const raised = compileCegSource({ source: sourceWith({}, 'prohibits', 50), image: image.bytes });
  assert.equal(base.ok && prohibited.ok && raised.ok, true);
  assert.notEqual(base.sidecar.graph.relations[0].id, prohibited.sidecar.graph.relations[0].id);
  assert.equal(base.sidecar.graph.nodes.map((node) => node.id).join(), prohibited.sidecar.graph.nodes.map((node) => node.id).join());
  assert.notEqual(base.semanticRoot, prohibited.semanticRoot);
  assert.notEqual(base.sidecar.graph.bindings[0].id, raised.sidecar.graph.bindings[0].id);
  assert.equal(base.sidecar.graph.relations[0].id, raised.sidecar.graph.relations[0].id);
  const diff = diffCegGraphs(base.sidecar, raised.sidecar);
  assert.equal(diff.ok, true);
  assert.equal(diff.authority.length, 1);
  assert.equal(diff.authority[0].before, 80);
  assert.equal(diff.authority[0].after, 50);
  assert.equal(diff.semanticRoot.changed, true);
});

test('missing and ambiguous evidence fail closed', () => {
  const image = imageFrom(baseDocuments);
  const missing = compileCegSource({
    source: sourceWith({}, 'prohibits', 80, { objectId: 'sha256-' + 'ab'.repeat(32) }),
    image: image.bytes,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics.some((item) => item.code === 'CEG_EVIDENCE_NOT_FOUND'), true);
  const ambiguousImage = imageFrom([
    { text: 'one', meta: { source: 'policy.md' } },
    { text: 'two', meta: { source: 'policy.md' } },
  ]);
  const ambiguous = compileCegSource({
    source: sourceWith({}, 'prohibits', 80, { source: 'policy.md' }),
    image: ambiguousImage.bytes,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.diagnostics.some((item) => item.code === 'CEG_EVIDENCE_AMBIGUOUS'), true);
});

test('a stale sidecar is not rebound', () => {
  const first = imageFrom(baseDocuments, 1);
  const compiled = compileCegSource({ source: sourceWith(), image: first.bytes });
  const second = imageFrom([
    { text: 'A guest may cancel later.', meta: { source: 'policy.md', namespace: 'front' } },
    { text: 'Enterprise customers may not cancel.', meta: { source: 'contract.md', namespace: 'legal' } },
  ], 2);
  const check = checkCegFreshness({ image: second.bytes, graph: compiled.sidecar });
  assert.equal(check.ok, false);
  assert.equal(check.diagnostics[0].code, 'CEG_STALE_IMAGE');
  assert.match(check.diagnostics[0].message, /Recompile from the CEG Source/);
  assert.throws(() => createKarSession({ image: second.bytes, graph: compiled.sidecar }), (error) => error.code === 'KAR_GRAPH_NOT_BOUND');
  const rebuilt = rebuildCegSource({ source: sourceWith(), image: second.bytes, previous: compiled.sidecar });
  assert.equal(rebuilt.compilation.ok, true);
  const alone = compileCegSource({ source: sourceWith(), image: second.bytes });
  assert.equal(rebuilt.compilation.bytes, alone.bytes);
});

test('cycles compile and empty opposition is a warning', () => {
  const image = imageFrom(baseDocuments);
  const source = sourceWith();
  source.relations.push({ from: 'cancel', type: 'permits', to: 'contract' });
  const compiled = compileCegSource({ source, image: image.bytes });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.diagnostics.some((item) => item.code === 'CEG_CYCLE_PRESENT'), true);
  const readiness = inspectKarReadiness(compiled.sidecar, [planFor(compiled.sidecar.graph.relations[0].from, { supports: 'F_S' })]);
  assert.equal(readiness.ok, true);
  assert.equal(readiness.readiness.diagnostics.some((item) => item.code === 'CEG_PLAN_EMPTY_OPPOSITION' || item.code === 'CEG_PLAN_UNMAPPED_RELATION'), true);
  const quality = inspectCegQuality(compiled.sidecar);
  assert.equal(quality.ok, true);
  assert.equal(quality.quality.nodeCount, 2);
  assert.equal(typeof quality.quality.mean, 'undefined');
});

test('claim graph import does not invent KAR relations', () => {
  const imported = importClaimGraph({
    version: 1,
    nodes: [{ id: 'contract', label: 'Contract' }, { id: 'cancel', label: 'Cancel' }],
    edges: [{ id: 'e1', from: 'contract', p: 'related', to: 'cancel', evidence: [0] }],
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.diagnostics.some((item) => item.code === 'CEG_CLAIM_IMPORT_LIMITED'), true);
  assert.equal(imported.diagnostics.some((item) => item.code === 'CEG_CLAIM_EVIDENCE_UNMAPPED'), true);
  assert.deepEqual(imported.source.relations, [{ from: 'contract', type: 'related', to: 'cancel' }]);
  assert.equal(imported.source.bindings.length, 0);
  assert.equal(JSON.stringify(imported.source).includes('prohibits'), false);
});

test('json import requires an explicit mapping', () => {
  const imported = importJsonGraph(
    {
      nodes: [{ id: 'contract', name: 'Contract' }, { id: 'cancel', name: 'Cancel' }],
      edges: [{ source: 'contract', rel: 'permits', target: 'cancel' }],
    },
    {
      format: 'ceg-import-map-1',
      concepts: { path: 'nodes', name: 'id', label: 'name' },
      relations: { path: 'edges', from: 'source', type: 'rel', to: 'target' },
    },
  );
  assert.equal(imported.ok, true, JSON.stringify(imported.diagnostics));
  assert.equal(imported.source.concepts.contract.label, 'Contract');
  assert.equal(imported.source.relations[0].type, 'permits');
});

test('distribution manifest rejects a swapped image', () => {
  const image = imageFrom(baseDocuments);
  const compiled = compileCegSource({ source: sourceWith(), image: image.bytes });
  const graphBytes = encoder.encode(compiled.bytes);
  const packed = buildDistributionFiles({ image: image.bytes, graphBytes, graph: compiled.sidecar });
  assert.equal(packed.ok, true);
  const loaded = loadKarBundle({ image: image.bytes, graph: compiled.sidecar, manifest: packed.manifest, graphBytes });
  assert.equal(loaded.ok, true);
  const other = imageFrom([{ text: 'different', meta: { source: 'policy.md' } }]);
  const swapped = loadKarBundle({ image: other.bytes, graph: compiled.sidecar, manifest: packed.manifest, graphBytes });
  assert.equal(swapped.ok, false);
  const review = reviewCegSource(sourceWith());
  assert.equal(review.bindings[0].excerpt, null);
  assert.equal(review.bindings[0].requirements[0], 'cancel-barred');
});

test('a producer result still goes through the deterministic compiler', async () => {
  const image = imageFrom(baseDocuments);
  const produced = await produceCegSource({
    id: 'manual',
    version: 'ceg-source-1',
    async produce() {
      return sourceWith();
    },
  });
  const compiled = compileCegSource({ source: produced.source, image: image.bytes });
  const direct = compileCegSource({ source: sourceWith(), image: image.bytes });
  assert.equal(compiled.bytes, direct.bytes);
  assert.equal(digest(compiled.sidecar), compiled.buildInfo.identity.sidecarDigest);
});

function sourceWith(extraConcepts = {}, type = 'prohibits', authority = 80, selector = { source: 'contract.md', namespace: 'legal' }, extra = {}) {
  const requirement = extra.requirement ?? 'cancel-barred';
  const binding = { concept: 'cancel', evidence: 'clause', requirements: [requirement], authority, validFrom: '2026-01-01' };
  if (extra.validUntil) binding.validUntil = extra.validUntil;
  return {
    format: 'ceg-source-1',
    concepts: { contract: { label: 'Enterprise contract' }, cancel: { label: 'Cancellation' }, ...extraConcepts },
    evidence: { clause: selector },
    relations: [{ from: 'contract', type, to: 'cancel' }],
    bindings: [binding],
    requirements: [requirement],
  };
}

function planFor(anchor, frontierMap = { prohibits: 'F_O' }) {
  return {
    version: 1,
    anchor: { mode: 'supplied', witness: [{ nodeId: anchor, queryTerm: 'contract' }] },
    frontierMap,
    depth: 2,
    cardinalityBound: 2,
    coverageMode: 'requirements',
    requirements: { F_S: [], F_O: ['cancel-barred'], F_Q: [], F_T: [], F_A: [] },
    floors: { F_S: '0', F_O: '1', F_Q: '0', F_T: '0', F_A: '0' },
    profile: 'minimum-cover',
    asOf: '2026-06-01',
    minAuthority: null,
    bounds: {
      maxAnchorNodes: 4,
      maxClosureNodes: 16,
      maxClosureEdges: 16,
      maxFrontierEvidence: 8,
      maxRequirementsPerFrontier: 4,
      maxEvidenceBindings: 8,
      maxCoverVisits: 100,
    },
    lexical: null,
  };
}
