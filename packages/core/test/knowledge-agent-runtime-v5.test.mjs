import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  createKnowledgeRunV1,
  executeKnowledgeAgentRunV1,
  verifyKnowledgeRunV1,
} from '../dist/index.js';
import { DurableKnowledgeRunStoreV5 } from '../dist/node.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run() {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('agent runtime'), meta: {} }] });
  return createKnowledgeRunV1({ agentId: 'universal-agent', imageStateRoot: image.stateRoot, input: { task: 'lookup' }, createdAt: 1 });
}

const allowedAgent = { id: 'universal-agent', version: 1, systemPrompt: ['Use tools carefully.'], retrievalDefaults: { namespace: ['default'] }, toolPolicy: { mode: 'allow', tools: ['search'] } };

test('V5 agent runtime orchestrates injected tools and durable checkpoints', async () => {
  const initial = run();
  let clock = 10;
  const first = await executeKnowledgeAgentRunV1({
    run: initial,
    input: { task: 'lookup' },
    agent: allowedAgent,
    now: () => clock++,
    executeStep: ({ lastToolResult, state }) => lastToolResult ? { kind: 'checkpoint', state: { ...state, found: lastToolResult.output } } : { kind: 'tool', call: { type: 'tool_call', callId: 'call-1', tool: 'search', args: { q: 'knolo' } } },
    executeTool: (call) => ({ type: 'tool_result', callId: call.callId, tool: call.tool, ok: true, output: 'result-1' }),
  });
  assert.equal(first.status, 'paused');
  assert.equal(first.toolCalls.length, 1);
  assert.equal(first.toolResults[0].output, 'result-1');
  verifyKnowledgeRunV1(first.run);

  const second = await executeKnowledgeAgentRunV1({
    run: first.run,
    input: { task: 'lookup' },
    now: () => clock++,
    executeStep: ({ state }) => ({ kind: 'complete', result: { ...state, answer: 'done' } }),
  });
  assert.equal(second.status, 'completed');
  assert.equal(second.run.checkpoint.state.found, 'result-1');
  verifyKnowledgeRunV1(second.run);
});

test('V5 agent runtime enforces tool policy, input binding, and step limits', async () => {
  const denied = await executeKnowledgeAgentRunV1({
    run: run(),
    input: { task: 'lookup' },
    agent: allowedAgent,
    now: () => 5,
    executeStep: () => ({ kind: 'tool', call: { type: 'tool_call', callId: 'call-1', tool: 'write', args: {} } }),
    executeTool: () => ({ type: 'tool_result', callId: 'call-1', tool: 'write', ok: true }),
  });
  assert.equal(denied.status, 'failed');
  assert.match(denied.run.events.at(-1).payload.error, /does not allow/i);
  await assert.rejects(() => executeKnowledgeAgentRunV1({ run: run(), input: { task: 'different' }, executeStep: () => ({ kind: 'complete' }) }), /input root/i);

  let toolCounter = 0;
  const limited = await executeKnowledgeAgentRunV1({
    run: run(),
    input: { task: 'lookup' },
    now: () => 5,
    maxSteps: 2,
    executeStep: () => ({ kind: 'tool', call: { type: 'tool_call', callId: `call-${++toolCounter}`, tool: 'search', args: {} } }),
    executeTool: (call) => ({ type: 'tool_result', callId: call.callId, tool: call.tool, ok: true }),
  });
  assert.equal(limited.status, 'failed');
  assert.match(limited.run.events.at(-1).payload.error, /maxSteps/i);
});

test('V5 agent runtime persists through the Node durable run store', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'knolo-v5-agent-runtime-'));
  const path = join(directory, 'run.v5');
  try {
    const store = DurableKnowledgeRunStoreV5.open(path, run());
    let clock = 20;
    const first = await executeKnowledgeAgentRunV1({ run: store.snapshot(), input: { task: 'lookup' }, now: () => clock++, persist: (next) => store.update(next), executeStep: () => ({ kind: 'checkpoint', state: { phase: 'saved' } }) });
    assert.equal(first.status, 'paused');
    const second = await executeKnowledgeAgentRunV1({ run: store.snapshot(), input: { task: 'lookup' }, now: () => clock++, persist: (next) => store.update(next), executeStep: () => ({ kind: 'complete', result: { phase: 'done' } }) });
    assert.equal(second.status, 'completed');
    assert.equal(store.snapshot().status, 'completed');
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
