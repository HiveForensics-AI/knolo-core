/**
 * Deterministic query-time activation over a frozen semantic image.
 * No model calls. Frontiers stay separate.
 */

import { SEED_STOP } from './lexicon.mjs';

const SUPPORT = new Set(['supports', 'permits', 'requires', 'equivalent']);
const OPPOSITION = new Set(['prohibits', 'contradicts']);
const QUALIFIER = new Set(['qualifies', 'excepts']);
const TEMPORAL = new Set(['valid_before', 'valid_after', 'applies_to', 'supersedes', 'overrides']);

function tokensOf(text, tokenize) {
  return tokenize(text).map((token) => token.term).filter(Boolean);
}

function hasPhrase(tokens, phrase) {
  const parts = phrase.split(' ').filter(Boolean);
  if (parts.length === 0) return false;
  outer: for (let index = 0; index <= tokens.length - parts.length; index += 1) {
    for (let offset = 0; offset < parts.length; offset += 1) {
      if (tokens[index + offset] !== parts[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function contentTokens(text, tokenize) {
  return tokensOf(text, tokenize).filter((token) => token.length >= 4 && !SEED_STOP.has(token));
}

function frontiersOf(relations) {
  const out = [];
  if (relations.some((relation) => SUPPORT.has(relation))) out.push('support');
  if (relations.some((relation) => OPPOSITION.has(relation))) out.push('opposition');
  if (relations.some((relation) => QUALIFIER.has(relation))) out.push('qualifier');
  if (relations.some((relation) => TEMPORAL.has(relation))) out.push('temporal');
  return out;
}

/**
 * @param {object} flags aliases, typed, reverse, exceptions, temporal. Omitted means enabled.
 * `typed: false` keeps direct seeds and does not walk edges.
 */
export function activate(query, artifact, tokenize, flags = {}) {
  const queryTokens = tokensOf(query, tokenize);
  const querySet = new Set(queryTokens);
  const claims = artifact?.claims ?? [];
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const outgoing = new Map();
  const incoming = new Map();
  const claimRelations = new Map();
  for (const edge of artifact?.edges ?? []) {
    const droppedFamily =
      (flags.exceptions === false && QUALIFIER.has(edge.relation)) ||
      (flags.temporal === false && TEMPORAL.has(edge.relation));
    if (!droppedFamily) {
      if (!claimRelations.has(edge.from)) claimRelations.set(edge.from, new Set());
      claimRelations.get(edge.from).add(edge.relation);
    }
    if (flags.typed === false || droppedFamily) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }

  const seeds = [];
  const seedScore = new Map();
  for (const claim of claims) {
    let score = 0;
    if (flags.aliases !== false) {
      for (const alias of claim.aliases ?? []) {
        if (!alias) continue;
        if (alias.includes(' ')) {
          if (hasPhrase(queryTokens, alias)) score += 2;
        } else if (querySet.has(alias)) score += 2;
      }
    }
    for (const token of contentTokens(`${claim.subject} ${claim.object} ${claim.predicate}`, tokenize)) {
      if (querySet.has(token)) score += 1;
    }
    if (score > 0) {
      seeds.push(claim.id);
      seedScore.set(claim.id, score);
    }
  }
  seeds.sort((a, b) => a.localeCompare(b));

  const visited = new Set(seeds);
  const queue = seeds.map((id) => ({ id, depth: 0, score: seedScore.get(id) ?? 0 }));
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (current.depth >= 2) continue;
    const nodeEdges = outgoing.get(current.id) ?? [];
    for (const edge of nodeEdges) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({ id: edge.to, depth: current.depth + 1, score: current.score });
      }
    }
    if (flags.reverse === false) continue;
    const reverseEdges = incoming.get(current.id) ?? [];
    for (const edge of reverseEdges) {
      if (!visited.has(edge.from)) {
        visited.add(edge.from);
        queue.push({ id: edge.from, depth: current.depth + 1, score: current.score });
      }
    }
  }

  const buckets = { support: new Map(), opposition: new Map(), qualifier: new Map(), temporal: new Map() };
  for (const item of queue) {
    const claim = byId.get(item.id);
    if (!claim) continue;
    const relations = [...(claimRelations.get(claim.id) ?? [])];
    const frontiers = flags.typed === false ? frontiersOf(relations) : frontiersOf(relations);
    for (const frontier of frontiers) {
      for (const evidenceId of claim.evidenceIds ?? []) {
        const previous = buckets[frontier].get(evidenceId);
        if (previous === undefined || item.score > previous) buckets[frontier].set(evidenceId, item.score);
      }
    }
  }

  const sortIds = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  const frontiers = {
    support: sortIds(buckets.support),
    opposition: sortIds(buckets.opposition),
    qualifier: sortIds(buckets.qualifier),
    temporal: sortIds(buckets.temporal),
  };
  const semanticIds = [];
  const seen = new Set();
  for (const name of ['opposition', 'qualifier', 'temporal', 'support']) {
    for (const id of frontiers[name]) {
      if (seen.has(id)) continue;
      seen.add(id);
      semanticIds.push(id);
    }
  }
  return { seeds, frontiers, semanticIds };
}
