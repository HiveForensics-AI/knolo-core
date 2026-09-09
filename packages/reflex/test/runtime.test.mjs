import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReflexMRSFrontierV1,
  openReflexSessionV1,
  selectReflexContextV1,
  validateReflexOutputV1,
  verifyReflexSelectionReceiptV1,
} from '../dist/index.js';
import { buildReflexImageV1 } from '../dist/index.js';
import { canonicalCbor, digestDomain } from '@knolo/core';

test('retrieves a declared bundle and creates a replayable receipt', async () => {
  const base = {
    namespace: 'support',
    atoms: [
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'procedure',
        key: 'support.account-recovery',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { steps: ['Identify the account provider.'] },
      },
    ],
    bundles: [],
  };
  const atom = base.atoms[0];
  const atomMeta = {
    reflex_namespace: 'support',
    reflex_role: 'atom',
    reflex_schema: 'knolo.reflex.atom/v1',
    reflex_type: 'procedure',
  };
  const atomId = digestDomain(
    'object',
    canonicalCbor({
      kind: 'metadata',
      bytes: canonicalCbor(atom),
      meta: atomMeta,
    })
  );
  const built = buildReflexImageV1({
    ...base,
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.account-recovery.default',
        namespace: 'support',
        atomIds: [atomId],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
  });
  const selection = selectReflexContextV1(session, 'account recovery provider');
  assert.equal(selection.disposition, 'ready');
  assert.equal(selection.selectedAtomIds.length, 1);
  verifyReflexSelectionReceiptV1(
    session,
    selection.receipt,
    'account recovery provider'
  );
  verifyReflexSelectionReceiptV1(
    selection.receipt,
    'account recovery provider',
    selection.context
  );
});

test('returns a typed result when no projection matches', async () => {
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [],
    bundles: [],
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
  });
  const selection = selectReflexContextV1(session, 'unrelated question');
  assert.equal(selection.disposition, 'no_applicable_bundle');
  assert.equal(selection.context, '');
});

test('activates a bundle from trigger atoms and closes over required atoms', async () => {
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'intent',
        key: 'support.account-recovery',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { phrases: ['account recovery'] },
      },
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'constraint',
        key: 'support.verify-ownership',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { must: ['verify ownership'] },
      },
    ],
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.account-recovery.default',
        namespace: 'support',
        requiredAtomKeys: [
          'support.account-recovery',
          'support.verify-ownership',
        ],
        triggerAtomKeys: ['support.account-recovery'],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
    topK: 1,
  });
  const selection = selectReflexContextV1(session, 'account recovery');
  assert.equal(selection.disposition, 'ready');
  assert.equal(selection.selectedAtomIds.length, 2);
  assert.match(selection.context, /verify-ownership/);
});

test('commits delivered and attempted contexts separately when over budget', async () => {
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'procedure',
        key: 'support.long-procedure',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { steps: ['one', 'two', 'three'] },
      },
    ],
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.long.default',
        namespace: 'support',
        atomKeys: ['support.long-procedure'],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
    maxInputTokens: 1,
  });
  const selection = selectReflexContextV1(session, 'long procedure');
  assert.equal(selection.disposition, 'budget_exceeded');
  assert.deepEqual(selection.selectedAtomIds, []);
  assert.equal(selection.receipt.selectedAtomIds.length, 0);
  assert.equal(selection.receipt.attemptedAtomIds.length, 1);
  assert.notEqual(
    selection.receipt.attemptedContextDigest,
    selection.receipt.renderedContextDigest
  );
  verifyReflexSelectionReceiptV1(session, selection.receipt, 'long procedure');
});

test('fails closed when selected atoms conflict through logical keys', async () => {
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'intent',
        key: 'support.safe-recovery',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: ['support.unsafe-recovery'],
        sourceIds: [],
        body: { phrase: 'recovery' },
      },
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'rule',
        key: 'support.unsafe-recovery',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { mustNot: ['skip verification'] },
      },
    ],
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.conflicting.default',
        namespace: 'support',
        requiredAtomKeys: ['support.safe-recovery', 'support.unsafe-recovery'],
        triggerAtomKeys: ['support.safe-recovery'],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
  });
  assert.equal(
    selectReflexContextV1(session, 'recovery').disposition,
    'conflict_detected'
  );
});

test('validates required output fields', () => {
  assert.deepEqual(
    validateReflexOutputV1({ answer: 'ok' }, { requiredFields: ['answer'] }),
    { valid: true, errors: [] }
  );
  assert.equal(
    validateReflexOutputV1({}, { requiredFields: ['answer'] }).valid,
    false
  );
  assert.equal(
    validateReflexOutputV1(
      { answer: 'ok' },
      {
        schema: {
          type: 'object',
          required: ['answer'],
          properties: { answer: { type: 'string' } },
          additionalProperties: false,
        },
      }
    ).valid,
    true
  );
  assert.equal(
    validateReflexOutputV1(
      { answer: 42, extra: true },
      {
        schema: {
          type: 'object',
          required: ['answer'],
          properties: { answer: { type: 'string' } },
          additionalProperties: false,
        },
      }
    ).valid,
    false
  );
});

test('integrates the finite MRS optimizer into runtime selection', async () => {
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms: [
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'intent',
        key: 'support.recovery',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { phrase: 'recovery' },
      },
      {
        schema: 'knolo.reflex.atom/v1',
        type: 'fact',
        key: 'support.extra',
        scope: { namespace: 'support' },
        requires: [],
        conflicts: [],
        sourceIds: [],
        body: { detail: 'optional' },
      },
    ],
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.recovery.default',
        namespace: 'support',
        requiredAtomKeys: ['support.recovery'],
        triggerAtomKeys: ['support.recovery'],
        optionalAtomKeys: ['support.extra'],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
    mrs: {
      successThreshold: 0.7,
      contributionByAtomKey: { 'support.recovery': 1, 'support.extra': 0 },
    },
  });
  const selection = selectReflexContextV1(session, 'recovery');
  assert.equal(selection.disposition, 'ready');
  assert.equal(selection.selectedAtomIds.length, 1);
  assert.match(selection.context, /support\.recovery/);
  assert.doesNotMatch(selection.context, /support\.extra/);
});

test('uses a verified offline MRS frontier in the fast runtime path', async () => {
  const atoms = [
    {
      schema: 'knolo.reflex.atom/v1',
      type: 'intent',
      key: 'support.recovery',
      scope: { namespace: 'support' },
      requires: [],
      conflicts: [],
      sourceIds: [],
      body: { phrase: 'recovery' },
    },
    {
      schema: 'knolo.reflex.atom/v1',
      type: 'fact',
      key: 'support.extra',
      scope: { namespace: 'support' },
      requires: [],
      conflicts: [],
      sourceIds: [],
      body: { detail: 'optional' },
    },
  ];
  const atomIds = atoms.map((atom) =>
    digestDomain(
      'object',
      canonicalCbor({
        kind: 'metadata',
        bytes: canonicalCbor(atom),
        meta: {
          reflex_namespace: 'support',
          reflex_role: 'atom',
          reflex_schema: 'knolo.reflex.atom/v1',
          reflex_type: atom.type,
        },
      })
    )
  );
  const built = buildReflexImageV1({
    namespace: 'support',
    atoms,
    bundles: [
      {
        schema: 'knolo.reflex.bundle/v1',
        key: 'support.recovery.default',
        namespace: 'support',
        requiredAtomKeys: ['support.recovery'],
        triggerAtomKeys: ['support.recovery'],
        optionalAtomKeys: ['support.extra'],
        outputSchema: { type: 'object' },
        renderer: 'reflex-renderer-v1',
      },
    ],
  });
  const mrs = {
    successThreshold: 0.7,
    contributionByAtomKey: { 'support.recovery': 1, 'support.extra': 0 },
  };
  const frontier = buildReflexMRSFrontierV1({
    atoms: atomIds.map((id, index) => ({
      id,
      tokenCost: 1,
      contribution: index === 0 ? 1 : 0,
    })),
    requiredAtomIds: [atomIds[0]],
    intercept: 0,
    successThreshold: mrs.successThreshold,
    maxTokenCost: 512,
    maxSearchAtoms: 20,
  });
  const session = await openReflexSessionV1(built.image.bytes, {
    namespace: 'support',
    countTokens: () => 1,
    mrs,
    mrsFrontier: frontier,
  });
  const selection = selectReflexContextV1(session, 'recovery');
  assert.equal(selection.disposition, 'ready');
  assert.deepEqual(selection.selectedAtomIds, [atomIds[0]]);
  assert.equal(selection.receipt.mrsFrontierDigest, frontier.frontierDigest);
  assert.ok(selection.receipt.mrsFrontierEntryDigest);
  verifyReflexSelectionReceiptV1(session, selection.receipt, 'recovery');
});
