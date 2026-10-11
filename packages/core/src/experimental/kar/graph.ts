import { digest } from './canonicalize.js';
import {
  FRONTIERS,
  type EvidenceBinding,
  type Frontier,
  type Graph,
  type Image,
  type KarIndexes,
  type Relation,
} from './types.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROOT = /^sha256-[0-9a-f]{64}$/;

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export type PreparedImage = {
  image: Image;
  knowledgeRoot: string;
  texts: Map<string, string>;
};

export function prepareImage(input: unknown): PreparedImage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (!onlyKeys(raw, ['version', 'evidence'])) return null;
  if (raw.version !== 1 || !Array.isArray(raw.evidence)) return null;
  const evidence: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const item of raw.evidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (!onlyKeys(row, ['id', 'text'])) return null;
    if (typeof row.id !== 'string' || row.id.length === 0 || seen.has(row.id)) return null;
    if (typeof row.text !== 'string') return null;
    seen.add(row.id);
    evidence.push({ id: row.id, text: row.text });
  }
  evidence.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const image: Image = { version: 1, evidence };
  const texts = new Map(evidence.map((row) => [row.id, row.text]));
  return { image, knowledgeRoot: digest(image), texts };
}

function sortId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function prepareGraph(input: unknown): Graph | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (!onlyKeys(raw, ['version', 'knowledgeRoot', 'provenance', 'nodes', 'relations', 'bindings'])) return null;
  if (raw.version !== 1 || typeof raw.knowledgeRoot !== 'string' || !ROOT.test(raw.knowledgeRoot)) return null;
  if (!raw.provenance || typeof raw.provenance !== 'object' || Array.isArray(raw.provenance)) return null;
  const provenanceRaw = raw.provenance as Record<string, unknown>;
  if (!onlyKeys(provenanceRaw, ['producer', 'note'])) return null;
  if (typeof provenanceRaw.producer !== 'string' || provenanceRaw.producer.length === 0) return null;
  if (provenanceRaw.note !== undefined && typeof provenanceRaw.note !== 'string') return null;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.relations) || !Array.isArray(raw.bindings)) return null;

  const nodes: { id: string }[] = [];
  const nodeIds = new Set<string>();
  for (const item of raw.nodes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (!onlyKeys(row, ['id'])) return null;
    const id = row.id;
    if (typeof id !== 'string' || id.length === 0 || nodeIds.has(id)) return null;
    nodeIds.add(id);
    nodes.push({ id });
  }

  const relations: Graph['relations'] = [];
  const relationIds = new Set<string>();
  for (const item of raw.relations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (!onlyKeys(row, ['id', 'from', 'relation', 'to'])) return null;
    if (typeof row.id !== 'string' || row.id.length === 0 || relationIds.has(row.id)) return null;
    if (typeof row.from !== 'string' || !nodeIds.has(row.from)) return null;
    if (typeof row.to !== 'string' || !nodeIds.has(row.to)) return null;
    if (typeof row.relation !== 'string' || row.relation.length === 0) return null;
    relationIds.add(row.id);
    relations.push({ id: row.id, from: row.from, relation: row.relation, to: row.to });
  }

  const bindings: EvidenceBinding[] = [];
  const bindingIds = new Set<string>();
  for (const item of raw.bindings) {
    const binding = normalizeBinding(item, nodeIds, bindingIds);
    if (!binding) return null;
    bindingIds.add(binding.id);
    bindings.push(binding);
  }

  const provenance: Graph['provenance'] = { producer: provenanceRaw.producer };
  if (provenanceRaw.note !== undefined) provenance.note = provenanceRaw.note;
  return {
    version: 1,
    knowledgeRoot: raw.knowledgeRoot,
    provenance,
    nodes: sortId(nodes),
    relations: sortId(relations),
    bindings: sortId(bindings),
  };
}

function normalizeBinding(item: unknown, nodeIds: Set<string>, bindingIds: Set<string>): EvidenceBinding | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  if (!onlyKeys(row, ['id', 'nodeId', 'evidenceId', 'requirements', 'authority', 'unauthorized', 'validFrom', 'validUntil', 'provenance'])) return null;
  if (typeof row.id !== 'string' || row.id.length === 0 || bindingIds.has(row.id)) return null;
  if (typeof row.nodeId !== 'string' || !nodeIds.has(row.nodeId)) return null;
  if (typeof row.evidenceId !== 'string' || row.evidenceId.length === 0) return null;
  if (!Array.isArray(row.requirements)) return null;
  const requirements: string[] = [];
  const seenReq = new Set<string>();
  for (const requirement of row.requirements) {
    if (typeof requirement !== 'string' || requirement.length === 0 || seenReq.has(requirement)) return null;
    seenReq.add(requirement);
    requirements.push(requirement);
  }
  requirements.sort();
  const binding: EvidenceBinding = {
    id: row.id,
    nodeId: row.nodeId,
    evidenceId: row.evidenceId,
    requirements,
  };
  if (row.authority !== undefined) {
    if (typeof row.authority !== 'number' || !Number.isInteger(row.authority)) return null;
    binding.authority = row.authority;
  }
  if (row.unauthorized !== undefined) {
    if (row.unauthorized !== true && row.unauthorized !== false) return null;
    if (row.unauthorized === true) binding.unauthorized = true;
  }
  if (row.validFrom !== undefined) {
    if (typeof row.validFrom !== 'string' || !DATE.test(row.validFrom)) return null;
    binding.validFrom = row.validFrom;
  }
  if (row.validUntil !== undefined) {
    if (typeof row.validUntil !== 'string' || !DATE.test(row.validUntil)) return null;
    binding.validUntil = row.validUntil;
  }
  if (row.provenance !== undefined) {
    if (typeof row.provenance !== 'string' || row.provenance.length === 0) return null;
    binding.provenance = row.provenance;
  }
  return binding;
}

export function isFrontier(value: unknown): value is Frontier {
  return typeof value === 'string' && (FRONTIERS as readonly string[]).includes(value);
}

export function semanticRootOf(graph: Graph): string {
  return digest({ knowledgeRoot: graph.knowledgeRoot, graph });
}

export function unresolvedEvidence(graph: Graph, texts: Map<string, string>): boolean {
  for (const binding of graph.bindings) {
    if (!texts.has(binding.evidenceId)) return true;
  }
  return false;
}

function pushGroup<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Build the immutable execution indexes for one prepared graph. */
export function buildKarIndexes(graph: Graph, texts: ReadonlyMap<string, string>): KarIndexes {
  const relationsByFrom = new Map<string, Relation[]>();
  for (const relation of graph.relations) pushGroup(relationsByFrom, relation.from, relation);
  for (const list of relationsByFrom.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const bindingsByNode = new Map<string, EvidenceBinding[]>();
  const bindingsByEvidence = new Map<string, EvidenceBinding[]>();
  for (const binding of graph.bindings) {
    pushGroup(bindingsByNode, binding.nodeId, binding);
    pushGroup(bindingsByEvidence, binding.evidenceId, binding);
  }

  const evidenceById = new Map<string, { id: string; text: string }>();
  for (const [id, text] of texts) evidenceById.set(id, { id, text });
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return {
    evidenceById,
    nodeById,
    relationsByFrom,
    bindingsByNode,
    bindingsByEvidence,
  };
}
