/**
 * Holdout benchmark and the stronger negative control.
 *
 * Written after experiments/kar-semantics/frozen/COMPILER_HASH.txt.
 * The compiler is not modified from these strings. In-lexicon cases use
 * synonyms already present in the frozen lexicon. Stress cases use wording
 * that the frozen lexicon does not list. Queries and opposing passages share
 * no important content word.
 */

import { buildLexiconIndex, NEGATION_PREFIXES } from './lexicon.mjs';
import { sentenceGated } from './s2.mjs';

export const HOLDOUT_SEED = 20261010;
export const NEGATIVE_SEED = 20261011;
export const HOLDOUT_COUNT = 60;
export const NEGATIVE_COUNT = 100;
export const NEGATIVE_CORPUS = 500;

const INDEX = buildLexiconIndex();
const STOP = new Set([
  'that', 'with', 'from', 'this', 'when', 'only', 'have', 'been', 'were', 'will', 'would', 'could', 'should',
  'about', 'after', 'before', 'there', 'their', 'which', 'where', 'while', 'them', 'they', 'into', 'than',
  'then', 'such', 'other', 'also', 'over', 'under', 'does', 'each', 'very', 'more', 'most', 'some', 'what',
  'your', 'upon', 'during', 'across', 'throughout', 'until', 'unless', 'except', 'once', 'note', 'states',
  'repeats', 'published', 'request', 'following', 'copy', 'reference',
]);
const CUE_RE = /\b(unless|except|before|after|until|effective|notwithstanding)\b|\bonly if\b|\bonly when\b|\bonly where\b|\bsubject to\b|\bprovided that\b/i;

const VERBS = ['cancel', 'close', 'terminate', 'rescind', 'revoke', 'discontinue'];
const DOMAINS = [
  { id: 'commercial-contracts', subjects: ['buyer', 'lessee', 'subscriber', 'patron'], objects: ['booking', 'retainer', 'showroom', 'catalog'] },
  { id: 'software-policy', subjects: ['tenant', 'operator', 'admin', 'owner'], objects: ['workspace', 'mailbox', 'snapshot', 'rollout'] },
  { id: 'equipment-operations', subjects: ['crew', 'fitter', 'driver', 'tech'], objects: ['pump', 'lathe', 'vessel', 'hopper'] },
];
const EASY_OPPOSITION = [
  'The patronage is non-revocable across the prepaid season.',
  'Closure is prohibited for the committed service period.',
  'Discontinuation is prohibited once the window has opened.',
  'Rescission is prohibited for the prepaid term.',
  'The charter is non-revocable for the posted term.',
];
const STRESS_OPPOSITION = [
  'The charter stays binding through the committed service window.',
  'The posting remains locked for the full duty cycle.',
  'The roster keeps its place for the entire watch.',
  'The seal stays in force for the stated duty.',
  'The berth remains occupied for the full turn.',
  'The lane stays assigned for the whole shift.',
];
const EASY_QUALIFIER = [
  'Rescission is permitted except when the seal is present.',
  'Closure is allowed only if the inspector has signed.',
  'Revocation is permitted unless the badge is expired.',
  'Cancellation is allowed except when the prior seal remains.',
];
const STRESS_QUALIFIER = [
  'Crews hired under the earlier bulletin keep the old window.',
  'Sites enrolled with the first bulletin keep the former rule.',
  'Units from the opening cohort keep the former limit.',
];
const TEMPORAL_TEXT = 'Closure is effective after the inspection seal and does not apply before that seal.';
const STRESS_OPPOSITION_INDEXES = new Set([9, 19, 29, 39, 49, 59]);
const STRESS_QUALIFIER_INDEXES = new Set([2, 6, 12, 16, 22, 26, 36, 46, 56]);

const DECOY_OPPOSITION = [
  'The gantry must not travel during a storm warning.',
  'Overtime is prohibited while the kiln stays hot.',
  'The crane must not slew above the posted wind limit.',
  'Payroll is forbidden on a holiday cycle.',
];
const DECOY_QUALIFIER = [
  'Visitors may enter except when the badge is expired.',
  'Tours are allowed unless the dock is sealed.',
  'Sampling is permitted only if the lab is staffed.',
  'Entry is allowed except when the gate is shut.',
];
const QUERY_A = ['brine', 'cedar', 'quartz', 'linen', 'cobalt', 'amber', 'maple', 'nitrate', 'velvet', 'copper', 'orchid', 'granite', 'saffron', 'basalt', 'ivory', 'topaz', 'millet', 'indigo', 'garnet', 'flint'];
const QUERY_B = ['density', 'count', 'level', 'ratio', 'index', 'score', 'width', 'depth', 'mass', 'tone'];
const QUERY_C = ['log', 'sheet', 'card', 'roll', 'ledger', 'slip', 'chart', 'table', 'file', 'folio'];

function contentTokens(text, tokenize) {
  return tokenize(text)
    .map((token) => token.term)
    .filter((token) => token.length >= 4 && !STOP.has(token));
}

function morphologyConcept(token) {
  const hyphen = token.indexOf('-');
  if (hyphen > 0) {
    const stem = token.slice(hyphen + 1);
    const prefix = token.slice(0, hyphen);
    if (NEGATION_PREFIXES.some((rule) => rule.prefix === prefix) && INDEX.tokenToConcept.has(stem)) return INDEX.tokenToConcept.get(stem);
  }
  for (const rule of NEGATION_PREFIXES) {
    if (rule.hyphenOnly || !token.startsWith(rule.prefix)) continue;
    const stem = token.slice(rule.prefix.length);
    if (stem.length >= 5 && INDEX.tokenToConcept.has(stem)) return INDEX.tokenToConcept.get(stem);
  }
  return null;
}

function lexiconHits(text, tokenize) {
  const tokens = tokenize(text).map((token) => token.term);
  const hits = [];
  for (const phrase of INDEX.phrases) {
    const joined = tokens.join(' ');
    if (joined.includes(phrase.phrase)) hits.push(phrase.phrase);
  }
  tokens.forEach((token) => {
    if (INDEX.tokenToConcept.has(token)) hits.push(token);
    else if (morphologyConcept(token)) hits.push(token);
  });
  return hits;
}

function overlap(left, right) {
  const ban = new Set(right);
  return left.filter((token) => ban.has(token));
}

function passage(id, relation, facts, text, heading, extra = {}) {
  return {
    id,
    sourceId: extra.sourceId ?? relation,
    relation,
    facts,
    text,
    heading,
    authority: 1,
    ...(extra.validFrom ? { validFrom: extra.validFrom } : {}),
    ...(extra.validTo ? { validTo: extra.validTo } : {}),
  };
}

export function generateHoldout(tokenize) {
  const instances = [];
  for (let index = 0; index < HOLDOUT_COUNT; index += 1) {
    const domain = DOMAINS[index % DOMAINS.length];
    const verb = VERBS[index % VERBS.length];
    const subject = domain.subjects[Math.floor(index / 3) % domain.subjects.length];
    const object = domain.objects[Math.floor(index / 6) % domain.objects.length];
    const query = `${subject} ${verb} ${object} whenever asked`;
    const queryTokens = tokenize(query).map((token) => token.term);
    const queryContent = contentTokens(query, tokenize);
    const oppositionStress = STRESS_OPPOSITION_INDEXES.has(index);
    const qualifierStress = STRESS_QUALIFIER_INDEXES.has(index);
    const oppositionText = (oppositionStress ? STRESS_OPPOSITION : EASY_OPPOSITION)[index % (oppositionStress ? STRESS_OPPOSITION.length : EASY_OPPOSITION.length)];
    const qualifierText = (qualifierStress ? STRESS_QUALIFIER : EASY_QUALIFIER)[index % (qualifierStress ? STRESS_QUALIFIER.length : EASY_QUALIFIER.length)];
    const shared = (text) => overlap(tokenize(text).map((token) => token.term), queryTokens);
    const oppositionHits = shared(oppositionText);
    const qualifierHits = shared(qualifierText);
    const temporalHits = shared(TEMPORAL_TEXT);
    if (oppositionHits.length || qualifierHits.length || temporalHits.length) {
      throw new Error(`Holdout ${index} shares tokens ${oppositionHits.concat(qualifierHits, temporalHits).join(',')}`);
    }
    if (overlap(contentTokens(oppositionText, tokenize), queryContent).length) {
      throw new Error(`Holdout ${index} opposition repeats query content`);
    }
    const oppositionLexicon = lexiconHits(oppositionText, tokenize);
    const qualifierLexicon = lexiconHits(qualifierText, tokenize);
    if (oppositionStress && oppositionLexicon.length) throw new Error(`Stress opposition contains a frozen alias: ${oppositionLexicon.join(',')}`);
    if (!oppositionStress && oppositionLexicon.length === 0) throw new Error(`In-lexicon opposition missed the frozen lexicon: ${oppositionText}`);
    if (qualifierStress && (qualifierLexicon.length || CUE_RE.test(qualifierText))) throw new Error(`Stress qualifier is not disconnected: ${qualifierText}`);
    if (!qualifierStress && (qualifierLexicon.length === 0 || !CUE_RE.test(qualifierText))) throw new Error(`In-lexicon qualifier missed a cue or alias: ${qualifierText}`);
    const withTemporal = index % 2 === 0;
    const supportText = `${query}. ${query}.`;
    const passages = [
      passage(`H${index}-support`, 'support', ['published-right'], supportText, 'Published bulletin', { sourceId: 'bulletin' }),
      passage(`H${index}-opposition`, 'contradict', ['binding-limit'], oppositionText, 'Binding limit', { sourceId: 'charter' }),
      passage(`H${index}-qualifier`, 'qualify', ['scope-exception'], qualifierText, 'Scope note', { sourceId: 'amendment' }),
    ];
    if (withTemporal) {
      passages.push(
        passage(`H${index}-temporal`, 'temporal', ['temporal-window'], TEMPORAL_TEXT, 'Effective date', {
          sourceId: 'effective-note',
          validFrom: '2024-01-01',
          validTo: '2025-01-01',
        }),
      );
    }
    for (let filler = 0; filler < 12; filler += 1) {
      const fillerText = `Pallet row ${index}-${filler} lists barcode crates for outbound lane markers.`;
      if (shared(fillerText).length) throw new Error(`Holdout filler shares query tokens on ${index}`);
      passages.push(passage(`H${index}-filler-${filler}`, 'irrelevant', [], fillerText, 'Warehouse note', { sourceId: 'warehouse' }));
    }
    instances.push({
      id: `H-${domain.id}-${String(index).padStart(2, '0')}`,
      split: 'holdout',
      scenario: 'holdout',
      domain: domain.id,
      variation: index,
      seed: HOLDOUT_SEED,
      asOf: '2024-06-15',
      tau: 1,
      gamma: 1,
      qTau: 1,
      query,
      disconnect: true,
      oppositionStratum: oppositionStress ? 'stress' : 'in-lexicon',
      qualifierStratum: qualifierStress ? 'stress' : 'in-lexicon',
      negativeControl: false,
      required: {
        support: ['published-right'],
        opposition: ['binding-limit'],
        qualifiers: ['scope-exception'],
        temporal: withTemporal ? ['temporal-window'] : [],
      },
      passages,
    });
  }
  const stressOpposition = instances.filter((item) => item.oppositionStratum === 'stress').length;
  const stressQualifier = instances.filter((item) => item.qualifierStratum === 'stress').length;
  const temporal = instances.filter((item) => item.required.temporal.length > 0).length;
  if (instances.length < 50 || stressOpposition !== 6 || stressQualifier !== 9 || temporal !== 30) {
    throw new Error(`Holdout mix drifted: n=${instances.length} stressOpp=${stressOpposition} stressQual=${stressQualifier} temporal=${temporal}`);
  }
  const domains = new Set(instances.map((item) => item.domain));
  if (domains.size < 3) throw new Error('Holdout needs three domains');
  return instances;
}

export function generateNegative(tokenize) {
  const instances = [];
  const seen = new Set();
  for (let index = 0; index < NEGATIVE_COUNT; index += 1) {
    const a = QUERY_A[index % QUERY_A.length];
    const b = QUERY_B[index % QUERY_B.length];
    const c = QUERY_C[Math.floor(index / 10) % QUERY_C.length];
    const key = `${a}|${b}|${c}`;
    if (seen.has(key)) throw new Error(`Duplicate negative query ${key}`);
    seen.add(key);
    const query = `Record the ${a} ${b} ${c} reading`;
    const queryContent = contentTokens(query, tokenize);
    const onTopic = `Record the ${a} ${b} ${c} reading. Record the ${a} ${b} ${c} reading. Record the ${a} ${b} ${c} reading.`;
    const passages = [];
    for (let copy = 0; copy < 15; copy += 1) {
      passages.push(passage(`N${index}-support-${copy}`, 'support', ['reading'], onTopic, 'Reading log', { sourceId: 'log' }));
    }
    DECOY_OPPOSITION.forEach((text, decoy) => {
      const hits = overlap(contentTokens(text, tokenize), queryContent);
      if (hits.length) throw new Error(`Negative opposition decoy shares ${hits.join(',')} with ${query}`);
      passages.push(passage(`N${index}-opp-${decoy}`, 'contradict', ['unrequested-opposition'], text, 'Unrelated limit', { sourceId: 'unrelated' }));
    });
    DECOY_QUALIFIER.forEach((text, decoy) => {
      const hits = overlap(contentTokens(text, tokenize), queryContent);
      if (hits.length) throw new Error(`Negative qualifier decoy shares ${hits.join(',')} with ${query}`);
      if (!CUE_RE.test(text)) throw new Error(`Qualifier decoy has no exception cue: ${text}`);
      passages.push(passage(`N${index}-qual-${decoy}`, 'qualify', ['unrequested-qualifier'], text, 'Unrelated exception', { sourceId: 'unrelated' }));
    });
    const fillerCount = NEGATIVE_CORPUS - passages.length;
    if (fillerCount < 400) throw new Error('Negative filler count is too small');
    for (let filler = 0; filler < fillerCount; filler += 1) {
      const text = `Pallet row ${index}-${filler} lists barcode crates for outbound lane markers.`;
      if (sentenceGated(text)) throw new Error('Negative filler tripped the model gate');
      const hits = overlap(contentTokens(text, tokenize), queryContent);
      if (hits.length) throw new Error(`Filler shares ${hits.join(',')} with the negative query`);
      passages.push(passage(`N${index}-pad-${filler}`, 'irrelevant', [], text, 'Warehouse note', { sourceId: 'warehouse' }));
    }
    if (passages.length !== NEGATIVE_CORPUS) throw new Error(`Negative corpus is ${passages.length}`);
    instances.push({
      id: `NEG-${String(index).padStart(3, '0')}`,
      split: 'negative',
      scenario: 'negative',
      domain: 'negative-control',
      variation: index,
      seed: NEGATIVE_SEED,
      asOf: '2024-06-15',
      tau: 1,
      gamma: 1,
      qTau: 1,
      query,
      disconnect: false,
      negativeControl: true,
      required: { support: ['reading'], opposition: [], qualifiers: [], temporal: [] },
      decoyOppositionIds: passages.filter((item) => item.facts.includes('unrequested-opposition')).map((item) => item.id),
      decoyQualifierIds: passages.filter((item) => item.facts.includes('unrequested-qualifier')).map((item) => item.id),
      passages,
    });
  }
  return instances;
}
