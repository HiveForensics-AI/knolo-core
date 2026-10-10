import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { canonicalize, digest } from '../dist/experimental/kar/canonicalize.js';
import { prepareGraph, semanticRootOf } from '../dist/experimental/kar/graph.js';
import { openEvidenceCatalog } from '../dist/experimental/kar/authoring/catalog.js';
import {
  compileCegSource,
  lintCegSource,
  parseCegSource,
} from '../dist/experimental/kar/authoring/index.js';

const encoder = new TextEncoder();

function imageFrom(documents, sequence = 1) {
  return createKnowledgeImageV5({
    actor: 'ceg-proof',
    sequence,
    objects: documents.map((document) => ({
      kind: 'chunk',
      bytes: encoder.encode(document.text),
      meta: document.meta,
    })),
  });
}

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

function shuffle(items, random) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = copy[index];
    copy[index] = copy[swap];
    copy[swap] = held;
  }
  return copy;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

test('10000 source reorderings share one SemanticRoot', { timeout: 180000 }, () => {
  const image = imageFrom([
    { text: 'A guest may cancel.', meta: { source: 'policy.md', namespace: 'front' } },
    { text: 'Enterprise customers may not cancel.', meta: { source: 'contract.md', namespace: 'legal' } },
  ]);
  const opened = openEvidenceCatalog(image.bytes);
  assert.equal(opened.ok, true);
  const roots = new Set();
  const bytes = new Set();
  for (let index = 0; index < 10000; index += 1) {
    const random = mulberry32(0xceb000 + index);
    const parsed = parseCegSource(shuffledYaml(random));
    assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
    const compiled = compileCegSource({ source: parsed.source, image: image.bytes, catalog: opened.catalog });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    roots.add(compiled.semanticRoot);
    bytes.add(compiled.bytes);
    if (roots.size !== 1) break;
  }
  assert.equal(roots.size, 1);
  assert.equal(bytes.size, 1);
});

test('independent reference compiler matches 10000 small sources', { timeout: 180000 }, () => {
  const image = imageFrom([{ text: 'Clause text.', meta: { source: 'clause.md' } }]);
  const opened = openEvidenceCatalog(image.bytes);
  assert.equal(opened.ok, true);
  const evidenceId = opened.catalog.objects[0].id;
  const roots = {
    stateRoot: opened.catalog.stateRoot,
    objectRoot: opened.catalog.objectRoot,
    commitDigest: opened.catalog.commitDigest,
    knowledgeRoot: opened.catalog.knowledgeRoot,
  };
  let mismatches = 0;
  let first = '';
  for (let index = 0; index < 10000; index += 1) {
    const source = smallSource(mulberry32(0x51c000 + index), evidenceId);
    const compiled = compileCegSource({ source, image: image.bytes, catalog: opened.catalog });
    const reference = referenceSidecar(source, roots);
    const sameRoot = compiled.ok && reference && compiled.semanticRoot === semanticRootOf(reference.graph);
    const sameBytes = sameRoot && canonicalize(compiled.sidecar) === canonicalize(reference);
    if (!sameBytes) {
      mismatches += 1;
      if (!first) first = JSON.stringify({ index, diagnostics: compiled.diagnostics, source });
      break;
    }
  }
  assert.equal(mismatches, 0, first);
});

test('25000 malformed and edge authoring inputs fail closed', { timeout: 180000 }, () => {
  const unique = imageFrom([
    { text: 'A guest may cancel.', meta: { source: 'policy.md' } },
    { text: 'Enterprise customers may not cancel.', meta: { source: 'contract.md' } },
  ]);
  const ambiguous = imageFrom([
    { text: 'one', meta: { source: 'same.md' } },
    { text: 'two', meta: { source: 'same.md' } },
  ]);
  const uniqueCatalog = openEvidenceCatalog(unique.bytes);
  const ambiguousCatalog = openEvidenceCatalog(ambiguous.bytes);
  assert.equal(uniqueCatalog.ok && ambiguousCatalog.ok, true);
  let crashes = 0;
  let silent = 0;
  let rejectedCycles = 0;
  let slow = 0;
  let first = '';
  for (let index = 0; index < 25000; index += 1) {
    const sample = fuzzSample(index, unique.bytes, uniqueCatalog.catalog, ambiguous.bytes, ambiguousCatalog.catalog);
    const started = performance.now();
    try {
      const parsed = parseCegSource(sample.text, sample.limits);
      if (parsed.ok) {
        lintCegSource(parsed.source, { catalog: sample.catalog });
        const compiled = compileCegSource({
          source: parsed.source,
          image: sample.image,
          catalog: sample.catalog,
          limits: sample.limits,
        });
        if (sample.expectAmbiguous) {
          const codes = compiled.ok ? [] : compiled.diagnostics.map((item) => item.code);
          if (compiled.ok || !codes.includes('CEG_EVIDENCE_AMBIGUOUS')) silent += 1;
        }
        if (sample.expectCycle && (!compiled.ok || compiled.diagnostics.some((item) => item.severity === 'error' && item.code === 'CEG_CYCLE_PRESENT'))) {
          rejectedCycles += 1;
        }
      } else if (sample.expectCycle || sample.expectAmbiguous) {
        silent += 1;
      }
    } catch (error) {
      crashes += 1;
      if (!first) first = `${index} ${error instanceof Error ? error.stack : String(error)}`;
    }
    if (performance.now() - started > 2000) slow += 1;
    if (crashes || silent || rejectedCycles || slow) {
      if (!first) first = `index ${index}`;
      break;
    }
  }
  assert.equal(crashes, 0, first);
  assert.equal(silent, 0, first);
  assert.equal(rejectedCycles, 0, first);
  assert.equal(slow, 0, first);
});

function shuffledYaml(random) {
  const labels = {
    customer: 'Customer',
    cancellation: 'Cancellation',
    commitment: 'Commitment',
    policy: 'Policy',
    archive: 'Archive',
    notice: 'Notice',
    renewal: 'Renewal',
    fee: 'Fee',
  };
  const conceptLines = ['concepts:'];
  for (const name of shuffle(Object.keys(labels), random)) {
    conceptLines.push(`  ${name}:`);
    conceptLines.push(`    label: ${labels[name]}`);
  }
  const evidenceLines = ['evidence:'];
  for (const [alias, source] of shuffle([['policy', 'policy.md'], ['contract', 'contract.md']], random)) {
    evidenceLines.push(`  ${alias}:`);
    evidenceLines.push(`    source: ${source}`);
  }
  const relationLines = ['relations:'];
  const relations = shuffle([
    ['customer', 'permits', 'cancellation'],
    ['customer', 'prohibits', 'cancellation'],
    ['commitment', 'qualifies', 'cancellation'],
    ['archive', 'related', 'notice'],
    ['renewal', 'permits', 'fee'],
    ['fee', 'related', 'renewal'],
  ], random);
  for (const [from, type, to] of relations) {
    relationLines.push(`  - from: ${from}`);
    relationLines.push(`    type: ${type}`);
    relationLines.push(`    to: ${to}`);
  }
  const bindingLines = ['bindings:'];
  const bindings = shuffle([
    { concept: 'cancellation', evidence: 'policy', requirements: ['cancel-allowed', 'guest'], authority: 40 },
    { concept: 'cancellation', evidence: 'contract', requirements: ['cancel-barred'], authority: 80, validFrom: '2026-01-01' },
    { concept: 'fee', evidence: 'policy', requirements: ['fee-rule', 'guest'] },
  ], random);
  for (const binding of bindings) {
    bindingLines.push(`  - concept: ${binding.concept}`);
    bindingLines.push(`    evidence: ${binding.evidence}`);
    bindingLines.push('    requirements:');
    for (const requirement of shuffle(binding.requirements, random)) bindingLines.push(`      - ${requirement}`);
    if (binding.authority !== undefined) bindingLines.push(`    authority: ${binding.authority}`);
    if (binding.validFrom) bindingLines.push(`    validFrom: ${binding.validFrom}`);
  }
  const requirementLines = ['requirements:'];
  for (const requirement of shuffle(['cancel-allowed', 'cancel-barred', 'guest', 'fee-rule', 'unused-rule'], random)) {
    requirementLines.push(`  - ${requirement}`);
  }
  const blocks = shuffle([
    conceptLines.join('\n'),
    evidenceLines.join('\n'),
    relationLines.join('\n'),
    bindingLines.join('\n'),
    requirementLines.join('\n'),
  ], random);
  if (random() < 0.5) blocks.unshift('format: ceg-source-1');
  else blocks.push('format: ceg-source-1');
  return blocks.join('\n');
}

function referenceNode(name) {
  return digest({ domain: 'ceg-node-v1', name });
}

function referenceRelation(from, relation, to) {
  return digest({ domain: 'ceg-relation-v1', from, relation, to });
}

function referenceBinding(parts) {
  return digest({
    domain: 'ceg-binding-v1',
    nodeId: parts.nodeId,
    evidenceId: parts.evidenceId,
    requirements: parts.requirements.slice().sort(compareText),
    authority: parts.authority ?? null,
    unauthorized: parts.unauthorized === true ? true : null,
    validFrom: parts.validFrom ?? null,
    validUntil: parts.validUntil ?? null,
    provenance: parts.provenance ?? null,
  });
}

function referenceSidecar(source, roots) {
  const names = Object.keys(source.concepts).sort(compareText);
  const nodeId = new Map(names.map((name) => [name, referenceNode(name)]));
  const nodes = names.map((name) => ({ id: nodeId.get(name) }));
  const relations = source.relations.map((relation) => {
    const from = nodeId.get(relation.from);
    const to = nodeId.get(relation.to);
    return { id: referenceRelation(from, relation.type, to), from, relation: relation.type, to };
  });
  const bindings = source.bindings.map((binding) => {
    const node = nodeId.get(binding.concept);
    const evidenceId = binding.evidence === 'doc' ? source.evidence.doc.objectId : '';
    const requirements = binding.requirements.slice().sort(compareText);
    const id = referenceBinding({
      nodeId: node,
      evidenceId,
      requirements,
      authority: binding.authority,
      unauthorized: binding.unauthorized,
      validFrom: binding.validFrom,
      validUntil: binding.validUntil,
      provenance: binding.provenance,
    });
    const committed = { id, nodeId: node, evidenceId, requirements };
    if (binding.authority !== undefined) committed.authority = binding.authority;
    if (binding.unauthorized === true) committed.unauthorized = true;
    if (binding.validFrom) committed.validFrom = binding.validFrom;
    if (binding.validUntil) committed.validUntil = binding.validUntil;
    if (binding.provenance) committed.provenance = binding.provenance;
    return committed;
  });
  const graph = prepareGraph({
    version: 1,
    knowledgeRoot: roots.knowledgeRoot,
    provenance: { producer: 'knolo-ceg-compiler/source-v1' },
    nodes,
    relations,
    bindings,
  });
  if (!graph) return null;
  return {
    version: 1,
    stateRoot: roots.stateRoot,
    objectRoot: roots.objectRoot,
    commitDigest: roots.commitDigest,
    knowledgeRoot: roots.knowledgeRoot,
    graph,
  };
}

function smallSource(random, evidenceId) {
  const count = 2 + Math.floor(random() * 3);
  const concepts = {};
  const names = [];
  for (let index = 0; index < count; index += 1) {
    const name = `c${index}`;
    names.push(name);
    concepts[name] = random() < 0.5 ? { label: `Label ${index}` } : {};
  }
  const relations = [];
  const seenRelations = new Set();
  const relationCount = Math.floor(random() * 4);
  const types = ['permits', 'prohibits', 'qualifies', 'related'];
  for (let index = 0; index < relationCount; index += 1) {
    const from = names[Math.floor(random() * names.length)];
    const to = names[Math.floor(random() * names.length)];
    const type = types[Math.floor(random() * types.length)];
    const key = `${from}\0${type}\0${to}`;
    if (seenRelations.has(key)) continue;
    seenRelations.add(key);
    relations.push({ from, type, to });
  }
  const bindings = [];
  const seenBindings = new Set();
  const pool = ['alpha', 'beta', 'gamma'];
  for (let index = 0; index < Math.floor(random() * 3); index += 1) {
    const concept = names[Math.floor(random() * names.length)];
    const requirements = pool.filter(() => random() < 0.5);
    if (requirements.length === 0) requirements.push('alpha');
    requirements.sort(compareText);
    const authority = random() < 0.5 ? undefined : [0, 50, 80][Math.floor(random() * 3)];
    const validFrom = random() < 0.3 ? '2026-01-01' : undefined;
    const validUntil = validFrom && random() < 0.5 ? '2026-12-31' : undefined;
    const unauthorized = random() < 0.2 ? true : undefined;
    const provenance = random() < 0.2 ? 'desk' : undefined;
    const key = [concept, requirements.join('\0'), authority ?? '', unauthorized ? '1' : '', validFrom ?? '', validUntil ?? '', provenance ?? ''].join('\u001f');
    if (seenBindings.has(key)) continue;
    seenBindings.add(key);
    const binding = { concept, evidence: 'doc', requirements: shuffle(requirements, random) };
    if (authority !== undefined) binding.authority = authority;
    if (unauthorized) binding.unauthorized = true;
    if (validFrom) binding.validFrom = validFrom;
    if (validUntil) binding.validUntil = validUntil;
    if (provenance) binding.provenance = provenance;
    bindings.push(binding);
  }
  return {
    format: 'ceg-source-1',
    concepts,
    evidence: { doc: { objectId: evidenceId } },
    relations,
    bindings,
    requirements: shuffle(['alpha', 'beta', 'gamma'], random),
  };
}

function fuzzSample(index, uniqueImage, uniqueCatalog, ambiguousImage, ambiguousCatalog) {
  const bucket = index % 25;
  const random = mulberry32(0xf22000 + index);
  if (bucket < 8) return { text: garbage(random), image: uniqueImage, catalog: uniqueCatalog };
  if (bucket < 12) return { text: JSON.stringify(randomObject(random, 0)), image: uniqueImage, catalog: uniqueCatalog };
  if (bucket < 16) return { text: badYaml(index, random), image: uniqueImage, catalog: uniqueCatalog };
  if (bucket < 18) {
    return {
      text: ambiguousYaml(random),
      image: ambiguousImage,
      catalog: ambiguousCatalog,
      expectAmbiguous: true,
    };
  }
  if (bucket < 20) {
    return {
      text: cycleYaml(index),
      image: uniqueImage,
      catalog: uniqueCatalog,
      expectCycle: true,
    };
  }
  if (bucket === 20) return { text: `${' '.repeat(index % 3)}{`, image: uniqueImage, catalog: uniqueCatalog };
  if (bucket === 21) return { text: 'format: ceg-source-1\nconcepts:\n  a:\n    label: ' + 'x'.repeat(2001), image: uniqueImage, catalog: uniqueCatalog };
  if (bucket === 22) return { text: 'format: ceg-source-1\n\tconcepts: {}', image: uniqueImage, catalog: uniqueCatalog };
  if (bucket === 23) {
    return {
      text: 'format: ceg-source-1\nconcepts:\n  a:\nrelations: []',
      image: uniqueImage,
      catalog: uniqueCatalog,
    };
  }
  return {
    text: 'format: ceg-source-1\nconcepts:\n  a:\n    extra: 1\n    label: Café 取消',
    image: uniqueImage,
    catalog: uniqueCatalog,
    limits: index % 50 === 0 ? { maxConcepts: 0 } : undefined,
  };
}

function garbage(random) {
  const alphabet = ' \nabc:-+[]{}"\'#*|><&!%@`\u0000\u0001\t\u2028é你';
  const length = Math.floor(random() * 90);
  let text = '';
  for (let index = 0; index < length; index += 1) text += alphabet[Math.floor(random() * alphabet.length)];
  return text;
}

function randomObject(random, depth) {
  if (depth > 4 || random() < 0.4) {
    const choice = Math.floor(random() * 6);
    if (choice === 0) return null;
    if (choice === 1) return random() < 0.5;
    if (choice === 2) return Math.floor(random() * 20) - 5;
    if (choice === 3) return 'not-a-date';
    if (choice === 4) return '';
    return 'sha256-' + 'zz';
  }
  if (random() < 0.5) return [randomObject(random, depth + 1), randomObject(random, depth + 1)];
  const value = {};
  const keys = shuffle(['format', 'concepts', 'evidence', 'relations', 'bindings', 'requirements', 'unknown', '__proto__', 'a'], random).slice(0, 4);
  for (const key of keys) value[key] = randomObject(random, depth + 1);
  return value;
}

function badYaml(index, random) {
  const samples = [
    'format: ceg-source-1\nconcepts:\n  a:\n  a:\n    label: A',
    'format: ceg-source-1\nconcepts:\n  a:\nrelations:\n  - from: a\n    type:\n    to: a',
    'format: ceg-source-1\nconcepts:\n  a:\nrelations:\n  - from: a\n    type: " "\n    to: missing',
    'format: ceg-source-1\nconcepts:\n  a:\nbindings:\n  - concept: a\n    evidence: missing\n    requirements:\n      - r\n      - r',
    'format: ceg-source-1\nconcepts:\n  a:\nbindings:\n  - concept: a\n    evidence: e\n    requirements:\n      - r\n    validFrom: 2026-13-40\n    authority: 1.5',
    'format: ceg-source-1\nconcepts:\n  a:\nbindings:\n  - concept: a\n    evidence: e\n    requirements:\n      - r\n    validFrom: 2026-12-31\n    validUntil: 2026-01-01',
    'format: ceg-source-1\nweird: true\nconcepts: []',
    ': value',
    'format: ceg-source-1\nconcepts:\n  "a b":\n    label: spaced',
    '- just\n- a\n- list',
    'format: ceg-source-1\nconcepts:\n  a: |\n    no',
    `format: ceg-source-1\nconcepts:\n  n${index % 7}:\n    label: "quote ${index}"`,
  ];
  return samples[Math.floor(random() * samples.length)];
}

function ambiguousYaml(random) {
  const alias = random() < 0.5 ? 'clause' : 'other';
  return `format: ceg-source-1
concepts:
  topic:
    label: Topic
evidence:
  ${alias}:
    source: same.md
relations:
  - from: topic
    type: related
    to: topic
bindings:
  - concept: topic
    evidence: ${alias}
    requirements:
      - needed
`;
}

function cycleYaml(index) {
  const type = index % 2 === 0 ? 'permits' : 'related';
  return `format: ceg-source-1
concepts:
  left:
  right:
evidence:
  clause:
    source: contract.md
relations:
  - from: left
    type: ${type}
    to: right
  - from: right
    type: ${type}
    to: left
  - from: left
    type: ${type}
    to: left
bindings:
  - concept: left
    evidence: clause
    requirements:
      - needed
`;
}
