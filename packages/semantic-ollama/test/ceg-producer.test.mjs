import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeCegWithOllama } from '../dist/index.js';

test('local model adapter returns parsed JSON and rejects malformed text', async () => {
  const good = await proposeCegWithOllama({
    evidence: [{ id: 'sha256-aa', text: 'The agreement may terminate.' }],
    schema: { relations: ['permits'] },
    endpoint: 'http://ollama.test',
    model: 'mock',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { message: { content: '{"concepts":[],"relations":[],"bindings":[],"aliases":[]}' } };
      },
    }),
  });
  assert.deepEqual(good.output.relations, []);
  assert.match(good.prompt, /may terminate/);
  await assert.rejects(
    () => proposeCegWithOllama({
      evidence: [],
      schema: {},
      fetchImpl: async () => ({ ok: true, async json() { return { message: { content: 'not json' } }; } }),
    }),
    /CEG_PRODUCER_OUTPUT_INVALID/,
  );
  await assert.rejects(
    () => proposeCegWithOllama({
      evidence: [],
      schema: {},
      fetchImpl: async () => ({ ok: true, async json() { return { message: { content: '```json\n{"concepts":[]}\n```' } }; } }),
    }),
    /CEG_PRODUCER_OUTPUT_INVALID/,
  );
});
