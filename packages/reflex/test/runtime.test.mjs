import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('validates required output fields', () => {
  assert.deepEqual(
    validateReflexOutputV1({ answer: 'ok' }, { requiredFields: ['answer'] }),
    { valid: true, errors: [] }
  );
  assert.equal(
    validateReflexOutputV1({}, { requiredFields: ['answer'] }).valid,
    false
  );
});
