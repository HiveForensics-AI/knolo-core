import type { KarImageInput } from '../v5.js';
import { canonicalize } from '../canonicalize.js';
import { openEvidenceCatalog, type EvidenceCatalog, type EvidenceObject } from './catalog.js';
import { CEG_SOURCE_VERSION } from './constants.js';
import { diagnostic, sortDiagnostics, type CegDiagnostic } from './diagnostics.js';
import {
  CEG_PRODUCER_RUN_FORMAT,
  RULE_PRODUCER_ID,
  RULE_PRODUCER_VERSION,
  compareText,
  domainPackRoot,
  interpretDomainPack,
  regexIsSafe,
  resolveProducerLimits,
  type DomainConcept,
  type DomainPackV1,
  type DomainRule,
  type PolicyClass,
  type ProducerLimits,
} from './domain.js';
import { isRealDate } from './model.js';
import type { CegProducer } from './index.js';
import {
  acceptedFragment,
  canonicalRun,
  emptySource,
  observationId,
  packProvenance,
  producerConfigRoot,
  producerInputRoot,
  proposalId,
  relationConflicts,
  textDigestOf,
  type CegObservation,
  type CegProducerRun,
  type CegProposal,
  type ProposalState,
} from './proposals.js';
import type { CegBindingSource, CegSourceFragment } from './model.js';

export type ProducerCache = Map<string, string>;

type Hit = {
  rule: DomainRule;
  evidence: EvidenceObject;
  start: number;
  end: number;
  excerpt: string;
  date?: string;
  authority?: number;
};

export function createRuleCegProducer(options: { domainPack: DomainPackV1 }): CegProducer {
  return {
    id: RULE_PRODUCER_ID,
    version: RULE_PRODUCER_VERSION,
    async produce(input) {
      const ran = runRuleProducer({ pack: options.domainPack, image: input.image, auto: true });
      if (!ran.ok) {
        const error = new Error(ran.diagnostics.map((item) => item.code).join(','));
        throw error;
      }
      return ran.run.fragment;
    },
  };
}

export function ruleProducerCacheKey(pack: DomainPackV1, catalog: EvidenceCatalog, limits: ProducerLimits): string {
  const root = domainPackRoot(pack);
  const configRoot = producerConfigRoot({ producerId: RULE_PRODUCER_ID, producerVersion: RULE_PRODUCER_VERSION, limits });
  return producerInputRoot({
    configRoot,
    domainPackRoot: root,
    image: {
      stateRoot: catalog.stateRoot,
      objectRoot: catalog.objectRoot,
      commitDigest: catalog.commitDigest,
      knowledgeRoot: catalog.knowledgeRoot,
    },
  });
}

export function runRuleProducer(input: {
  pack: unknown;
  image?: KarImageInput;
  catalog?: EvidenceCatalog;
  auto?: boolean;
  limits?: Partial<ProducerLimits>;
  cache?: ProducerCache;
}): { ok: true; run: CegProducerRun } | { ok: false; diagnostics: CegDiagnostic[] } {
  const interpreted = interpretDomainPack(input.pack);
  if (!interpreted.ok) return interpreted;
  const pack = interpreted.pack;
  const limitResult = resolveProducerLimits({ ...pack.limits, ...input.limits });
  if ('severity' in limitResult) return { ok: false, diagnostics: [limitResult] };
  const opened = input.catalog ? { ok: true as const, catalog: input.catalog } : input.image ? openEvidenceCatalog(input.image) : { ok: false as const, diagnostics: [diagnostic('error', 'CEG_PRODUCER_INPUT', 'image', 'Rule production needs a Knowledge Image.')] };
  if (!opened.ok) return opened;
  const key = input.cache ? ruleProducerCacheKey(pack, opened.catalog, limitResult) : '';
  if (input.cache && key) {
    const cached = input.cache.get(key);
    if (cached !== undefined) return { ok: true, run: JSON.parse(cached) as CegProducerRun };
  }
  const run = produceRun(pack, opened.catalog, limitResult);
  if (input.cache && key && run.ok) input.cache.set(key, canonicalize(canonicalRun(run.run)));
  return run;
}

function produceRun(pack: DomainPackV1, catalog: EvidenceCatalog, limits: ProducerLimits): { ok: true; run: CegProducerRun } | { ok: false; diagnostics: CegDiagnostic[] } {
  const diagnostics: CegDiagnostic[] = [];
  if (catalog.objects.length > limits.maxEvidenceObjects) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_LIMIT', 'image', 'The image has more evidence objects than the producer allows.')] };
  }
  const objects = [...catalog.objects].sort((left, right) => compareText(left.id, right.id));
  const rules = [...pack.rules].sort((left, right) => compareText(left.id, right.id));
  const conceptsByName = new Map(pack.concepts.map((concept) => [concept.name, concept]));
  const hits: Hit[] = [];
  for (const evidence of objects) {
    let ruleHits = 0;
    for (const rule of rules) {
      const matched = matchRule(rule, evidence, limits, diagnostics);
      if (matched.length > 0) ruleHits += 1;
      hits.push(...matched);
      if (ruleHits > limits.maxRulesPerEvidence) {
        return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_LIMIT', `evidence.${evidence.id}`, 'One evidence object matched too many rules.')] };
      }
    }
  }
  const dates = new Map<string, { validFrom: Set<string>; validUntil: Set<string>; authority: Set<number> }>();
  for (const hit of hits) {
    const bucket = dates.get(hit.evidence.id) ?? { validFrom: new Set<string>(), validUntil: new Set<string>(), authority: new Set<number>() };
    // A review-only or observation-only class must not paint dates or authority onto committed bindings.
    if (commitsSideEffect(hit.rule) && hit.rule.dateField && hit.date) bucket[hit.rule.dateField].add(hit.date);
    if (commitsSideEffect(hit.rule) && hit.authority !== undefined) bucket.authority.add(hit.authority);
    dates.set(hit.evidence.id, bucket);
  }
  for (const [evidenceId, bucket] of dates) {
    if (bucket.validFrom.size > 1 || bucket.validUntil.size > 1) {
      diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_AMBIGUOUS_DATE', `evidence.${evidenceId}`, 'More than one explicit date was found. None was applied.'));
      bucket.validFrom.clear();
      bucket.validUntil.clear();
    }
    const from = [...bucket.validFrom][0];
    const until = [...bucket.validUntil][0];
    if (from && until && from >= until) {
      diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_INVALID_WINDOW', `evidence.${evidenceId}`, 'The explicit validity window is impossible. Dates were not applied.'));
      bucket.validFrom.clear();
      bucket.validUntil.clear();
    }
    if (bucket.authority.size > 1) {
      diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_AMBIGUOUS_AUTHORITY', `evidence.${evidenceId}`, 'More than one explicit authority was found. None was applied.'));
      bucket.authority.clear();
    }
  }

  const observations: CegObservation[] = [];
  const proposals: CegProposal[] = [];
  for (const hit of hits.sort(compareHits)) {
    const excerpt = hit.excerpt.slice(0, limits.maxSpanLength);
    const digest = textDigestOf(excerpt);
    const span = { start: hit.start, end: hit.end };
    const built = buildFragment(hit, conceptsByName, dates.get(hit.evidence.id));
    const observation = makeObservation(hit, excerpt, digest, span, built.fragment);
    observations.push(observation);
    if (hit.rule.kind === 'incomplete' || hit.rule.reason === 'INCOMPLETE_REFERENCE') {
      diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_INCOMPLETE_REFERENCE', `rules.${hit.rule.id}`, `Rule "${hit.rule.id}" found a reference this pack will not complete.`));
    }
    const policy = policyOf(hit.rule);
    const legacyObservation = !hit.rule.policyClass && (hit.rule.kind === 'incomplete' || hit.rule.kind === 'date' || hit.rule.kind === 'authority');
    if (policy === 'OBSERVATION_ONLY' || legacyObservation) continue;
    if (!built.emit) continue;
    const state: ProposalState = policy === 'AUTO_ACCEPT' ? 'ACCEPTED' : 'NEEDS_REVIEW';
    proposals.push(makeProposal(hit, observation.id, built.fragment, state));
  }
  if (proposals.length > limits.maxGeneratedRelations) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_LIMIT', 'proposals', 'The producer generated too many proposals.')] };
  }
  const accepted = acceptedFragment(proposals);
  diagnostics.push(...accepted.diagnostics);
  diagnostics.push(...relationConflicts(accepted.source.relations));
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  const counted = countFragment(accepted.source);
  if (counted.concepts > limits.maxGeneratedConcepts || counted.relations > limits.maxGeneratedRelations || counted.bindings > limits.maxGeneratedBindings) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_PRODUCER_LIMIT', 'fragment', 'Generated CEG Source exceeds a producer bound.')] };
  }
  const root = domainPackRoot(pack);
  const configRoot = producerConfigRoot({ producerId: RULE_PRODUCER_ID, producerVersion: RULE_PRODUCER_VERSION, limits });
  const image = {
    stateRoot: catalog.stateRoot,
    objectRoot: catalog.objectRoot,
    commitDigest: catalog.commitDigest,
    knowledgeRoot: catalog.knowledgeRoot,
  };
  const run: CegProducerRun = {
    format: CEG_PRODUCER_RUN_FORMAT,
    producer: { id: RULE_PRODUCER_ID, version: RULE_PRODUCER_VERSION },
    fragment: accepted.source,
    diagnostics: sortDiagnostics(diagnostics),
    observations: observations.sort((left, right) => compareText(left.id, right.id)),
    proposals: proposals.sort((left, right) => compareText(left.id, right.id)),
    provenance: {
      producerId: RULE_PRODUCER_ID,
      producerVersion: RULE_PRODUCER_VERSION,
      ...packProvenance(pack, root),
      image,
      configRoot,
      inputRoot: producerInputRoot({ configRoot, domainPackRoot: root, image }),
    },
  };
  return { ok: true, run: canonicalRun(run) };
}

function matchRule(rule: DomainRule, evidence: EvidenceObject, limits: ProducerLimits, diagnostics: CegDiagnostic[]): Hit[] {
  const cap = rule.maxMatches ?? limits.maxMatchesPerRule;
  let hits: Hit[] = [];
  if (rule.kind === 'metadata') hits = matchMetadata(rule, evidence);
  else if (rule.kind === 'authority') hits = matchAuthority(rule, evidence);
  else if (!rule.pattern) hits = [];
  else if (rule.kind === 'clause') hits = matchClause(rule, evidence, cap);
  else if (rule.kind === 'heading' || rule.kind === 'section') hits = matchHeading(rule, evidence, cap);
  else if (rule.patternMode === 'regex') hits = matchRegex(rule, evidence, cap, limits, diagnostics);
  else hits = matchExact(rule, evidence, cap, limits, diagnostics);
  if (!rule.headingContext) return hits;
  return hits.filter((hit) => nearestHeading(hit.evidence.text, hit.start) === rule.headingContext);
}

function matchMetadata(rule: DomainRule, evidence: EvidenceObject): Hit[] {
  if (rule.metadata) {
    for (const [key, expected] of Object.entries(rule.metadata)) {
      if (evidence.meta[key] !== expected) return [];
    }
  }
  if (rule.metadataExists && !evidence.meta[rule.metadataExists]) return [];
  if (!rule.metadata && !rule.metadataExists) return [];
  return [hitOf(rule, evidence, 0, 0, '')];
}

function matchAuthority(rule: DomainRule, evidence: EvidenceObject): Hit[] {
  const hits: Hit[] = [];
  if (rule.authorityMetadata) {
    const raw = evidence.meta[rule.authorityMetadata];
    const parsed = parseAuthority(raw);
    if (parsed !== undefined) hits.push({ ...hitOf(rule, evidence, 0, 0, raw ?? ''), authority: parsed });
  }
  const textHits = findExact(evidence.text, 'authority', 20);
  for (const span of textHits) {
    const window = evidence.text.slice(span.end, span.end + 16);
    const match = /^[ \t]+([0-9]+)/.exec(window);
    if (!match?.[1]) continue;
    const parsed = parseAuthority(match[1]);
    if (parsed === undefined) continue;
    hits.push({ ...hitOf(rule, evidence, span.start, span.end + match[0].length, evidence.text.slice(span.start, span.end + match[0].length)), authority: parsed });
  }
  return hits;
}

function matchHeading(rule: DomainRule, evidence: EvidenceObject, cap: number): Hit[] {
  const pattern = rule.pattern ?? '';
  const hits: Hit[] = [];
  let offset = 0;
  const lines = evidence.text.split('\n');
  const headings = new Set<string>();
  for (const line of lines) {
    const heading = headingText(line);
    if (heading) headings.add(heading);
    if (heading === pattern && hits.length < cap) {
      hits.push(hitOf(rule, evidence, offset, offset + line.length, line.trim()));
    }
    offset += line.length + 1;
  }
  if (rule.kind === 'section' && rule.targetPattern && !headings.has(rule.targetPattern)) return [];
  return hits;
}

function matchExact(rule: DomainRule, evidence: EvidenceObject, cap: number, limits: ProducerLimits, diagnostics: CegDiagnostic[]): Hit[] {
  const pattern = rule.pattern ?? '';
  const spans = findExact(evidence.text, pattern, cap);
  const hits: Hit[] = [];
  let missingDate = false;
  for (const span of spans) {
    const line = lineAt(evidence.text, span.start);
    if (rule.excludePattern && line.text.includes(rule.excludePattern)) continue;
    const excerpt = evidence.text.slice(span.start, span.end);
    const hit = hitOf(rule, evidence, span.start, span.end, excerpt);
    if (rule.kind === 'date' || rule.dateField) {
      const found = findDate(evidence.text, span.end, limits.maxSpanLength);
      if (!found) {
        missingDate = true;
        continue;
      }
      hit.date = found.date;
      hit.end = found.end;
      hit.excerpt = evidence.text.slice(span.start, found.end);
    }
    hits.push(hit);
  }
  if (missingDate) {
    diagnostics.push(diagnostic('warning', 'CEG_PRODUCER_INCOMPLETE_REFERENCE', `rules.${rule.id}`, `Rule "${rule.id}" found a date cue without an explicit date.`));
  }
  return hits;
}

function matchRegex(rule: DomainRule, evidence: EvidenceObject, cap: number, limits: ProducerLimits, diagnostics: CegDiagnostic[]): Hit[] {
  const pattern = rule.pattern ?? '';
  if (!regexIsSafe(pattern)) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RULE_INVALID', `rules.${rule.id}`, `Rule "${rule.id}" regex is not allowed.`));
    return [];
  }
  if (evidence.text.length > 8_000) {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RULE_LIMIT', `rules.${rule.id}`, `Rule "${rule.id}" refused a long regex target.`));
    return [];
  }
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, rule.ignoreCase ? 'gu' : 'g');
  } catch {
    diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RULE_INVALID', `rules.${rule.id}`, `Rule "${rule.id}" regex did not compile.`));
    return [];
  }
  const hits: Hit[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(evidence.text)) !== null) {
    if (hits.length >= cap) {
      diagnostics.push(diagnostic('error', 'CEG_PRODUCER_RULE_LIMIT', `rules.${rule.id}`, `Rule "${rule.id}" exceeded the regex budget.`));
      break;
    }
    if (match[0].length === 0) expression.lastIndex += 1;
    const start = match.index;
    const end = start + match[0].length;
    const line = lineAt(evidence.text, start);
    if (rule.excludePattern && line.text.includes(rule.excludePattern)) continue;
    hits.push(hitOf(rule, evidence, start, end, evidence.text.slice(start, end)));
  }
  return hits;
}

const CLAUSE_MODAL_WORDS = new Set(['shall', 'must', 'will', 'may']);
const CLAUSE_CUES = ['unless', 'notwithstanding', 'subject to', 'provided that', 'except as', 'except when'];

function matchClause(rule: DomainRule, evidence: EvidenceObject, cap: number): Hit[] {
  const template = rule.pattern ?? '';
  const hits: Hit[] = [];
  for (const sentence of boundedSentences(evidence.text)) {
    if (hits.length >= cap) break;
    const parsed = parseClause(template, sentence.text);
    if (!parsed) continue;
    if (rule.modal && parsed.modal !== rule.modal) continue;
    if (rule.verb && parsed.verb !== rule.verb) continue;
    if (rule.excludePattern && sentence.text.includes(rule.excludePattern)) continue;
    hits.push(hitOf(rule, evidence, sentence.start, sentence.end, sentence.text));
  }
  return hits;
}

function boundedSentences(text: string): Array<{ start: number; end: number; text: string }> {
  const sentences: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const ch = index === text.length ? '\n' : text[index];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n' && index !== text.length) continue;
    const end = ch === '\n' || index === text.length ? index : index + 1;
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed.length >= 8 && trimmed.length <= 400) {
      const lead = raw.indexOf(trimmed);
      sentences.push({ start: start + lead, end: start + lead + trimmed.length, text: trimmed });
    }
    start = end;
    if (sentences.length >= 200) break;
  }
  return sentences;
}

function parseClause(template: string, sentence: string): { modal: string; verb: string } | null {
  const tokens = sentence.split(/[^A-Za-z0-9-]+/).filter((token) => token.length > 0);
  const lower = tokens.map((token) => token.toLowerCase());
  if (template === 'party-modal-verb') {
    for (let index = 1; index < lower.length - 2; index += 1) {
      if (!CLAUSE_MODAL_WORDS.has(lower[index] ?? '')) continue;
      if (lower[index + 1] === 'not' || !isClauseVerb(tokens[index + 1] ?? '')) continue;
      return { modal: lower[index] ?? '', verb: lower[index + 1] ?? '' };
    }
  }
  if (template === 'party-modal-not') {
    for (let index = 1; index < lower.length - 3; index += 1) {
      if (!CLAUSE_MODAL_WORDS.has(lower[index] ?? '')) continue;
      if (lower[index + 1] !== 'not' || !isClauseVerb(tokens[index + 2] ?? '')) continue;
      return { modal: lower[index] ?? '', verb: lower[index + 2] ?? '' };
    }
  }
  if (template === 'party-agrees-to') {
    for (let index = 1; index < lower.length - 3; index += 1) {
      if (lower[index] !== 'agrees' || lower[index + 1] !== 'to' || !isClauseVerb(tokens[index + 2] ?? '')) continue;
      return { modal: 'agrees', verb: lower[index + 2] ?? '' };
    }
  }
  if (template === 'object-is-required') {
    for (let index = 0; index < lower.length - 4; index += 1) {
      if ((lower[index] !== 'is' && lower[index] !== 'are') || lower[index + 1] !== 'required' || lower[index + 2] !== 'to') continue;
      if (!isClauseVerb(tokens[index + 3] ?? '')) continue;
      return { modal: 'required', verb: lower[index + 3] ?? '' };
    }
  }
  if (template === 'condition-main') {
    const padded = ` ${lower.join(' ')} `;
    if (!CLAUSE_CUES.some((cue) => padded.includes(` ${cue} `))) return null;
    for (let index = 0; index < lower.length; index += 1) {
      if (!CLAUSE_MODAL_WORDS.has(lower[index] ?? '')) continue;
      const next = tokens[index + 1] ?? '';
      return { modal: lower[index] ?? '', verb: isClauseVerb(next) ? next.toLowerCase() : 'clause' };
    }
  }
  return null;
}

function isClauseVerb(token: string): boolean {
  return /^[A-Za-z][A-Za-z-]{2,24}$/.test(token) && token.toLowerCase() !== 'not';
}

function nearestHeading(text: string, index: number): string | null {
  let offset = 0;
  let last: string | null = null;
  for (const line of text.split('\n')) {
    if (offset >= index) break;
    const heading = headingText(line);
    if (heading) last = heading;
    offset += line.length + 1;
  }
  return last;
}

function policyOf(rule: DomainRule): PolicyClass {
  if (rule.policyClass) return rule.policyClass;
  if (rule.kind === 'incomplete' || rule.kind === 'date' || rule.kind === 'authority') return 'OBSERVATION_ONLY';
  return rule.autoAccept ? 'AUTO_ACCEPT' : 'NEEDS_REVIEW';
}

function commitsSideEffect(rule: DomainRule): boolean {
  if (rule.policyClass === 'NEEDS_REVIEW' || rule.policyClass === 'OBSERVATION_ONLY') return false;
  return true;
}

function buildFragment(
  hit: Hit,
  conceptsByName: Map<string, DomainConcept>,
  dates: { validFrom: Set<string>; validUntil: Set<string>; authority: Set<number> } | undefined,
): { emit: boolean; fragment: CegSourceFragment } {
  const reviewDate = hit.rule.kind === 'date' && hit.rule.policyClass === 'NEEDS_REVIEW' && Boolean(hit.date);
  if (hit.rule.kind === 'incomplete' || hit.rule.kind === 'authority' || (hit.rule.kind === 'date' && !reviewDate)) {
    return { emit: false, fragment: {} };
  }
  const fragment: CegSourceFragment = { concepts: {}, evidence: {}, relations: [], bindings: [], requirements: [] };
  const names = new Set<string>();
  if (hit.rule.concept) names.add(hit.rule.concept);
  if (hit.rule.relation) {
    names.add(hit.rule.relation.from);
    names.add(hit.rule.relation.to);
    fragment.relations = [hit.rule.relation];
  }
  if (hit.rule.binding) names.add(hit.rule.binding.concept);
  for (const name of names) {
    const concept = conceptsByName.get(name);
    fragment.concepts![name] = concept?.label ? { label: concept.label } : {};
  }
  fragment.evidence![hit.evidence.id] = { objectId: hit.evidence.id };
  if (hit.rule.binding) {
    const binding: CegBindingSource = {
      concept: hit.rule.binding.concept,
      evidence: hit.evidence.id,
      requirements: [...hit.rule.binding.requirements],
    };
    const from = reviewDate && hit.rule.dateField === 'validFrom'
      ? hit.date
      : dates && dates.validFrom.size === 1 ? [...dates.validFrom][0] : undefined;
    const until = reviewDate && hit.rule.dateField === 'validUntil'
      ? hit.date
      : dates && dates.validUntil.size === 1 ? [...dates.validUntil][0] : undefined;
    const authority = dates && dates.authority.size === 1 ? [...dates.authority][0] : undefined;
    if (from) binding.validFrom = from;
    if (until) binding.validUntil = until;
    if (authority !== undefined) binding.authority = authority;
    fragment.bindings = [binding];
    fragment.requirements = [...hit.rule.binding.requirements];
  }
  const emit = names.size > 0 || (fragment.relations?.length ?? 0) > 0;
  return { emit, fragment };
}

function makeObservation(hit: Hit, excerpt: string, digest: string, span: { start: number; end: number }, fragment: CegSourceFragment): CegObservation {
  const observation: CegObservation = {
    id: '',
    evidenceId: hit.evidence.id,
    producerId: RULE_PRODUCER_ID,
    producerVersion: RULE_PRODUCER_VERSION,
    ruleId: hit.rule.id,
    span,
    textDigest: digest,
    excerpt,
    proposedConcepts: Object.keys(fragment.concepts ?? {}).sort(compareText),
    proposedRelations: fragment.relations ?? [],
  };
  if (hit.rule.policyClass) observation.policyClass = hit.rule.policyClass;
  if (hit.rule.reason) observation.reason = hit.rule.reason;
  observation.id = observationId(observation);
  return observation;
}

function makeProposal(hit: Hit, observation: string, fragment: CegSourceFragment, state: ProposalState): CegProposal {
  const proposal: CegProposal = {
    id: '',
    state,
    producerId: RULE_PRODUCER_ID,
    producerVersion: RULE_PRODUCER_VERSION,
    ruleId: hit.rule.id,
    evidenceId: hit.evidence.id,
    observationId: observation,
    fragment,
  };
  if (hit.rule.policyClass) proposal.policyClass = hit.rule.policyClass;
  if (hit.rule.reason) proposal.reason = hit.rule.reason;
  proposal.id = proposalId(proposal);
  return proposal;
}

function hitOf(rule: DomainRule, evidence: EvidenceObject, start: number, end: number, excerpt: string): Hit {
  return { rule, evidence, start, end, excerpt };
}

function findExact(text: string, pattern: string, cap: number): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  if (pattern.length === 0) return spans;
  let from = 0;
  while (spans.length < cap && from <= text.length) {
    const start = text.indexOf(pattern, from);
    if (start < 0) break;
    const end = start + pattern.length;
    if (isBoundary(text, start, end)) spans.push({ start, end });
    from = start + 1;
    if (from > text.length) break;
  }
  return spans;
}

function findDate(text: string, from: number, maxSpan: number): { date: string; end: number } | null {
  const window = text.slice(from, from + maxSpan);
  const match = /(\d{4}-\d{2}-\d{2})/.exec(window);
  if (!match?.[1] || !isRealDate(match[1])) return null;
  return { date: match[1], end: from + match.index + match[1].length };
}

function parseAuthority(value: string | undefined): number | undefined {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}

function headingText(line: string): string | null {
  const trimmed = line.trim();
  const markdown = /^#{1,6}\s+(.+)$/.exec(trimmed);
  const text = (markdown?.[1] ?? trimmed).trim();
  if (text.length === 0 || text.length > 80) return null;
  if (markdown || (trimmed.length > 0 && trimmed === text && !/[.!?]$/.test(text))) return text;
  return null;
}

function lineAt(text: string, index: number): { text: string } {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return { text: text.slice(start, end < 0 ? text.length : end) };
}

function isBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : text[start - 1] ?? '';
  const after = end >= text.length ? '' : text[end] ?? '';
  return !isWord(before) && !isWord(after);
}

function isWord(char: string): boolean {
  return /[A-Za-z0-9]/.test(char);
}

function compareHits(left: Hit, right: Hit): number {
  return compareText(left.rule.id, right.rule.id)
    || compareText(left.evidence.id, right.evidence.id)
    || left.start - right.start
    || left.end - right.end;
}

function countFragment(source: { concepts: object; relations: unknown[]; bindings: unknown[] }): { concepts: number; relations: number; bindings: number } {
  return {
    concepts: Object.keys(source.concepts).length,
    relations: source.relations.length,
    bindings: source.bindings.length,
  };
}

export function sourceFormat(): typeof CEG_SOURCE_VERSION {
  return CEG_SOURCE_VERSION;
}

export function blankSource(): ReturnType<typeof emptySource> {
  return emptySource();
}
