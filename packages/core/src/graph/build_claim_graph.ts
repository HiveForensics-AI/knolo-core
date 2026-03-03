import type { BuildInputDoc } from '../builder.js';
import {
  canonicalEvidence,
  computeEdgeId,
  computeNodeId,
  finalizeGraph,
  normalizeClaimLabel,
} from './claim_graph.js';
import type { ClaimEdge, ClaimGraph, ClaimNode } from './claim_graph.js';

const DEF_RE = /^([A-Za-z0-9 _-]{2,80})\s+(is|are)\s+(.{2,120})[.?!]/;
const MD_LINK_RE = /\[([^\]]{1,200})\]\(([^)\s]{1,200})\)/g;
const WIKI_RE = /\[\[([^\]]{1,200})\]\]/g;
const HEADING_RE = /^(#{1,3})\s+(.+)$/gm;
const STOPWORDS = new Set(['a', 'an', 'and', 'or', 'the', 'it', 'they', 'this', 'that', 'these', 'those']);

export function buildClaimGraph(
  docs: BuildInputDoc[],
  opts: { maxEdgesPerDoc?: number } = {}
): ClaimGraph {
  const maxEdgesPerDoc = Math.max(1, opts.maxEdgesPerDoc ?? 500);
  const nodeById = new Map<string, ClaimNode>();
  const edgeById = new Map<string, ClaimEdge>();

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const docLabel = normalizeLabel(doc.id || doc.heading || `doc_${i}`);
    const local: ClaimEdge[] = [];

    for (const m of doc.text.matchAll(MD_LINK_RE)) {
      addEdge(local, nodeById, normalizeLabel(m[1]), 'ref', normalizeLabel(m[2]), [i]);
    }

    for (const m of doc.text.matchAll(WIKI_RE)) {
      addEdge(local, nodeById, docLabel, 'mentions', normalizeLabel(m[1]), [i]);
    }

    const headingMatches = Array.from(doc.text.matchAll(HEADING_RE));
    for (const h of headingMatches) {
      const headingLabel = normalizeLabel(h[2] || '');
      const headingStart = h.index ?? 0;
      const sentence = firstSentenceAfter(doc.text, headingStart + h[0].length);
      if (sentence) {
        addEdge(local, nodeById, headingLabel, 'defined_as', normalizeLabel(sentence), [i]);
      }
    }

    for (const sentence of splitSentences(doc.text)) {
      const m = sentence.match(DEF_RE);
      if (!m) continue;
      const subject = normalizeLabel(m[1]);
      if (!subject || isStopwordOnly(subject)) continue;
      const objectSnippet = normalizeLabel(m[3]);
      addEdge(local, nodeById, subject, 'is', objectSnippet, [i]);
    }

    local.sort((a, b) => a.id.localeCompare(b.id));
    for (const edge of local.slice(0, maxEdgesPerDoc)) {
      const existing = edgeById.get(edge.id);
      if (existing) {
        existing.evidence = canonicalEvidence([...(existing.evidence ?? []), ...(edge.evidence ?? [])]);
      } else {
        edgeById.set(edge.id, edge);
      }
    }
  }

  return finalizeGraph({ version: 1, nodes: [...nodeById.values()], edges: [...edgeById.values()] });
}

function addEdge(
  local: ClaimEdge[],
  nodeById: Map<string, ClaimNode>,
  fromLabel: string,
  p: string,
  toLabel: string,
  evidence: number[]
): void {
  if (!fromLabel || !toLabel) return;
  const fromId = ensureNode(nodeById, fromLabel);
  const toId = ensureNode(nodeById, toLabel);
  const edgeEvidence = canonicalEvidence(evidence);
  const id = computeEdgeId(fromId, p, toId, edgeEvidence);
  local.push({ id, from: fromId, p, to: toId, evidence: edgeEvidence });
}

function ensureNode(nodeById: Map<string, ClaimNode>, label: string): string {
  const id = computeNodeId(label);
  if (!nodeById.has(id)) nodeById.set(id, { id, label });
  return id;
}

function normalizeLabel(input: string): string {
  return normalizeClaimLabel(input, 200);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstSentenceAfter(text: string, startIdx: number): string {
  const tail = text.slice(startIdx).replace(/^[^\n]*\n+/, '').trim();
  if (!tail) return '';
  const first = splitSentences(tail)[0] ?? '';
  return first.slice(0, 240);
}

function isStopwordOnly(subject: string): boolean {
  const words = subject.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => STOPWORDS.has(w));
}
