import type { MemoryEngramV1, MemoryInputV1, MemoryLinkV1 } from './engram.js';
import {
  createMemoryId,
  normalizeMemoryActor,
  normalizeMemoryInput,
  normalizeMemoryKind,
  normalizeMemoryTimestamp,
} from './engram.js';
import {
  appendMemoryOp,
  applyMemoryLog,
  createMemoryLog,
  type MemoryLogV1,
  type MemoryOpV1,
} from './log.js';
import { validateMemoryLabels } from './label.js';

export type CortexV1 = {
  version: 1;
  actor: string;
  now: () => number;
  log: MemoryLogV1;
  memories: MemoryEngramV1[];
};

export type CortexWriteResult<T extends object> = T & {
  cortex: CortexV1;
};

export function createCortex(opts: {
  actor?: string;
  now?: () => number;
  log?: MemoryLogV1;
} = {}): CortexV1 {
  const log: MemoryLogV1 = opts.log ? { version: 1, ops: [...opts.log.ops] } : createMemoryLog();
  return {
    version: 1,
    actor: normalizeMemoryActor(opts.actor ?? 'cortex'),
    now: opts.now ?? (() => Date.now()),
    log,
    memories: applyMemoryLog(log),
  };
}

export function remember(
  cortex: CortexV1,
  input: MemoryInputV1
): CortexWriteResult<{ memory: MemoryEngramV1; op: MemoryOpV1 }> {
  const memory = normalizeMemoryInput(input, {
    actor: cortex.actor,
    ts: cortex.now(),
  });
  const op: MemoryOpV1 = {
    op: 'remember',
    ts: memory.ts,
    actor: memory.actor,
    memory,
  };
  return applyWrite(cortex, op, { memory });
}

export function forget(
  cortex: CortexV1,
  id: string,
  provenance: { ts?: number; actor?: string } = {}
): CortexWriteResult<{ memoryId: string; op: MemoryOpV1 }> {
  const op: MemoryOpV1 = {
    op: 'forget',
    id,
    ts: normalizeMemoryTimestamp(provenance.ts ?? cortex.now()),
    actor: normalizeMemoryActor(provenance.actor ?? cortex.actor),
  };
  return applyWrite(cortex, op, { memoryId: id });
}

export function labelMemory(
  cortex: CortexV1,
  id: string,
  labels: string | readonly string[],
  provenance: { ts?: number; actor?: string } = {}
): CortexWriteResult<{ memory?: MemoryEngramV1; op: MemoryOpV1 }> {
  const normalizedLabels = validateMemoryLabels(labels);
  const op: MemoryOpV1 = {
    op: 'label',
    id,
    labels: normalizedLabels,
    ts: normalizeMemoryTimestamp(provenance.ts ?? cortex.now()),
    actor: normalizeMemoryActor(provenance.actor ?? cortex.actor),
  };
  return applyWrite(cortex, op, {
    memory: cortex.memories.find((memory) => memory.id === id),
  });
}

export function linkMemories(
  cortex: CortexV1,
  from: string,
  to: string,
  relation: string,
  provenance: { ts?: number; actor?: string; confidence?: number } = {}
): CortexWriteResult<{ link: MemoryLinkV1; op: MemoryOpV1 }> {
  const normalizedRelation = normalizeMemoryKind(relation);
  const ts = normalizeMemoryTimestamp(provenance.ts ?? cortex.now());
  const actor = normalizeMemoryActor(provenance.actor ?? cortex.actor);
  const link: MemoryLinkV1 = {
    version: 1,
    id: createMemoryId({
      kind: 'link',
      text: [from, normalizedRelation, to, provenance.confidence ?? ''].join('\u0001'),
      ts,
      actor,
    }),
    from,
    to,
    relation: normalizedRelation,
    ts,
    actor,
    confidence: provenance.confidence,
  };
  const op: MemoryOpV1 = {
    op: 'link',
    from,
    to,
    relation: normalizedRelation,
    confidence: provenance.confidence,
    ts,
    actor,
  };
  return applyWrite(cortex, op, { link });
}

function applyWrite<T extends object>(
  cortex: CortexV1,
  op: MemoryOpV1,
  extra: T
): CortexWriteResult<T & { op: MemoryOpV1 }> {
  const log = appendMemoryOp(cortex.log, op);
  const memories = applyMemoryLog(log);
  return {
    ...extra,
    op,
    cortex: {
      version: 1,
      actor: cortex.actor,
      now: cortex.now,
      log,
      memories,
    },
  };
}
