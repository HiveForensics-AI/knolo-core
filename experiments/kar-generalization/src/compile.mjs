/**
 * Vocabulary-independent semantic compiler.
 *
 * The model runs only while the artifact is built. It receives source
 * passages. It does not receive a query, a relation label, or a hand-authored
 * domain lexicon. Query-time code must read the frozen artifact and must not
 * call this module.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { semanticArtifactRoot, sha256Text } from './canonicalize.mjs';

export const G1_VERSION = 'kar-generalization-g1-1';
export const G1_MODEL = 'llama3.1:latest';
export const G1_PROVIDER = 'ollama';
export const G1_TEMPERATURE = 0;

export const G1_PROMPT = `You compile source passages into committed semantic claims. No search query is provided. Do not guess a benchmark label. Return JSON only, with this shape:
{"claims":[{"index":0,"entity":"","entityAliases":[],"action":"","actionAliases":[],"relation":"equivalent","polarity":"positive"}]}
Allowed relation values are supports, contradicts, qualifies, excepts, overrides, supersedes, applies_to, valid_before, valid_after, requires, permits, prohibits, and equivalent.
Allowed polarity values are positive and negative.
entity is the thing the passage is about, as a short noun.
entityAliases are at most eight other ordinary names for that same real-world thing. Use the common word a person would use. Each alias is at most three words.
action is the underlying action, as a short verb.
actionAliases are at most eight ordinary verbs for that action. Each alias is at most three words.
If the passage keeps an arrangement in force, or says it cannot be left early, the action is ending that arrangement, polarity is negative, relation is prohibits, and actionAliases name ordinary verbs for ending it.
If the passage says an earlier group keeps a different rule, relation is qualifies.
If the passage allows an action, relation is permits and polarity is positive.
If the passage only defines a term, relation is equivalent.
If a passage states nothing, omit it.
Use the given passage index. Do not invent passages.
Shape example, not a source passage: a passage saying the lantern stays lit for the whole vigil uses entity lantern, entityAliases such as light, action end, actionAliases such as extinguish and finish, relation prohibits, and polarity negative. A passage saying lamps issued with the first chit keep a different schedule uses relation qualifies.`;

export const PROMPT_DIGEST = sha256Text(G1_PROMPT);

const RELATIONS = [
  'supports', 'contradicts', 'qualifies', 'excepts', 'overrides', 'supersedes', 'applies_to',
  'valid_before', 'valid_after', 'requires', 'permits', 'prohibits', 'equivalent',
];
const RELATION_SET = new Set(RELATIONS);
const GATE = /\b(is|are|was|were|be|been|remains|remain|stays|stay|keeps|keep|retains|retain|holds|hold|lasts|last|continues|continue)\b/i;
const STOP = new Set([
  'that', 'with', 'from', 'this', 'when', 'only', 'have', 'been', 'were', 'will', 'would', 'could', 'should',
  'about', 'after', 'before', 'there', 'their', 'which', 'where', 'while', 'them', 'they', 'into', 'than',
  'then', 'such', 'other', 'also', 'over', 'under', 'does', 'each', 'very', 'more', 'most', 'some', 'what',
  'your', 'upon', 'during', 'across', 'throughout', 'until', 'unless', 'except', 'once', 'note', 'thing',
  'item', 'unit', 'stuff', 'something', 'someone', 'through', 'still', 'the', 'and', 'for', 'not', 'its',
  'who', 'any', 'all', 'but', 'you', 'our', 'his', 'her', 'she', 'him', 'how', 'why', 'out', 'off', 'too',
  'now', 'just', 'like', 'per', 'via',
]);

const totals = { calls: 0, cacheHits: 0, failures: 0, attempted: 0 };

export function sentenceGated(text) {
  return GATE.test(String(text ?? ''));
}

export function compilerTotals() {
  return { ...totals };
}

export function resetCompilerTotals() {
  totals.calls = 0;
  totals.cacheHits = 0;
  totals.failures = 0;
  totals.attempted = 0;
}

function sentencesOf(text) {
  return String(text ?? '')
    .split(/\n+|(?<=[.?!])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanAlias(value, tokenize) {
  const tokens = tokenize(String(value ?? ''))
    .map((token) => token.term)
    .filter((token) => token.length >= 3 && !STOP.has(token));
  if (tokens.length === 0 || tokens.length > 3) return null;
  return tokens.join(' ');
}

function aliasList(values, tokenize) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const alias = cleanAlias(value, tokenize);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function claimsFromModel(text, tokenize) {
  const start = String(text ?? '').indexOf('{');
  const end = String(text ?? '').lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let body;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || !Array.isArray(body.claims)) return null;
  return body.claims
    .filter((item) => Number.isInteger(item?.index))
    .map((item) => {
      const relation = RELATION_SET.has(item?.relation) ? item.relation : 'equivalent';
      const entity = clip(item?.entity, 80);
      const action = clip(item?.action, 80);
      const entityAliases = aliasList([entity, ...(item?.entityAliases ?? [])], tokenize);
      const actionAliases = aliasList([action, ...(item?.actionAliases ?? [])], tokenize);
      return {
        index: item.index,
        entity,
        action,
        relation,
        entityAliases,
        actionAliases,
        surfaceEntity: aliasList([entity], tokenize),
        surfaceAction: aliasList([action], tokenize),
      };
    });
}

function conceptIdOf(surfaceEntity) {
  const key = (surfaceEntity ?? []).join('-') || 'unknown';
  return `e:${key}`;
}

export function artifactFromClaims(rows) {
  const claims = [];
  const edges = [];
  for (const row of rows) {
    const conceptId = conceptIdOf(row.surfaceEntity);
    const claim = {
      id: row.id,
      conceptId,
      entity: row.entity,
      action: row.action,
      relation: row.relation,
      entityAliases: row.entityAliases,
      actionAliases: row.actionAliases,
      surfaceEntity: row.surfaceEntity,
      surfaceAction: row.surfaceAction,
      evidenceIds: [row.docId],
    };
    claims.push(claim);
    edges.push({
      from: claim.id,
      relation: claim.relation,
      to: conceptId,
      evidenceIds: [row.docId],
    });
  }
  claims.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.from}|${a.relation}|${a.to}`.localeCompare(`${b.from}|${b.relation}|${b.to}`));
  return {
    version: 1,
    compiler: G1_VERSION,
    claims,
    edges,
  };
}

export function relationCounts(artifact) {
  const counts = {};
  for (const edge of artifact?.edges ?? []) counts[edge.relation] = (counts[edge.relation] ?? 0) + 1;
  return counts;
}

async function ollamaChat(model, user) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          keep_alive: '30m',
          options: { temperature: G1_TEMPERATURE, num_predict: 512, num_ctx: 2048 },
          messages: [
            { role: 'system', content: G1_PROMPT },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Local model request failed with status ${response.status}`);
      const body = await response.json();
      return body.message?.content ?? '';
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function loadCache(file) {
  const map = new Map();
  if (!file || !existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line);
    map.set(row.key, row.value);
  }
  return map;
}

function remember(file, map, key, value) {
  map.set(key, value);
  if (!file) return;
  writeFileSync(file, `${[...map.entries()].map(([itemKey, itemValue]) => JSON.stringify({ key: itemKey, value: itemValue })).join('\n')}\n`);
}

/**
 * Compile documents with the local model. `cacheFile` freezes model outputs.
 * A second call with the same cache does not contact the model.
 */
export async function compileWithModel(documents, tokenize, options = {}) {
  const model = options.model ?? G1_MODEL;
  const cache = loadCache(options.cacheFile);
  const groups = new Map();
  for (const document of documents ?? []) {
    sentencesOf(document.text).forEach((sentence, sentenceIndex) => {
      const passage = [document.heading, sentence].filter(Boolean).join('. ').trim();
      if (!sentenceGated(passage)) return;
      const key = sha256Text(passage);
      if (!groups.has(key)) groups.set(key, { passage, docs: [] });
      groups.get(key).docs.push({ id: document.id, sentenceIndex });
    });
  }
  const uniques = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const extracted = new Map();
  let calls = 0;
  let cacheHits = 0;
  let failures = 0;
  const batchSize = 1;
  for (let offset = 0; offset < uniques.length; offset += batchSize) {
    const batch = uniques.slice(offset, offset + batchSize);
    const payload = batch.map(([, group], index) => ({ index, passage: group.passage }));
    const cacheKey = sha256Text(`${PROMPT_DIGEST}\n${model}\n${JSON.stringify(payload)}`);
    let parsed = cache.get(cacheKey);
    if (parsed) {
      cacheHits += 1;
      totals.cacheHits += 1;
    } else {
      calls += 1;
      totals.calls += 1;
      totals.attempted += 1;
      const content = await ollamaChat(model, JSON.stringify({ passages: payload }));
      parsed = claimsFromModel(content, tokenize);
      const failed = parsed === null && content.trim().length > 0;
      if (failed) {
        failures += 1;
        totals.failures += 1;
        parsed = [];
      }
      if (parsed === null) parsed = [];
      remember(options.cacheFile, cache, cacheKey, parsed);
      if ((totals.calls % 20) === 0) process.stderr.write(`g1 model calls ${totals.calls}\n`);
    }
    for (const claim of parsed ?? []) {
      const group = batch[claim.index]?.[1];
      if (!group) continue;
      if (!extracted.has(batch[claim.index][0])) extracted.set(batch[claim.index][0], []);
      extracted.get(batch[claim.index][0]).push(claim);
    }
  }
  const rows = [];
  for (const [key, group] of uniques) {
    const claims = extracted.get(key) ?? [];
    for (const doc of group.docs) {
      claims.forEach((claim, claimIndex) => {
        rows.push({
          ...claim,
          id: `c:${doc.id}:${doc.sentenceIndex}:${claimIndex}`,
          docId: doc.id,
        });
      });
    }
  }
  const artifact = artifactFromClaims(rows);
  const frozen = semanticArtifactRoot(artifact);
  return {
    artifact: JSON.parse(frozen.canonical),
    root: frozen.root,
    calls,
    cacheHits,
    failures,
    gated: uniques.length,
  };
}
