import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { loadDomainDirectory } from '../../cli/bin/kar-produce.mjs';
import * as authoring from '../dist/experimental/kar/authoring/index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const encoder = new TextEncoder();
const loaded = loadDomainDirectory(authoring, `${repo}/domains/contracts`);
assert.equal(loaded.ok, true);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function imageOf(metaFirst, objectsFirst) {
  const permit = objectsFirst
    ? { source: 'permit.md', type: 'contract', lane: 'a' }
    : { lane: 'a', type: 'contract', source: 'permit.md' };
  const bar = metaFirst
    ? { type: 'contract', source: 'bar.md', lane: 'b' }
    : { source: 'bar.md', lane: 'b', type: 'contract' };
  const objects = [
    { kind: 'chunk', bytes: encoder.encode('The agreement may terminate after notice.\n'), meta: permit },
    { kind: 'chunk', bytes: encoder.encode('The agreement may not terminate during the annual term.\n'), meta: bar },
  ];
  if (!objectsFirst) objects.reverse();
  return createKnowledgeImageV5({ actor: 'ceg-producer-proof', sequence: 1, objects });
}

test('deterministic producer stays stable across 10000 runs and reorderings', { timeout: 180000 }, () => {
  const image = imageOf(true, true);
  const fragments = new Set();
  const roots = new Set();
  let baseline = '';
  for (let index = 0; index < 10000; index += 1) {
    const ran = authoring.runRuleProducer({ pack: loaded.pack, image: image.bytes });
    assert.equal(ran.ok, true);
    const encoded = JSON.stringify(ran.run.fragment);
    fragments.add(encoded);
    if (index === 0) baseline = encoded;
  }
  assert.equal(fragments.size, 1);
  for (let index = 0; index < 10000; index += 1) {
    const shuffled = imageOf(index % 2 === 0, index % 3 === 0);
    const ran = authoring.runRuleProducer({ pack: loaded.pack, image: shuffled.bytes });
    assert.equal(ran.ok, true);
    assert.equal(JSON.stringify(ran.run.fragment), baseline);
    if (index % 25 === 0) {
      const compiled = authoring.compileCegSource({ source: ran.run.fragment, image: shuffled.bytes });
      assert.equal(compiled.ok, true);
      roots.add(compiled.semanticRoot);
    }
  }
  const compiled = authoring.compileCegSource({ source: JSON.parse(baseline), image: image.bytes });
  assert.equal(compiled.ok, true);
  roots.add(compiled.semanticRoot);
  assert.equal(roots.size, 1);
  assert.equal(fragments.size, 1);
});

test('10000 rule orders produce one canonical source', { timeout: 180000 }, () => {
  const image = imageOf(true, true);
  const rand = mulberry32(20261013);
  const rules = loaded.pack.rules;
  const sources = new Set();
  const roots = new Set();
  for (let index = 0; index < 10000; index += 1) {
    const copy = [...rules];
    for (let cursor = copy.length - 1; cursor > 0; cursor -= 1) {
      const swap = Math.floor(rand() * (cursor + 1));
      const next = copy[cursor];
      copy[cursor] = copy[swap];
      copy[swap] = next;
    }
    const ran = authoring.runRuleProducer({ pack: { ...loaded.pack, rules: copy }, image: image.bytes });
    assert.equal(ran.ok, true);
    sources.add(JSON.stringify(ran.run.fragment));
    if (index % 500 === 0) {
      const compiled = authoring.compileCegSource({ source: ran.run.fragment, image: image.bytes });
      assert.equal(compiled.ok, true);
      roots.add(compiled.semanticRoot);
    }
  }
  assert.equal(sources.size, 1);
  assert.equal(roots.size, 1);
});

test('10000 merge orders and 10000 ontology mappings do not crash or drop conflicts', { timeout: 180000 }, () => {
  const fragments = [
    { concepts: { agreement: { label: 'Zebra' } }, relations: [{ from: 'agreement', type: 'permits', to: 'termination' }] },
    { concepts: { agreement: { label: 'Alpha' }, termination: { label: 'Termination' } }, relations: [{ from: 'agreement', type: 'prohibits', to: 'termination' }] },
    { concepts: { exception: {} }, relations: [{ from: 'agreement', type: 'qualifies', to: 'exception' }] },
  ];
  const merged = new Set();
  const rand = mulberry32(20261014);
  for (let index = 0; index < 10000; index += 1) {
    const order = [...fragments];
    for (let cursor = order.length - 1; cursor > 0; cursor -= 1) {
      const swap = Math.floor(rand() * (cursor + 1));
      const next = order[cursor];
      order[cursor] = order[swap];
      order[swap] = next;
    }
    const result = authoring.mergeProducerFragments(order);
    assert.equal(result.source.relations.length, 3);
    assert.equal(result.source.concepts.agreement.label, 'Alpha');
    merged.add(JSON.stringify(result.source));
  }
  assert.equal(merged.size, 1);

  let ontologyFailures = 0;
  for (let index = 0; index < 10000; index += 1) {
    const count = 1 + (index % 5);
    const nodes = Array.from({ length: count }, (_, node) => ({ id: `n${node}`, label: `Node ${node}` }));
    const edges = count > 1 ? [{ from: 'n0', type: 'related', to: `n${count - 1}` }] : [];
    const mapping = {
      format: index % 2 === 0 ? 'ceg-ontology-map-1' : 'ceg-import-map-1',
      concepts: { path: 'nodes', name: 'id', label: 'label' },
      relations: { path: 'edges', from: 'from', type: 'type', to: 'to' },
    };
    const ran = authoring.runOntologyProducer({ ontology: { nodes, edges }, mapping, auto: true });
    if (!ran.ok || Object.keys(ran.run.fragment.concepts).length !== count) ontologyFailures += 1;
  }
  assert.equal(ontologyFailures, 0);
});

test('25000 malformed packs and 25000 malformed producer outputs fail closed', { timeout: 180000 }, () => {
  const rand = mulberry32(20261015);
  let crashes = 0;
  const samples = [
    null,
    1,
    'pack',
    [],
    { format: 'ceg-domain-1' },
    { format: 'ceg-domain-1', id: '/tmp/pack', version: 1, conceptKinds: [], concepts: [], relations: [], rules: [], planTemplates: {} },
    { format: 'ceg-domain-1', id: 'ok', version: '1', conceptKinds: [], concepts: [{ name: 'record' }], relations: ['related'], rules: [{ id: 'bad', kind: 'phrase', pattern: '(a+)+', patternMode: 'regex', concept: 'record' }], planTemplates: {} },
    { format: 'ceg-domain-1', id: 'ok', version: '1', description: 'see https://example.test/secret', conceptKinds: [], concepts: [], relations: [], rules: [], planTemplates: {} },
  ];
  for (let index = 0; index < 25000; index += 1) {
    const sample = samples[index % samples.length];
    const mutated = sample && typeof sample === 'object' && !Array.isArray(sample)
      ? { ...sample, extra: rand() > 0.5 ? { path: '/etc/passwd' } : index }
      : sample;
    try {
      const result = authoring.interpretDomainPack(mutated);
      if (result.ok && JSON.stringify(result.pack).includes('/tmp/pack')) crashes += 1;
    } catch {
      crashes += 1;
    }
  }
  assert.equal(crashes, 0);

  let outputCrashes = 0;
  let acceptedAmbiguous = 0;
  for (let index = 0; index < 25000; index += 1) {
    const output = index % 5 === 0
      ? { format: 'not-json', concepts: [{ name: 'agreement' }] }
      : index % 5 === 1
        ? { format: 'ceg-model-proposals-1', concepts: 'bad' }
        : index % 5 === 2
          ? { format: 'ceg-model-proposals-1', model: { id: 'm', version: '0' }, concepts: [{ name: 'agreement' }], relations: [], bindings: [] }
          : index % 5 === 3
            ? null
            : { format: 'ceg-model-proposals-1', model: { id: 'm', version: String(index) }, concepts: [], relations: [{ type: 'invented' }], bindings: [] };
    try {
      const result = authoring.validateModelProposals({ output });
      if (result.ok && result.run.fragment.relations.length > 0) acceptedAmbiguous += 1;
      if (result.ok && result.run.proposals.some((item) => item.state !== 'PROPOSED')) acceptedAmbiguous += 1;
    } catch {
      outputCrashes += 1;
    }
  }
  assert.equal(outputCrashes, 0);
  assert.equal(acceptedAmbiguous, 0);
});

test('regex fuzz and decision fuzz do not hang or throw', { timeout: 60000 }, () => {
  const rand = mulberry32(20261016);
  const alphabet = 'abc.+*?()[]\\';
  const fuzzStarted = Date.now();
  for (let index = 0; index < 1000; index += 1) {
    let pattern = '';
    const length = 1 + Math.floor(rand() * 40);
    for (let cursor = 0; cursor < length; cursor += 1) pattern += alphabet[Math.floor(rand() * alphabet.length)];
    const safe = authoring.regexIsSafe(pattern);
    assert.equal(typeof safe, 'boolean');
  }
  assert.ok(Date.now() - fuzzStarted < 2000);
  assert.equal(authoring.regexIsSafe('(a+)+'), false);
  assert.equal(authoring.regexIsSafe('(.*)+'), false);
  assert.equal(authoring.regexIsSafe('(?=a)'), false);
  assert.equal(authoring.regexIsSafe('(?!a)'), false);
  assert.equal(authoring.regexIsSafe('\\1'), false);
  const started = Date.now();
  authoring.regexIsSafe('(a+)+');
  assert.ok(Date.now() - started < 50);

  const run = authoring.runRuleProducer({
    pack: loaded.pack,
    image: imageOf(true, true).bytes,
  });
  assert.equal(run.ok, true);
  for (let index = 0; index < 2000; index += 1) {
    const decisions = index % 4 === 0
      ? null
      : index % 4 === 1
        ? { format: 'ceg-decisions-1', decisions: [{ id: 'missing', state: 'ACCEPTED' }, { id: 'missing', state: 'REJECTED' }] }
        : index % 4 === 2
          ? { format: 'nope', decisions: [] }
          : { format: 'ceg-decisions-1', decisions: [] };
    try {
      const applied = authoring.applyProducerDecisions(index % 7 === 0 ? { format: 'nope' } : run.run, decisions);
      if (applied.ok && decisions && decisions.format === 'ceg-decisions-1' && decisions.decisions.length === 0) {
        assert.ok(applied.source.relations.length >= 1);
      }
    } catch {
      assert.fail('decision fuzz threw');
    }
  }
});
