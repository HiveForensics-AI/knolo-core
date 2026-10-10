/**
 * Deterministic query-time activation over a frozen generalized artifact.
 * No model calls. A claim is seeded only by the mode below.
 * The default mode requires both an entity alias and an action alias.
 */

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

function aliasHit(queryTokens, querySet, aliases) {
  for (const alias of aliases ?? []) {
    if (!alias) continue;
    if (alias.includes(' ')) {
      if (hasPhrase(queryTokens, alias)) return true;
    } else if (querySet.has(alias)) return true;
  }
  return false;
}

function frontierOf(relation) {
  if (OPPOSITION.has(relation)) return 'opposition';
  if (QUALIFIER.has(relation)) return 'qualifier';
  if (TEMPORAL.has(relation)) return 'temporal';
  if (SUPPORT.has(relation)) return 'support';
  return null;
}

/**
 * @param {object} flags mode: dual | action-only | entity-only | siblings.
 * paraphrases: false uses only the surface entity and action strings.
 */
export function activate(query, artifact, tokenize, flags = {}) {
  const queryTokens = tokensOf(query, tokenize);
  const querySet = new Set(queryTokens);
  const mode = flags.mode ?? 'dual';
  const claims = (artifact?.claims ?? []).filter((claim) => (claim.evidenceIds ?? []).length > 0);
  const seeds = [];
  for (const claim of claims) {
    const entityAliases = flags.paraphrases === false ? claim.surfaceEntity : claim.entityAliases;
    const actionAliases = flags.paraphrases === false ? claim.surfaceAction : claim.actionAliases;
    const entityHit = aliasHit(queryTokens, querySet, entityAliases);
    const actionHit = aliasHit(queryTokens, querySet, actionAliases);
    let seeded = false;
    if (mode === 'action-only') seeded = actionHit;
    else if (mode === 'entity-only') seeded = entityHit;
    else seeded = entityHit && actionHit;
    if (!seeded) continue;
    seeds.push({ claim, score: (entityHit ? 2 : 0) + (actionHit ? 2 : 0) });
  }

  const selected = new Map();
  for (const seed of seeds) {
    selected.set(seed.claim.id, { claim: seed.claim, score: seed.score });
  }
  if (mode === 'siblings') {
    const concepts = new Set(seeds.map((seed) => seed.claim.conceptId).filter(Boolean));
    const inherited = seeds.reduce((max, seed) => Math.max(max, seed.score), 0);
    for (const claim of claims) {
      if (!claim.conceptId || !concepts.has(claim.conceptId) || selected.has(claim.id)) continue;
      selected.set(claim.id, { claim, score: inherited });
    }
  }

  const buckets = {
    support: new Map(),
    opposition: new Map(),
    qualifier: new Map(),
    temporal: new Map(),
  };
  for (const item of selected.values()) {
    const frontier = frontierOf(item.claim.relation);
    const docId = item.claim.evidenceIds[0];
    if (!frontier || !docId) continue;
    const existing = buckets[frontier].get(docId);
    if (!existing || item.score > existing.score || (item.score === existing.score && docId < existing.id)) {
      buckets[frontier].set(docId, { id: docId, score: item.score });
    }
  }
  const frontiers = {};
  for (const [name, bucket] of Object.entries(buckets)) {
    frontiers[name] = [...bucket.values()]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((item) => item.id);
  }
  return { frontiers };
}
