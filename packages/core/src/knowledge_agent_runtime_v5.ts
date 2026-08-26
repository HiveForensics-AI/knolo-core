import { assertToolAllowed, type AgentDefinitionV1 } from './agent.js';
import {
  checkpointKnowledgeRunV1,
  completeKnowledgeRunV1,
  failKnowledgeRunV1,
  knowledgeRunInputRootV1,
  resumeKnowledgeRunV1,
  startKnowledgeRunV1,
  type KnowledgeRunStateV1,
  type KnowledgeRunV1,
} from './knowledge_run_v5.js';
import { isToolCallV1, isToolResultV1, type ToolCallV1, type ToolResultV1 } from './tools.js';

export type KnowledgeAgentStepV1 =
  | { kind: 'tool'; call: ToolCallV1 }
  | { kind: 'checkpoint'; state: KnowledgeRunStateV1 }
  | { kind: 'complete'; result?: KnowledgeRunStateV1 };

export type KnowledgeAgentStepContextV1 = {
  run: KnowledgeRunV1;
  input: KnowledgeRunStateV1;
  state: KnowledgeRunStateV1;
  lastToolResult?: ToolResultV1;
};

export type KnowledgeAgentExecutionOptionsV1 = {
  run: KnowledgeRunV1;
  input: KnowledgeRunStateV1;
  executeStep: (context: KnowledgeAgentStepContextV1) => KnowledgeAgentStepV1 | Promise<KnowledgeAgentStepV1>;
  executeTool?: (call: ToolCallV1) => ToolResultV1 | Promise<ToolResultV1>;
  agent?: AgentDefinitionV1;
  now?: () => number;
  maxSteps?: number;
  persist?: (run: KnowledgeRunV1) => void | Promise<void>;
};

export type KnowledgeAgentExecutionResultV1 = {
  run: KnowledgeRunV1;
  status: 'paused' | 'completed' | 'failed';
  steps: number;
  toolCalls: ToolCallV1[];
  toolResults: ToolResultV1[];
};

export async function executeKnowledgeAgentRunV1(options: KnowledgeAgentExecutionOptionsV1): Promise<KnowledgeAgentExecutionResultV1> {
  if (!options || typeof options.executeStep !== 'function') throw new Error('V5 agent execution requires an executeStep function.');
  if (knowledgeRunInputRootV1(options.input) !== options.run.inputRoot) throw new Error('V5 agent input does not match the durable run input root.');
  const maxSteps = options.maxSteps ?? 64;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000) throw new Error('V5 agent execution maxSteps must be between 1 and 1000.');
  const now = options.now ?? (() => Date.now());
  let run = options.run;
  if (run.status === 'pending') run = await save(options, startKnowledgeRunV1(run, timestamp(now)));
  else if (run.status === 'paused') run = await save(options, resumeKnowledgeRunV1(run, timestamp(now)));
  else if (run.status !== 'running') throw new Error(`V5 agent execution cannot resume a ${run.status} run.`);

  let state = run.checkpoint?.state ?? {};
  let lastToolResult: ToolResultV1 | undefined;
  const toolCalls: ToolCallV1[] = [];
  const toolResults: ToolResultV1[] = [];
  const callIds = new Set<string>();
  let steps = 0;
  while (steps < maxSteps) {
    steps++;
    try {
      const step = await options.executeStep({ run, input: options.input, state, ...(lastToolResult ? { lastToolResult } : {}) });
      if (!step || (step.kind !== 'tool' && step.kind !== 'checkpoint' && step.kind !== 'complete')) throw new Error('V5 agent execution returned an invalid step.');
      if (step.kind === 'complete') {
        run = await save(options, completeKnowledgeRunV1(run, step.result ?? state, timestamp(now)));
        return { run, status: 'completed', steps, toolCalls, toolResults };
      }
      if (step.kind === 'checkpoint') {
        run = await save(options, checkpointKnowledgeRunV1(run, step.state, timestamp(now)));
        return { run, status: 'paused', steps, toolCalls, toolResults };
      }
      if (!isToolCallV1(step.call)) throw new Error('V5 agent execution returned an invalid tool call.');
      if (callIds.has(step.call.callId)) throw new Error(`V5 agent execution repeated tool call: ${step.call.callId}.`);
      callIds.add(step.call.callId);
      if (options.agent) assertToolAllowed(options.agent, step.call.tool);
      if (!options.executeTool) throw new Error(`V5 agent execution has no host executor for tool: ${step.call.tool}.`);
      const result = await options.executeTool(step.call);
      if (!isToolResultV1(result) || result.callId !== step.call.callId || result.tool !== step.call.tool) throw new Error('V5 agent execution received an invalid or mismatched tool result.');
      toolCalls.push(step.call);
      toolResults.push(result);
      lastToolResult = result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run = await save(options, failKnowledgeRunV1(run, message || 'V5 agent execution failed.', timestamp(now)));
      return { run, status: 'failed', steps, toolCalls, toolResults };
    }
  }
  run = await save(options, failKnowledgeRunV1(run, `V5 agent execution exceeded maxSteps=${maxSteps}.`, timestamp(now)));
  return { run, status: 'failed', steps, toolCalls, toolResults };
}

async function save(options: KnowledgeAgentExecutionOptionsV1, run: KnowledgeRunV1): Promise<KnowledgeRunV1> { if (options.persist) await options.persist(run); return run; }
function timestamp(now: () => number): number { const value = now(); if (!Number.isSafeInteger(value) || value < 0) throw new Error('V5 agent execution clock must return a non-negative safe integer.'); return value; }
