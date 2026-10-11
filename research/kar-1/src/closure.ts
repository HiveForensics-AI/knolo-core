import { digest } from './canonicalize.js';
import {
  FRONTIERS,
  emptyFrontiers,
  type EvidenceBinding,
  type Frontier,
  type Graph,
  type PathStep,
  type Plan,
  type Witness,
} from './types.js';

export type ClosureOutcome =
  | { ok: true; frontiers: Record<Frontier, string[]>; witnesses: Witness[]; admissions: Admission[]; edges: number }
  | { ok: false; edges: number };

export type Admission = {
  evidenceId: string;
  frontier: Frontier;
  applicable: boolean;
  requirements: string[];
};

type State = {
  nodeId: string;
  frontier: string;
  depth: number;
  anchorId: string;
  path: PathStep[];
};

function applicable(binding: EvidenceBinding, plan: Plan): boolean {
  if (binding.unauthorized) return false;
  if (plan.minAuthority !== null) {
    if (binding.authority === undefined || binding.authority < plan.minAuthority) return false;
  }
  if (binding.validFrom !== undefined && plan.asOf < binding.validFrom) return false;
  if (binding.validUntil !== undefined && plan.asOf >= binding.validUntil) return false;
  return true;
}

function stateOrder(a: State, b: State): number {
  if (a.frontier !== b.frontier) return a.frontier < b.frontier ? -1 : 1;
  return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
}

/**
 * Breadth-first closure over (node, frontier) states.
 * The arriving relation replaces the frontier. The first time a state is
 * reached is the canonical witness, because each layer is expanded in order.
 */
export function closeFrontiers(graph: Graph, plan: Plan, anchors: readonly string[]): ClosureOutcome {
  const bounds = plan.bounds;
  if (graph.bindings.length > bounds.maxEvidenceBindings) return { ok: false, edges: 0 };
  if (anchors.length > bounds.maxAnchorNodes) return { ok: false, edges: 0 };
  if (anchors.length > bounds.maxClosureNodes) return { ok: false, edges: 0 };

  const outgoing = new Map<string, Graph['relations']>();
  for (const relation of graph.relations) {
    const list = outgoing.get(relation.from) ?? [];
    list.push(relation);
    outgoing.set(relation.from, list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byNode = new Map<string, EvidenceBinding[]>();
  for (const binding of graph.bindings) {
    const list = byNode.get(binding.nodeId) ?? [];
    list.push(binding);
    byNode.set(binding.nodeId, list);
  }

  const frontiers = emptyFrontiers();
  const members = new Map<string, Set<string>>();
  for (const frontier of FRONTIERS) members.set(frontier, new Set());
  const witnesses: Witness[] = [];
  const witnessKeys = new Set<string>();
  const admissions: Admission[] = [];

  const seenStates = new Set<string>();
  const seenNodes = new Set<string>();
  let edges = 0;
  let current: State[] = anchors.map((nodeId) => ({
    nodeId,
    frontier: '',
    depth: 0,
    anchorId: nodeId,
    path: [{ node: nodeId }],
  }));
  for (const state of current) {
    seenStates.add(`${state.nodeId}\0${state.frontier}`);
    seenNodes.add(state.nodeId);
  }

  const fail = (): ClosureOutcome => ({ ok: false, edges });

  const admit = (state: State): ClosureOutcome | null => {
    if (state.frontier === '') return null;
    const frontier = state.frontier as Frontier;
    const bucket = members.get(frontier)!;
    for (const binding of byNode.get(state.nodeId) ?? []) {
      if (!bucket.has(binding.evidenceId)) {
        if (bucket.size + 1 > bounds.maxFrontierEvidence) return fail();
        bucket.add(binding.evidenceId);
        frontiers[frontier].push(binding.evidenceId);
      }
      const key = `${frontier}\0${binding.evidenceId}`;
      if (!witnessKeys.has(key)) {
        witnessKeys.add(key);
        witnesses.push({
          evidenceId: binding.evidenceId,
          frontier,
          anchorId: state.anchorId,
          path: state.path.map((step) => ({ ...step })),
        });
      }
      admissions.push({
        evidenceId: binding.evidenceId,
        frontier,
        applicable: applicable(binding, plan),
        requirements: applicable(binding, plan) ? [...binding.requirements] : [],
      });
    }
    return null;
  };

  while (current.length > 0) {
    const next: State[] = [];
    for (const state of current) {
      if (state.depth >= plan.depth) continue;
      for (const relation of outgoing.get(state.nodeId) ?? []) {
        const label = plan.frontierMap[relation.relation];
        if (!label) continue;
        if (edges + 1 > bounds.maxClosureEdges) return fail();
        edges += 1;
        const key = `${relation.to}\0${label}`;
        if (seenStates.has(key)) continue;
        if (!seenNodes.has(relation.to)) {
          if (seenNodes.size + 1 > bounds.maxClosureNodes) return fail();
          seenNodes.add(relation.to);
        }
        seenStates.add(key);
        next.push({
          nodeId: relation.to,
          frontier: label,
          depth: state.depth + 1,
          anchorId: state.anchorId,
          path: [...state.path, { relation: relation.id, node: relation.to }],
        });
      }
    }
    next.sort(stateOrder);
    for (const state of next) {
      const overflow = admit(state);
      if (overflow) return overflow;
    }
    current = next;
  }

  if (plan.lexical) {
    const frontier = plan.lexical.frontier;
    const bucket = members.get(frontier)!;
    const ids = [...new Set(plan.lexical.evidenceIds)].sort();
    for (const evidenceId of ids) {
      if (bucket.has(evidenceId)) continue;
      if (bucket.size + 1 > bounds.maxFrontierEvidence) return fail();
      bucket.add(evidenceId);
      frontiers[frontier].push(evidenceId);
      witnesses.push({ evidenceId, frontier, anchorId: null, path: [] });
      const related = graph.bindings.filter((binding) => binding.evidenceId === evidenceId);
      if (related.length === 0) {
        admissions.push({ evidenceId, frontier, applicable: true, requirements: [] });
      } else {
        for (const binding of related) {
          const ok = applicable(binding, plan);
          admissions.push({
            evidenceId,
            frontier,
            applicable: ok,
            requirements: ok ? [...binding.requirements] : [],
          });
        }
      }
    }
  }

  for (const frontier of FRONTIERS) frontiers[frontier].sort();
  witnesses.sort(witnessOrder);
  return { ok: true, frontiers, witnesses, admissions, edges };
}

function witnessOrder(a: Witness, b: Witness): number {
  if (a.frontier !== b.frontier) return a.frontier < b.frontier ? -1 : 1;
  if (a.evidenceId !== b.evidenceId) return a.evidenceId < b.evidenceId ? -1 : 1;
  const left = a.anchorId ?? '';
  const right = b.anchorId ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

export function frontierRoot(frontiers: Record<Frontier, string[]>): string {
  return digest(frontiers);
}

export function frontierWitnessRoot(witnesses: readonly Witness[]): string {
  return digest(witnesses);
}
