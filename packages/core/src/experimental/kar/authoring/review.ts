import type { EvidenceCatalog } from './catalog.js';
import { resolveEvidenceSelector } from './catalog.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';
import { cegNodeId, cegRelationId } from './ids.js';
import { lintCegSource } from './lint.js';
import { compareText, type CegSourceV1 } from './model.js';

export type CegReview = {
  concepts: Array<{ name: string; label: string | null; nodeId: string }>;
  relations: Array<{ from: string; type: string; to: string; relationId: string }>;
  bindings: Array<{
    concept: string;
    evidence: string;
    evidenceId: string | null;
    excerpt: string | null;
    requirements: string[];
    authority: number | null;
    validFrom: string | null;
    validUntil: string | null;
  }>;
  diagnostics: CegDiagnostic[];
};

export function reviewCegSource(source: CegSourceV1, catalog?: EvidenceCatalog): CegReview {
  if (!source?.concepts || !source.evidence || !Array.isArray(source.relations) || !Array.isArray(source.bindings)) {
    return {
      concepts: [],
      relations: [],
      bindings: [],
      diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', '', 'CEG Source is not a ceg-source-1 object.')],
    };
  }
  const diagnostics = lintCegSource(source, catalog ? { catalog } : {});
  const nodeIds = new Map(Object.keys(source.concepts).map((name) => [name, cegNodeId(name)]));
  const texts = new Map<string, { id: string; text: string }>();
  if (catalog) {
    for (const [alias, selector] of Object.entries(source.evidence)) {
      if (!selector) continue;
      const resolved = resolveEvidenceSelector(selector, catalog, `evidence.${alias}`);
      if (resolved.ok) texts.set(alias, { id: resolved.id, text: resolved.text });
    }
  }
  return {
    concepts: Object.keys(source.concepts).sort(compareText).map((name) => ({
      name,
      label: source.concepts[name]?.label ?? null,
      nodeId: nodeIds.get(name) ?? cegNodeId(name),
    })),
    relations: source.relations.map((relation) => ({
      from: relation.from,
      type: relation.type,
      to: relation.to,
      relationId: cegRelationId(nodeIds.get(relation.from) ?? '', relation.type, nodeIds.get(relation.to) ?? ''),
    })),
    bindings: source.bindings.map((binding) => {
      const resolved = texts.get(binding.evidence);
      return {
        concept: binding.concept,
        evidence: binding.evidence,
        evidenceId: resolved?.id ?? null,
        excerpt: resolved ? excerpt(resolved.text) : null,
        requirements: binding.requirements,
        authority: binding.authority ?? null,
        validFrom: binding.validFrom ?? null,
        validUntil: binding.validUntil ?? null,
      };
    }),
    diagnostics,
  };
}

export function renderCegReview(review: CegReview): string {
  const lines = ['CEG SOURCE REVIEW', ''];
  lines.push('CONCEPTS');
  for (const concept of review.concepts) {
    lines.push(`${concept.name}  ${concept.label ?? '(no label)'}  ${concept.nodeId}`);
  }
  lines.push('', 'RELATIONS');
  for (const relation of review.relations) {
    lines.push(`${relation.from}  ${relation.type}  ${relation.to}`);
  }
  lines.push('', 'BINDINGS');
  for (const binding of review.bindings) {
    lines.push([
      binding.concept,
      binding.evidence,
      binding.evidenceId ?? '(unresolved)',
      binding.requirements.join(', ') || '(no requirements)',
      binding.authority === null ? 'authority (none)' : `authority ${binding.authority}`,
      binding.validFrom || binding.validUntil ? `${binding.validFrom ?? ''}..${binding.validUntil ?? ''}` : 'validity (none)',
      binding.excerpt ?? '(no excerpt)',
    ].join('  |  '));
  }
  if (review.diagnostics.length > 0) {
    lines.push('', 'DIAGNOSTICS');
    for (const item of review.diagnostics) lines.push(`${item.severity}  ${item.code}  ${item.path}  ${item.message}`);
  }
  return lines.join('\n');
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}
