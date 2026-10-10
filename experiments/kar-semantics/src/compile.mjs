/**
 * S1 deterministic semantic compiler and the S0 projection of the production
 * claim graph. Compilation sees documents only. It does not see a query.
 */

import { CONCEPTS, CUE_PHRASES, NEGATION_PREFIXES, RELATIONS, buildLexiconIndex, COMPILER_VERSION } from './lexicon.mjs';

const INDEX = buildLexiconIndex();
const RELATION_SET = new Set(RELATIONS);

function sentenceSplit(text) {
  return String(text ?? '')
    .split(/\n+|(?<=[.?!])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function termsOf(text, tokenize) {
  return tokenize(text).map((token) => token.term).filter(Boolean);
}

function negateToken(token) {
  const hyphen = token.indexOf('-');
  if (hyphen > 0) {
    const prefix = token.slice(0, hyphen);
    const stem = token.slice(hyphen + 1);
    const rule = NEGATION_PREFIXES.find((item) => item.prefix === prefix);
    if (rule && INDEX.tokenToConcept.has(stem)) return { stem, concept: INDEX.tokenToConcept.get(stem) };
    return null;
  }
  for (const rule of NEGATION_PREFIXES) {
    if (rule.hyphenOnly) continue;
    if (!token.startsWith(rule.prefix)) continue;
    const stem = token.slice(rule.prefix.length);
    if (stem.length < 5) continue;
    if (!INDEX.tokenToConcept.has(stem)) continue;
    return { stem, concept: INDEX.tokenToConcept.get(stem) };
  }
  return null;
}

function matchConcept(tokens) {
  let found = null;
  const consumed = new Set();
  for (const phrase of INDEX.phrases) {
    for (let index = 0; index <= tokens.length - phrase.tokens.length; index += 1) {
      let ok = true;
      for (let offset = 0; offset < phrase.tokens.length; offset += 1) {
        if (tokens[index + offset] !== phrase.tokens[offset]) ok = false;
      }
      if (!ok) continue;
      found = prefer(found, { concept: phrase.concept, negated: false, at: index });
      for (let offset = 0; offset < phrase.tokens.length; offset += 1) consumed.add(index + offset);
    }
  }
  tokens.forEach((token, index) => {
    if (consumed.has(index)) return;
    const negated = negateToken(token);
    if (negated) {
      found = prefer(found, { concept: negated.concept, negated: true, at: index });
      return;
    }
    const concept = INDEX.tokenToConcept.get(token);
    if (concept) found = prefer(found, { concept, negated: false, at: index });
  });
  return found;
}

function prefer(current, next) {
  if (!current) return next;
  const rank = (concept) => Object.keys(CONCEPTS).indexOf(concept);
  const left = rank(current.concept);
  const right = rank(next.concept);
  if (right !== left) return right < left ? next : current;
  if (next.negated && !current.negated) return next;
  return current;
}

function scanCues(tokens) {
  const found = [];
  const consumed = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumed.has(index)) continue;
    let matched = null;
    for (const cue of CUE_PHRASES) {
      if (index + cue.tokens.length > tokens.length) continue;
      let ok = true;
      for (let offset = 0; offset < cue.tokens.length; offset += 1) {
        if (tokens[index + offset] !== cue.tokens[offset]) ok = false;
      }
      if (!ok) continue;
      matched = cue;
      break;
    }
    if (!matched) continue;
    found.push(matched);
    for (let offset = 0; offset < matched.tokens.length; offset += 1) consumed.add(index + offset);
    index += matched.tokens.length - 1;
  }
  return found;
}

function cueFlags(cues) {
  const flags = {
    modality: null,
    exception: false,
    before: false,
    after: false,
    supersedes: false,
    overrides: false,
    contradicts: false,
    applies: false,
  };
  for (const cue of cues) {
    if (cue.kind === 'modality' && flags.modality !== 'prohibit') flags.modality = cue.value;
    if (cue.kind === 'exception') flags.exception = true;
    if (cue.kind === 'temporal' && cue.value === 'before') flags.before = true;
    if (cue.kind === 'temporal' && cue.value === 'after') flags.after = true;
    if (cue.kind === 'scope' && cue.value === 'only-for') flags.exception = true;
    if (cue.kind === 'scope' && cue.value === 'applies-to') flags.applies = true;
    if (cue.kind === 'link' && cue.value === 'supersedes') flags.supersedes = true;
    if (cue.kind === 'link' && cue.value === 'overrides') flags.overrides = true;
    if (cue.kind === 'link' && cue.value === 'contradicts') flags.contradicts = true;
  }
  return flags;
}

function relationsFor(flags, negated) {
  const relations = [];
  if (flags.modality === 'prohibit' || negated) relations.push('prohibits');
  else if (flags.modality === 'require') relations.push('requires');
  else if (flags.modality === 'permit') relations.push('permits');
  else relations.push('equivalent');
  if (flags.exception) {
    relations.push('qualifies');
    relations.push('excepts');
  }
  if (flags.before) relations.push('valid_before');
  if (flags.after) relations.push('valid_after');
  if (flags.supersedes) relations.push('supersedes');
  if (flags.overrides) relations.push('overrides');
  if (flags.applies) relations.push('applies_to');
  if (flags.contradicts) relations.push('contradicts');
  return [...new Set(relations)].filter((relation) => RELATION_SET.has(relation));
}

function phraseAliases(concept) {
  const entry = CONCEPTS[concept];
  if (!entry) return [];
  return [...entry.aliases, ...entry.phrases].sort();
}

function clip(text, count) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean).slice(0, count);
  return words.join(' ');
}

function emptyArtifact(kind, compiler) {
  return { version: 1, kind, compiler, claims: [], edges: [], aliases: {} };
}

/**
 * Compile public documents into a query-independent semantic image.
 * Each document may carry id, heading, text, and ordinary source metadata.
 */
export function compileDocuments(documents, tokenize) {
  const claims = [];
  const edges = [];
  const aliases = {};
  for (const document of documents ?? []) {
    const metadata = document.source ?? {};
    const sentences = sentenceSplit(document.text);
    sentences.forEach((sentence, sentenceIndex) => {
      const tokens = termsOf(`${document.heading ?? ''}. ${sentence}`, tokenize);
      const concept = matchConcept(tokens);
      const flags = cueFlags(scanCues(tokens));
      if (!concept && !flags.modality && !flags.exception && !flags.before && !flags.after && !flags.supersedes && !flags.overrides && !flags.contradicts && !flags.applies) {
        return;
      }
      const negated = Boolean(concept?.negated) || flags.modality === 'prohibit';
      const conceptName = concept?.concept ?? 'local';
      const relations = relationsFor(flags, Boolean(concept?.negated) || flags.modality === 'prohibit');
      const claimAliases = concept ? phraseAliases(concept.concept) : [];
      const id = `c:${document.id}:${sentenceIndex}:${conceptName}:${negated ? 'neg' : 'pos'}`;
      const subject = clip(document.heading || sentence, 8);
      const predicate = conceptName === 'local' ? (flags.modality ?? 'state') : conceptName;
      const claim = {
        id,
        subject,
        predicate,
        object: clip(sentence, 16),
        concept: conceptName,
        polarity: negated ? 'negative' : 'positive',
        modality: flags.modality ?? (negated ? 'prohibit' : 'define'),
        aliases: claimAliases,
        evidenceIds: [document.id],
      };
      claims.push(claim);
      const target = concept ? `concept:${concept.concept}` : `local:${id}`;
      if (concept) aliases[concept.concept] = phraseAliases(concept.concept);
      for (const relation of relations) {
        edges.push({ from: id, relation, to: target, evidenceIds: [document.id] });
      }
      if (metadata.validFrom) {
        edges.push({ from: id, relation: 'valid_after', to: target, evidenceIds: [document.id] });
      }
      if (metadata.validTo) {
        edges.push({ from: id, relation: 'valid_before', to: target, evidenceIds: [document.id] });
      }
    });
  }
  claims.sort((a, b) => a.id.localeCompare(b.id));
  const seenEdges = new Set();
  const uniqueEdges = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.relation}|${edge.to}|${edge.evidenceIds.join(',')}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    uniqueEdges.push(edge);
  }
  uniqueEdges.sort((a, b) => `${a.from}|${a.relation}|${a.to}`.localeCompare(`${b.from}|${b.relation}|${b.to}`));
  const aliasMap = {};
  for (const key of Object.keys(aliases).sort()) aliasMap[key] = aliases[key];
  return { version: 1, kind: 's1', compiler: COMPILER_VERSION, claims, edges: uniqueEdges, aliases: aliasMap };
}

/**
 * S0: project the current production claim graph into the experimental image.
 * Aliases are the endpoint tokens only. No synonym lexicon is applied.
 */
export function projectProductionGraph(graph, docIds) {
  const labels = new Map((graph?.nodes ?? []).map((node) => [node.id, node.label ?? '']));
  const claims = [];
  const edges = [];
  for (const edge of graph?.edges ?? []) {
    const evidenceIds = (edge.evidence ?? [])
      .map((blockId) => docIds[blockId])
      .filter((id) => typeof id === 'string');
    if (evidenceIds.length === 0) continue;
    const subject = labels.get(edge.from) ?? '';
    const object = labels.get(edge.to) ?? '';
    const id = `s0:${edge.id}`;
    claims.push({
      id,
      subject,
      predicate: edge.p || 'is',
      object,
      concept: 'production',
      polarity: 'positive',
      modality: 'define',
      aliases: [],
      evidenceIds: [...new Set(evidenceIds)].sort(),
    });
    edges.push({
      from: id,
      relation: 'equivalent',
      to: `node:${edge.to}`,
      evidenceIds: [...new Set(evidenceIds)].sort(),
    });
  }
  claims.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.from.localeCompare(b.from));
  return { ...emptyArtifact('s0', 'production-claim-graph'), claims, edges };
}

export function relationCounts(artifact) {
  const counts = {};
  for (const edge of artifact?.edges ?? []) counts[edge.relation] = (counts[edge.relation] ?? 0) + 1;
  return counts;
}
