import { prepareGraph, semanticRootOf } from '../graph.js';
import type { EvidenceBinding, Graph, Relation } from '../types.js';
import { compareText } from './model.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';

export type CegDiff = {
  ok: true;
  semanticRoot: { before: string; after: string; changed: boolean };
  knowledgeRoot: { before: string; after: string; changed: boolean };
  nodes: { added: string[]; removed: string[] };
  relations: { added: Relation[]; removed: Relation[] };
  bindings: { added: EvidenceBinding[]; removed: EvidenceBinding[] };
  authority: Array<{ beforeId: string; afterId: string; nodeId: string; evidenceId: string; before: number | null; after: number | null }>;
  validity: Array<{ beforeId: string; afterId: string; nodeId: string; evidenceId: string; before: { validFrom: string | null; validUntil: string | null }; after: { validFrom: string | null; validUntil: string | null } }>;
  requirements: Array<{ beforeId: string; afterId: string; nodeId: string; evidenceId: string; before: string[]; after: string[] }>;
} | {
  ok: false;
  diagnostics: CegDiagnostic[];
};

export function diffCegGraphs(beforeInput: unknown, afterInput: unknown): CegDiff {
  const before = graphOf(beforeInput);
  const after = graphOf(afterInput);
  if (!before || !after) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'graph', 'Both sides must be committed evidence graphs or sidecars.')] };
  }
  const beforeNodes = new Set(before.nodes.map((node) => node.id));
  const afterNodes = new Set(after.nodes.map((node) => node.id));
  const beforeRelations = new Map(before.relations.map((relation) => [relation.id, relation]));
  const afterRelations = new Map(after.relations.map((relation) => [relation.id, relation]));
  const beforeBindings = new Map(before.bindings.map((binding) => [binding.id, binding]));
  const afterBindings = new Map(after.bindings.map((binding) => [binding.id, binding]));
  const removedBindings = [...beforeBindings.values()].filter((binding) => !afterBindings.has(binding.id));
  const addedBindings = [...afterBindings.values()].filter((binding) => !beforeBindings.has(binding.id));
  const paired = pairBindings(removedBindings, addedBindings);
  return {
    ok: true,
    semanticRoot: {
      before: semanticRootOf(before),
      after: semanticRootOf(after),
      changed: semanticRootOf(before) !== semanticRootOf(after),
    },
    knowledgeRoot: {
      before: before.knowledgeRoot,
      after: after.knowledgeRoot,
      changed: before.knowledgeRoot !== after.knowledgeRoot,
    },
    nodes: {
      added: [...afterNodes].filter((id) => !beforeNodes.has(id)).sort(compareText),
      removed: [...beforeNodes].filter((id) => !afterNodes.has(id)).sort(compareText),
    },
    relations: {
      added: [...afterRelations.values()].filter((relation) => !beforeRelations.has(relation.id)).sort((left, right) => compareText(left.id, right.id)),
      removed: [...beforeRelations.values()].filter((relation) => !afterRelations.has(relation.id)).sort((left, right) => compareText(left.id, right.id)),
    },
    bindings: {
      added: addedBindings.sort((left, right) => compareText(left.id, right.id)),
      removed: removedBindings.sort((left, right) => compareText(left.id, right.id)),
    },
    authority: paired.authority,
    validity: paired.validity,
    requirements: paired.requirements,
  };
}

function pairBindings(removed: EvidenceBinding[], added: EvidenceBinding[]): Pick<Extract<CegDiff, { ok: true }>, 'authority' | 'validity' | 'requirements'> {
  const addedBySlot = new Map<string, EvidenceBinding[]>();
  for (const binding of added) {
    const key = `${binding.nodeId}\0${binding.evidenceId}`;
    const list = addedBySlot.get(key) ?? [];
    list.push(binding);
    addedBySlot.set(key, list);
  }
  const authority: Extract<CegDiff, { ok: true }>['authority'] = [];
  const validity: Extract<CegDiff, { ok: true }>['validity'] = [];
  const requirements: Extract<CegDiff, { ok: true }>['requirements'] = [];
  for (const before of removed) {
    const key = `${before.nodeId}\0${before.evidenceId}`;
    const candidates = addedBySlot.get(key) ?? [];
    if (candidates.length !== 1) continue;
    const after = candidates[0];
    if (!after) continue;
    if ((before.authority ?? null) !== (after.authority ?? null)) {
      authority.push({
        beforeId: before.id,
        afterId: after.id,
        nodeId: before.nodeId,
        evidenceId: before.evidenceId,
        before: before.authority ?? null,
        after: after.authority ?? null,
      });
    }
    if ((before.validFrom ?? null) !== (after.validFrom ?? null) || (before.validUntil ?? null) !== (after.validUntil ?? null)) {
      validity.push({
        beforeId: before.id,
        afterId: after.id,
        nodeId: before.nodeId,
        evidenceId: before.evidenceId,
        before: { validFrom: before.validFrom ?? null, validUntil: before.validUntil ?? null },
        after: { validFrom: after.validFrom ?? null, validUntil: after.validUntil ?? null },
      });
    }
    if (before.requirements.join('\0') !== after.requirements.join('\0')) {
      requirements.push({
        beforeId: before.id,
        afterId: after.id,
        nodeId: before.nodeId,
        evidenceId: before.evidenceId,
        before: before.requirements,
        after: after.requirements,
      });
    }
  }
  return { authority, validity, requirements };
}

function graphOf(value: unknown): Graph | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { graph?: unknown };
  return prepareGraph(record.graph ?? value);
}
