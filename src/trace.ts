import type { ToolCallV1, ToolResultV1 } from './tools.js';

export type TraceEventV1 =
  | { type: 'agent.selected'; ts: string; agentId: string; namespace?: string }
  | {
      type: 'prompt.resolved';
      ts: string;
      agentId: string;
      promptHash?: string;
      patchKeys?: string[];
    }
  | { type: 'tool.requested'; ts: string; agentId: string; call: ToolCallV1 }
  | {
      type: 'tool.executed';
      ts: string;
      agentId: string;
      result: ToolResultV1;
      durationMs?: number;
    }
  | {
      type: 'run.completed';
      ts: string;
      agentId: string;
      status: 'ok' | 'error';
    };

export function nowIso(): string {
  return new Date().toISOString();
}

export function createTrace(): {
  events: TraceEventV1[];
  push(e: TraceEventV1): void;
} {
  const events: TraceEventV1[] = [];
  return {
    events,
    push(e: TraceEventV1): void {
      events.push(e);
    },
  };
}
