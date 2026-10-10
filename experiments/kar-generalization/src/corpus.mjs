/**
 * Unseen-wording benchmark for vocabulary-independent compilation.
 *
 * Every opposition sentence and every qualifier sentence shares no tokenizer
 * token with its query, contains no Experiment 4 lexicon alias, and contains
 * no exception cue. The compiler does not import this file.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLexiconIndex, NEGATION_PREFIXES } from '../../kar-semantics/src/lexicon.mjs';
import { sentenceGated } from './compile.mjs';

export const DEV_SEED = 20261012;
export const HOLDOUT_SEED = 20261013;
export const NEGATIVE_SEED = 20261014;
export const DEV_COUNT = 36;
export const HOLDOUT_COUNT = 60;
export const NEGATIVE_COUNT = 100;
export const NEGATIVE_CORPUS = 500;

const INDEX = buildLexiconIndex();
const CUE_RE = /\b(unless|except|before|after|until|effective|notwithstanding|cannot|must|shall|may)\b|\bonly if\b|\bonly when\b|\bsubject to\b|\bprovided that\b|\bis prohibited\b|\bis required\b|\bis permitted\b/i;
const SPANS = [
  'through the prepaid season',
  'across the paid term',
  'for the listed duty',
  'through the open watch',
  'across the full shift',
];
const SITES = ['north', 'south', 'east', 'west', 'cedar', 'maple', 'birch', 'alder', 'holly', 'yew', 'elm', 'oak', 'ash', 'pine', 'fir', 'reed', 'moss', 'fern', 'glen', 'bay'];
const DEV_SITES = ['amber', 'cobalt', 'linen', 'quartz', 'velvet', 'saffron', 'indigo', 'garnet', 'topaz', 'ivory', 'flint', 'basalt'];
const BANNED_SENTENCES = [
  'The charter stays binding through the committed service window.',
  'The posting remains locked for the full duty cycle.',
  'The roster keeps its place for the entire watch.',
  'The seal stays in force for the stated duty.',
  'The berth remains occupied for the full turn.',
  'The lane stays assigned for the whole shift.',
  'The lantern stays lit for the whole vigil.',
];

const HOLDOUT_DOMAINS = [
  {
    id: 'lodging',
    frame: 'stays',
    rows: [
      ['guest', 'cancel', 'room', 'lodging', 'committed', 0],
      ['patron', 'release', 'suite', 'accommodation', 'pledged', 1],
      ['visitor', 'vacate', 'cabin', 'quarters', 'locked', 2],
      ['traveler', 'drop', 'cottage', 'dwelling', 'seated', 3],
      ['occupant', 'cancel', 'villa', 'residence', 'posted', 4],
      ['tenant', 'release', 'loft', 'tenancy', 'bound', 0],
      ['lodger', 'vacate', 'studio', 'occupancy', 'frozen', 1],
      ['resident', 'drop', 'bungalow', 'leasehold', 'fixed', 2],
      ['boarder', 'cancel', 'chalet', 'patronage', 'staffed', 3],
      ['camper', 'release', 'hostel', 'billet', 'mounted', 4],
      ['tourist', 'drop', 'inn', 'barracks', 'committed', 0],
      ['pilgrim', 'cancel', 'lodge', 'dormitory', 'pledged', 1],
      ['nomad', 'release', 'hut', 'habitat', 'locked', 2],
      ['hiker', 'vacate', 'tent', 'shelter', 'seated', 3],
      ['sailor', 'drop', 'bunk', 'hammock', 'posted', 4],
      ['clerk', 'cancel', 'berth', 'mooring', 'occupied', 0],
      ['agent', 'release', 'slip', 'anchorage', 'bound', 1],
      ['buyer', 'vacate', 'pad', 'campsite', 'frozen', 2],
      ['client', 'drop', 'nook', 'alcove', 'fixed', 3],
      ['member', 'cancel', 'spot', 'assignment', 'staffed', 4],
    ],
  },
  {
    id: 'software-access',
    frame: 'remains',
    rows: [
      ['admin', 'cancel', 'login', 'credential', 'granted', 0],
      ['owner', 'release', 'mailbox', 'inbox', 'issued', 1],
      ['operator', 'vacate', 'workspace', 'environment', 'active', 2],
      ['tenant', 'drop', 'snapshot', 'image', 'frozen', 3],
      ['user', 'cancel', 'token', 'passport', 'posted', 4],
      ['moderator', 'release', 'forum', 'board', 'open', 0],
      ['maintainer', 'vacate', 'cluster', 'fleet', 'coupled', 1],
      ['auditor', 'drop', 'ledger', 'journal', 'bound', 2],
      ['analyst', 'cancel', 'dashboard', 'console', 'live', 3],
      ['vendor', 'release', 'portal', 'gateway', 'armed', 4],
      ['intern', 'cancel', 'badge', 'passcard', 'granted', 0],
      ['steward', 'release', 'key', 'fob', 'issued', 1],
      ['curator', 'vacate', 'archive', 'repository', 'active', 2],
      ['editor', 'drop', 'draft', 'manuscript', 'frozen', 3],
      ['author', 'cancel', 'page', 'folio', 'posted', 4],
      ['builder', 'release', 'pipeline', 'conduit', 'coupled', 0],
      ['tester', 'vacate', 'sandbox', 'arena', 'bound', 1],
      ['planner', 'drop', 'roster', 'timetable', 'live', 2],
      ['scout', 'cancel', 'feed', 'channel', 'armed', 3],
      ['captain', 'release', 'node', 'vertex', 'granted', 4],
    ],
  },
  {
    id: 'field-equipment',
    frame: 'still',
    rows: [
      ['crew', 'cancel', 'pump', 'impeller', 'mounted', 0],
      ['fitter', 'release', 'lathe', 'spindle', 'coupled', 1],
      ['driver', 'vacate', 'vessel', 'hull', 'moored', 2],
      ['tech', 'drop', 'hopper', 'chute', 'loaded', 3],
      ['pilot', 'cancel', 'engine', 'turbine', 'engaged', 4],
      ['miner', 'release', 'drill', 'auger', 'planted', 0],
      ['guard', 'vacate', 'gate', 'barrier', 'latched', 1],
      ['nurse', 'drop', 'cart', 'trolley', 'stocked', 2],
      ['ranger', 'cancel', 'radio', 'handset', 'armed', 3],
      ['mason', 'release', 'crane', 'derrick', 'coupled', 4],
      ['diver', 'cancel', 'tank', 'cylinder', 'mounted', 0],
      ['welder', 'release', 'torch', 'burner', 'fueled', 1],
      ['porter', 'vacate', 'belt', 'conveyor', 'engaged', 2],
      ['smith', 'drop', 'press', 'ram', 'loaded', 3],
      ['rider', 'cancel', 'bike', 'cycle', 'parked', 4],
      ['keeper', 'release', 'hive', 'colony', 'seated', 0],
      ['herder', 'vacate', 'pen', 'corral', 'latched', 1],
      ['grower', 'drop', 'field', 'plot', 'planted', 2],
      ['brewer', 'cancel', 'vat', 'cask', 'filled', 3],
      ['miller', 'release', 'wheel', 'rotor', 'coupled', 4],
    ],
  },
];

const DEV_DOMAINS = [
  {
    id: 'clinic-visits',
    frame: 'remains',
    rows: [
      ['patient', 'cancel', 'visit', 'appointment', 'booked', 0],
      ['doctor', 'release', 'clinic', 'infirmary', 'issued', 1],
      ['nurse', 'vacate', 'ward', 'pavilion', 'active', 2],
      ['surgeon', 'drop', 'case', 'procedure', 'frozen', 3],
      ['intern', 'cancel', 'rota', 'rotation', 'posted', 4],
      ['midwife', 'release', 'bed', 'cot', 'bound', 0],
      ['dentist', 'vacate', 'chair', 'stool', 'fixed', 1],
      ['therapist', 'drop', 'session', 'sitting', 'staffed', 2],
      ['paramedic', 'cancel', 'call', 'dispatch', 'mounted', 3],
      ['orderly', 'release', 'gurney', 'stretcher', 'pledged', 4],
      ['student', 'vacate', 'lab', 'workshop', 'committed', 0],
      ['clerk', 'drop', 'file', 'dossier', 'locked', 1],
    ],
  },
  {
    id: 'campus-housing',
    frame: 'stays',
    rows: [
      ['student', 'cancel', 'dorm', 'hall', 'committed', 0],
      ['dean', 'release', 'course', 'seminar', 'pledged', 1],
      ['proctor', 'vacate', 'exam', 'test', 'locked', 2],
      ['tutor', 'drop', 'class', 'lesson', 'seated', 3],
      ['resident', 'cancel', 'meal', 'supper', 'posted', 4],
      ['porter', 'release', 'gate', 'portal', 'bound', 0],
      ['athlete', 'vacate', 'court', 'pitch', 'frozen', 1],
      ['singer', 'drop', 'rehearsal', 'practice', 'fixed', 2],
      ['editor', 'cancel', 'issue', 'edition', 'staffed', 3],
      ['librarian', 'release', 'stack', 'shelves', 'mounted', 4],
      ['freshman', 'vacate', 'quad', 'yard', 'committed', 0],
      ['alumni', 'drop', 'gift', 'donation', 'pledged', 1],
    ],
  },
  {
    id: 'freight-desk',
    frame: 'still',
    rows: [
      ['shipper', 'cancel', 'cargo', 'freight', 'committed', 0],
      ['broker', 'release', 'bill', 'invoice', 'pledged', 1],
      ['docker', 'vacate', 'crate', 'box', 'locked', 2],
      ['pilot', 'drop', 'route', 'path', 'seated', 3],
      ['agent', 'cancel', 'load', 'consignment', 'posted', 4],
      ['clerk', 'release', 'dock', 'wharf', 'bound', 0],
      ['driver', 'vacate', 'cab', 'compartment', 'frozen', 1],
      ['dispatcher', 'drop', 'slot', 'allocation', 'fixed', 2],
      ['inspector', 'cancel', 'seal', 'stamp', 'staffed', 3],
      ['handler', 'release', 'pallet', 'skid', 'mounted', 4],
      ['courier', 'vacate', 'parcel', 'packet', 'committed', 0],
      ['mate', 'drop', 'bout', 'stint', 'pledged', 1],
    ],
  },
];

const DECOY_OPPOSITION = [
  'The kiln stays fired through the full cycle.',
  'The gantry stays parked across the storm watch.',
  'The forge stays hot for the listed duty.',
  'Payroll stays frozen on a festival cycle.',
];
const DECOY_QUALIFIER = [
  'Holders of the kiln from the zebra intake retain the former limit.',
  'Holders of the gantry from the zebra intake retain the former limit.',
  'Holders of the forge from the zebra intake retain the former limit.',
  'Holders of the payroll from the zebra intake retain the former limit.',
];
const QUERY_A = ['brine', 'cedar', 'quartz', 'linen', 'cobalt', 'amber', 'maple', 'nitrate', 'velvet', 'copper', 'orchid', 'granite', 'saffron', 'basalt', 'ivory', 'topaz', 'millet', 'indigo', 'garnet', 'flint'];
const QUERY_B = ['density', 'count', 'level', 'ratio', 'index', 'score', 'width', 'depth', 'mass', 'tone'];
const QUERY_C = ['log', 'sheet', 'card', 'roll', 'ledger', 'slip', 'chart', 'table', 'file', 'folio'];

function terms(text, tokenize) {
  return tokenize(text).map((token) => token.term).filter(Boolean);
}

function shared(left, right) {
  const ban = new Set(right);
  return left.filter((token) => ban.has(token));
}

function morphologyHit(token) {
  const hyphen = token.indexOf('-');
  if (hyphen > 0) {
    const prefix = token.slice(0, hyphen);
    const stem = token.slice(hyphen + 1);
    if (NEGATION_PREFIXES.some((rule) => rule.prefix === prefix) && INDEX.tokenToConcept.has(stem)) return true;
  }
  for (const rule of NEGATION_PREFIXES) {
    if (rule.hyphenOnly || !token.startsWith(rule.prefix)) continue;
    const stem = token.slice(rule.prefix.length);
    if (stem.length >= 5 && INDEX.tokenToConcept.has(stem)) return true;
  }
  return false;
}

function lexiconHits(text, tokenize) {
  const tokens = terms(text, tokenize);
  const hits = [];
  const joined = tokens.join(' ');
  for (const phrase of INDEX.phrases) {
    if (joined.includes(phrase.phrase)) hits.push(phrase.phrase);
  }
  for (const token of tokens) {
    if (INDEX.tokenToConcept.has(token) || morphologyHit(token)) hits.push(token);
  }
  return hits;
}

function oppositionText(frame, noun, state, spanIndex) {
  const span = SPANS[spanIndex];
  if (frame === 'stays') return `The ${noun} stays ${state} ${span}.`;
  if (frame === 'remains') return `The ${noun} remains ${state} ${span}.`;
  return `The ${noun} is still ${state} ${span}.`;
}

function qualifierText(noun, site) {
  return `Holders of the ${noun} from the ${site} intake retain the former limit.`;
}

function passage(id, relation, facts, text) {
  return { id, sourceId: 'src', relation, facts, text, heading: '', authority: 1 };
}

function compilerSource() {
  return ['compile.mjs', 'activate.mjs', 'canonicalize.mjs']
    .map((file) => readFileSync(path.join(import.meta.dirname, file), 'utf8'))
    .join('\n');
}

function assertEvidence(text, queryTerms, tokenize, compiler, label) {
  const hits = shared(terms(text, tokenize), queryTerms);
  if (hits.length) throw new Error(`${label} shares ${hits.join(',')} with its query`);
  const lexicon = lexiconHits(text, tokenize);
  if (lexicon.length) throw new Error(`${label} contains a frozen lexicon alias: ${lexicon.join(',')}`);
  if (CUE_RE.test(text)) throw new Error(`${label} contains a cue: ${text}`);
  if (!sentenceGated(text)) throw new Error(`${label} missed the compiler gate: ${text}`);
  if (BANNED_SENTENCES.some((banned) => text.includes(banned))) throw new Error(`${label} repeats a banned sentence`);
  if (compiler.includes(text)) throw new Error(`${label} is present in the frozen compiler`);
}

function buildSplit(domains, sites, split, seed, tokenize, compiler) {
  const instances = [];
  const seenText = new Set();
  let variation = 0;
  for (const domain of domains) {
    if (domain.rows.length !== sites.length) throw new Error(`${domain.id} row count does not match sites`);
    domain.rows.forEach((row, index) => {
      const [head, verb, object, noun, state, spanIndex] = row;
      const query = `${head} ${verb} ${object} whenever asked`;
      const queryTerms = terms(query, tokenize);
      const opposition = oppositionText(domain.frame, noun, state, spanIndex);
      const qualifier = qualifierText(noun, sites[index]);
      assertEvidence(opposition, queryTerms, tokenize, compiler, `${split} ${domain.id} opposition ${index}`);
      assertEvidence(qualifier, queryTerms, tokenize, compiler, `${split} ${domain.id} qualifier ${index}`);
      if (seenText.has(opposition) || seenText.has(qualifier)) throw new Error(`Duplicate evidence text on ${domain.id} ${index}`);
      seenText.add(opposition);
      seenText.add(qualifier);
      const support = `${query}. ${query}.`;
      const passages = [
        passage(`${split}-${variation}-support`, 'support', ['published-right'], support),
        passage(`${split}-${variation}-opposition`, 'contradict', ['binding-limit'], opposition),
        passage(`${split}-${variation}-qualifier`, 'qualify', ['scope-exception'], qualifier),
      ];
      for (let filler = 0; filler < 12; filler += 1) {
        const fillerText = `Zedlot ${variation}-${filler} lists barcode crates beside outbound lane markers.`;
        if (shared(terms(fillerText, tokenize), queryTerms).length) throw new Error(`Filler shares query tokens on ${split} ${variation}`);
        if (sentenceGated(fillerText)) throw new Error(`Filler tripped the compiler gate on ${split} ${variation}`);
        passages.push(passage(`${split}-${variation}-filler-${filler}`, 'irrelevant', [], fillerText));
      }
      instances.push({
        id: `${split === 'development' ? 'D' : 'H'}-${domain.id}-${String(index).padStart(2, '0')}`,
        split,
        scenario: split,
        domain: domain.id,
        variation,
        seed,
        asOf: '2024-06-15',
        tau: 1,
        gamma: 1,
        qTau: 1,
        query,
        disconnect: true,
        unseen: true,
        negativeControl: false,
        required: { support: ['published-right'], opposition: ['binding-limit'], qualifiers: ['scope-exception'], temporal: [] },
        passages,
      });
      variation += 1;
    });
  }
  return instances;
}

export function generateDevelopment(tokenize) {
  const instances = buildSplit(DEV_DOMAINS, DEV_SITES, 'development', DEV_SEED, tokenize, compilerSource());
  if (instances.length !== DEV_COUNT) throw new Error(`Development count is ${instances.length}`);
  if (new Set(instances.map((item) => item.domain)).size < 3) throw new Error('Development needs three domains');
  return instances;
}

export function generateHoldout(tokenize) {
  const instances = buildSplit(HOLDOUT_DOMAINS, SITES, 'holdout', HOLDOUT_SEED, tokenize, compilerSource());
  if (instances.length !== HOLDOUT_COUNT) throw new Error(`Holdout count is ${instances.length}`);
  if (new Set(instances.map((item) => item.domain)).size < 3) throw new Error('Holdout needs three domains');
  return instances;
}

export function generateNegative(tokenize) {
  const compiler = compilerSource();
  const instances = [];
  const seen = new Set();
  for (let index = 0; index < NEGATIVE_COUNT; index += 1) {
    const a = QUERY_A[index % QUERY_A.length];
    const b = QUERY_B[index % QUERY_B.length];
    const c = QUERY_C[Math.floor(index / 10) % QUERY_C.length];
    const key = `${a}|${b}|${c}`;
    if (seen.has(key)) throw new Error(`Duplicate negative query ${key}`);
    seen.add(key);
    const query = `clerk cancel ${a} ${b} ${c} whenever asked`;
    const queryTerms = terms(query, tokenize);
    const support = `${query}. ${query}.`;
    const passages = [];
    for (let copy = 0; copy < 15; copy += 1) {
      passages.push(passage(`N${index}-support-${copy}`, 'support', ['reading'], support));
    }
    DECOY_OPPOSITION.forEach((text, decoy) => {
      assertEvidence(text, queryTerms, tokenize, compiler, `negative opposition ${decoy} on ${index}`);
      passages.push(passage(`N${index}-opp-${decoy}`, 'contradict', ['unrequested-opposition'], text));
    });
    DECOY_QUALIFIER.forEach((text, decoy) => {
      assertEvidence(text, queryTerms, tokenize, compiler, `negative qualifier ${decoy} on ${index}`);
      passages.push(passage(`N${index}-qual-${decoy}`, 'qualify', ['unrequested-qualifier'], text));
    });
    const fillerCount = NEGATIVE_CORPUS - passages.length;
    if (fillerCount < 400) throw new Error('Negative filler count is too small');
    for (let filler = 0; filler < fillerCount; filler += 1) {
      const text = `Zedlot ${index}-${filler} lists barcode crates beside outbound lane markers.`;
      if (shared(terms(text, tokenize), queryTerms).length) throw new Error(`Negative filler shares tokens with ${query}`);
      if (sentenceGated(text)) throw new Error('Negative filler tripped the compiler gate');
      passages.push(passage(`N${index}-pad-${filler}`, 'irrelevant', [], text));
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
      unseen: false,
      negativeControl: true,
      required: { support: ['reading'], opposition: [], qualifiers: [], temporal: [] },
      decoyOppositionIds: passages.filter((item) => item.facts.includes('unrequested-opposition')).map((item) => item.id),
      decoyQualifierIds: passages.filter((item) => item.facts.includes('unrequested-qualifier')).map((item) => item.id),
      passages,
    });
  }
  return instances;
}
