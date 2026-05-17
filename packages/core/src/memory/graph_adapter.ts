import { computeEdgeId, computeNodeId, normalizeClaimLabel } from '../graph/claim_graph.js';
import type { ClaimOp } from '../graph/log.js';
import type { MemoryEngramV1, MemoryLinkV1 } from './engram.js';
import { validateMemoryLabels } from './label.js';

type ClaimNodeOp = Extract<ClaimOp, { op: 'upsert_node' }>;
type ClaimEdgeOp = Extract<ClaimOp, { op: 'add_edge' }>;

export function memoryToClaimOps(memory: MemoryEngramV1): ClaimOp[] {
  const nodeOps = new Map<string, ClaimNodeOp>();
  const edgeOps = new Map<string, ClaimEdgeOp>();

  const memoryLabel = memoryNodeLabel(memory.id);
  upsertNode(nodeOps, memoryLabel, memory.ts, memory.actor);

  for (const label of validateMemoryLabels(memory.labels)) {
    const entityLabel = normalizeClaimLabel(label);
    if (!entityLabel) continue;
    upsertNode(nodeOps, entityLabel, memory.ts, memory.actor);
    upsertEdge(edgeOps, memoryLabel, 'mentions', entityLabel, memory.ts, memory.actor);
  }

  for (const link of sortedLinks(memory.links)) {
    const relation = normalizeClaimLabel(link.relation);
    if (!relation) continue;

    const targetLabel = memoryNodeLabel(link.to);
    upsertNode(nodeOps, targetLabel, link.ts, link.actor);
    upsertEdge(edgeOps, memoryLabel, relation, targetLabel, link.ts, link.actor);
  }

  return [...nodeOps.values(), ...edgeOps.values()];
}

function memoryNodeLabel(id: string): string {
  return normalizeClaimLabel(`memory ${id}`);
}

function upsertNode(
  nodeOps: Map<string, ClaimNodeOp>,
  label: string,
  ts: number,
  actor: string
): void {
  if (!label) return;
  const id = computeNodeId(label);
  if (nodeOps.has(id)) return;
  nodeOps.set(id, {
    op: 'upsert_node',
    id,
    label,
    ts,
    actor,
  });
}

function upsertEdge(
  edgeOps: Map<string, ClaimEdgeOp>,
  fromLabel: string,
  relation: string,
  toLabel: string,
  ts: number,
  actor: string
): void {
  if (!fromLabel || !relation || !toLabel) return;

  const from = computeNodeId(fromLabel);
  const to = computeNodeId(toLabel);
  const id = computeEdgeId(from, relation, to);
  if (edgeOps.has(id)) return;

  edgeOps.set(id, {
    op: 'add_edge',
    from,
    p: relation,
    to,
    ts,
    actor,
  });
}

function sortedLinks(memoryLinks: ReadonlyArray<MemoryLinkV1>): MemoryLinkV1[] {
  return [...memoryLinks].sort((a, b) =>
    a.ts - b.ts ||
    a.actor.localeCompare(b.actor) ||
    a.relation.localeCompare(b.relation) ||
    a.to.localeCompare(b.to) ||
    a.id.localeCompare(b.id)
  );
}
