/**
 * KITE conformance vectors.
 *
 *   node conformance/kite/v1/run.mjs
 *   KITE_V1_ACCEPT=1 node conformance/kite/v1/run.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../../../packages/core/dist/index.js';
import {
  createKiteSession,
  evaluateKiteSession,
  verifyKiteCertificate,
} from '../../../packages/core/dist/kite/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const expectedPath = path.join(here, 'expected.json');
const contract = {
  format: 'knolo-kite-contract-1',
  question: 'Can contractor A access production?',
  obligations: [
    { id: 'policy', kind: 'authority', term: 'security policy' },
    { id: 'exception', kind: 'qualification', term: 'contractor exception' },
    { id: 'approval', kind: 'evidence', term: 'contractor approval' },
  ],
};
const rules = {
  format: 'knolo-kite-rules-1',
  proposition: 'contractor access',
  support: ['exception'],
  oppose: ['policy'],
  require: ['approval'],
  conflicts: [{ left: 'exception', right: 'policy' }],
  completeness: [
    { id: 'register', collection: 'approvals', obligationId: 'approval' },
  ],
};
const signed = {
  format: 'knolo-kite-completeness-1',
  declarations: [{ id: 'register', collection: 'approvals', signed: true }],
};
const unsigned = { format: 'knolo-kite-completeness-1', declarations: [] };

function image(chunks) {
  return createKnowledgeImageV5({
    actor: 'kite-conformance',
    sequence: 1,
    objects: chunks.map((chunk) => ({
      kind: 'chunk',
      bytes: Buffer.from(`${chunk.text}\n`),
      meta: { source: chunk.source },
    })),
  });
}

async function runCase(id, chunks, completeness, extra = {}) {
  const packed = image(chunks);
  const session = createKiteSession({
    image: packed.bytes,
    contract,
    rules,
    completeness,
    ...(extra.changes ? { changes: extra.changes } : {}),
    ...(extra.bounds ? { bounds: extra.bounds } : {}),
  });
  const result = await evaluateKiteSession(session, { asOf: '2026-11-10' });
  const again = await evaluateKiteSession(session, { asOf: '2026-11-10' });
  assert.deepEqual(again, result, `${id} was not reproducible`);
  if (result.certificate) {
    const verified = await verifyKiteCertificate({
      image: packed.bytes,
      contract,
      rules,
      completeness,
      ...(extra.changes ? { changes: extra.changes } : {}),
      ...(extra.bounds ? { bounds: extra.bounds } : {}),
      asOf: '2026-11-10',
      certificate: result.certificate,
    });
    assert.equal(verified.ok, true, id);
    const tampered = { ...result.certificate, verdict: 'WARRANTED_IN_SCOPE' };
    if (result.verdict !== 'WARRANTED_IN_SCOPE') {
      const rejected = await verifyKiteCertificate({
        image: packed.bytes,
        contract,
        rules,
        completeness,
        asOf: '2026-11-10',
        certificate: tampered,
      });
      assert.equal(rejected.ok, false, id);
    }
  }
  return {
    id,
    verdict: result.verdict,
    invarianceRoot: result.certificate
      ? result.certificate.invarianceRoot
      : null,
    unmet: result.unmet.map((item) => item.id),
  };
}

const policy = {
  text: 'The security policy forbids contractor access.',
  source: 'policy.md',
};
const exception = {
  text: 'The contractor exception allows restricted access.',
  source: 'exception.md',
};
const approval = {
  text: 'Contractor approval is recorded for A.',
  source: 'approval.md',
};

const actual = {
  format: 'kite-conformance-v1',
  cases: [
    await runCase('undetermined', [policy, exception], unsigned),
    await runCase('explicit-refute', [policy], unsigned),
    await runCase('warranted', [exception, approval], signed),
    await runCase('conflict', [policy, exception, approval], signed),
    await runCase('bound', [policy], unsigned, {
      changes: {
        format: 'knolo-kite-changes-1',
        changes: [
          { id: 'add-approval', kind: 'amend', obligationId: 'approval' },
          { id: 'drop-policy', kind: 'retract', obligationId: 'policy' },
        ],
      },
      bounds: { maxVariants: 1 },
    }),
  ],
};

assert.equal(actual.cases[0].verdict, 'UNDERDETERMINED');
assert.deepEqual(actual.cases[0].unmet, ['approval']);
assert.equal(actual.cases[1].verdict, 'REFUTED_IN_SCOPE');
assert.equal(actual.cases[2].verdict, 'WARRANTED_IN_SCOPE');
assert.equal(actual.cases[3].verdict, 'CONFLICTED');
assert.equal(actual.cases[4].verdict, 'BOUND_EXCEEDED');
assert.equal(actual.cases[4].invarianceRoot, null);
assert.equal(
  actual.cases.filter((item) => item.verdict === 'WARRANTED_IN_SCOPE').length,
  1
);

if (process.env.KITE_V1_ACCEPT === '1') {
  writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Wrote ${expectedPath}`);
} else {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  assert.deepEqual(actual, expected);
  console.log('KITE conformance vectors match.');
}
