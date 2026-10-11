/**
 * S2 model-assisted semantic compiler.
 *
 * The model runs only while the artifact is built. It receives source
 * sentences. It does not receive a query or benchmark labels. Query-time
 * code must read the frozen artifact and must not call this module.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SEED_STOP, RELATIONS } from './lexicon.mjs';
import { sha256Text } from './canonicalize.mjs';

export const S2_VERSION = 'kar-semantics-s2-1';
export const S2_MODEL = 'llama3.1:latest';
export const S2_PROVIDER = 'ollama';
export const S2_TEMPERATURE = 0;

export const S2_PROMPT = `You extract structured claims from source passages. No user question is provided. Do not guess who will search these passages. Return JSON only, with this shape:
{"claims":[{"index":0,"subject":"","predicate":"","object":"","modality":"define","polarity":"positive","aliases":[],"conditions":[],"validity":{"before":"","after":""},"relations":[{"relation":"equivalent","target":""}]}]}
Allowed modality values are permit, prohibit, require, and define.
Allowed polarity values are positive and negative.
Allowed relation values are supports, contradicts, qualifies, excepts, overrides, supersedes, applies_to, valid_before, valid_after, requires, permits, prohibits, and equivalent.
Aliases are at most six ordinary synonyms of the predicate. Do not copy the subject. Do not copy the whole sentence.
A prohibition has negative polarity and a prohibits relation. A permission has a permits relation. A requirement has a requires relation. An exception or an only-if condition adds qualifies or excepts. A time bound adds valid_before or valid_after. A replacement adds supersedes or overrides.
If a passage states no claim, return {"claims":[]}. Use the given passage index. Do not invent passages.
Shape example, not a source passage: a passage saying a driver may not depart unless a ramp is clear would use predicate depart, modality prohibit, polarity negative, relations prohibits and excepts, and aliases such as leave and depart.`;

export const PROMPT_DIGEST = sha256Text(S2_PROMPT);

const RELATION_SET = new Set(RELATIONS);
const GATE = /\b(is|are|was|were|remains|remain|stays|stay|keeps|keep|retains|retain|becomes|become|may|must|shall|cannot|can|applies|apply|unless|except|before|after|until|effective|supersedes|replaces|overrides|prohibited|forbidden|required|permitted)\b|(?:^|[\s-])(?:non|un|ir|im|il)[a-z]{5,}/i;

export function sentenceGated(text) {
  return GATE.test(String(text ?? ''));
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

function aliasList(value, tokenize) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of source) {
    const tokens = tokenize(String(item)).map((token) => token.term).filter((token) => token.length >= 3 && !SEED_STOP.has(token));
    if (tokens.length === 0 || tokens.length > 3) continue;
    const alias = tokens.join(' ');
    if (seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
    if (out.length >= 6) break;
  }
  return out;
}

function mapClaim(raw, tokenize) {
  const relations = [];
  for (const item of raw?.relations ?? []) {
    const relation = String(item?.relation ?? '');
    if (RELATION_SET.has(relation)) relations.push(relation);
  }
  const modality = ['permit', 'prohibit', 'require', 'define'].includes(raw?.modality) ? raw.modality : 'define';
  const polarity = raw?.polarity === 'negative' || modality === 'prohibit' ? 'negative' : 'positive';
  if (modality === 'prohibit' && !relations.includes('prohibits')) relations.push('prohibits');
  if (modality === 'permit' && !relations.includes('permits')) relations.push('permits');
  if (modality === 'require' && !relations.includes('requires')) relations.push('requires');
  if ((raw?.conditions ?? []).length > 0 && !relations.includes('qualifies')) relations.push('qualifies');
  if (raw?.validity?.before && !relations.includes('valid_before')) relations.push('valid_before');
  if (raw?.validity?.after && !relations.includes('valid_after')) relations.push('valid_after');
  if (relations.length === 0) relations.push('equivalent');
  const predicate = clip(raw?.predicate, 80) || 'state';
  const aliases = aliasList([predicate, ...(raw?.aliases ?? [])], tokenize);
  return {
    subject: clip(raw?.subject, 80),
    predicate,
    object: clip(raw?.object, 120),
    modality,
    polarity,
    aliases,
    relations: [...new Set(relations)],
  };
}

function parseClaims(text) {
  const start = String(text ?? '').indexOf('{');
  const end = String(text ?? '').lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let body;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = Array.isArray(body?.claims) ? body.claims : [];
  return list.filter((item) => Number.isInteger(item?.index));
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
          options: { temperature: S2_TEMPERATURE, num_predict: 512, num_ctx: 2048 },
          messages: [
            { role: 'system', content: S2_PROMPT },
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
  const model = options.model ?? S2_MODEL;
  const cache = loadCache(options.cacheFile);
  const groups = new Map();
  for (const document of documents ?? []) {
    sentencesOf(document.text).forEach((sentence, sentenceIndex) => {
      const passage = `${document.heading ?? ''}. ${sentence}`.trim();
      if (!sentenceGated(passage)) return;
      const key = sha256Text(passage);
      if (!groups.has(key)) groups.set(key, { passage, docs: [] });
      groups.get(key).docs.push({ id: document.id, sentenceIndex, source: document.source ?? {} });
    });
  }
  const uniques = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const extracted = new Map();
  let calls = 0;
  let cacheHits = 0;
  let failures = 0;
  const batchSize = 4;
  for (let offset = 0; offset < uniques.length; offset += batchSize) {
    const batch = uniques.slice(offset, offset + batchSize);
    const payload = batch.map(([, group], index) => ({ index, passage: group.passage }));
    const cacheKey = sha256Text(`${PROMPT_DIGEST}\n${model}\n${JSON.stringify(payload)}`);
    let parsed = cache.get(cacheKey);
    if (parsed) {
      cacheHits += 1;
    } else {
      calls += 1;
      const raw = await ollamaChat(model, JSON.stringify({ passages: payload }));
      parsed = parseClaims(raw);
      if (raw.trim() && parsed.length === 0 && !raw.includes('"claims"')) failures += 1;
      remember(options.cacheFile, cache, cacheKey, parsed);
    }
    for (const rawClaim of parsed) {
      if (rawClaim.index < 0 || rawClaim.index >= batch.length) continue;
      const key = batch[rawClaim.index][0];
      if (!extracted.has(key)) extracted.set(key, []);
      extracted.get(key).push(mapClaim(rawClaim, tokenize));
    }
  }
  const claims = [];
  const edges = [];
  const aliases = {};
  for (const [key, group] of uniques) {
    const mapped = extracted.get(key) ?? [];
    for (const doc of group.docs) {
      mapped.forEach((item, itemIndex) => {
        const conceptToken = tokenize(item.predicate).map((token) => token.term).find((token) => token.length >= 3) ?? 'state';
        const id = `m:${doc.id}:${doc.sentenceIndex}:${itemIndex}:${conceptToken}`;
        claims.push({
          id,
          subject: item.subject,
          predicate: item.predicate,
          object: item.object,
          concept: conceptToken,
          polarity: item.polarity,
          modality: item.modality,
          aliases: item.aliases,
          evidenceIds: [doc.id],
        });
        const target = `concept:${conceptToken}`;
        aliases[conceptToken] = [...new Set([...(aliases[conceptToken] ?? []), ...item.aliases])].sort();
        for (const relation of item.relations) {
          edges.push({ from: id, relation, to: target, evidenceIds: [doc.id] });
        }
        if (doc.source.validFrom) edges.push({ from: id, relation: 'valid_after', to: target, evidenceIds: [doc.id] });
        if (doc.source.validTo) edges.push({ from: id, relation: 'valid_before', to: target, evidenceIds: [doc.id] });
      });
    }
  }
  claims.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.from}|${a.relation}|${a.to}`.localeCompare(`${b.from}|${b.relation}|${b.to}`));
  const aliasMap = {};
  for (const key of Object.keys(aliases).sort()) aliasMap[key] = aliases[key];
  return {
    artifact: { version: 1, kind: 's2', compiler: S2_VERSION, claims, edges, aliases: aliasMap },
    calls,
    cacheHits,
    failures,
    model,
    provider: S2_PROVIDER,
    temperature: S2_TEMPERATURE,
    promptDigest: PROMPT_DIGEST,
  };
}
