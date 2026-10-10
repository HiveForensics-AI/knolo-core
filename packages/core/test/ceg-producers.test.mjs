import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { loadDomainDirectory } from '../../cli/bin/kar-produce.mjs';
import * as authoring from '../dist/experimental/kar/authoring/index.js';
import { createKarSession, evaluateKar, verifyKar } from '../dist/experimental/kar/index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const encoder = new TextEncoder();
const {
  applyProducerDecisions,
  checkCegFreshness,
  compileCegSource,
  createOntologyCegProducer,
  createRuleCegProducer,
  explainCegProposal,
  instantiatePlanTemplate,
  interpretDomainPack,
  mergeProducerFragments,
  produceCegSource,
  regexIsSafe,
  runOntologyProducer,
  runRuleProducer,
  testDomainFixtures,
  validateModelProposals,
} = authoring;

function domain(id) {
  const loaded = loadDomainDirectory(authoring, `${repo}/domains/${id}`);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
  return loaded;
}

function imageFrom(actor, documents) {
  return createKnowledgeImageV5({
    actor,
    sequence: 1,
    objects: documents.map((document) => ({
      kind: 'chunk',
      bytes: encoder.encode(document.text),
      meta: { source: document.source, ...(document.meta ?? {}) },
    })),
  });
}

test('domain packs preserve support, opposition, qualification, time, authority, and gaps', () => {
  for (const id of ['contracts', 'policy', 'operations', 'generic']) {
    const loaded = domain(id);
    const report = testDomainFixtures(loaded.pack, loaded.fixtures);
    assert.equal(report.ok, true, `${id} ${report.fixtures.filter((item) => !item.ok).map((item) => `${item.id}: ${item.message}`).join(' | ')}`);
    assert.deepEqual(report.unmatchedRules, []);
    assert.match(report.domainPackRoot, /^sha256-[0-9a-f]{64}$/);
  }
});

test('rule order, metadata key order, and cache hits stay byte-identical', () => {
  const loaded = domain('contracts');
  const image = imageFrom('ceg-producers', [
    { source: 'terms.md', text: 'The agreement may terminate after notice.\nThe agreement may not terminate during the annual term.\n', meta: { type: 'contract' } },
  ]);
  const first = runRuleProducer({ pack: loaded.pack, image: image.bytes });
  assert.equal(first.ok, true);
  const reversed = { ...loaded.pack, rules: [...loaded.pack.rules].reverse() };
  const second = runRuleProducer({ pack: reversed, image: image.bytes });
  assert.equal(JSON.stringify(second.run.fragment), JSON.stringify(first.run.fragment));
  assert.equal(second.run.provenance.domainPackRoot, first.run.provenance.domainPackRoot);
  const cache = new Map();
  const cached = runRuleProducer({ pack: loaded.pack, image: image.bytes, cache });
  const hit = runRuleProducer({ pack: loaded.pack, image: image.bytes, cache });
  assert.equal(JSON.stringify(hit.run), JSON.stringify(cached.run));
  for (const binding of first.run.fragment.bindings) assert.equal(binding.provenance, undefined);
  assert.equal(first.run.fragment.relations.some((relation) => relation.type === 'permits'), true);
  assert.equal(first.run.fragment.relations.some((relation) => relation.type === 'prohibits'), true);
});

test('a producer fragment compiles only through the frozen compiler', async () => {
  const loaded = domain('contracts');
  const image = imageFrom('ceg-producers', [
    { source: 'permit.md', text: 'The agreement may terminate after notice.\n', meta: { type: 'contract' } },
    { source: 'bar.md', text: 'The agreement may not terminate during the annual term.\n', meta: { type: 'contract' } },
    { source: 'except.md', text: 'The duty stands except when notice is late.\n', meta: { type: 'contract' } },
  ]);
  const producer = createRuleCegProducer({ domainPack: loaded.pack });
  const produced = await produceCegSource(producer, { image: image.bytes });
  assert.equal(produced.source.format, 'ceg-source-1');
  assert.equal(produced.source.version, undefined);
  const compiled = compileCegSource({ source: produced.source, image: image.bytes });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.sidecar.graph.provenance.producer, 'knolo-ceg-compiler/source-v1');
  const other = imageFrom('ceg-producers-other', [{ source: 'permit.md', text: 'The agreement may terminate after notice.\n', meta: { type: 'contract' } }]);
  const stale = checkCegFreshness({ image: other.bytes, graph: compiled.sidecar });
  assert.equal(stale.ok, false);
  assert.equal(stale.diagnostics[0].code, 'CEG_STALE_IMAGE');
  const plan = instantiatePlanTemplate(loaded.pack, 'showcase-review');
  assert.equal(plan.ok, true);
  const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
  const result = evaluateKar(session, { proposition: 'May the agreement terminate?', plan: plan.plan });
  assert.equal(result.status, 'SATISFIED');
  assert.ok(result.frontiers.F_S.length > 0);
  assert.ok(result.frontiers.F_O.length > 0);
  assert.ok(result.frontiers.F_Q.length > 0);
  const verdict = verifyKar({ image: image.bytes, graph: compiled.sidecar, proposition: 'May the agreement terminate?', plan: plan.plan, result });
  assert.equal(verdict.ok, true);
});

test('review states admit only accepted proposals', () => {
  const loaded = domain('generic');
  const image = imageFrom('ceg-producers', [{ source: 'note.md', text: 'The record is related to the topic.\n', meta: { type: 'record' } }]);
  const ran = runRuleProducer({ pack: loaded.pack, image: image.bytes });
  assert.equal(ran.ok, true);
  const proposal = ran.run.proposals.find((item) => item.ruleId === 'generic.phrase.related.v1');
  assert.ok(proposal);
  const explained = explainCegProposal(ran.run, proposal.id);
  assert.equal(explained.ok, true);
  assert.equal(explained.explanation.ruleId, 'generic.phrase.related.v1');
  assert.equal(explained.explanation.state, 'ACCEPTED');
  assert.equal(explained.explanation.domainPackId, 'generic');
  const rejected = applyProducerDecisions(ran.run, { format: 'ceg-decisions-1', decisions: [{ id: proposal.id, state: 'REJECTED' }] });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.source.relations.length, 0);
  const unknown = applyProducerDecisions(ran.run, { format: 'ceg-decisions-1', decisions: [{ id: 'missing', state: 'ACCEPTED' }] });
  assert.equal(unknown.ok, false);
  const duplicate = applyProducerDecisions(ran.run, { format: 'ceg-decisions-1', decisions: [{ id: proposal.id, state: 'ACCEPTED' }, { id: proposal.id, state: 'REJECTED' }] });
  assert.equal(duplicate.ok, false);
  const held = { ...ran.run, proposals: ran.run.proposals.map((item) => ({ ...item, state: 'NEEDS_REVIEW' })) };
  const pending = applyProducerDecisions(held, { format: 'ceg-decisions-1', decisions: [] });
  assert.equal(pending.ok, true);
  assert.equal(pending.source.relations.length, 0);
});

test('merge keeps both sides of a conflict and ignores fragment order', () => {
  const left = { concepts: { agreement: { label: 'Zebra' }, termination: {} }, relations: [{ from: 'agreement', type: 'permits', to: 'termination' }], evidence: { a: { objectId: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } } };
  const right = { concepts: { agreement: { label: 'Alpha' } }, relations: [{ from: 'agreement', type: 'prohibits', to: 'termination' }], evidence: { a: { objectId: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } } };
  const forward = mergeProducerFragments([left, right]);
  const backward = mergeProducerFragments([right, left]);
  assert.equal(JSON.stringify(forward.source), JSON.stringify(backward.source));
  assert.equal(forward.source.concepts.agreement.label, 'Alpha');
  assert.equal(forward.source.relations.length, 2);
  assert.equal(forward.diagnostics.some((item) => item.code === 'CEG_PRODUCER_CONCEPT_DIVERGENCE'), true);
  assert.equal(forward.diagnostics.some((item) => item.code === 'CEG_PRODUCER_RELATION_CONFLICT'), false);
});

test('regex packs reject catastrophic patterns and do not execute them', () => {
  assert.equal(regexIsSafe('(a+)+'), false);
  assert.equal(regexIsSafe('(.*)+'), false);
  assert.equal(regexIsSafe('(?=a)'), false);
  assert.equal(regexIsSafe('(?!a)'), false);
  assert.equal(regexIsSafe('\\1'), false);
  assert.equal(regexIsSafe('may terminate'), true);
  const rejected = interpretDomainPack({
    format: 'ceg-domain-1',
    id: 'unsafe',
    version: 1,
    conceptKinds: [{ id: 'record' }],
    concepts: [{ name: 'record', kind: 'record' }],
    relations: ['related'],
    rules: [{ id: 'unsafe.regex.v1', kind: 'phrase', pattern: '(a+)+', patternMode: 'regex', autoAccept: true, concept: 'record' }],
    planTemplates: {},
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.diagnostics.some((item) => item.code === 'CEG_PRODUCER_RULE_INVALID'), true);
});

test('ontology producer maps explicit structure and preserves Phase 8 ambiguity', async () => {
  const documents = [
    { source: 'a.md', text: 'alpha' },
    { source: 'b.md', text: 'beta' },
    { source: 'same.md', text: 'one' },
    { source: 'same.md', text: 'two' },
  ];
  const image = imageFrom('ceg-ontology', documents);
  const bySource = new Map();
  for (const object of image.objects) {
    const list = bySource.get(object.meta.source) ?? [];
    list.push(object.id);
    bySource.set(object.meta.source, list);
  }
  const alpha = bySource.get('a.md')[0];
  const ontology = {
    nodes: [{ id: 'agreement', label: 'Agreement' }, { id: 'termination', label: 'Termination' }],
    edges: [{ from: 'agreement', type: 'prohibits', to: 'termination' }],
    docs: [{ alias: 'alpha', objectId: alpha }],
    links: [{ concept: 'termination', evidence: 'alpha', requirements: ['termination-barred'] }],
  };
  const mapping = {
    format: 'ceg-ontology-map-1',
    concepts: { path: 'nodes', name: 'id', label: 'label' },
    relations: { path: 'edges', from: 'from', type: 'type', to: 'to' },
    evidence: { path: 'docs', alias: 'alias', objectId: 'objectId' },
    bindings: { path: 'links', concept: 'concept', evidence: 'evidence', requirements: 'requirements' },
  };
  const ran = runOntologyProducer({ ontology, mapping, image: image.bytes, auto: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.diagnostics));
  assert.equal(ran.run.fragment.relations[0].type, 'prohibits');
  assert.equal(ran.run.fragment.evidence.alpha.objectId, alpha);
  assert.equal(ran.run.proposals.every((item) => item.state === 'ACCEPTED'), true);
  const held = runOntologyProducer({ ontology, mapping, auto: false });
  assert.equal(held.ok, true);
  assert.equal(held.run.fragment.relations.length, 0);
  assert.equal(held.run.proposals.every((item) => item.state === 'NEEDS_REVIEW'), true);
  const ambiguous = runOntologyProducer({
    ontology: { docs: [{ alias: 'same', source: 'same.md' }] },
    mapping: { format: 'ceg-import-map-1', evidence: { path: 'docs', alias: 'alias', source: 'source' } },
    image: image.bytes,
    auto: true,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.diagnostics.some((item) => item.code === 'CEG_EVIDENCE_AMBIGUOUS'), true);
  const missing = runOntologyProducer({
    ontology: { docs: [{ alias: 'gone', source: 'missing.md' }] },
    mapping: { format: 'ceg-import-map-1', evidence: { path: 'docs', alias: 'alias', source: 'source' } },
    image: image.bytes,
    auto: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics.some((item) => item.code === 'CEG_EVIDENCE_NOT_FOUND'), true);
  const produced = await createOntologyCegProducer({ ontology, mapping, auto: true }).produce({ image: image.bytes });
  assert.equal(produced.format, 'ceg-source-1');
  assert.equal(produced.relations[0].type, 'prohibits');
});

test('model proposals stay proposed, grounded, and free of invented authority', async () => {
  const image = imageFrom('ceg-model', [{ source: 'terms.md', text: 'The agreement may terminate after notice.\n', meta: { type: 'contract' } }]);
  const evidenceId = image.objects[0].id;
  const { openEvidenceCatalog } = await import('../dist/experimental/kar/authoring/catalog.js');
  const catalog = openEvidenceCatalog(image.bytes).catalog;
  const loaded = domain('contracts');
  const bad = validateModelProposals({ output: { concepts: [] } });
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].code, 'CEG_PRODUCER_OUTPUT_INVALID');
  const ungrounded = validateModelProposals({
    output: {
      format: 'ceg-model-proposals-1',
      model: { id: 'mock', version: '0' },
      concepts: [{ name: 'agreement' }],
      relations: [],
      bindings: [],
    },
    catalog,
    domainPack: loaded.pack,
  });
  assert.equal(ungrounded.ok, false);
  assert.equal(ungrounded.diagnostics.some((item) => item.code === 'CEG_PRODUCER_UNGROUNDED'), true);
  const ran = validateModelProposals({
    output: {
      format: 'ceg-model-proposals-1',
      model: { id: 'mock', version: '0' },
      concepts: [],
      relations: [{ from: 'agreement', type: 'permits', to: 'termination', evidenceId, quote: 'may terminate', confidence: 0.2 }],
      bindings: [{ concept: 'termination', evidenceId, requirements: ['termination-right'], quote: 'may terminate', authority: 99, validFrom: '1999-01-01', confidence: 0.4 }],
      aliases: [{ phrase: 'room', concept: 'lodging', evidenceId }],
    },
    catalog,
    domainPack: loaded.pack,
  });
  assert.equal(ran.ok, true, JSON.stringify(ran.diagnostics));
  assert.equal(ran.run.fragment.relations.length, 0);
  assert.equal(ran.run.proposals.every((item) => item.state === 'PROPOSED'), true);
  const bindingProposal = ran.run.proposals.find((item) => item.fragment.bindings?.length);
  assert.equal(bindingProposal.confidence, 0.4);
  assert.equal(bindingProposal.fragment.bindings[0].authority, undefined);
  assert.equal(bindingProposal.fragment.bindings[0].validFrom, undefined);
  assert.equal(ran.run.aliases[0].concept, 'lodging');
  assert.equal(JSON.stringify(ran.run.fragment).includes('lodging'), false);
  const applied = applyProducerDecisions(ran.run, { format: 'ceg-decisions-1', decisions: [] });
  assert.equal(applied.source.relations.length, 0);
});
