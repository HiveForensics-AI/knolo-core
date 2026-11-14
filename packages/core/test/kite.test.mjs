import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createKnowledgeImageV5 } from '../dist/index.js';
import { KiteError, evaluateKite, namedRetrieval } from '../dist/kite/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function imageWithPolicy() {
  return createKnowledgeImageV5({
    actor: 'kite-test',
    sequence: 1,
    objects: [
      {
        kind: 'chunk',
        bytes: Buffer.from('The security policy forbids unmarked access.\n'),
        meta: { source: 'policy.md' },
      },
    ],
  });
}

function contract() {
  return {
    format: 'knolo-kite-contract-1',
    question: 'Is approval recorded?',
    obligations: [
      { id: 'policy', kind: 'authority', term: 'security policy' },
      { id: 'approval', kind: 'evidence', term: 'contractor approval' },
    ],
  };
}

test('root export does not load KITE', () => {
  const bundle = readFileSync(path.resolve(here, '../dist/index.js'), 'utf8');
  const source = readFileSync(path.resolve(here, '../src/index.ts'), 'utf8');
  assert.equal(bundle.includes('evaluateKite'), false);
  assert.equal(bundle.includes('knolo-kite-contract-1'), false);
  assert.equal(source.includes('evaluateKite'), false);
});

test('an unmet obligation is named on its retrieval', async () => {
  const image = imageWithPolicy();
  const first = await evaluateKite({
    image: image.bytes,
    contract: contract(),
  });
  const second = await evaluateKite({
    image: image.bytes,
    contract: contract(),
  });
  assert.deepEqual(second, first);
  assert.equal(first.stateRoot, image.stateRoot);
  assert.deepEqual(
    first.met.map((item) => item.id),
    ['policy']
  );
  assert.deepEqual(
    first.unmet.map((item) => item.id),
    ['approval']
  );
  assert.equal(first.retrievals.length, 1);
  assert.equal(first.retrievals[0].obligationId, 'approval');
  assert.equal(first.retrievals[0].query, 'contractor approval');
  assert.deepEqual(first.retrievals[0].hitIds, []);
  assert.equal(first.bounds.variantsChecked, 0);
  assert.equal(first.bounds.counterfactualChanges, 0);
  assert.equal(first.met[0].hitIds.length > 0, true);
});

test('a retrieval without an obligation name fails', () => {
  assert.throws(
    () => namedRetrieval('', 'contractor approval', 'contractor approval', []),
    (error) => {
      assert.equal(error instanceof KiteError, true);
      assert.equal(error.code, 'KITE_OBLIGATION_UNBOUND');
      return true;
    }
  );
});

test('too many obligations exceed the retrieval bound', async () => {
  const image = imageWithPolicy();
  await assert.rejects(
    () =>
      evaluateKite({
        image: image.bytes,
        contract: contract(),
        bounds: { maxRetrievals: 1 },
      }),
    (error) => {
      assert.equal(error instanceof KiteError, true);
      assert.equal(error.code, 'BOUND_EXCEEDED');
      return true;
    }
  );
});
