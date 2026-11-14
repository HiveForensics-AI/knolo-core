import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import {
  KiteError,
  createKiteSession,
  deriveKiteWorld,
  evaluateKite,
  evaluateKiteSession,
  labelKiteWorld,
  reviewKiteDelta,
  verifyKiteCertificate,
} from '../dist/kite/index.js';

const DIGEST = 'sha256-' + 'ab'.repeat(32);

function image(chunks) {
  return createKnowledgeImageV5({
    actor: 'kite-test',
    sequence: 1,
    objects: chunks.map((chunk) => ({
      kind: 'chunk',
      bytes: Buffer.from(`${chunk.text}\n`),
      meta: { source: chunk.source },
    })),
  });
}

function contract(
  obligations,
  question = 'Can contractor A access production?'
) {
  return {
    format: 'knolo-kite-contract-1',
    question,
    obligations,
  };
}

const obligations = [
  { id: 'policy', kind: 'authority', term: 'security policy' },
  { id: 'exception', kind: 'qualification', term: 'contractor exception' },
  { id: 'approval', kind: 'evidence', term: 'contractor approval' },
];

function rules(extra = {}) {
  return {
    format: 'knolo-kite-rules-1',
    proposition: 'contractor access',
    support: ['exception'],
    oppose: ['policy'],
    require: ['approval'],
    conflicts: [{ left: 'exception', right: 'policy' }],
    completeness: [
      { id: 'register', collection: 'approvals', obligationId: 'approval' },
    ],
    ...extra,
  };
}

function completeness(signed = false) {
  if (!signed) return { format: 'knolo-kite-completeness-1', declarations: [] };
  return {
    format: 'knolo-kite-completeness-1',
    declarations: [{ id: 'register', collection: 'approvals', signed: true }],
  };
}

function changes(items) {
  return { format: 'knolo-kite-changes-1', changes: items };
}

function worldFrom(met, options = {}) {
  return {
    format: 'knolo-kite-world-1',
    question: 'Can contractor A access production?',
    asOf: options.asOf ?? null,
    stateRoot: DIGEST,
    semanticRoot: options.semanticRoot ?? null,
    obligations: obligations.map((item) => ({
      id: item.id,
      kind: item.kind,
      met: met.includes(item.id),
      hitIds: met.includes(item.id) ? [`hit-${item.id}`] : [],
      sources: met.includes(item.id) ? [`${item.id}.md`] : [],
    })),
    rules: rules(options.rules),
    completeness: options.completeness ?? completeness(false),
    changes: options.changes ?? [],
    bounds: {
      maxGraphNodes: 5000,
      maxVariants: options.maxVariants ?? 2048,
      maxCounterfactualChanges: options.maxChanges ?? 2,
      maxRetrievals: 64,
    },
  };
}

function subsets(items, maxSize) {
  const found = [[]];
  function walk(start, size, current) {
    if (size === 0) {
      found.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - size; index += 1) {
      current.push(items[index]);
      walk(index + 1, size - 1, current);
      current.pop();
    }
  }
  const limit = Math.min(maxSize, items.length);
  for (let size = 1; size <= limit; size += 1) walk(0, size, []);
  return found;
}

test('a missing required record stays undetermined', () => {
  const derived = deriveKiteWorld(
    worldFrom(['policy', 'exception'], { completeness: completeness(false) })
  );
  assert.equal(derived.verdict, 'UNDERDETERMINED');
  assert.equal(derived.baseWorld, 'UNDERDETERMINED');
  assert.notEqual(derived.verdict, 'REFUTED_IN_SCOPE');
  assert.equal(derived.invarianceRoot.startsWith('sha256-'), true);
});

test('explicit opposition refutes without using the missing record', () => {
  const derived = deriveKiteWorld(worldFrom(['policy']));
  assert.equal(derived.verdict, 'REFUTED_IN_SCOPE');
  assert.equal(derived.baseWorld, 'REFUTED');
});

test('a signed absence can refute and a missing signature cannot', () => {
  const absent = deriveKiteWorld(
    worldFrom([], { completeness: completeness(true) })
  );
  const unsigned = deriveKiteWorld(
    worldFrom([], { completeness: completeness(false) })
  );
  assert.equal(absent.verdict, 'REFUTED_IN_SCOPE');
  assert.equal(unsigned.verdict, 'UNDERDETERMINED');
  assert.deepEqual(absent.negativeCollections, ['approvals']);
});

test('closed support is warranted only when every declared world agrees', () => {
  const closed = deriveKiteWorld(
    worldFrom(['exception', 'approval'], { completeness: completeness(true) })
  );
  assert.equal(closed.verdict, 'WARRANTED_IN_SCOPE');
  const flipped = deriveKiteWorld(
    worldFrom(['exception', 'approval'], {
      completeness: completeness(true),
      changes: [
        { id: 'retract-exception', kind: 'retract', obligationId: 'exception' },
      ],
    })
  );
  assert.equal(flipped.verdict, 'SUPPORTED_OPEN_WORLD');
  assert.deepEqual(flipped.witness, ['retract-exception']);
  assert.equal(flipped.agrees, false);
});

test('both sides conflict once required records are closed', () => {
  const derived = deriveKiteWorld(
    worldFrom(['policy', 'exception', 'approval'], {
      completeness: completeness(true),
    })
  );
  assert.equal(derived.verdict, 'CONFLICTED');
});

test('an open completeness declaration keeps support open', () => {
  const derived = deriveKiteWorld(
    worldFrom(['exception', 'approval'], { completeness: completeness(false) })
  );
  assert.equal(derived.verdict, 'SUPPORTED_OPEN_WORLD');
});

test('the enumerated worlds are the full declared subset lattice', () => {
  const catalog = [
    { id: 'add-approval', kind: 'amend', obligationId: 'approval' },
    { id: 'drop-policy', kind: 'retract', obligationId: 'policy' },
    { id: 'note-conflict', kind: 'conflict', obligationId: 'exception' },
  ];
  const input = worldFrom(['policy'], { changes: catalog, maxChanges: 2 });
  const derived = deriveKiteWorld(input);
  const expected = subsets(catalog, 2);
  assert.equal(derived.worlds.length, expected.length);
  assert.equal(derived.worlds.length, 1 + 3 + 3);
  expected.forEach((subset, index) => {
    assert.deepEqual(
      derived.worlds[index].changeIds,
      subset.map((change) => change.id)
    );
    const met = new Set(
      input.obligations.filter((item) => item.met).map((item) => item.id)
    );
    for (const change of subset) {
      if (change.kind === 'retract') met.delete(change.obligationId);
      else met.add(change.obligationId);
    }
    assert.equal(derived.worlds[index].label, labelKiteWorld(met, input));
  });
  const witness = expected.find((subset, index) => {
    return derived.worlds[index].label !== derived.baseWorld;
  });
  assert.deepEqual(
    derived.witness,
    witness ? witness.map((change) => change.id) : null
  );
});

test('an unfinished variant search is not a certificate', () => {
  const derived = deriveKiteWorld(
    worldFrom(['policy'], {
      changes: [
        { id: 'a-change', kind: 'amend', obligationId: 'approval' },
        { id: 'b-change', kind: 'retract', obligationId: 'policy' },
      ],
      maxVariants: 1,
      maxChanges: 2,
    })
  );
  assert.equal(derived.verdict, 'BOUND_EXCEEDED');
  assert.equal(derived.invarianceRoot, null);
  assert.equal(derived.worldsChecked, 0);
});

test('the same world commits the same invariance root', () => {
  const first = deriveKiteWorld(worldFrom(['policy', 'exception']));
  const second = deriveKiteWorld(worldFrom(['policy', 'exception']));
  assert.equal(second.invarianceRoot, first.invarianceRoot);
  const dated = deriveKiteWorld(
    worldFrom(['policy', 'exception'], { asOf: '2026-11-10' })
  );
  assert.notEqual(dated.invarianceRoot, first.invarianceRoot);
});

test('a mounted image names the open approval and does not warrant it', async () => {
  const packed = image([
    {
      text: 'The security policy forbids contractor access.',
      source: 'policy.md',
    },
    {
      text: 'The contractor exception allows restricted access.',
      source: 'exception.md',
    },
  ]);
  const session = createKiteSession({
    image: packed.bytes,
    contract: contract(obligations),
    rules: rules(),
    completeness: completeness(false),
    graph: { semanticRoot: DIGEST },
  });
  const first = await evaluateKiteSession(session, { asOf: '2026-11-10' });
  const second = await evaluateKiteSession(session, { asOf: '2026-11-10' });
  assert.deepEqual(second, first);
  assert.equal(first.stateRoot, packed.stateRoot);
  assert.equal(first.semanticRoot, DIGEST);
  assert.deepEqual(
    first.unmet.map((item) => item.id),
    ['approval']
  );
  assert.equal(first.retrievals[0].obligationId, 'approval');
  assert.equal(first.verdict, 'UNDERDETERMINED');
  assert.equal(first.certificate.verdict, 'UNDERDETERMINED');
  assert.equal(first.certificate.stateRoot, packed.stateRoot);
  const verified = await verifyKiteCertificate({
    image: packed.bytes,
    graph: { semanticRoot: DIGEST },
    contract: contract(obligations),
    rules: rules(),
    completeness: completeness(false),
    asOf: '2026-11-10',
    certificate: first.certificate,
  });
  assert.equal(verified.ok, true);
  const tampered = { ...first.certificate, verdict: 'WARRANTED_IN_SCOPE' };
  const rejected = await verifyKiteCertificate({
    image: packed.bytes,
    graph: { semanticRoot: DIGEST },
    contract: contract(obligations),
    rules: rules(),
    completeness: completeness(false),
    asOf: '2026-11-10',
    certificate: tampered,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'KITE_CERTIFICATE_MISMATCH');
});

test('phase 1 evaluation still returns no verdict', async () => {
  const packed = image([
    {
      text: 'The security policy forbids unmarked access.',
      source: 'policy.md',
    },
  ]);
  const result = await evaluateKite({
    image: packed.bytes,
    contract: contract(
      [
        { id: 'policy', kind: 'authority', term: 'security policy' },
        { id: 'approval', kind: 'evidence', term: 'contractor approval' },
      ],
      'Is approval recorded?'
    ),
  });
  assert.equal(result.format, 'knolo-kite-evaluation-1');
  assert.equal(Object.hasOwn(result, 'verdict'), false);
});

test('incremental review matches a full recomputation', async () => {
  const before = image([
    {
      text: 'The contractor exception allows restricted access.',
      source: 'exception.md',
    },
    { text: 'Contractor approval is recorded for A.', source: 'approval.md' },
  ]);
  const unrelated = image([
    {
      text: 'The contractor exception allows restricted access.',
      source: 'exception.md',
    },
    { text: 'Contractor approval is recorded for A.', source: 'approval.md' },
    { text: 'The office calendar lists a meeting.', source: 'calendar.md' },
  ]);
  const approved = image([
    {
      text: 'The contractor exception allows restricted access.',
      source: 'exception.md',
    },
    { text: 'Contractor approval is recorded for A.', source: 'approval.md' },
    {
      text: 'The security policy forbids contractor access.',
      source: 'policy.md',
    },
  ]);
  const input = {
    contract: contract(obligations),
    rules: rules(),
    completeness: completeness(true),
  };
  const previous = await evaluateKiteSession(
    createKiteSession({ image: before.bytes, ...input })
  );
  assert.equal(previous.verdict, 'WARRANTED_IN_SCOPE');
  const same = await evaluateKiteSession(
    createKiteSession({ image: unrelated.bytes, ...input })
  );
  const quiet = reviewKiteDelta({
    certificate: previous.certificate,
    delta: {
      format: 'knolo-kite-delta-1',
      fromStateRoot: previous.stateRoot,
      toStateRoot: same.stateRoot,
      retractedSources: [],
      insertedCollections: ['notes'],
      changedObligationIds: [],
    },
    next: same,
  });
  assert.equal(quiet.invalidated, false);
  assert.equal(quiet.same, true);
  assert.equal(quiet.verdict, same.verdict);
  const next = await evaluateKiteSession(
    createKiteSession({ image: approved.bytes, ...input })
  );
  const moved = reviewKiteDelta({
    certificate: previous.certificate,
    delta: {
      format: 'knolo-kite-delta-1',
      fromStateRoot: previous.stateRoot,
      toStateRoot: next.stateRoot,
      retractedSources: [],
      insertedCollections: [],
      changedObligationIds: ['policy'],
    },
    next,
  });
  assert.equal(moved.invalidated, true);
  assert.equal(moved.verdict, next.verdict);
  assert.equal(moved.same, true);
  assert.equal(next.verdict, 'CONFLICTED');
});

test('a new record in a negative collection invalidates a refuted absence', async () => {
  const empty = image([{ text: 'A calendar note.', source: 'calendar.md' }]);
  const filled = image([
    { text: 'A calendar note.', source: 'calendar.md' },
    { text: 'Contractor approval is recorded for A.', source: 'approval.md' },
  ]);
  const input = {
    contract: contract(obligations),
    rules: rules(),
    completeness: completeness(true),
  };
  const previous = await evaluateKiteSession(
    createKiteSession({ image: empty.bytes, ...input })
  );
  assert.equal(previous.verdict, 'REFUTED_IN_SCOPE');
  const next = await evaluateKiteSession(
    createKiteSession({ image: filled.bytes, ...input })
  );
  const review = reviewKiteDelta({
    certificate: previous.certificate,
    delta: {
      format: 'knolo-kite-delta-1',
      fromStateRoot: previous.stateRoot,
      toStateRoot: next.stateRoot,
      retractedSources: [],
      insertedCollections: ['approvals'],
      changedObligationIds: [],
    },
    next,
  });
  assert.equal(review.invalidated, true);
  assert.equal(review.verdict, next.verdict);
  assert.notEqual(next.verdict, 'REFUTED_IN_SCOPE');
});

test('bad rules and a missing semantic root fail closed', () => {
  const packed = image([
    {
      text: 'The security policy forbids contractor access.',
      source: 'policy.md',
    },
  ]);
  assert.throws(
    () =>
      createKiteSession({
        image: packed.bytes,
        contract: contract(obligations),
        rules: rules(),
        graph: { semanticRoot: 'not-a-digest' },
      }),
    (error) => error instanceof KiteError && error.code === 'KITE_GRAPH_INVALID'
  );
  assert.throws(
    () =>
      createKiteSession({
        image: packed.bytes,
        contract: contract(obligations),
        rules: { ...rules(), support: ['missing'] },
      }),
    (error) => error instanceof KiteError && error.code === 'KITE_RULES_INVALID'
  );
});

test('variant budget on a session returns no certificate', async () => {
  const packed = image([
    {
      text: 'The security policy forbids contractor access.',
      source: 'policy.md',
    },
  ]);
  const session = createKiteSession({
    image: packed.bytes,
    contract: contract(obligations),
    rules: rules(),
    changes: changes([
      { id: 'add-approval', kind: 'amend', obligationId: 'approval' },
      { id: 'drop-policy', kind: 'retract', obligationId: 'policy' },
    ]),
    bounds: { maxVariants: 1 },
  });
  const result = await evaluateKiteSession(session);
  assert.equal(result.verdict, 'BOUND_EXCEEDED');
  assert.equal(result.certificate, null);
  const verified = await verifyKiteCertificate({
    image: packed.bytes,
    contract: contract(obligations),
    rules: rules(),
    changes: changes([
      { id: 'add-approval', kind: 'amend', obligationId: 'approval' },
      { id: 'drop-policy', kind: 'retract', obligationId: 'policy' },
    ]),
    bounds: { maxVariants: 1 },
    certificate: {
      format: 'knolo-kite-certificate-1',
      verdict: 'BOUND_EXCEEDED',
    },
  });
  assert.equal(verified.ok, false);
});
