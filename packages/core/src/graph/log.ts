import type { Pack } from '../pack.runtime.js';
import {
  canonicalEvidence,
  computeEdgeId,
  computeNodeId,
  finalizeGraph,
  normalizeClaimLabel,
} from './claim_graph.js';
import type { ClaimEdge, ClaimGraph, ClaimNode } from './claim_graph.js';

export type ClaimOp =
  | {
      op: 'upsert_node';
      id?: string;
      label: string;
      props?: Record<string, string>;
      ts: number;
      actor: string;
    }
  | {
      op: 'add_edge';
      from: string;
      p: string;
      to: string;
      evidence?: number[];
      ts: number;
      actor: string;
    }
  | {
      op: 'tombstone_edge';
      edgeId: string;
      ts: number;
      actor: string;
    };

export type ClaimGraphLog = { version: 1; ops: ClaimOp[] };

export function createGraphLog(): ClaimGraphLog {
  return { version: 1, ops: [] };
}

export function appendOp(log: ClaimGraphLog, op: ClaimOp): ClaimGraphLog {
  return { version: 1, ops: [...log.ops, op] };
}

export function mergeClaimGraphLogs(a: ClaimGraphLog, b: ClaimGraphLog): ClaimGraphLog {
  return { version: 1, ops: [...a.ops, ...b.ops].sort(compareOps) };
}

export function serializeClaimGraphLog(log: ClaimGraphLog): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: 1, ops: [...log.ops].sort(compareOps) }));
}

export function deserializeClaimGraphLog(data: Uint8Array): ClaimGraphLog {
  const parsed = JSON.parse(new TextDecoder().decode(data));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ops)) {
    throw new Error('Invalid ClaimGraphLog payload');
  }
  return { version: 1, ops: parsed.ops.sort(compareOps) };
}

export function applyClaimGraphLog(
  graphOrPack: ClaimGraph | Pack,
  log: ClaimGraphLog
): ClaimGraph {
  const baseGraph = isPack(graphOrPack)
    ? graphOrPack.claimGraph ?? { version: 1 as const, nodes: [], edges: [] }
    : graphOrPack;

  const nodeById = new Map<string, ClaimNode>(baseGraph.nodes.map((n) => [n.id, { ...n, props: n.props ? { ...n.props } : undefined }]));
  const edgeById = new Map<string, ClaimEdge>(
    baseGraph.edges.map((e) => [e.id, { ...e, evidence: canonicalEvidence(e.evidence) }])
  );

  const nodeStamp = new Map<string, [number, string]>();
  const addStamp = new Map<string, [number, string]>();
  const tombstoneStamp = new Map<string, [number, string]>();

  for (const op of [...log.ops].sort(compareOps)) {
    if (op.op === 'upsert_node') {
      const label = normalizeClaimLabel(op.label);
      const id = op.id || computeNodeId(label);
      const prev = nodeStamp.get(id);
      if (!prev || compareStamp([op.ts, op.actor], prev) >= 0) {
        nodeStamp.set(id, [op.ts, op.actor]);
        nodeById.set(id, { id, label, props: op.props ? { ...op.props } : undefined });
      }
      continue;
    }

    if (op.op === 'add_edge') {
      const evidence = canonicalEvidence(op.evidence);
      const edgeId = computeEdgeId(op.from, op.p, op.to, evidence);
      const prevAdd = addStamp.get(edgeId);
      if (!prevAdd || compareStamp([op.ts, op.actor], prevAdd) >= 0) {
        addStamp.set(edgeId, [op.ts, op.actor]);
      }
      const existing = edgeById.get(edgeId);
      const mergedEvidence = canonicalEvidence([...(existing?.evidence ?? []), ...evidence]);
      edgeById.set(edgeId, {
        id: edgeId,
        from: op.from,
        p: op.p,
        to: op.to,
        evidence: mergedEvidence,
        actor: op.actor,
        ts: op.ts,
      });
      continue;
    }

    const prev = tombstoneStamp.get(op.edgeId);
    if (!prev || compareStamp([op.ts, op.actor], prev) >= 0) {
      tombstoneStamp.set(op.edgeId, [op.ts, op.actor]);
    }
  }

  for (const [edgeId, edge] of edgeById) {
    const add = addStamp.get(edgeId) ?? [-Infinity, ''];
    const tomb = tombstoneStamp.get(edgeId);
    if (tomb && compareStamp(tomb, add) > 0) {
      edgeById.delete(edgeId);
      continue;
    }
    if (!nodeById.has(edge.from)) {
      nodeById.set(edge.from, { id: edge.from, label: edge.from });
    }
    if (!nodeById.has(edge.to)) {
      nodeById.set(edge.to, { id: edge.to, label: edge.to });
    }
  }

  return finalizeGraph({ version: 1, nodes: [...nodeById.values()], edges: [...edgeById.values()] });
}

function compareOps(a: ClaimOp, b: ClaimOp): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  const actorCmp = a.actor.localeCompare(b.actor);
  if (actorCmp !== 0) return actorCmp;
  return stableSerializeOp(a).localeCompare(stableSerializeOp(b));
}

function stableSerializeOp(op: ClaimOp): string {
  if (op.op === 'upsert_node') {
    return `upsert_node|${op.id || ''}|${normalizeClaimLabel(op.label)}|${JSON.stringify(op.props || {})}`;
  }
  if (op.op === 'add_edge') {
    return `add_edge|${op.from}|${op.p}|${op.to}|${canonicalEvidence(op.evidence).join(',')}`;
  }
  return `tombstone_edge|${op.edgeId}`;
}

function compareStamp(a: [number, string], b: [number, string]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1].localeCompare(b[1]);
}

function isPack(input: ClaimGraph | Pack): input is Pack {
  return Boolean((input as Pack).meta && (input as Pack).blocks);
}
