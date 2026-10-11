import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedJson } from './kar-limits.mjs';

const USAGE = `Usage: knolo kar benchmark <annotate|adjudicate|agreement> [options]

Blind human gold tooling. Semantics stay kar-1-research-1.
This command does not read producer output, Domain Pack hits, or KAR results.

  knolo kar benchmark annotate --packet packet.json --decisions decisions.json --out labels.json --role human --reviewer-id <id>
  knolo kar benchmark adjudicate --packet packet.json --a pass-a.json --b pass-b.json --decisions decisions.json --out gold.json --role human-adjudicator --reviewer-id <id>
  knolo kar benchmark agreement --a pass-a.json --b pass-b.json [--json]

Roles: human, domain-expert, human-adjudicator, model-assistant.
A model id cannot use a human role.
`;

const ROLES = ['human', 'domain-expert', 'human-adjudicator', 'model-assistant'];
const HUMAN_ROLES = new Set(['human', 'domain-expert', 'human-adjudicator']);
const MODEL_ID = /llama|gpt|openai|claude|grok|openchat|mistral|qwen|ollama|model/i;

const RELATIONS = [
  'supports', 'permits', 'requires', 'prohibits', 'contradicts', 'qualifies', 'excepts',
  'overrides', 'supersedes', 'applies_to', 'valid_before', 'valid_after',
];

const KINDS = {
  contracts: ['agreement', 'party', 'right', 'obligation', 'restriction', 'payment', 'termination', 'renewal', 'exception', 'amendment', 'scope', 'condition', 'effective-date'],
  policy: ['policy', 'role', 'requirement', 'prohibition', 'control', 'exception', 'scope', 'condition', 'effective-date'],
  operations: ['procedure', 'role', 'step', 'precondition', 'prohibition', 'exception', 'equipment', 'scope', 'condition', 'effective-date'],
};

const TOKENS = [
  'termination-right', 'termination-barred', 'renewal-duty', 'payment-duty', 'stated-obligation',
  'stated-restriction', 'stated-exception', 'amendment-effect', 'party-scope', 'requirement-duty',
  'control-duty', 'prohibition-bar', 'stated-permission', 'role-scope', 'stated-scope',
  'required-step', 'precondition', 'prohibited-state', 'equipment-used', 'temporal-bound',
  'stated-replacement', 'stated-support',
];

const FORBIDDEN_FLAGS = ['proposals', 'gold', 'graph', 'domain', 'pack', 'other', 'kar', 'result'];

export function runKarBenchmark(args, flags) {
  for (const name of FORBIDDEN_FLAGS) {
    if (flags[name]) throw new Error(`Refusing --${name}. Independent annotation cannot see producer output or another answer key.`);
  }
  const sub = args[0];
  if (!sub || sub === 'help' || flags.help) {
    console.log(USAGE.trim());
    return;
  }
  if (sub === 'annotate') return annotate(flags);
  if (sub === 'adjudicate') return adjudicate(flags);
  if (sub === 'agreement') return agreementCommand(flags);
  throw new Error(`Unknown benchmark command "${sub}".\n${USAGE}`);
}

function annotate(flags) {
  const packet = readPacket(required(flags, 'packet'));
  const decisions = readJson(required(flags, 'decisions'));
  const role = roleOf(flags);
  const reviewerId = required(flags, 'reviewer-id');
  assertRole(role, reviewerId);
  const items = [];
  const incomplete = [];
  const decisionItems = Array.isArray(decisions.items) ? decisions.items : [];
  for (const decision of decisionItems) {
    const block = blockOf(packet, decision.evidenceId);
    if (decision.action === 'skip') continue;
    if (decision.action === 'incomplete') {
      const quote = quoteOf(decision, block);
      incomplete.push({ evidenceId: block.evidenceId, quote, code: 'INCOMPLETE_REFERENCE' });
      continue;
    }
    if (decision.action !== 'label') throw new Error(`Unknown annotation action "${decision.action ?? ''}".`);
    items.push(labelOf(packet.domain, decision, block));
  }
  const record = {
    format: 'kar-annotation-pass-1',
    role,
    reviewerId,
    human: HUMAN_ROLES.has(role),
    blind: true,
    sawProducerOutput: false,
    documentId: packet.documentId,
    domain: packet.domain,
    items,
    incomplete,
  };
  writeJson(required(flags, 'out'), record);
  if (flags.json) console.log(JSON.stringify(record, null, 2));
  else console.log(`ANNOTATION PASS\nrole             ${role}\nitems            ${items.length}\nincomplete       ${incomplete.length}\nhuman            ${record.human}`);
}

function adjudicate(flags) {
  const packet = readPacket(required(flags, 'packet'));
  const left = readPass(required(flags, 'a'));
  const right = readPass(required(flags, 'b'));
  if (left.documentId !== packet.documentId || right.documentId !== packet.documentId) {
    throw new Error('Annotation passes and the packet must name the same document.');
  }
  const role = roleOf(flags);
  const reviewerId = required(flags, 'reviewer-id');
  assertRole(role, reviewerId);
  if (role !== 'human-adjudicator' && role !== 'domain-expert' && role !== 'model-assistant') {
    throw new Error('Adjudication requires role human-adjudicator, domain-expert, or model-assistant.');
  }
  const decisions = readJson(required(flags, 'decisions'));
  const items = [];
  for (const decision of decisions.items ?? []) {
    const block = blockOf(packet, decision.evidenceId);
    if (decision.action === 'incomplete') continue;
    items.push(labelOf(packet.domain, { ...decision, action: 'label' }, block));
  }
  const record = {
    format: 'kar-adjudicated-gold-1',
    role,
    reviewerId,
    humanAdjudicator: role === 'human-adjudicator' || role === 'domain-expert',
    releaseGold: role === 'human-adjudicator' || role === 'domain-expert',
    sawProducerOutput: false,
    documentId: packet.documentId,
    domain: packet.domain,
    passA: { role: left.role, reviewerId: left.reviewerId, human: left.human === true },
    passB: { role: right.role, reviewerId: right.reviewerId, human: right.human === true },
    items,
    grounding: items.length === 0 ? null : 1,
  };
  writeJson(required(flags, 'out'), record);
  if (flags.json) console.log(JSON.stringify(record, null, 2));
  else console.log(`ADJUDICATION\nrole             ${role}\nitems            ${items.length}\nrelease gold     ${record.releaseGold}`);
}

function agreementCommand(flags) {
  const left = readPass(required(flags, 'a'));
  const right = readPass(required(flags, 'b'));
  const report = comparePasses(left, right);
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    const lines = [
      'ANNOTATION AGREEMENT',
      `documents        ${report.documents}`,
      `evidence         ${formatMetric(report.evidence)}`,
      `relation         ${formatMetric(report.relation)}`,
      `concept kind     ${formatMetric(report.conceptKind)}`,
      `strict endpoint  ${formatMetric(report.strictEndpoint)}`,
      `requirements     ${formatMetric(report.requirements)}`,
      `binding          ${formatMetric(report.binding)}`,
      `stable           ${report.gates.stable}`,
    ];
    console.log(lines.join('\n'));
  }
}

export function comparePasses(left, right) {
  const relation = metric(left.items, right.items, ['evidenceId', 'relation']);
  const conceptKind = metric(left.items, right.items, ['evidenceId', 'relation', 'fromKind', 'toKind']);
  const stable = relation.agreement !== null
    && conceptKind.agreement !== null
    && relation.agreement >= 0.9
    && conceptKind.agreement >= 0.9;
  return {
    format: 'kar-annotation-agreement-3',
    documents: left.documentId && left.documentId === right.documentId ? 1 : 0,
    sameModelFamily: false,
    humanA: left.human === true && HUMAN_ROLES.has(left.role),
    humanB: right.human === true && HUMAN_ROLES.has(right.role),
    evidence: metric(left.items, right.items, ['evidenceId']),
    relation,
    conceptKind,
    strictEndpoint: metric(left.items, right.items, ['evidenceId', 'relation', 'from', 'to']),
    requirements: metric(left.items, right.items, ['evidenceId', 'relation', 'requirements']),
    binding: metric(left.items, right.items, ['evidenceId', 'relation', 'from', 'to', 'requirements']),
    gates: {
      evidenceRelationAgreement: 0.9,
      conceptKindAgreement: 0.9,
      stable,
    },
  };
}

function metric(leftItems, rightItems, fields) {
  const left = new Set((leftItems ?? []).map((item) => keyOf(item, fields)));
  const right = new Set((rightItems ?? []).map((item) => keyOf(item, fields)));
  let hit = 0;
  for (const key of left) if (right.has(key)) hit += 1;
  const union = new Set([...left, ...right]).size;
  return {
    hit,
    left: left.size,
    right: right.size,
    agreement: union === 0 ? null : hit / union,
    precision: right.size === 0 ? null : hit / right.size,
    recall: left.size === 0 ? null : hit / left.size,
  };
}

function keyOf(item, fields) {
  return fields.map((field) => {
    if (field === 'requirements') return [...(item.requirements ?? [])].sort().join(',');
    return String(item[field] ?? '');
  }).join('\t');
}

function labelOf(domain, decision, block) {
  const quote = quoteOf(decision, block);
  if (!RELATIONS.includes(decision.relation)) throw new Error(`Relation "${decision.relation ?? ''}" is not in Annotation Guide v3.`);
  const kinds = KINDS[domain];
  if (!kinds) throw new Error(`Domain "${domain}" is not in Annotation Guide v3.`);
  if (!kinds.includes(decision.fromKind) || !kinds.includes(decision.toKind)) {
    throw new Error('Concept kind is not in the domain taxonomy.');
  }
  if (!isToken(decision.from) || !isToken(decision.to)) throw new Error('Concept ids must be short identifiers.');
  const requirements = Array.isArray(decision.requirements) ? [...decision.requirements] : [];
  if (requirements.length !== 1 || !TOKENS.includes(requirements[0])) {
    throw new Error('A label needs one requirement token from Annotation Guide v3.');
  }
  const item = {
    evidenceId: block.evidenceId,
    quote,
    relation: decision.relation,
    from: decision.from,
    fromKind: decision.fromKind,
    to: decision.to,
    toKind: decision.toKind,
    requirements,
  };
  if (decision.validFrom !== undefined) {
    if (!isoInQuote(decision.validFrom, quote)) throw new Error('validFrom must be an ISO date written in the quote.');
    item.validFrom = decision.validFrom;
  }
  if (decision.validUntil !== undefined) {
    if (!isoInQuote(decision.validUntil, quote)) throw new Error('validUntil must be an ISO date written in the quote.');
    item.validUntil = decision.validUntil;
  }
  if (decision.authority !== undefined) {
    if (!authorityInQuote(decision.authority, quote)) throw new Error('Numeric authority must be an integer labeled as authority in the quote.');
    item.authority = decision.authority;
  }
  return item;
}

function quoteOf(decision, block) {
  if (typeof decision.quote !== 'string' || decision.quote.length === 0) throw new Error('Each decision needs an exact quote.');
  if (!block.text.includes(decision.quote)) throw new Error(`Quote is not an exact substring of evidence ${block.evidenceId}.`);
  return decision.quote;
}

function isoInQuote(value, quote) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && quote.includes(value);
}

function authorityInQuote(value, quote) {
  return Number.isInteger(value) && value >= 0 && new RegExp(`authority\\s+${value}(?!\\d)`, 'i').test(quote);
}

function isToken(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,80}$/.test(value);
}

function readPacket(file) {
  const packet = readJson(file);
  if (packet.format !== 'kar-annotation-packet-1') throw new Error('Packet format must be kar-annotation-packet-1.');
  if (packet.proposals || packet.gold || packet.producer || packet.kar) {
    throw new Error('Packet contains producer or answer-key fields.');
  }
  if (!isToken(packet.documentId) || !KINDS[packet.domain]) throw new Error('Packet document id or domain is invalid.');
  if (!Array.isArray(packet.blocks) || packet.blocks.length === 0) throw new Error('Packet has no evidence blocks.');
  const seen = new Set();
  for (const block of packet.blocks) {
    if (!isToken(block.evidenceId) || typeof block.text !== 'string' || block.text.length === 0) {
      throw new Error('Each evidence block needs an id and text.');
    }
    if (seen.has(block.evidenceId)) throw new Error(`Duplicate evidence id ${block.evidenceId}.`);
    seen.add(block.evidenceId);
  }
  return packet;
}

function blockOf(packet, evidenceId) {
  const block = packet.blocks.find((item) => item.evidenceId === evidenceId);
  if (!block) throw new Error(`Evidence ${evidenceId ?? ''} is not in the packet.`);
  return block;
}

function readPass(file) {
  const pass = readJson(file);
  if (pass.format !== 'kar-annotation-pass-1' && pass.format !== 'kar-adjudicated-gold-1') {
    throw new Error('Annotation file format is not recognized.');
  }
  if (!Array.isArray(pass.items)) throw new Error('Annotation file has no items.');
  return pass;
}

function roleOf(flags) {
  const role = required(flags, 'role');
  if (!ROLES.includes(role)) throw new Error(`Role must be one of ${ROLES.join(', ')}.`);
  return role;
}

function assertRole(role, reviewerId) {
  if (HUMAN_ROLES.has(role) && MODEL_ID.test(reviewerId)) {
    throw new Error(`Reviewer id "${reviewerId}" is a model. Use role model-assistant.`);
  }
}

function formatMetric(metricValue) {
  if (metricValue.agreement === null) return 'n/a';
  return `${(metricValue.agreement * 100).toFixed(1)}% (${metricValue.hit}/${metricValue.left} vs ${metricValue.right})`;
}

function required(flags, name) {
  if (!flags[name]) throw new Error(`Missing --${name}`);
  return flags[name];
}

function readJson(file) {
  return readBoundedJson(file);
}

function writeJson(file, value) {
  writeFileSync(path.resolve(process.cwd(), file), `${JSON.stringify(value, null, 2)}\n`);
}
