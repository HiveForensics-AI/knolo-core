import { openEvidenceCatalog } from './catalog.js';
import { CEG_SOURCE_VERSION } from './constants.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import { canonicalCegSource, type CegEvidenceSelector, type CegSourceV1 } from './model.js';
import type { KarImageInput } from '../v5.js';

/** Read the single `claims` object from a Knowledge Image. Zero or many claims objects fail closed. */
export function readImageClaimGraph(image: KarImageInput): { ok: true; claim: unknown } | { ok: false; diagnostics: CegDiagnostic[] } {
  const opened = openEvidenceCatalog(image);
  if (!opened.ok) return opened;
  const claims = opened.catalog.objects.filter((object) => object.kind === 'claims');
  if (claims.length === 0) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'image', 'The Knowledge Image has no claims object.')] };
  }
  if (claims.length > 1) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_EVIDENCE_AMBIGUOUS', 'image', 'The Knowledge Image has more than one claims object.')] };
  }
  const text = claims[0]?.text ?? '';
  try {
    return { ok: true, claim: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PARSE', 'claims', 'The claims object is not JSON.')] };
  }
}

/**
 * Bootstrap importer for a Knolo ClaimGraph.
 * It copies nodes and edge predicates. It does not invent contradiction,
 * qualification, override, validity, or authority.
 */
export function importClaimGraph(
  input: unknown,
  options: { blockEvidence?: Record<string, CegEvidenceSelector> } = {},
): { ok: true; source: CegSourceV1; diagnostics: CegDiagnostic[] } | { ok: false; diagnostics: CegDiagnostic[] } {
  const diagnostics: CegDiagnostic[] = [diagnostic(
    'info',
    'CEG_CLAIM_IMPORT_LIMITED',
    '',
    'ClaimGraph import copies structure only. It does not invent contradicts, qualifies, overrides, validity, or authority.',
  )];
  if (!input || typeof input !== 'object') {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', '', 'ClaimGraph must be an object.')] };
  }
  const graph = input as { version?: unknown; nodes?: unknown; edges?: unknown };
  if (graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', '', 'ClaimGraph version, nodes, or edges are missing.')] };
  }
  const concepts: CegSourceV1['concepts'] = {};
  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object') {
      diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'nodes', 'Claim node must be an object.'));
      continue;
    }
    const row = node as { id?: unknown; label?: unknown };
    if (typeof row.id !== 'string' || row.id.length === 0) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_IDENTIFIER', 'nodes', 'Claim node id is missing.'));
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(concepts, row.id)) {
      diagnostics.push(diagnostic('error', 'CEG_DUPLICATE_CONCEPT', `concepts.${row.id}`, `Duplicate claim node "${row.id}".`));
      continue;
    }
    concepts[row.id] = typeof row.label === 'string' ? { label: row.label } : {};
  }
  const relations: CegSourceV1['relations'] = [];
  const evidence: CegSourceV1['evidence'] = {};
  const bindings: CegSourceV1['bindings'] = [];
  let unmappedEvidence = 0;
  for (const edge of graph.edges) {
    if (!edge || typeof edge !== 'object') {
      diagnostics.push(diagnostic('error', 'CEG_SOURCE_INVALID', 'edges', 'Claim edge must be an object.'));
      continue;
    }
    const row = edge as { from?: unknown; p?: unknown; to?: unknown; evidence?: unknown };
    if (typeof row.from !== 'string' || typeof row.to !== 'string' || typeof row.p !== 'string' || row.p.length === 0) {
      diagnostics.push(diagnostic('error', 'CEG_INVALID_RELATION', 'edges', 'Claim edge is missing from, p, or to.'));
      continue;
    }
    relations.push({ from: row.from, type: row.p, to: row.to });
    if (Array.isArray(row.evidence) && row.evidence.length > 0 && !options.blockEvidence) unmappedEvidence += 1;
    if (options.blockEvidence && Array.isArray(row.evidence)) {
      for (const block of row.evidence) {
        const key = String(block);
        const selector = options.blockEvidence[key];
        if (!selector) {
          unmappedEvidence += 1;
          continue;
        }
        const alias = `block-${key}`;
        evidence[alias] = selector;
        bindings.push({ concept: row.to, evidence: alias, requirements: [], provenance: 'claim-graph-block' });
      }
    }
  }
  if (unmappedEvidence > 0) {
    diagnostics.push(diagnostic(
      'warning',
      'CEG_CLAIM_EVIDENCE_UNMAPPED',
      'edges',
      `${unmappedEvidence} claim edges cite block indexes that were not mapped to Knowledge Image evidence.`,
    ));
  }
  if (diagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  return {
    ok: true,
    source: canonicalCegSource({
      format: CEG_SOURCE_VERSION,
      concepts,
      evidence,
      relations,
      bindings,
      requirements: [],
    }),
    diagnostics: sortDiagnostics(diagnostics),
  };
}
