import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendMemoryOp,
  applyMemoryLog,
  applyClaimGraphLog,
  consolidateMemories,
  createCortex,
  createMemoryId,
  createMemoryLog,
  deserializeMemoryLog,
  forget,
  labelMemory,
  linkMemories,
  matchesMemoryLabels,
  mergeMemoryLogs,
  normalizeMemoryInput,
  normalizeMemoryLabel,
  memoryToClaimOps,
  recall,
  remember,
  serializeMemoryLog,
  validateMemoryLabels,
} from '../dist/index.js';

function makeClock(start = 1_000) {
  let current = start;
  return () => ++current;
}

test('normalizes memory labels and matches hierarchical prefixes', () => {
  assert.equal(normalizeMemoryLabel('  Project / Alpha  Beta '), 'project.alpha.beta');
  assert.deepEqual(
    validateMemoryLabels(['Alpha', 'alpha', 'Beta / Gamma', '']),
    ['alpha', 'beta.gamma']
  );
  assert.ok(matchesMemoryLabels(['project.alpha.beta'], ['project.alpha']));
  assert.ok(!matchesMemoryLabels(['project.alpha'], ['project.alpha.beta']));
});

test('creates deterministic memory ids from normalized provenance', () => {
  const memory = normalizeMemoryInput(
    {
      kind: 'Note',
      text: 'Hello, world!',
      labels: ['Project / Alpha', 'Project / Alpha', 'Scratch'],
      namespace: 'Team / Cortex',
      source: 'Doc-1',
      importance: 1.5,
      confidence: 0.4,
      ts: 123,
      actor: 'sam',
    },
    { actor: 'fallback', ts: 99 }
  );

  assert.equal(
    memory.id,
    createMemoryId({ kind: 'note', text: 'Hello, world!', ts: 123, actor: 'sam' })
  );
  assert.equal(memory.version, 1);
  assert.equal(memory.kind, 'note');
  assert.equal(memory.namespace, 'team.cortex');
  assert.equal(memory.source, 'doc-1');
  assert.equal(memory.importance, 1);
  assert.equal(memory.confidence, 0.4);
  assert.deepEqual(memory.labels, ['project.alpha', 'scratch']);
  assert.deepEqual(memory.links, []);
});

test('memory logs merge deterministically and replay idempotently', () => {
  const memory = normalizeMemoryInput(
    {
      kind: 'note',
      text: 'Alpha note',
      labels: ['alpha'],
      namespace: 'project.alpha',
      source: 'alpha.md',
      ts: 10,
      actor: 'alice',
    },
    { actor: 'alice', ts: 10 }
  );

  const base = createMemoryLog();
  const logA = appendMemoryOp(base, {
    op: 'remember',
    ts: memory.ts,
    actor: memory.actor,
    memory,
  });
  const logB = appendMemoryOp(createMemoryLog(), {
    op: 'label',
    id: memory.id,
    labels: ['project.alpha', 'project.alpha.launch'],
    ts: 11,
    actor: 'alice',
  });
  const logC = appendMemoryOp(createMemoryLog(), {
    op: 'link',
    from: memory.id,
    to: 'entity.alpha',
    relation: 'mentions',
    ts: 12,
    actor: 'alice',
  });
  const logD = appendMemoryOp(createMemoryLog(), {
    op: 'forget',
    id: memory.id,
    ts: 13,
    actor: 'alice',
  });

  const merged = mergeMemoryLogs(mergeMemoryLogs(logA, logB), mergeMemoryLogs(logC, logD));
  const roundTrip = deserializeMemoryLog(serializeMemoryLog(merged));
  const active = applyMemoryLog(roundTrip);

  assert.equal(active.length, 0);

  const mergedA = mergeMemoryLogs(logA, logB);
  const mergedB = mergeMemoryLogs(logB, logA);
  assert.deepEqual(mergedA, mergedB);
});

test('cortex writes are immutable and append-only', () => {
  const cortex = createCortex({ actor: 'alice', now: makeClock() });
  const remembered = remember(cortex, {
    kind: 'note',
    text: 'Alpha memory',
    labels: ['project.alpha'],
    namespace: 'project.alpha',
    source: 'alpha.md',
    importance: 0.9,
    confidence: 0.95,
  });

  assert.notEqual(remembered.cortex, cortex);
  assert.equal(cortex.memories.length, 0);
  assert.equal(remembered.memory.actor, 'alice');
  assert.equal(remembered.cortex.memories.length, 1);

  const labeled = labelMemory(remembered.cortex, remembered.memory.id, ['project.alpha.launch']);
  assert.notEqual(labeled.cortex, remembered.cortex);
  assert.deepEqual(labeled.cortex.memories[0].labels, ['project.alpha', 'project.alpha.launch']);

  const linked = linkMemories(labeled.cortex, remembered.memory.id, 'entity.alpha', 'mentions');
  assert.equal(linked.cortex.memories[0].links.length, 1);
  assert.equal(linked.cortex.memories[0].links[0].relation, 'mentions');

  const forgotten = forget(linked.cortex, remembered.memory.id);
  assert.notEqual(forgotten.cortex, linked.cortex);
  assert.equal(forgotten.cortex.memories.length, 0);
});

test('recall ranks lexical and metadata signals deterministically', () => {
  const cortex = createCortex({ actor: 'alice', now: makeClock() });
  const plain = remember(cortex, {
    kind: 'note',
    text: 'alpha',
    labels: ['misc'],
    namespace: 'notes',
    source: 'plain',
    importance: 0.2,
    confidence: 0.2,
  });
  const boosted = remember(plain.cortex, {
    kind: 'note',
    text: 'alpha',
    labels: ['alpha.section'],
    namespace: 'alpha.topic',
    source: 'alpha source',
    importance: 0.9,
    confidence: 0.9,
  });
  const later = remember(boosted.cortex, {
    kind: 'task',
    text: 'alpha follow up',
    labels: ['alpha.section'],
    namespace: 'alpha.topic',
    source: 'task source',
    importance: 0.5,
    confidence: 0.5,
  });

  const queryHits = recall(later.cortex, 'alpha', { topK: 5 });
  assert.equal(queryHits[0].id, boosted.memory.id);
  assert.ok(queryHits[0].score >= queryHits[1].score);

  const browseHits = recall(later.cortex, '', { labels: 'alpha' });
  assert.equal(browseHits.length, 2);
  assert.equal(browseHits[0].id, later.memory.id);

  const filtered = recall(later.cortex, 'alpha', {
    minImportance: 0.8,
    minConfidence: 0.8,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, boosted.memory.id);
});

test('consolidation keeps output deterministic and write-free', () => {
  const cortex = createCortex({ actor: 'alice', now: makeClock() });
  const first = remember(cortex, {
    kind: 'note',
    text: 'alpha',
    labels: ['alpha.section'],
    namespace: 'project.alpha',
    source: 'alpha.md',
    importance: 0.9,
    confidence: 0.9,
  });
  const second = remember(first.cortex, {
    kind: 'task',
    text: 'beta',
    labels: ['beta'],
    namespace: 'project.beta',
    source: 'beta.md',
    importance: 0.2,
    confidence: 0.2,
  });

  const docs = consolidateMemories(second.cortex, {
    namespacePrefix: 'memory',
    kind: ['note'],
    labels: 'alpha',
    minImportance: 0.8,
    minConfidence: 0.8,
    now: 2_000,
  });

  assert.deepEqual(docs, [
    {
      id: first.memory.id,
      heading: 'note: alpha.section',
      namespace: 'memory.note',
      text: 'alpha',
    },
  ]);
});

test('memory adapter emits deterministic claim graph ops', () => {
  const cortex = createCortex({ actor: 'alice', now: makeClock() });
  const remembered = remember(cortex, {
    kind: 'note',
    text: 'Alpha memory',
    labels: ['project.alpha'],
    namespace: 'project.alpha',
    source: 'alpha.md',
    ts: 20,
    actor: 'alice',
  });
  const linked = linkMemories(
    remembered.cortex,
    remembered.memory.id,
    'mem_target',
    'references',
    { ts: 21, actor: 'alice' }
  );
  const memory = linked.cortex.memories[0];
  const ops = memoryToClaimOps(memory);
  const graph = applyClaimGraphLog(
    { version: 1, nodes: [], edges: [] },
    { version: 1, ops }
  );

  assert.deepEqual(
    ops.map((op) => op.op),
    ['upsert_node', 'upsert_node', 'upsert_node', 'add_edge', 'add_edge']
  );
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.nodes.some((node) => node.label === 'project alpha'));
  assert.equal(
    graph.nodes.filter((node) => node.label.startsWith('memory ')).length,
    2
  );
  assert.ok(graph.edges.some((edge) => edge.p === 'mentions'));
  assert.ok(graph.edges.some((edge) => edge.p === 'references'));
});
