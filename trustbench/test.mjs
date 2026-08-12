import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountPack } from '../packages/core/dist/index.js';
import { evaluatePack, loadQueries } from './evaluator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = JSON.parse(await readFile(path.join(root, 'conformance/expected/retrieval-v4.0.json'), 'utf8'));
const actual = await evaluatePack(await readFile(path.join(root, 'conformance/packs/verified-v4.knolo')), await loadQueries(path.join(root, 'conformance/queries/retrieval.jsonl')));
const expectedContract = { ...expected }; delete expectedContract.runtime;
assert.deepEqual(actual, expectedContract, 'conformance output changed; regenerate expected output intentionally');

for (const name of ['truncated.knolo', 'section-digest.knolo']) {
  await assert.rejects(async () => mountPack({ src: await readFile(path.join(root, 'conformance/packs/corrupted', name)) }), /invalid|mismatch|truncated/i, `${name} must fail closed`);
}
console.log('TrustBench conformance passed.');
