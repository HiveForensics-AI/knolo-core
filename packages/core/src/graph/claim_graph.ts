import { normalize, tokenize } from '../tokenize.js';
import type { Pack } from '../pack.runtime.js';

export type ClaimNode = {
  id: string;
  label: string;
  props?: Record<string, string>;
};

export type ClaimEdge = {
  id: string;
  from: string;
  p: string;
  to: string;
  evidence?: number[];
  actor?: string;
  ts?: number;
};

export type ClaimGraph = {
  version: 1;
  nodes: ClaimNode[];
  edges: ClaimEdge[];
  index?: {
    labelToId?: Record<string, string>;
    out?: Record<string, string[]>;
    in?: Record<string, string[]>;
  };
};

export function normalizeClaimLabel(label: string, maxLen = 200): string {
  const compact = normalize(label).replace(/\s+/g, ' ').trim();
  return compact.slice(0, maxLen);
}

export function computeNodeId(label: string): string {
  return `n_${hash32Hex(normalizeClaimLabel(label))}`;
}

export function computeEdgeId(
  from: string,
  p: string,
  to: string,
  evidence?: number[]
): string {
  const evidenceCsv = canonicalEvidence(evidence).join(',');
  return `e_${hash32Hex(`${from}\n${p}\n${to}\n${evidenceCsv}`)}`;
}

export function canonicalEvidence(evidence?: number[]): number[] {
  if (!evidence?.length) return [];
  return Array.from(new Set(evidence.filter((n) => Number.isInteger(n) && n >= 0))).sort(
    (a, b) => a - b
  );
}

export function buildGraphIndex(graph: ClaimGraph): ClaimGraph['index'] {
  const labelToId: Record<string, string> = {};
  const out: Record<string, string[]> = {};
  const inbound: Record<string, string[]> = {};

  for (const node of graph.nodes) {
    labelToId[normalizeClaimLabel(node.label)] = node.id;
  }
  for (const edge of graph.edges) {
    (out[edge.from] ||= []).push(edge.id);
    (inbound[edge.to] ||= []).push(edge.id);
  }
  for (const key of Object.keys(out)) out[key].sort();
  for (const key of Object.keys(inbound)) inbound[key].sort();

  return { labelToId, out, in: inbound };
}

export function finalizeGraph(graph: ClaimGraph): ClaimGraph {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...graph.edges]
    .map((e) => ({ ...e, evidence: canonicalEvidence(e.evidence) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const out: ClaimGraph = { version: 1, nodes, edges };
  out.index = buildGraphIndex(out);
  return out;
}

export function getClaimGraph(pack: Pack): ClaimGraph | null {
  return pack.claimGraph ?? null;
}

export function validateClaimGraph(input: unknown): ClaimGraph | null {
  if (!input || typeof input !== 'object') return null;
  const g = input as ClaimGraph;
  if (g.version !== 1 || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  return finalizeGraph({ version: 1, nodes: g.nodes, edges: g.edges });
}

export function expandLabelToTerms(label: string): string[] {
  return tokenize(normalizeClaimLabel(label)).map((t) => t.term);
}

function hash32Hex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
