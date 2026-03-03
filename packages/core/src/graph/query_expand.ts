import { normalize, tokenize } from '../tokenize.js';
import type { Pack } from '../pack.runtime.js';
import { expandLabelToTerms } from './claim_graph.js';

export type GraphQueryExpandOptions = {
  maxExtraTerms?: number;
  predicates?: string[];
};

export function expandQueryWithGraph(
  pack: Pack,
  queryString: string,
  opts: GraphQueryExpandOptions = {}
): string {
  const graph = pack.claimGraph;
  if (!graph || graph.nodes.length === 0 || graph.edges.length === 0) return queryString;

  const maxExtraTerms = Math.max(1, opts.maxExtraTerms ?? 12);
  const predicates = new Set((opts.predicates ?? ['defined_as', 'is', 'mentions', 'ref']).map((p) => normalize(p)));
  const qTokens = tokenize(queryString).map((t) => t.term);
  if (qTokens.length === 0) return queryString;

  const qSet = new Set(qTokens);
  const candidateNodeIds = new Set<string>();
  const labelEntries = Object.entries(graph.index?.labelToId ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [labelNorm, nodeId] of labelEntries) {
    if (qSet.has(labelNorm)) candidateNodeIds.add(nodeId);
  }
  for (const token of qTokens.sort()) {
    for (const [labelNorm, nodeId] of labelEntries) {
      if (labelNorm.startsWith(token)) candidateNodeIds.add(nodeId);
      if (candidateNodeIds.size >= maxExtraTerms * 4) break;
    }
    if (candidateNodeIds.size >= maxExtraTerms * 4) break;
  }

  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const outIdx = graph.index?.out ?? {};
  const extraTerms = new Set<string>();

  const sortedNodeIds = [...candidateNodeIds].sort();
  for (const nodeId of sortedNodeIds) {
    const edgeIds = [...(outIdx[nodeId] ?? [])].sort();
    for (const edgeId of edgeIds) {
      const edge = edgeById.get(edgeId);
      if (!edge || !predicates.has(normalize(edge.p))) continue;
      const target = graph.nodes.find((n) => n.id === edge.to);
      if (!target) continue;
      for (const term of expandLabelToTerms(target.label)) {
        if (!qSet.has(term)) extraTerms.add(term);
        if (extraTerms.size >= maxExtraTerms) break;
      }
      if (extraTerms.size >= maxExtraTerms) break;
    }
    if (extraTerms.size >= maxExtraTerms) break;
  }

  if (extraTerms.size === 0) return queryString;
  return `${queryString} ${[...extraTerms].sort().join(' ')}`.trim();
}
