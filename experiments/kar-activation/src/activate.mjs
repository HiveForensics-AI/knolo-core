/**
 * Blind relationship activation for KAR Experiment 3.
 *
 * Inputs are the query string and the claim graph buildPack already stored.
 * This module does not read passage relation labels, fact ids, required
 * frontiers, or any hand-authored opposing query. It does not mine raw text
 * for cue words. Strategies were frozen before the run.
 *
 * A term cap of 12 matches the production expander. The all-edges ceiling is
 * a visibility diagnostic and is not an anchoring strategy.
 */

export const ACTIVATION_VERSION = 'kar-activation-blind-1';
export const TERM_CAP = 12;
export const HOP_LIMIT = 2;
export const BRIDGE_SHARED = 2;
export const BRIDGE_JACCARD = 0.5;

const STOP = new Set([
  'that', 'with', 'from', 'this', 'under', 'when', 'only', 'same', 'text', 'copy',
  'into', 'than', 'then', 'them', 'they', 'have', 'been', 'were', 'will', 'would',
  'could', 'should', 'about', 'after', 'before', 'there', 'their', 'which', 'where',
  'while', 'the', 'and', 'for',
]);

const PREFIX_PREDICATES = ['defined_as', 'is', 'mentions', 'ref'];
const TYPED_BIDIRECTIONAL = [
  'is', 'are', 'defined_as', 'except', 'exception', 'superseded_by', 'supersede',
  'valid_before', 'valid_after', 'applies_to', 'overrides', 'contradicted_by', 'qualify',
];
const TYPED_OUTGOING = ['mentions', 'ref'];

function allows(predicate, names, normalize) {
  for (const name of names) if (normalize(name) === predicate) return true;
  return false;
}

function claimLabel(label, normalize) {
  return normalize(String(label ?? '')).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function termsOf(label, tokenize, normalize) {
  return tokenize(claimLabel(label, normalize)).map((token) => token.term);
}

function contentSet(tokens) {
  const out = new Set();
  for (const term of tokens) {
    if (term.length < 4) continue;
    if (STOP.has(term)) continue;
    out.add(term);
  }
  return out;
}

function intersects(left, right) {
  for (const term of left) if (right.has(term)) return true;
  return false;
}

function sharedCount(left, right) {
  let count = 0;
  for (const term of left) if (right.has(term)) count += 1;
  return count;
}

function jaccard(left, right) {
  const shared = sharedCount(left, right);
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

function emptyResult() {
  return { terms: [], anchored: 0, edges: 0, predicates: {} };
}

function finish(terms, anchored, edges, predicates, cap = TERM_CAP) {
  const sorted = [...new Set(terms)].sort();
  const limited = cap == null ? sorted : sorted.slice(0, cap);
  return {
    terms: limited,
    anchored,
    edges,
    predicates,
  };
}

function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

export function viewGraph(graph, tokenize, normalize) {
  const nodes = (graph?.nodes ?? []).map((node) => {
    const norm = claimLabel(node.label, normalize);
    const tokens = tokenize(norm).map((token) => token.term);
    return { id: node.id, label: node.label, norm, tokens, content: contentSet(tokens) };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (graph?.edges ?? []).map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    p: normalize(edge.p ?? ''),
    fromNode: byId.get(edge.from),
    toNode: byId.get(edge.to),
  }));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    const out = outgoing.get(edge.from) ?? [];
    out.push(edge);
    outgoing.set(edge.from, out);
    const inn = incoming.get(edge.to) ?? [];
    inn.push(edge);
    incoming.set(edge.to, inn);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  for (const list of incoming.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, byId, edges, outgoing, incoming };
}

function prefixAnchorIds(queryTokens, view) {
  const qSet = new Set(queryTokens);
  const ids = new Set();
  const labelEntries = view.nodes.map((node) => [node.norm, node.id]).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [label, id] of labelEntries) {
    if (qSet.has(label)) ids.add(id);
  }
  for (const token of [...queryTokens].sort()) {
    for (const [label, id] of labelEntries) {
      if (label.startsWith(token)) ids.add(id);
      if (ids.size >= TERM_CAP * 4) break;
    }
    if (ids.size >= TERM_CAP * 4) break;
  }
  return ids;
}

/**
 * Mirror of expandQueryWithGraph. The run compares this string with the
 * production function and throws if they diverge.
 */
export function mirrorPrefixQuery(query, graph, tokenize, normalize) {
  const view = viewGraph(graph, tokenize, normalize);
  if (view.nodes.length === 0 || view.edges.length === 0) return query;
  const queryTokens = termsOf(query, tokenize, normalize);
  if (queryTokens.length === 0) return query;
  const qSet = new Set(queryTokens);
  const anchors = prefixAnchorIds(queryTokens, view);
  const extra = new Set();
  for (const nodeId of [...anchors].sort()) {
    for (const edge of view.outgoing.get(nodeId) ?? []) {
      if (!allows(edge.p, PREFIX_PREDICATES, normalize)) continue;
      const target = edge.toNode;
      if (!target) continue;
      for (const term of target.tokens) {
        if (!qSet.has(term)) extra.add(term);
        if (extra.size >= TERM_CAP) break;
      }
      if (extra.size >= TERM_CAP) break;
    }
    if (extra.size >= TERM_CAP) break;
  }
  if (extra.size === 0) return query;
  return `${query} ${[...extra].sort().join(' ')}`.trim();
}

function endpointActivation(view, queryContent) {
  const ids = new Set();
  const predicates = {};
  let edges = 0;
  for (const edge of view.edges) {
    const fromHit = edge.fromNode ? intersects(edge.fromNode.content, queryContent) : false;
    const toHit = edge.toNode ? intersects(edge.toNode.content, queryContent) : false;
    if (!fromHit && !toHit) continue;
    edges += 1;
    bump(predicates, edge.p);
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return { ids, edges, predicates };
}

function containsSequence(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function shingles(tokens, size) {
  const out = [];
  for (let index = 0; index <= tokens.length - size; index += 1) out.push(tokens.slice(index, index + size));
  return out;
}

function phraseAnchorIds(queryTokens, view) {
  const phrases = [...shingles(queryTokens, 2), ...shingles(queryTokens, 3)];
  const ids = new Set();
  for (const node of view.nodes) {
    const labelPhrases = [...shingles(node.tokens, 2), ...shingles(node.tokens, 3)];
    const labelInQuery = labelPhrases.some((phrase) => containsSequence(queryTokens, phrase));
    const queryInLabel = phrases.some((phrase) => containsSequence(node.tokens, phrase));
    if (labelInQuery || queryInLabel) ids.add(node.id);
  }
  return ids;
}

function termsFrom(ids, view) {
  const terms = [];
  for (const id of [...ids].sort()) {
    const node = view.byId.get(id);
    if (!node) continue;
    terms.push(...node.tokens);
  }
  return terms;
}

function typedActivation(view, queryTokens, queryContent, normalize) {
  const ids = new Set();
  const predicates = {};
  let edges = 0;
  const prefix = prefixAnchorIds(queryTokens, view);
  for (const edge of view.edges) {
    const fromAnchored = prefix.has(edge.from) || (edge.fromNode ? intersects(edge.fromNode.content, queryContent) : false);
    const toAnchored = prefix.has(edge.to) || (edge.toNode ? intersects(edge.toNode.content, queryContent) : false);
    if (allows(edge.p, TYPED_BIDIRECTIONAL, normalize)) {
      if (!fromAnchored && !toAnchored) continue;
      edges += 1;
      bump(predicates, edge.p);
      if (fromAnchored) ids.add(edge.to);
      if (toAnchored) ids.add(edge.from);
      continue;
    }
    if (allows(edge.p, TYPED_OUTGOING, normalize) && fromAnchored) {
      edges += 1;
      bump(predicates, edge.p);
      ids.add(edge.to);
    }
  }
  return { ids, edges, predicates };
}

function bridgeActivation(view, queryContent) {
  const anchors = new Set(view.nodes.filter((node) => intersects(node.content, queryContent)).map((node) => node.id));
  const ids = new Set();
  const predicates = {};
  let edges = 0;
  for (const edge of view.edges) {
    const subject = edge.fromNode;
    const object = edge.toNode;
    if (!subject || !object) continue;
    if (anchors.has(subject.id)) continue;
    if (intersects(subject.content, queryContent)) continue;
    let linked = false;
    for (const anchorId of anchors) {
      const anchor = view.byId.get(anchorId);
      if (!anchor || anchor.id === object.id) continue;
      if (sharedCount(object.content, anchor.content) >= BRIDGE_SHARED || jaccard(object.content, anchor.content) >= BRIDGE_JACCARD) {
        linked = true;
        break;
      }
    }
    if (!linked) continue;
    edges += 1;
    bump(predicates, edge.p);
    ids.add(subject.id);
  }
  return { ids, edges, predicates, anchored: anchors.size };
}

function twoHopIds(view, seeds, normalize) {
  const visited = new Set(seeds);
  let frontier = [...seeds].sort();
  let edges = 0;
  const predicates = {};
  for (let hop = 0; hop < HOP_LIMIT; hop += 1) {
    const next = [];
    for (const id of frontier) {
      for (const edge of view.outgoing.get(id) ?? []) {
        if (!allows(edge.p, PREFIX_PREDICATES, normalize)) continue;
        edges += 1;
        bump(predicates, edge.p);
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        next.push(edge.to);
      }
    }
    frontier = next.sort();
  }
  return { ids: visited, edges, predicates };
}

export function activateAll(query, graph, tokenize, normalize) {
  const view = viewGraph(graph, tokenize, normalize);
  const queryTokens = termsOf(query, tokenize, normalize);
  const querySet = new Set(queryTokens);
  const queryContent = contentSet(queryTokens);
  const emit = (terms) => terms.filter((term) => !querySet.has(term) && term.length >= 4 && !STOP.has(term));

  const prefixIds = prefixAnchorIds(queryTokens, view);
  const endpoint = endpointActivation(view, queryContent);
  const phraseIds = phraseAnchorIds(queryTokens, view);
  const reverseIds = new Set();
  const reversePredicates = {};
  let reverseEdges = 0;
  for (const id of prefixIds) {
    for (const edge of view.incoming.get(id) ?? []) {
      if (!allows(edge.p, PREFIX_PREDICATES, normalize)) continue;
      reverseEdges += 1;
      bump(reversePredicates, edge.p);
      reverseIds.add(edge.from);
    }
  }
  const twoHopSeeds = new Set([...prefixIds, ...endpoint.ids]);
  const twoHop = twoHopIds(view, twoHopSeeds, normalize);
  const bridge = bridgeActivation(view, queryContent);
  const typed = typedActivation(view, queryTokens, queryContent, normalize);
  const ceilingIds = new Set();
  const ceilingPredicates = {};
  for (const edge of view.edges) {
    bump(ceilingPredicates, edge.p);
    ceilingIds.add(edge.from);
    ceilingIds.add(edge.to);
  }

  return {
    endpoint: finish(emit(termsFrom(endpoint.ids, view)), endpoint.ids.size, endpoint.edges, endpoint.predicates),
    phrase: finish(
      emit(termsFrom(phraseIds, view)),
      phraseIds.size,
      view.edges.filter((edge) => phraseIds.has(edge.from) || phraseIds.has(edge.to)).length,
      {},
    ),
    reverse: finish(emit(termsFrom(reverseIds, view)), prefixIds.size, reverseEdges, reversePredicates),
    twohop: finish(emit(termsFrom(twoHop.ids, view)), twoHopSeeds.size, twoHop.edges, twoHop.predicates),
    bridge: finish(emit(termsFrom(bridge.ids, view)), bridge.anchored, bridge.edges, bridge.predicates),
    typed: finish(emit(termsFrom(typed.ids, view)), typed.ids.size, typed.edges, typed.predicates),
    ceiling: finish(emit(termsFrom(ceilingIds, view)), ceilingIds.size, view.edges.length, ceilingPredicates, null),
  };
}

export function graphInventory(graph) {
  const predicates = {};
  for (const edge of graph?.edges ?? []) bump(predicates, edge.p ?? '');
  return {
    nodes: graph?.nodes?.length ?? 0,
    edges: graph?.edges?.length ?? 0,
    predicates,
  };
}

export function expandedQuery(query, terms) {
  if (!terms?.length) return query;
  return `${query} ${terms.join(' ')}`;
}

export function selfTestActivation(tokenize, normalize) {
  const graph = {
    nodes: [
      { id: 'q', label: 'customer policy' },
      { id: 'near', label: 'customer binder manual' },
      { id: 'obj', label: 'binder manual shelf' },
      { id: 'weak', label: 'alpha marker' },
      { id: 'far', label: 'warehouse pallet' },
      { id: 'far2', label: 'crate barcode' },
      { id: 'typed', label: 'ledger column' },
    ],
    edges: [
      { id: 'e-near', from: 'q', p: 'is', to: 'near' },
      { id: 'e-bridge', from: 'weak', p: 'is', to: 'obj' },
      { id: 'e-far', from: 'far', p: 'is', to: 'far2' },
      { id: 'e-typed', from: 'q', p: 'contradicted_by', to: 'typed' },
    ],
  };
  const query = 'customer cancel';
  const result = activateAll(query, graph, tokenize, normalize);
  const mirror = mirrorPrefixQuery(query, graph, tokenize, normalize);
  if (!mirror.includes('binder') || !mirror.includes('manual')) throw new Error('Prefix mirror missed the outgoing definition');
  if (mirror.includes('ledger')) throw new Error('Prefix mirror walked a predicate it does not permit');
  if (result.endpoint.terms.includes('crate')) throw new Error('Endpoint overlap activated a disconnected edge');
  if (!result.endpoint.terms.includes('binder')) throw new Error('Endpoint overlap missed a query-overlapping edge');
  if (result.phrase.terms.length !== 0) throw new Error('Phrase anchors fired without a shared phrase');
  if (!result.reverse.terms.includes('policy')) throw new Error('Reverse walk missed the subject of an incoming edge');
  if (result.reverse.terms.includes('crate')) throw new Error('Reverse walk reached a disconnected edge');
  if (!result.bridge.terms.includes('alpha') || !result.bridge.terms.includes('marker')) {
    throw new Error('Bridge did not emit the weakly related subject');
  }
  if (result.bridge.terms.includes('crate')) throw new Error('Bridge activated the disconnected edge');
  if (!result.typed.terms.includes('ledger')) throw new Error('Typed rule missed contradicted_by');
  if (!result.twohop.terms.includes('binder')) throw new Error('Two-hop missed the first definition');
  if (result.twohop.terms.includes('crate')) throw new Error('Two-hop reached a disconnected component');
  if (!result.ceiling.terms.includes('crate') || !result.ceiling.terms.includes('warehouse')) {
    throw new Error('Ceiling dropped a stored edge');
  }
}
