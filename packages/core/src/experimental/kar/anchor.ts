import { digest } from './canonicalize.js';
import type { AnchorSpec, WitnessRecord } from './types.js';

export type AnchorCommitment = {
  mode: 'recompute' | 'supplied' | null;
  procedure: string | null;
  witness: WitnessRecord[] | null;
  nodes: string[];
};

export function anchorRoot(commitment: AnchorCommitment): string {
  return digest(commitment);
}

export function memberIdAnchors(query: string, nodeIds: { has(id: string): boolean }): string[] {
  const found = new Set<string>();
  for (const token of query.split(/[^A-Za-z0-9_:-]+/)) {
    if (token.length > 0 && nodeIds.has(token)) found.add(token);
  }
  return [...found].sort();
}

export function resolveAnchor(query: string, nodeIds: { has(id: string): boolean }, anchor: AnchorSpec): {
  commitment: AnchorCommitment;
  rejected: boolean;
} {
  if (anchor.mode === 'recompute') {
    const nodes = anchor.procedure === 'member-id-v1' ? memberIdAnchors(query, nodeIds) : [];
    return {
      commitment: { mode: 'recompute', procedure: anchor.procedure, witness: null, nodes },
      rejected: false,
    };
  }
  const witness = anchor.witness.map((record) => {
    const copy: WitnessRecord = { nodeId: record.nodeId };
    if (record.queryTerm !== undefined) copy.queryTerm = record.queryTerm;
    return copy;
  });
  witness.sort((a, b) => {
    if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
    const left = a.queryTerm ?? '';
    const right = b.queryTerm ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const nodes = [...new Set(witness.map((record) => record.nodeId))].sort();
  return {
    commitment: { mode: 'supplied', procedure: null, witness, nodes },
    rejected: nodes.some((id) => !nodeIds.has(id)),
  };
}
