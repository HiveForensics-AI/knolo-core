/**
 * Deterministic KAR theory fixtures.
 *
 * Relation labels and required facts are authored here. Nothing in this
 * generator asks a model to decide support, contradiction, or qualification.
 *
 * The hand-authored counterQuery is an experimental probe for a second
 * lexical frontier. It is not a proposed KAR implementation.
 */

export const SEED = 20261009;
export const PER_SCENARIO = 20;
export const GENERATOR_VERSION = 'kar-theory-fixtures-1';
export const SCENARIOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'N'];

const AS_OF = '2024-06-15';
const QUERY = 'customer cancel agreement after 30 days';
const QUERY_B = 'customer cancel order after 30 days';
const COUNTER = 'non-terminable irrevocable minimum annual commitment cannot terminate early';
const QUERY_CONTENT = ['customer', 'cancel', 'agreement', 'after', '30', 'days'];
const QUERY_B_CONTENT = ['customer', 'cancel', 'order', 'after', '30', 'days'];

const SUPPORT_STEM =
  'Published service policy states that a customer may cancel the agreement after 30 days of activation. ' +
  'The customer cancel agreement after 30 days rule applies to standard retail service. ' +
  'A customer may cancel the agreement after 30 days when the published policy window is open. ' +
  'Policy text confirms the customer may cancel the agreement after 30 days without a special waiver. ' +
  'Standard retail language repeats that the customer may cancel the agreement after 30 days. ' +
  'The same published service policy states that a customer may cancel the agreement after 30 days of activation.';

const OPP_VOCAB = ['master', 'subscription', 'non-terminable', 'irrevocable', 'minimum', 'annual', 'commitment', 'committed', 'renewal', 'binding', 'cycle', 'schedule'];
const QUAL_VOCAB = ['accounts', 'opened', 'cutoff', 'retain', 'prior', 'exit', 'grandfathered', 'amendment', 'earlier', 'conditions', 'cohort', 'legacy'];
const NOISE_VOCAB = ['warehouse', 'pallet', 'forklift', 'aisle', 'freight', 'dock', 'staging', 'outbound', 'marker', 'lane', 'crate', 'barcode'];

export function roughTokens(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function assertDisjoint(text, banned, label) {
  const present = new Set(roughTokens(text));
  for (const token of banned) {
    if (present.has(token)) throw new Error(`${label} contains banned token ${token}`);
  }
}

function pad(text, vocab, target = 68) {
  const parts = [text];
  let guard = 0;
  while (roughTokens(parts.join(' ')).length < target && guard < 400) {
    parts.push(vocab[guard % vocab.length]);
    guard += 1;
  }
  return parts.join(' ');
}

function passage(id, sourceId, relation, facts, text, heading, extra = {}) {
  return {
    id,
    sourceId,
    relation,
    facts: [...facts],
    text,
    heading,
    authority: extra.authority ?? 1,
    ...(extra.validFrom ? { validFrom: extra.validFrom } : {}),
    ...(extra.validTo ? { validTo: extra.validTo } : {}),
    ...(extra.unauthorized ? { unauthorized: true } : {}),
  };
}

function noise(scenario, variation, count) {
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    const text = pad(
      `Warehouse pallet ${scenario} v${variation} n${i} uses forklift aisle n${i} markers for outbound freight staging lanes and barcode crates.`,
      NOISE_VOCAB,
      60,
    );
    assertDisjoint(text, QUERY_CONTENT.concat(['order', 'policy', 'non-terminable', 'irrevocable']), `${scenario} noise ${i}`);
    docs.push(
      passage(
        `${scenario}-${variation}-noise-${String(i).padStart(3, '0')}`,
        `warehouse-${i % 7}`,
        'irrelevant',
        [],
        text,
        'Warehouse freight notes',
      ),
    );
  }
  return docs;
}

function background(scenario, variation) {
  const text = pad(
    'A training slide mentions invoice layouts and billing calendars for an account family without stating any exit rule.',
    ['invoice', 'layout', 'billing', 'calendar', 'slide', 'family'],
    60,
  );
  assertDisjoint(text, QUERY_CONTENT, `${scenario} background`);
  return passage(
    `${scenario}-${variation}-background`,
    `training-${variation}`,
    'independent',
    ['background-context'],
    text,
    'Billing calendar slide',
  );
}

function supportDuplicate(scenario, variation, index, facts) {
  const label = String(index).padStart(2, '0');
  return passage(
    `${scenario}-${variation}-sup-${label}`,
    'policy-bulletin',
    'support',
    facts,
    `${SUPPORT_STEM} Copy ${label}.`,
    'Customer cancel agreement policy',
  );
}

function oppositionText(seedWords) {
  return pad(
    `The master subscription is non-terminable and irrevocable under a minimum annual commitment for the committed renewal cycle. ${seedWords}`,
    OPP_VOCAB,
    70,
  );
}

function qualifierText() {
  return pad(
    'Accounts opened before the cutoff retain the prior exit rules. The grandfathered cohort keeps the earlier amendment conditions.',
    QUAL_VOCAB,
    70,
  );
}

function highLex(query, label) {
  return `${label}. ${query}. ${query}. ${query}. ${query}. Filing key ${label}.`;
}

function baseInstance(scenario, variation, extra) {
  return {
    id: `${scenario}-${String(variation).padStart(2, '0')}`,
    scenario,
    variation,
    seed: SEED,
    generator: GENERATOR_VERSION,
    asOf: AS_OF,
    tau: 1,
    gamma: 1,
    qTau: 1,
    qualifierQuery: 'grandfathered cutoff retain prior exit amendment cohort legacy',
    minAuthority: null,
    negativeControl: false,
    expectFeasible: true,
    expectAbstain: false,
    ...extra,
  };
}

function scenarioA(variation) {
  const withQualifier = variation % 2 === 0;
  const overlap = variation % 5 === 0 ? 0 : variation % 4;
  const dupCount = 12 + (variation % 9);
  const facts = ['standard-cancel-window', 'retail-30-day-right'];
  const support = Array.from({ length: dupCount }, (_, index) => supportDuplicate('A', variation, index, facts));
  let oppose = oppositionText('Enterprise master subscriptions stay binding.');
  if (overlap > 0) oppose += ` Mention ${QUERY_CONTENT.slice(0, overlap).join(' ')}.`;
  assertDisjoint(overlap === 0 ? oppose : oppositionText(''), QUERY_CONTENT, 'A opposition base');
  const passages = [
    ...support,
    passage('A-' + variation + '-contract', 'master-agreement', 'contradict', ['enterprise-nonterminable'], oppose, 'Master subscription commitment'),
    background('A', variation),
    ...noise('A', variation, 100),
  ];
  if (withQualifier) {
    passages.push(
      passage('A-' + variation + '-amendment', 'legacy-amendment', 'qualify', ['pre-cutoff-keeps-prior-terms'], qualifierText(), 'Grandfathered cohort amendment'),
    );
  }
  return baseInstance('A', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: {
      support: facts,
      opposition: ['enterprise-nonterminable'],
      qualifiers: withQualifier ? ['pre-cutoff-keeps-prior-terms'] : [],
    },
    designedMinSize: withQualifier ? 3 : 2,
    params: { dupCount, noiseCount: 100, overlap, withQualifier, pattern: 'near-duplicate-support' },
    passages,
  });
}

const B_PARAPHRASES = [
  ['storefront', 'A storefront FAQ lists the ordinary path for a retail purchase.'],
  ['brochure', 'The brochure describes month-to-month purchases and basic carts.'],
  ['macro', 'Support macro number one covers retail purchases only.'],
  ['email', 'An email template grants the ordinary right on delivery.'],
  ['footnote', 'A receipt footnote describes the default right from delivery.'],
  ['form', 'The web form title describes standard carts and monthly plans.'],
  ['article', 'A help article applies the rule to month-to-month purchases.'],
  ['checkout', 'Standard checkout copy describes the ordinary path.'],
  ['card', 'Training card text repeats the rule when the plan is monthly.'],
  ['abstract', 'A policy abstract includes no enterprise language.'],
  ['handbook', 'The retail handbook limits the statement to basic subscriptions.'],
  ['notice', 'A posted notice describes signup for ordinary accounts.'],
];

function scenarioB(variation) {
  const dupCount = 6 + (variation % 7);
  const supportFacts = ['standard-cancel-30', 'retail-order-window'];
  const opposeFacts = ['no-early-termination', 'annual-commitment-binding'];
  const qualFacts = ['pre-cutoff-keeps-prior-terms', 'activation-date-exception'];
  const passages = [];
  for (let i = 0; i < dupCount; i += 1) {
    const [label, tail] = B_PARAPHRASES[i % B_PARAPHRASES.length];
    const unique = pad(tail, ['orange', 'nickel', 'velvet', 'cinder', 'marble', label, String(variation), String(i)], 80);
    passages.push(
      passage(
        `B-${variation}-sup-${label}-${i}`,
        `retail-${label}`,
        'support',
        supportFacts,
        `${QUERY_B}. ${unique}`,
        'Customer cancel order policy',
      ),
    );
  }
  passages.push(
    passage(
      `B-${variation}-partial-contract`,
      'partial-schedule',
      'contradict',
      [opposeFacts[0]],
      highLex(QUERY_B, `partial schedule ${variation}`),
      'Customer cancel order policy',
    ),
    passage(
      `B-${variation}-contract`,
      'enterprise-schedule',
      'contradict',
      opposeFacts,
      oppositionText('Annual enterprise orders cannot terminate early.'),
      'Enterprise schedule commitment',
    ),
    passage(
      `B-${variation}-amendment`,
      'legacy-amendment',
      'qualify',
      qualFacts,
      qualifierText(),
      'Grandfathered cohort amendment',
    ),
    background('B', variation),
    ...noise('B', variation, 80),
  );
  return baseInstance('B', variation, {
    query: QUERY_B,
    counterQuery: COUNTER,
    required: { support: supportFacts, opposition: opposeFacts, qualifiers: qualFacts },
    designedMinSize: 3,
    params: { dupCount, noiseCount: 80, overlap: 0, withQualifier: true, pattern: 'buried-exception' },
    passages,
  });
}

function scenarioC(variation) {
  const withQualifier = variation % 2 === 0;
  const supportFacts = ['current-window-30'];
  const opposeFacts = ['enterprise-nonterminable'];
  const qualFacts = withQualifier ? ['pre-cutoff-keeps-prior-terms'] : [];
  const passages = [
    passage(
      `C-${variation}-stale-policy`,
      'archive-policy',
      'support',
      ['old-window-7'],
      `${SUPPORT_STEM} Historical copy.`,
      'Customer cancel agreement policy',
      { validFrom: '2019-01-01', validTo: '2024-01-01' },
    ),
    passage(
      `C-${variation}-stale-contract`,
      'archive-contract',
      'contradict',
      opposeFacts,
      oppositionText('Superseded master terms.'),
      'Master subscription commitment',
      { validFrom: '2019-01-01', validTo: '2024-01-01' },
    ),
    passage(
      `C-${variation}-current-policy`,
      'current-policy',
      'support',
      supportFacts,
      pad('The current service bulletin states that a customer may cancel the agreement after 30 days.', ['current', 'bulletin', 'monthly'], 70),
      'Current customer cancel agreement bulletin',
      { validFrom: '2024-01-01', validTo: '2025-01-01' },
    ),
    passage(
      `C-${variation}-future-policy`,
      'future-policy',
      'support',
      ['future-window-10'],
      `${SUPPORT_STEM} Future copy.`,
      'Customer cancel agreement policy',
      { validFrom: '2025-01-01', validTo: '2026-01-01' },
    ),
    passage(
      `C-${variation}-current-contract`,
      'current-contract',
      'contradict',
      opposeFacts,
      oppositionText('Current master terms remain binding.'),
      'Master subscription commitment',
      { validFrom: '2024-01-01', validTo: '2025-01-01' },
    ),
    background('C', variation),
    ...noise('C', variation, 30),
  ];
  if (withQualifier) {
    passages.push(
      passage(
        `C-${variation}-amendment`,
        'legacy-amendment',
        'qualify',
        qualFacts,
        qualifierText(),
        'Grandfathered cohort amendment',
        { validFrom: '2024-01-01', validTo: '2025-01-01' },
      ),
    );
  }
  return baseInstance('C', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: { support: supportFacts, opposition: opposeFacts, qualifiers: qualFacts },
    designedMinSize: withQualifier ? 3 : 2,
    params: { dupCount: 1, noiseCount: 30, overlap: 0, withQualifier, pattern: 'validity-window' },
    passages,
  });
}

function scenarioD(variation) {
  const dense = variation < 10;
  const decoys = [];
  for (let i = 0; i < 8; i += 1) {
    const text = dense
      ? highLex(QUERY, `decoy ${variation}-${i}`)
      : pad(`Archive card ${variation} ${i} lists ${QUERY} as a tab name and repeats ${QUERY} for sorting only.`, ['drawer', 'tab', 'sorting', 'label'], 40);
    decoys.push(passage(`D-${variation}-decoy-${i}`, `index-${i}`, 'irrelevant', [], text, QUERY));
  }
  const passages = [
    ...decoys,
    passage(
      `D-${variation}-real-support`,
      'real-memo',
      'support',
      ['real-cancel-rule', 'monthly-plan-condition'],
      pad('Internal memorandum. A customer may cancel the agreement after 30 days only when the account is a standard monthly plan.', ['mailroom', 'binder', 'shelf', 'routing'], 80),
      'Internal memorandum',
    ),
    passage(
      `D-${variation}-real-limit`,
      'real-limit',
      'contradict',
      ['real-enterprise-limit'],
      oppositionText('The enterprise schedule is the actual limit.'),
      'Master subscription commitment',
    ),
    background('D', variation),
    ...noise('D', variation, 40),
  ];
  return baseInstance('D', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: { support: ['real-cancel-rule', 'monthly-plan-condition'], opposition: ['real-enterprise-limit'], qualifiers: [] },
    designedMinSize: 2,
    params: { dupCount: 0, noiseCount: 40, overlap: 0, decoy: dense ? 'dense' : 'same-length', pattern: 'lexical-decoy' },
    passages,
  });
}

function scenarioE(variation) {
  const overlap = variation % 5 === 0 ? 0 : variation % 4;
  const split = variation % 2 === 0;
  const dupCount = 8 + (variation % 12);
  const supportFacts = ['standard-cancel-window', 'retail-30-day-right'];
  const opposeFacts = ['enterprise-nonterminable', 'annual-commitment-binding'];
  const passages = Array.from({ length: dupCount }, (_, index) => supportDuplicate('E', variation, index, supportFacts));
  if (split) {
    let first = 'The master subscription is non-terminable and irrevocable for the committed renewal cycle.';
    const second = 'A minimum annual commitment applies until renewal of the master subscription.';
    if (overlap > 0) first += ` Mention ${QUERY_CONTENT.slice(0, overlap).join(' ')}.`;
    passages.push(
      passage(`E-${variation}-contract-a`, 'master-agreement', 'contradict', [opposeFacts[0]], pad(first, OPP_VOCAB, 70), 'Master subscription commitment'),
      passage(`E-${variation}-contract-b`, 'master-agreement', 'contradict', [opposeFacts[1]], pad(second, OPP_VOCAB, 70), 'Annual commitment schedule'),
    );
  } else {
    let text = oppositionText('Both limits live in one schedule.');
    if (overlap > 0) text += ` Mention ${QUERY_CONTENT.slice(0, overlap).join(' ')}.`;
    passages.push(passage(`E-${variation}-contract`, 'master-agreement', 'contradict', opposeFacts, text, 'Master subscription commitment'));
  }
  passages.push(background('E', variation), ...noise('E', variation, 120));
  return baseInstance('E', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: { support: supportFacts, opposition: opposeFacts, qualifiers: [] },
    designedMinSize: split ? 3 : 2,
    params: { dupCount, noiseCount: 120, overlap, splitOpposition: split, pattern: 'weak-lexical-opposition' },
    passages,
  });
}

function scenarioF(variation) {
  const gap = ['opposition', 'support', 'qualifier'][variation % 3];
  const passages = [
    ...Array.from({ length: 6 }, (_, index) => supportDuplicate('F', variation, index, ['standard-cancel-window'])),
    passage(
      `F-${variation}-contract`,
      'master-agreement',
      'contradict',
      ['enterprise-nonterminable'],
      oppositionText('Present in the corpus only for non-opposition gaps.'),
      'Master subscription commitment',
    ),
    background('F', variation),
    ...noise('F', variation, 20),
  ];
  const required = {
    support: gap === 'support' ? ['missing-support-fact'] : ['standard-cancel-window'],
    opposition: gap === 'opposition' ? ['missing-opposition-fact'] : ['enterprise-nonterminable'],
    qualifiers: gap === 'qualifier' ? ['missing-qualifier-fact'] : [],
  };
  return baseInstance('F', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required,
    designedMinSize: null,
    expectFeasible: false,
    expectAbstain: true,
    params: { dupCount: 6, noiseCount: 20, overlap: 0, gap, pattern: 'genuine-gap' },
    passages,
  });
}

function scenarioG(variation) {
  const reason = ['stale', 'future', 'unauthorized', 'low-authority'][variation % 4];
  const extra =
    reason === 'stale'
      ? { validFrom: '2018-01-01', validTo: '2020-01-01' }
      : reason === 'future'
        ? { validFrom: '2026-01-01', validTo: '2027-01-01' }
        : reason === 'unauthorized'
          ? { unauthorized: true }
          : { authority: 1 };
  const supportAuthority = reason === 'low-authority' ? 5 : 1;
  const passages = [
    ...Array.from({ length: 8 }, (_, index) => {
      const support = supportDuplicate('G', variation, index, ['standard-cancel-window']);
      support.authority = supportAuthority;
      return support;
    }),
    passage(
      `G-${variation}-ineligible-contract`,
      'blocked-contract',
      'contradict',
      ['enterprise-nonterminable'],
      `${oppositionText('This copy is outside the allowed universe.')} ${QUERY}`,
      'Customer cancel agreement policy',
      reason === 'low-authority' ? extra : { ...extra, authority: extra.authority ?? 9 },
    ),
    background('G', variation),
    ...noise('G', variation, 20),
  ];
  return baseInstance('G', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    minAuthority: reason === 'low-authority' ? 5 : null,
    required: { support: ['standard-cancel-window'], opposition: ['enterprise-nonterminable'], qualifiers: [] },
    designedMinSize: null,
    expectFeasible: false,
    expectAbstain: true,
    params: { dupCount: 8, noiseCount: 20, overlap: 6, ineligibleReason: reason, pattern: 'ineligible-opposition' },
    passages,
  });
}

function scenarioH(variation) {
  const trap = variation % 2 === 1;
  const passages = [...noise('H', variation, 20), background('H', variation)];
  if (!trap) {
    passages.push(
      passage(`H-${variation}-part-s1`, 'fragments', 'support', ['s1'], highLex(QUERY, `fragment s1 ${variation}`), QUERY),
      passage(`H-${variation}-part-s2`, 'fragments', 'support', ['s2'], highLex(QUERY, `fragment s2 ${variation}`), QUERY),
      passage(`H-${variation}-cover-support`, 'covering-memo', 'support', ['s1', 's2'], pad('Covering memo records both retail conditions.', ['xylophone', 'quartet', 'marble'], 70), 'Covering memo'),
      passage(`H-${variation}-opp`, 'master-agreement', 'contradict', ['o1'], oppositionText('One opposing limit is enough here.'), 'Master subscription commitment'),
      passage(`H-${variation}-opp-part`, 'partial-schedule', 'contradict', ['other'], highLex(QUERY, `fragment limit ${variation}`), QUERY),
    );
    return baseInstance('H', variation, {
      query: QUERY,
      counterQuery: COUNTER,
      required: { support: ['s1', 's2'], opposition: ['o1'], qualifiers: [] },
      designedMinSize: 2,
      params: { dupCount: 2, noiseCount: 20, overlap: 0, trap: false, pattern: 'minimum-set' },
      passages,
    });
  }
  passages.push(
    passage(`H-${variation}-aa-partial`, 'partial-schedule', 'contradict', ['o1', 'o3'], highLex(QUERY, `partial frontier ${variation}`), QUERY),
    passage(`H-${variation}-mm-left`, 'left-schedule', 'contradict', ['o1', 'o2'], oppositionText('Left schedule clause.'), 'Left schedule'),
    passage(`H-${variation}-mm-right`, 'right-schedule', 'contradict', ['o3', 'o4'], oppositionText('Right schedule clause.'), 'Right schedule'),
    passage(`H-${variation}-cover-support`, 'covering-memo', 'support', ['s1', 's2'], pad('Covering memo records both retail conditions.', ['xylophone', 'quartet'], 70), 'Covering memo'),
    passage(`H-${variation}-part-s1`, 'fragments', 'support', ['s1'], highLex(QUERY, `fragment s1 ${variation}`), QUERY),
  );
  return baseInstance('H', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: { support: ['s1', 's2'], opposition: ['o1', 'o2', 'o3', 'o4'], qualifiers: [] },
    designedMinSize: 3,
    params: { dupCount: 1, noiseCount: 20, overlap: 0, trap: true, pattern: 'greedy-trap' },
    passages,
  });
}

function scenarioI(variation) {
  const preferIndependent = variation % 2 === 0;
  const dupCount = 10;
  const passages = [];
  for (let i = 0; i < dupCount; i += 1) {
    const shared = preferIndependent ? 'minimum annual commitment binding cycle' : 'bulletin wording only';
    passages.push(
      passage(
        `I-${variation}-dup-${String(i).padStart(2, '0')}`,
        'bulletin-house',
        'support',
        ['standard-cancel-window'],
        `${SUPPORT_STEM} House copy ${i}. ${shared}.`,
        'Customer cancel agreement policy',
      ),
    );
  }
  passages.push(
    passage(
      `I-${variation}-indep`,
      'regulator-memo',
      'support',
      ['standard-cancel-window'],
      pad('A regulator memo records the same retail right with separate wording.', ['regulator', 'xylophone', 'quartet', 'marble'], 70),
      'Regulator memo',
    ),
    passage(
      `I-${variation}-contract`,
      'contract-archive',
      'contradict',
      ['enterprise-nonterminable'],
      oppositionText('Archived master terms.'),
      'Master subscription commitment',
    ),
    background('I', variation),
    ...noise('I', variation, 20),
  );
  return baseInstance('I', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: { support: ['standard-cancel-window'], opposition: ['enterprise-nonterminable'], qualifiers: [] },
    designedMinSize: 2,
    params: { dupCount, noiseCount: 20, overlap: 0, preferIndependent, pattern: 'source-diversity-observed' },
    passages,
  });
}

function scenarioJ(variation) {
  const textSupport = `${SUPPORT_STEM} Identical tie copy.`;
  const textOppose = oppositionText('Identical opposing copy.');
  const passages = [
    passage(`J-${variation}-a-support`, 'tie-source', 'support', ['standard-cancel-window'], textSupport, 'Customer cancel agreement policy'),
    passage(`J-${variation}-b-support`, 'tie-source', 'support', ['standard-cancel-window'], textSupport, 'Customer cancel agreement policy'),
    passage(`J-${variation}-a-contradict`, 'tie-contract', 'contradict', ['enterprise-nonterminable'], textOppose, 'Master subscription commitment'),
    passage(`J-${variation}-b-contradict`, 'tie-contract', 'contradict', ['enterprise-nonterminable'], textOppose, 'Master subscription commitment'),
    background('J', variation),
    ...noise('J', variation, 15),
  ];
  return baseInstance('J', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    required: { support: ['standard-cancel-window'], opposition: ['enterprise-nonterminable'], qualifiers: [] },
    designedMinSize: 2,
    params: { dupCount: 2, noiseCount: 15, overlap: 0, pattern: 'exact-tie' },
    passages,
  });
}

function scenarioN(variation) {
  const passages = [
    ...Array.from({ length: 8 }, (_, index) => supportDuplicate('N', variation, index, ['standard-cancel-window'])),
    passage(
      `N-${variation}-unrequested`,
      'master-agreement',
      'contradict',
      ['unrequested-conflict'],
      oppositionText('This conflict is not part of the required frontier.'),
      'Master subscription commitment',
    ),
    passage(
      `N-${variation}-decoy`,
      'index-card',
      'irrelevant',
      [],
      highLex(QUERY, `negative decoy ${variation}`),
      QUERY,
    ),
    background('N', variation),
    ...noise('N', variation, 20),
  ];
  return baseInstance('N', variation, {
    query: QUERY,
    counterQuery: COUNTER,
    negativeControl: true,
    required: { support: ['standard-cancel-window'], opposition: [], qualifiers: [] },
    designedMinSize: 1,
    params: { dupCount: 8, noiseCount: 20, overlap: 0, pattern: 'no-required-opposition' },
    passages,
  });
}

const BUILDERS = {
  A: scenarioA,
  B: scenarioB,
  C: scenarioC,
  D: scenarioD,
  E: scenarioE,
  F: scenarioF,
  G: scenarioG,
  H: scenarioH,
  I: scenarioI,
  J: scenarioJ,
  N: scenarioN,
};

export function generateInstances() {
  const instances = [];
  for (const scenario of SCENARIOS) {
    for (let variation = 0; variation < PER_SCENARIO; variation += 1) {
      instances.push(BUILDERS[scenario](variation));
    }
  }
  return instances;
}
