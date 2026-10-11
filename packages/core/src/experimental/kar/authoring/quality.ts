import { prepareGraph, semanticRootOf } from '../graph.js';
import { validatePlan } from '../plan.js';
import { FRONTIERS, type Frontier, type Graph } from '../types.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';
import { compareText } from './model.js';

export type CegQuality = {
  nodeCount: number;
  relationCount: number;
  bindingCount: number;
  relationTypeDistribution: Record<string, number>;
  bindingsPerNode: { min: number; max: number; mean: number };
  requirementsPerBinding: { min: number; max: number; mean: number };
  unboundNodes: number;
  componentCount: number;
  largestComponent: number;
  evidenceCount: number;
  evidenceReuse: number;
  temporalBindingCount: number;
  authorityBindingCount: number;
  semanticRoot: string;
};

export function inspectCegQuality(graphInput: unknown): { ok: true; quality: CegQuality } | { ok: false; diagnostics: CegDiagnostic[] } {
  const graph = graphFrom(graphInput);
  if (!graph) return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'graph', 'Quality inspection requires a committed evidence graph.')] };
  const distribution: Record<string, number> = {};
  for (const relation of graph.relations) distribution[relation.relation] = (distribution[relation.relation] ?? 0) + 1;
  const bindingsByNode = new Map<string, number>();
  for (const node of graph.nodes) bindingsByNode.set(node.id, 0);
  const evidenceUse = new Map<string, number>();
  let temporal = 0;
  let authority = 0;
  const requirementCounts: number[] = [];
  for (const binding of graph.bindings) {
    bindingsByNode.set(binding.nodeId, (bindingsByNode.get(binding.nodeId) ?? 0) + 1);
    evidenceUse.set(binding.evidenceId, (evidenceUse.get(binding.evidenceId) ?? 0) + 1);
    if (binding.validFrom || binding.validUntil) temporal += 1;
    if (binding.authority !== undefined) authority += 1;
    requirementCounts.push(binding.requirements.length);
  }
  const bindingCounts = [...bindingsByNode.values()];
  const components = componentSizes(graph);
  return {
    ok: true,
    quality: {
      nodeCount: graph.nodes.length,
      relationCount: graph.relations.length,
      bindingCount: graph.bindings.length,
      relationTypeDistribution: sortRecord(distribution),
      bindingsPerNode: summarize(bindingCounts),
      requirementsPerBinding: summarize(requirementCounts),
      unboundNodes: bindingCounts.filter((count) => count === 0).length,
      componentCount: components.length,
      largestComponent: components.reduce((max, size) => Math.max(max, size), 0),
      evidenceCount: evidenceUse.size,
      evidenceReuse: [...evidenceUse.values()].filter((count) => count > 1).length,
      temporalBindingCount: temporal,
      authorityBindingCount: authority,
      semanticRoot: semanticRootOf(graph),
    },
  };
}

export type KarReadiness = {
  diagnostics: CegDiagnostic[];
  mappedRelations: string[];
  unmappedRelations: string[];
};

export function inspectKarReadiness(graphInput: unknown, plans: readonly unknown[]): { ok: true; readiness: KarReadiness } | { ok: false; diagnostics: CegDiagnostic[] } {
  const graph = graphFrom(graphInput);
  if (!graph) return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'graph', 'Readiness inspection requires a committed evidence graph.')] };
  const diagnostics: CegDiagnostic[] = [];
  const symbols = [...new Set(graph.relations.map((relation) => relation.relation))].sort(compareText);
  const mapped = new Set<string>();
  const unmapped = new Set(symbols);
  plans.forEach((planInput, index) => {
    const plan = validatePlan(planInput);
    if (!plan) {
      diagnostics.push(diagnostic('warning', 'CEG_PLAN_INVALID', `plans[${index}]`, 'Plan is not valid, so readiness skipped it.'));
      return;
    }
    const counts = new Map<Frontier, number>();
    for (const frontier of FRONTIERS) counts.set(frontier, 0);
    for (const [symbol, frontier] of Object.entries(plan.frontierMap)) {
      if (symbols.includes(symbol)) {
        mapped.add(symbol);
        unmapped.delete(symbol);
      }
      const count = graph.relations.filter((relation) => relation.relation === symbol).length;
      counts.set(frontier, (counts.get(frontier) ?? 0) + count);
    }
    for (const frontier of FRONTIERS) {
      if (!Object.values(plan.frontierMap).includes(frontier)) continue;
      if ((counts.get(frontier) ?? 0) > 0) continue;
      const code = frontier === 'F_O' ? 'CEG_PLAN_EMPTY_OPPOSITION' : frontier === 'F_Q' ? 'CEG_PLAN_EMPTY_QUALIFICATION' : 'CEG_PLAN_EMPTY_FRONTIER';
      diagnostics.push(diagnostic('warning', code, `plans[${index}].${frontier}`, `Frontier ${frontier} has no relation of the mapped type.`));
    }
    for (const frontier of FRONTIERS) {
      for (const requirement of plan.requirements[frontier]) {
        if (!graph.bindings.some((binding) => binding.requirements.includes(requirement))) {
          diagnostics.push(diagnostic('warning', 'CEG_PLAN_REQUIREMENT_UNBOUND', `plans[${index}].${frontier}.${requirement}`, `Requirement "${requirement}" is never bound.`));
        }
      }
    }
  });
  for (const symbol of symbols) {
    if (!mapped.has(symbol)) {
      diagnostics.push(diagnostic('warning', 'CEG_PLAN_UNMAPPED_RELATION', symbol, `Relation "${symbol}" is not used by the supplied plans.`));
    }
  }
  return {
    ok: true,
    readiness: {
      diagnostics,
      mappedRelations: [...mapped].sort(compareText),
      unmappedRelations: [...unmapped].sort(compareText),
    },
  };
}

function graphFrom(value: unknown): Graph | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { graph?: unknown };
  return prepareGraph(record.graph ?? value);
}

function summarize(values: number[]): { min: number; max: number; mean: number } {
  if (values.length === 0) return { min: 0, max: 0, mean: 0 };
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, max, mean: Number((sum / values.length).toFixed(6)) };
}

function sortRecord(value: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(value).sort(compareText)) sorted[key] = value[key] ?? 0;
  return sorted;
}

function componentSizes(graph: Graph): number[] {
  const ids = graph.nodes.map((node) => node.id);
  const index = new Map(ids.map((id, position) => [id, position]));
  const parent = ids.map((_, position) => position);
  const find = (value: number): number => {
    let cursor = value;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor] ?? cursor] ?? cursor;
      cursor = parent[cursor] ?? cursor;
    }
    return cursor;
  };
  for (const relation of graph.relations) {
    const left = index.get(relation.from);
    const right = index.get(relation.to);
    if (left === undefined || right === undefined) continue;
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  }
  const sizes = new Map<number, number>();
  ids.forEach((_, position) => {
    const root = find(position);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  });
  return [...sizes.values()].sort((left, right) => right - left);
}
