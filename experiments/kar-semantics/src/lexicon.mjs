/**
 * Frozen general lexicon for the deterministic semantic compiler.
 *
 * This file is hashed before the holdout corpus is evaluated. It is ordinary
 * English evidence language. It is not a scenario dictionary and it does not
 * contain benchmark sentences.
 */

export const COMPILER_VERSION = 'kar-semantics-s1-1';

/** Action concepts. Longer phrases are matched before single tokens. */
export const CONCEPTS = {
  terminate: {
    phrases: ['end contract', 'end the contract', 'end the agreement', 'close the account', 'close account'],
    aliases: [
      'cancel', 'cancels', 'canceled', 'cancelled', 'canceling', 'cancelling', 'cancellation', 'cancellations',
      'terminate', 'terminates', 'terminated', 'terminating', 'termination', 'terminations', 'terminable',
      'revoke', 'revokes', 'revoked', 'revoking', 'revocation', 'revocations', 'revocable',
      'rescind', 'rescinds', 'rescinded', 'rescinding', 'rescission', 'rescissions',
      'close', 'closes', 'closed', 'closing', 'closure', 'closures',
      'discontinue', 'discontinues', 'discontinued', 'discontinuing', 'discontinuation',
      'unwind', 'unwinds', 'unwound',
    ],
  },
  supersede: {
    phrases: [],
    aliases: ['supersede', 'supersedes', 'superseded', 'superseding', 'replace', 'replaces', 'replaced', 'replacing', 'override', 'overrides', 'overridden', 'overriding'],
  },
  require: {
    phrases: [],
    aliases: ['require', 'requires', 'required', 'requiring', 'requirement', 'requirements', 'obligation', 'obligations', 'obligatory', 'mandatory'],
  },
  permit: {
    phrases: [],
    aliases: ['permit', 'permits', 'permitted', 'permitting', 'permission', 'permissions', 'allow', 'allows', 'allowed', 'allowing', 'authorize', 'authorizes', 'authorized', 'authorizing'],
  },
  prohibit: {
    phrases: [],
    aliases: ['prohibit', 'prohibits', 'prohibited', 'prohibiting', 'prohibition', 'prohibitions', 'forbid', 'forbids', 'forbidden', 'forbidding', 'ban', 'bans', 'banned', 'banning'],
  },
};

/**
 * Cue phrases, longest first. `kind` is modality, exception, temporal, or link.
 * These are general linguistic structures, not fixture text.
 */
export const CUE_PHRASES = [
  { tokens: ['is', 'not', 'permitted'], kind: 'modality', value: 'prohibit' },
  { tokens: ['is', 'not', 'allowed'], kind: 'modality', value: 'prohibit' },
  { tokens: ['may', 'not'], kind: 'modality', value: 'prohibit' },
  { tokens: ['must', 'not'], kind: 'modality', value: 'prohibit' },
  { tokens: ['shall', 'not'], kind: 'modality', value: 'prohibit' },
  { tokens: ['is', 'prohibited'], kind: 'modality', value: 'prohibit' },
  { tokens: ['is', 'forbidden'], kind: 'modality', value: 'prohibit' },
  { tokens: ['is', 'required'], kind: 'modality', value: 'require' },
  { tokens: ['is', 'permitted'], kind: 'modality', value: 'permit' },
  { tokens: ['is', 'allowed'], kind: 'modality', value: 'permit' },
  { tokens: ['except', 'when'], kind: 'exception', value: 'except' },
  { tokens: ['only', 'if'], kind: 'exception', value: 'only-if' },
  { tokens: ['only', 'when'], kind: 'exception', value: 'only-when' },
  { tokens: ['only', 'where'], kind: 'exception', value: 'only-where' },
  { tokens: ['only', 'for'], kind: 'scope', value: 'only-for' },
  { tokens: ['subject', 'to'], kind: 'exception', value: 'subject-to' },
  { tokens: ['provided', 'that'], kind: 'exception', value: 'provided-that' },
  { tokens: ['prior', 'to'], kind: 'temporal', value: 'before' },
  { tokens: ['as', 'of'], kind: 'temporal', value: 'after' },
  { tokens: ['no', 'later', 'than'], kind: 'temporal', value: 'before' },
  { tokens: ['contrary', 'to'], kind: 'link', value: 'contradicts' },
  { tokens: ['conflicts', 'with'], kind: 'link', value: 'contradicts' },
  { tokens: ['applies', 'to'], kind: 'scope', value: 'applies-to' },
  { tokens: ['applicable', 'to'], kind: 'scope', value: 'applies-to' },
  { tokens: ['cannot'], kind: 'modality', value: 'prohibit' },
  { tokens: ['unless'], kind: 'exception', value: 'unless' },
  { tokens: ['except'], kind: 'exception', value: 'except' },
  { tokens: ['notwithstanding'], kind: 'exception', value: 'notwithstanding' },
  { tokens: ['before'], kind: 'temporal', value: 'before' },
  { tokens: ['after'], kind: 'temporal', value: 'after' },
  { tokens: ['until'], kind: 'temporal', value: 'before' },
  { tokens: ['effective'], kind: 'temporal', value: 'after' },
  { tokens: ['supersedes'], kind: 'link', value: 'supersedes' },
  { tokens: ['supersede'], kind: 'link', value: 'supersedes' },
  { tokens: ['replaces'], kind: 'link', value: 'supersedes' },
  { tokens: ['replace'], kind: 'link', value: 'supersedes' },
  { tokens: ['overrides'], kind: 'link', value: 'overrides' },
  { tokens: ['override'], kind: 'link', value: 'overrides' },
  { tokens: ['contradicts'], kind: 'link', value: 'contradicts' },
  { tokens: ['must'], kind: 'modality', value: 'require' },
  { tokens: ['shall'], kind: 'modality', value: 'require' },
  { tokens: ['may'], kind: 'modality', value: 'permit' },
];

/** Prefixes that invert a known stem. `in` and `dis` require a hyphen. */
export const NEGATION_PREFIXES = [
  { prefix: 'non', hyphenOnly: false },
  { prefix: 'un', hyphenOnly: false },
  { prefix: 'ir', hyphenOnly: false },
  { prefix: 'il', hyphenOnly: false },
  { prefix: 'im', hyphenOnly: false },
  { prefix: 'in', hyphenOnly: true },
  { prefix: 'dis', hyphenOnly: true },
];

/**
 * Tokens that must not seed a claim by themselves. They are function words
 * or cue words that occur in ordinary queries without naming a concept.
 */
export const SEED_STOP = new Set([
  'that', 'with', 'from', 'this', 'under', 'when', 'only', 'same', 'text', 'copy', 'into', 'than', 'then',
  'them', 'they', 'have', 'been', 'were', 'will', 'would', 'could', 'should', 'about', 'after', 'before',
  'there', 'their', 'which', 'where', 'while', 'must', 'shall', 'days', 'upon', 'such', 'other', 'also',
  'over', 'into', 'does', 'each', 'very', 'more', 'most', 'some', 'than', 'what', 'your', 'ours', 'itself',
  'cannot', 'until', 'unless', 'except', 'effective', 'during', 'within', 'without', 'across', 'throughout',
]);

export const RELATIONS = [
  'supports', 'contradicts', 'qualifies', 'excepts', 'overrides', 'supersedes', 'applies_to',
  'valid_before', 'valid_after', 'requires', 'permits', 'prohibits', 'equivalent',
];

const CONCEPT_PRIORITY = ['terminate', 'supersede', 'require', 'permit', 'prohibit'];

export function buildLexiconIndex() {
  const tokenToConcept = new Map();
  const phrases = [];
  for (const concept of CONCEPT_PRIORITY) {
    const entry = CONCEPTS[concept];
    for (const phrase of entry.phrases) phrases.push({ phrase, concept, tokens: phrase.split(' ') });
    for (const alias of entry.aliases) {
      if (!tokenToConcept.has(alias)) tokenToConcept.set(alias, concept);
    }
  }
  phrases.sort((a, b) => b.tokens.length - a.tokens.length || a.phrase.localeCompare(b.phrase));
  return { tokenToConcept, phrases };
}
