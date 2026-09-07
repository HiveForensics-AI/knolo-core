import assert from 'node:assert/strict';
import test from 'node:test';
import { createOllamaReflexAdapterV1 } from '../dist/index.js';

test('adapts an explicit Ollama response without making a real network call', async () => {
  let request;
  let judgedInput;
  const adapter = createOllamaReflexAdapterV1({
    modelId: 'local-test',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(
        JSON.stringify({ response: 'approved', eval_count: 4 }),
        { status: 200 }
      );
    },
    judge: (output, input) => {
      judgedInput = input;
      return { failure: output !== 'approved' };
    },
  });
  const result = await adapter.run({
    taskId: 'support-001',
    query: 'reset account',
    context: 'Use recovery policy.',
    selectedAtomIds: [],
  });
  assert.equal(result.failure, false);
  assert.equal(result.outputTokens, 4);
  assert.equal(request.url, 'http://localhost:11434/api/generate');
  assert.match(request.init.body, /reset account/);
  assert.equal(judgedInput.taskId, 'support-001');
});

test('requires an output judge', () => {
  assert.throws(() => createOllamaReflexAdapterV1({ modelId: 'local-test' }));
});
