import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPack,
  consolidateMemories,
  createCortex,
  forget,
  labelMemory,
  mountPack,
  query,
  recall,
  remember,
} from '../dist/index.js';

function makeClock(start = 10_000) {
  let current = start;
  return () => current += 1;
}

test('create -> remember -> recall -> label/forget -> consolidate -> rebuild -> query', async () => {
  const cortex = createCortex({ actor: 'planner', now: makeClock() });
  const first = remember(cortex, {
    kind: 'note',
    text: 'Knolo Cortex keeps project alpha memory local and deterministic.',
    labels: ['project.alpha'],
    namespace: 'project.alpha',
    source: 'alpha.md',
    importance: 0.95,
    confidence: 0.95,
  });
  const second = remember(first.cortex, {
    kind: 'note',
    text: 'This scratch note should be forgotten before consolidation.',
    labels: ['scratch'],
    namespace: 'project.beta',
    source: 'beta.md',
    importance: 0.2,
    confidence: 0.2,
  });

  const recallHits = recall(second.cortex, 'project alpha deterministic', { topK: 5 });
  assert.equal(recallHits[0].id, first.memory.id);

  const labeled = labelMemory(second.cortex, first.memory.id, ['project.alpha.cortex']);
  const forgotten = forget(labeled.cortex, second.memory.id);
  assert.equal(recall(forgotten.cortex, 'scratch', { topK: 5 }).length, 0);

  const docs = consolidateMemories(forgotten.cortex, { namespacePrefix: 'memory' });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, first.memory.id);
  assert.equal(docs[0].heading, 'note: project.alpha/project.alpha.cortex');
  assert.equal(docs[0].namespace, 'memory.note');

  const rebuilt = await mountPack({ src: await buildPack(docs) });
  const hits = query(rebuilt, 'project alpha deterministic', { topK: 5 });

  assert.ok(hits.length > 0);
  assert.equal(hits[0].source, first.memory.id);
  assert.equal(hits[0].namespace, 'memory.note');
});
