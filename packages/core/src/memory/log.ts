import { getTextDecoder, getTextEncoder } from '../utils/utf8.js';
import type { MemoryEngramV1, MemoryLinkV1 } from './engram.js';
import {
  createMemoryId,
  normalizeMemoryActor,
  normalizeMemoryInput,
  normalizeMemoryKind,
  normalizeMemoryNamespace,
  normalizeMemorySource,
  normalizeMemoryTimestamp,
} from './engram.js';
import { matchesMemoryLabels, validateMemoryLabels } from './label.js';

export type MemoryOpV1 =
  | {
      op: 'remember';
      ts: number;
      actor: string;
      memory: MemoryEngramV1;
    }
  | {
      op: 'forget';
      ts: number;
      actor: string;
      id: string;
    }
  | {
      op: 'label';
      ts: number;
      actor: string;
      id: string;
      labels: string[];
    }
  | {
      op: 'link';
      ts: number;
      actor: string;
      from: string;
      to: string;
      relation: string;
      confidence?: number;
    };

export type MemoryLogV1 = { version: 1; ops: MemoryOpV1[] };

export function createMemoryLog(): MemoryLogV1 {
  return { version: 1, ops: [] };
}

export function appendMemoryOp(log: MemoryLogV1, op: MemoryOpV1): MemoryLogV1 {
  return { version: 1, ops: [...log.ops, op] };
}

export function mergeMemoryLogs(a: MemoryLogV1, b: MemoryLogV1): MemoryLogV1 {
  return { version: 1, ops: [...a.ops, ...b.ops].sort(compareMemoryOps) };
}

export function serializeMemoryLog(log: MemoryLogV1): Uint8Array {
  const enc = getTextEncoder();
  return enc.encode(JSON.stringify(normalizeMemoryLog(log)));
}

export function deserializeMemoryLog(data: Uint8Array): MemoryLogV1 {
  const dec = getTextDecoder();
  const parsed = JSON.parse(dec.decode(data));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ops)) {
    throw new Error('Invalid MemoryLog payload');
  }

  return normalizeMemoryLog({ version: 1, ops: parsed.ops as MemoryOpV1[] });
}

export function applyMemoryLog(log: MemoryLogV1): MemoryEngramV1[] {
  const memories = new Map<string, MemoryEngramV1>();
  const tombstones = new Set<string>();
  const pendingLabels = new Map<string, Set<string>>();
  const pendingLinks = new Map<string, Map<string, MemoryLinkV1>>();

  for (const op of [...log.ops].sort(compareMemoryOps)) {
    if (op.op === 'remember') {
      if (tombstones.has(op.memory.id)) continue;

      const memory = normalizeMemoryInput(op.memory, {
        actor: op.actor,
        ts: op.ts,
      });
      const mergedLabels = mergeLabels(
        memory.labels,
        pendingLabels.get(memory.id)
      );
      const mergedLinks = mergeLinks(memory.id, memory.links, pendingLinks.get(memory.id));

      memories.set(memory.id, {
        ...memory,
        labels: mergedLabels,
        links: mergedLinks,
      });
      pendingLabels.delete(memory.id);
      pendingLinks.delete(memory.id);
      continue;
    }

    if (op.op === 'forget') {
      memories.delete(op.id);
      tombstones.add(op.id);
      pendingLabels.delete(op.id);
      pendingLinks.delete(op.id);
      continue;
    }

    if (op.op === 'label') {
      if (tombstones.has(op.id)) continue;
      const labels = validateMemoryLabels(op.labels);
      const memory = memories.get(op.id);
      if (memory) {
        memories.set(op.id, {
          ...memory,
          labels: validateMemoryLabels([...memory.labels, ...labels]),
        });
      } else if (labels.length > 0) {
        const pending = pendingLabels.get(op.id) ?? new Set<string>();
        for (const label of labels) pending.add(label);
        pendingLabels.set(op.id, pending);
      }
      continue;
    }

    if (tombstones.has(op.from)) continue;
    const link = createLink(op);
    const memory = memories.get(op.from);
    if (memory) {
      memories.set(op.from, {
        ...memory,
        links: mergeLinks(memory.id, memory.links, new Map([[link.id, link]])),
      });
    } else {
      const pending = pendingLinks.get(op.from) ?? new Map<string, MemoryLinkV1>();
      pending.set(link.id, link);
      pendingLinks.set(op.from, pending);
    }
  }

  return [...memories.values()]
    .map((memory) => ({
      ...memory,
      labels: [...memory.labels].sort((a, b) => a.localeCompare(b)),
      links: [...memory.links].sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

function normalizeMemoryLog(log: MemoryLogV1): MemoryLogV1 {
  return {
    version: 1,
    ops: [...log.ops].sort(compareMemoryOps).map((op) => normalizeMemoryOp(op)),
  };
}

function normalizeMemoryOp(op: MemoryOpV1): MemoryOpV1 {
  if (op.op === 'remember') {
    const memory = normalizeMemoryInput(op.memory, {
      actor: op.actor,
      ts: op.ts,
    });
    return {
      op: 'remember',
      ts: normalizeMemoryTimestamp(op.ts),
      actor: normalizeMemoryActor(op.actor),
      memory,
    };
  }

  if (op.op === 'forget') {
    return {
      op: 'forget',
      ts: normalizeMemoryTimestamp(op.ts),
      actor: normalizeMemoryActor(op.actor),
      id: String(op.id),
    };
  }

  if (op.op === 'label') {
    return {
      op: 'label',
      ts: normalizeMemoryTimestamp(op.ts),
      actor: normalizeMemoryActor(op.actor),
      id: String(op.id),
      labels: validateMemoryLabels(op.labels),
    };
  }

  return {
    op: 'link',
    ts: normalizeMemoryTimestamp(op.ts),
    actor: normalizeMemoryActor(op.actor),
    from: String(op.from),
    to: String(op.to),
    relation: normalizeMemoryKind(op.relation),
    confidence: op.confidence === undefined ? undefined : clamp01(op.confidence),
  };
}

function compareMemoryOps(a: MemoryOpV1, b: MemoryOpV1): number {
  const tsA = a.ts;
  const tsB = b.ts;
  if (tsA !== tsB) return tsA - tsB;

  const actorCmp = a.actor.localeCompare(b.actor);
  if (actorCmp !== 0) return actorCmp;

  const rankA = memoryOpRank(a.op);
  const rankB = memoryOpRank(b.op);
  if (rankA !== rankB) return rankA - rankB;

  return stableSerializeMemoryOp(a).localeCompare(stableSerializeMemoryOp(b));
}

function memoryOpRank(op: MemoryOpV1['op']): number {
  switch (op) {
    case 'remember':
      return 0;
    case 'label':
      return 1;
    case 'link':
      return 2;
    case 'forget':
      return 3;
  }
}

function stableSerializeMemoryOp(op: MemoryOpV1): string {
  if (op.op === 'remember') {
    const memory = op.memory;
    return [
      'remember',
      memory.id,
      memory.kind,
      memory.text,
      memory.labels.join(','),
      memory.namespace ?? '',
      memory.source ?? '',
      memory.importance ?? '',
      memory.confidence ?? '',
    ].join('|');
  }

  if (op.op === 'forget') {
    return ['forget', op.id].join('|');
  }

  if (op.op === 'label') {
    return ['label', op.id, op.labels.join(',')].join('|');
  }

  return [
    'link',
    op.from,
    op.to,
    op.relation,
    op.confidence ?? '',
  ].join('|');
}

function mergeLabels(
  labels: string[],
  pending?: Set<string>
): string[] {
  if (!pending || pending.size === 0) return [...labels].sort((a, b) => a.localeCompare(b));
  return validateMemoryLabels([...labels, ...pending]);
}

function mergeLinks(
  fromId: string,
  links: MemoryLinkV1[],
  pending?: Map<string, MemoryLinkV1>
): MemoryLinkV1[] {
  const map = new Map<string, MemoryLinkV1>(links.map((link) => [link.id, link]));
  if (pending) {
    for (const [id, link] of pending) {
      if (link.from === fromId) {
        map.set(id, link);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function createLink(op: Extract<MemoryOpV1, { op: 'link' }>): MemoryLinkV1 {
  return {
    version: 1,
    id: createMemoryId({
      kind: 'link',
      text: [op.from, op.relation, op.to, op.confidence ?? ''].join('\u0001'),
      ts: op.ts,
      actor: op.actor,
    }),
    from: op.from,
    to: op.to,
    relation: op.relation,
    ts: op.ts,
    actor: op.actor,
    confidence: op.confidence,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
