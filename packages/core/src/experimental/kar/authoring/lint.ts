import type { Plan } from '../types.js';
import { validatePlan } from '../plan.js';
import { FRONTIERS, type Frontier } from '../types.js';
import type { EvidenceCatalog } from './catalog.js';
import { resolveEvidenceSelector } from './catalog.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import { cegNodeId } from './ids.js';
import { compareText, type CegSourceV1 } from './model.js';

export function lintCegSource(
  source: CegSourceV1,
  options: { catalog?: EvidenceCatalog; plan?: unknown } = {},
): CegDiagnostic[] {
  if (!source || source.format !== 'ceg-source-1' || !source.concepts || !source.evidence || !Array.isArray(source.relations) || !Array.isArray(source.bindings)) {
    return [diagnostic('error', 'CEG_SOURCE_INVALID', '', 'CEG Source is not a ceg-source-1 object.')];
  }
  const diagnostics: CegDiagnostic[] = [];
  const concepts = new Set(Object.keys(source.concepts));
  const relationKey = new Set<string>();
  for (const [index, relation] of source.relations.entries()) {
    const path = `relations[${index}]`;
    if (!relation || typeof relation.from !== 'string' || typeof relation.type !== 'string' || typeof relation.to !== 'string') {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_RELATION', path, 'Relation is missing from, type, or to.'));
      continue;
    }
    if (!concepts.has(relation.from)) {
      diagnostics.push(diagnostic('error', 'CEG_DANGLING_RELATION', `${path}.from`, `Unknown concept "${relation.from}".`));
    }
    if (!concepts.has(relation.to)) {
      diagnostics.push(diagnostic('error', 'CEG_DANGLING_RELATION', `${path}.to`, `Unknown concept "${relation.to}".`));
    }
    const key = `${relation.from}\0${relation.type}\0${relation.to}`;
    if (relationKey.has(key)) {
      diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_RELATION', path, `Duplicate relation ${relation.from} ${relation.type} ${relation.to}.`));
    }
    relationKey.add(key);
  }

  const bindingKey = new Set<string>();
  const evidenceConcepts = new Map<string, Set<string>>();
  for (const [index, binding] of source.bindings.entries()) {
    const path = `bindings[${index}]`;
    if (!binding || typeof binding.concept !== 'string' || typeof binding.evidence !== 'string' || !Array.isArray(binding.requirements)) {
      diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', path, 'Binding is missing concept, evidence, or requirements.'));
      continue;
    }
    if (!concepts.has(binding.concept)) {
      diagnostics.push(diagnostic('error', 'CEG_UNKNOWN_CONCEPT', `${path}.concept`, `Unknown concept "${binding.concept}".`));
    }
    if (!Object.prototype.hasOwnProperty.call(source.evidence, binding.evidence)) {
      diagnostics.push(diagnostic('error', 'CEG_UNKNOWN_EVIDENCE', `${path}.evidence`, `Unknown evidence alias "${binding.evidence}".`));
    }
    if (binding.requirements.length === 0) {
      diagnostics.push(diagnostic('warning', 'CEG_BINDING_WITHOUT_REQUIREMENTS', path, 'Binding has no requirements.'));
    }
    const key = [
      binding.concept,
      binding.evidence,
      binding.requirements.join('\0'),
      binding.authority ?? '',
      binding.unauthorized === true ? '1' : '0',
      binding.validFrom ?? '',
      binding.validUntil ?? '',
      binding.provenance ?? '',
    ].join('\u001f');
    if (bindingKey.has(key)) {
      diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_BINDING', path, 'Duplicate binding for the same concept, evidence, and applicability.'));
    }
    bindingKey.add(key);
    const used = evidenceConcepts.get(binding.evidence) ?? new Set<string>();
    used.add(binding.concept);
    evidenceConcepts.set(binding.evidence, used);
  }

  const bound = new Set(source.bindings.map((binding) => binding.concept));
  const incident = new Set<string>();
  for (const relation of source.relations) {
    incident.add(relation.from);
    incident.add(relation.to);
  }
  for (const name of [...concepts].sort(compareText)) {
    if (!incident.has(name) && !bound.has(name)) {
      diagnostics.push(diagnostic('warning', 'CEG_UNUSED_CONCEPT', `concepts.${name}`, `Concept "${name}" is unused.`));
    } else if (!bound.has(name)) {
      diagnostics.push(diagnostic('warning', 'CEG_UNBOUND_CONCEPT', `concepts.${name}`, `Concept "${name}" has no evidence binding.`));
    }
  }

  const usedRequirements = new Set(source.bindings.flatMap((binding) => binding.requirements ?? []));
  for (const name of source.requirements ?? []) {
    if (!usedRequirements.has(name)) {
      diagnostics.push(diagnostic('warning', 'CEG_UNUSED_REQUIREMENT', `requirements`, `Requirement "${name}" is never bound.`));
    }
  }

  for (const [alias, names] of evidenceConcepts) {
    if (names.size > 1) {
      diagnostics.push(diagnostic(
        'warning',
        'CEG_EVIDENCE_MANY_CONCEPTS',
        `evidence.${alias}`,
        `Evidence "${alias}" is bound to ${names.size} concepts.`,
      ));
    }
  }

  if (hasCycle(source)) {
    diagnostics.push(diagnostic('info', 'CEG_CYCLE_PRESENT', 'relations', 'The relation graph contains a cycle. Cycles are allowed.'));
  }
  const components = componentCount(source);
  if (components > 1) {
    diagnostics.push(diagnostic(
      'warning',
      'CEG_UNREACHABLE_COMPONENT',
      'concepts',
      `The graph has ${components} weakly connected components.`,
    ));
  }

  if (options.catalog) {
    for (const alias of Object.keys(source.evidence).sort(compareText)) {
      const selector = source.evidence[alias];
      if (!selector) continue;
      const resolved = resolveEvidenceSelector(selector, options.catalog, `evidence.${alias}`);
      if (!resolved.ok) diagnostics.push(resolved.diagnostic);
    }
  }
  if (options.plan !== undefined) lintPlan(source, options.plan, diagnostics);
  return sortDiagnostics(diagnostics);
}

function lintPlan(source: CegSourceV1, planInput: unknown, diagnostics: CegDiagnostic[]): void {
  const plan = validatePlan(planInput);
  if (!plan) {
    diagnostics.push(diagnostic('warning', 'CEG_PLAN_INVALID', 'plan', 'The supplied plan is not a valid KAR plan. Readiness was not checked.'));
    return;
  }
  const symbols = new Set(source.relations.map((relation) => relation.type));
  for (const symbol of [...symbols].sort(compareText)) {
    if (!Object.prototype.hasOwnProperty.call(plan.frontierMap, symbol)) {
      diagnostics.push(diagnostic('warning', 'CEG_PLAN_UNMAPPED_RELATION', `relations.${symbol}`, `Relation "${symbol}" is not mapped by the plan.`));
    }
  }
  const byFrontier = new Map<Frontier, number>();
  for (const frontier of FRONTIERS) byFrontier.set(frontier, 0);
  for (const [symbol, frontier] of Object.entries(plan.frontierMap)) {
    const count = source.relations.filter((relation) => relation.type === symbol).length;
    byFrontier.set(frontier, (byFrontier.get(frontier) ?? 0) + count);
  }
  for (const frontier of FRONTIERS) {
    if ((byFrontier.get(frontier) ?? 0) > 0) continue;
    const mapped = Object.values(plan.frontierMap).includes(frontier);
    if (!mapped) continue;
    diagnostics.push(diagnostic('warning', emptyFrontierCode(frontier), `plan.${frontier}`, emptyFrontierMessage(frontier)));
  }
  for (const frontier of FRONTIERS) {
    for (const requirement of plan.requirements[frontier]) {
      const present = source.bindings.some((binding) => binding.requirements.includes(requirement));
      if (!present) {
        diagnostics.push(diagnostic(
          'warning',
          'CEG_PLAN_REQUIREMENT_UNBOUND',
          `plan.${frontier}.${requirement}`,
          `Requirement "${requirement}" is not carried by any binding.`,
        ));
      }
    }
  }
  void (plan satisfies Plan);
}

function emptyFrontierCode(frontier: Frontier): string {
  if (frontier === 'F_O') return 'CEG_PLAN_EMPTY_OPPOSITION';
  if (frontier === 'F_Q') return 'CEG_PLAN_EMPTY_QUALIFICATION';
  return 'CEG_PLAN_EMPTY_FRONTIER';
}

function emptyFrontierMessage(frontier: Frontier): string {
  if (frontier === 'F_O') return 'The plan maps opposition, and the graph has no relation of that type.';
  if (frontier === 'F_Q') return 'The plan maps qualification, and the graph has no relation of that type.';
  return `The plan maps ${frontier}, and the graph has no relation of that type.`;
}

function hasCycle(source: CegSourceV1): boolean {
  const outgoing = new Map<string, string[]>();
  for (const name of Object.keys(source.concepts)) outgoing.set(name, []);
  for (const relation of source.relations) {
    if (relation.from === relation.to) return true;
    outgoing.get(relation.from)?.push(relation.to);
  }
  const color = new Map<string, 0 | 1 | 2>();
  for (const start of outgoing.keys()) {
    if ((color.get(start) ?? 0) !== 0) continue;
    const stack: { name: string; next: number }[] = [{ name: start, next: 0 }];
    color.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      const edges = outgoing.get(frame.name) ?? [];
      if (frame.next >= edges.length) {
        color.set(frame.name, 2);
        stack.pop();
        continue;
      }
      const next = edges[frame.next] ?? '';
      frame.next += 1;
      const state = color.get(next) ?? 0;
      if (state === 1) return true;
      if (state === 0) {
        color.set(next, 1);
        stack.push({ name: next, next: 0 });
      }
    }
  }
  return false;
}

function componentCount(source: CegSourceV1): number {
  const names = Object.keys(source.concepts);
  if (names.length === 0) return 0;
  const index = new Map(names.map((name, position) => [name, position]));
  const parent = names.map((_, position) => position);
  const find = (value: number): number => {
    let cursor = value;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor] ?? cursor] ?? cursor;
      cursor = parent[cursor] ?? cursor;
    }
    return cursor;
  };
  const unite = (left: string, right: string) => {
    const a = index.get(left);
    const b = index.get(right);
    if (a === undefined || b === undefined) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const relation of source.relations) unite(relation.from, relation.to);
  const roots = new Set<number>();
  names.forEach((_, position) => roots.add(find(position)));
  return roots.size;
}

export function conceptNodeIds(source: CegSourceV1): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const name of Object.keys(source.concepts).sort(compareText)) ids[name] = cegNodeId(name);
  return ids;
}
