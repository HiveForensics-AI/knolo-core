import { canonicalize, digest } from '../canonicalize.js';
import { prepareGraph, semanticRootOf } from '../graph.js';
import type { EvidenceBinding, Graph, KarSidecarV1, Relation } from '../types.js';
import { openEvidenceCatalog, resolveEvidenceSelector, type EvidenceCatalog } from './catalog.js';
import {
  CEG_BUILD_FORMAT,
  CEG_COMPILER_ID,
  CEG_COMPILER_PRODUCER,
  CEG_SOURCE_VERSION,
  resolveLimits,
  type CegLimits,
} from './constants.js';
import { diagnostic, hasErrors, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import { cegBindingId, cegNodeId, cegRelationId } from './ids.js';
import { lintCegSource } from './lint.js';
import { compareText, interpretCegSource, type CegSourceV1 } from './model.js';
import type { KarImageInput } from '../v5.js';

export type CegBuildRecord = {
  format: typeof CEG_BUILD_FORMAT;
  identity: {
    compiler: { id: typeof CEG_COMPILER_ID; version: typeof CEG_SOURCE_VERSION };
    configRoot: string;
    sourceRoot: string;
    image: {
      stateRoot: string;
      objectRoot: string;
      commitDigest: string;
      knowledgeRoot: string;
    };
    semanticRoot: string;
    sidecarDigest: string;
  };
};

export type CegCompilation = {
  ok: true;
  sidecar: KarSidecarV1;
  bytes: string;
  diagnostics: CegDiagnostic[];
  buildInfo: CegBuildRecord;
  semanticRoot: string;
} | {
  ok: false;
  diagnostics: CegDiagnostic[];
};

export function compileCegSource(input: {
  source: CegSourceV1;
  image: KarImageInput;
  plan?: unknown;
  limits?: Partial<CegLimits>;
  catalog?: EvidenceCatalog;
}): CegCompilation {
  const limits = resolveLimits(input.limits);
  const interpreted = interpretCegSource(input.source, limits);
  if (!interpreted.ok) return { ok: false, diagnostics: interpreted.diagnostics };
  const source = interpreted.source;
  const opened = input.catalog ? { ok: true as const, catalog: input.catalog } : openEvidenceCatalog(input.image);
  if (!opened.ok) return { ok: false, diagnostics: opened.diagnostics };
  const diagnostics = lintCegSource(source, { catalog: opened.catalog, plan: input.plan });
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  const resolved = new Map<string, string>();
  for (const alias of Object.keys(source.evidence)) {
    const selector = source.evidence[alias];
    if (!selector) continue;
    const match = resolveEvidenceSelector(selector, opened.catalog, `evidence.${alias}`);
    if (!match.ok) return { ok: false, diagnostics: sortDiagnostics([...diagnostics, match.diagnostic]) };
    resolved.set(alias, match.id);
  }

  const nodeIdByName = new Map<string, string>();
  const nodes = Object.keys(source.concepts).sort(compareText).map((name) => {
    const id = cegNodeId(name);
    nodeIdByName.set(name, id);
    return { id };
  });
  const relations: Relation[] = [];
  const relationIds = new Set<string>();
  for (const relation of source.relations) {
    const from = nodeIdByName.get(relation.from);
    const to = nodeIdByName.get(relation.to);
    if (!from || !to) {
      return { ok: false, diagnostics: [diagnostic('error', 'CEG_DANGLING_RELATION', 'relations', 'Relation endpoint was not compiled.')] };
    }
    const id = cegRelationId(from, relation.type, to);
    if (relationIds.has(id)) {
      return { ok: false, diagnostics: [diagnostic('error', 'CEG_DUPLICATE_RELATION', 'relations', 'Compiled relation id collided.')] };
    }
    relationIds.add(id);
    relations.push({ id, from, relation: relation.type, to });
  }
  relations.sort((left, right) => compareText(left.id, right.id));

  const bindings: EvidenceBinding[] = [];
  const bindingIds = new Set<string>();
  for (const binding of source.bindings) {
    const nodeId = nodeIdByName.get(binding.concept);
    const evidenceId = resolved.get(binding.evidence);
    if (!nodeId || !evidenceId) {
      return { ok: false, diagnostics: [diagnostic('error', 'CEG_UNKNOWN_EVIDENCE', 'bindings', 'Binding could not be resolved.')] };
    }
    const requirements = [...binding.requirements].sort(compareText);
    const authority = binding.authority ?? null;
    const unauthorized = binding.unauthorized === true ? true : null;
    const validFrom = binding.validFrom ?? null;
    const validUntil = binding.validUntil ?? null;
    const provenance = binding.provenance ?? null;
    const id = cegBindingId({ nodeId, evidenceId, requirements, authority, unauthorized, validFrom, validUntil, provenance });
    if (bindingIds.has(id)) {
      return { ok: false, diagnostics: [diagnostic('error', 'CEG_DUPLICATE_BINDING', 'bindings', 'Compiled binding id collided.')] };
    }
    bindingIds.add(id);
    const committed: EvidenceBinding = { id, nodeId, evidenceId, requirements };
    if (authority !== null) committed.authority = authority;
    if (unauthorized === true) committed.unauthorized = true;
    if (validFrom) committed.validFrom = validFrom;
    if (validUntil) committed.validUntil = validUntil;
    if (provenance) committed.provenance = provenance;
    bindings.push(committed);
  }
  bindings.sort((left, right) => compareText(left.id, right.id));

  const graph: Graph = {
    version: 1,
    knowledgeRoot: opened.catalog.knowledgeRoot,
    provenance: { producer: CEG_COMPILER_PRODUCER },
    nodes,
    relations,
    bindings,
  };
  const prepared = prepareGraph(graph);
  if (!prepared) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'graph', 'The compiler produced a graph the frozen KAR parser rejected.')] };
  }
  const sidecar: KarSidecarV1 = {
    version: 1,
    stateRoot: opened.catalog.stateRoot,
    objectRoot: opened.catalog.objectRoot,
    commitDigest: opened.catalog.commitDigest,
    knowledgeRoot: opened.catalog.knowledgeRoot,
    graph: prepared,
  };
  const semanticRoot = semanticRootOf(prepared);
  const bytes = `${canonicalize(sidecar)}\n`;
  const buildInfo: CegBuildRecord = {
    format: CEG_BUILD_FORMAT,
    identity: {
      compiler: { id: CEG_COMPILER_ID, version: CEG_SOURCE_VERSION },
      configRoot: digest({
        format: 'ceg-build-config-1',
        compiler: CEG_COMPILER_ID,
        version: CEG_SOURCE_VERSION,
        producer: CEG_COMPILER_PRODUCER,
        limits,
      }),
      sourceRoot: digest({ format: CEG_SOURCE_VERSION, source }),
      image: {
        stateRoot: opened.catalog.stateRoot,
        objectRoot: opened.catalog.objectRoot,
        commitDigest: opened.catalog.commitDigest,
        knowledgeRoot: opened.catalog.knowledgeRoot,
      },
      semanticRoot,
      sidecarDigest: digest(sidecar),
    },
  };
  return {
    ok: true,
    sidecar,
    bytes,
    diagnostics: diagnostics.filter((item) => item.severity !== 'error'),
    buildInfo,
    semanticRoot,
  };
}

export function serializeCegBuild(record: CegBuildRecord): string {
  return `${canonicalize(record)}\n`;
}
