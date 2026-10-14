/**
 * Public Cortex vectors.
 *
 * Small redistributable packs. They do not edit KAR v1, coverage v1, or
 * composition v1. Lock roots and statuses. Do not lock evidence text.
 *
 *   node conformance/cortex/v1/run.mjs
 *   CORTEX_V1_ACCEPT=1 node conformance/cortex/v1/run.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack, createKnowledgeImageV5 } from '../../../packages/core/dist/index.js';
import { askCortex, createCortexSession, verifyCortexAnswer } from '../../../packages/core/dist/cortex/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const expectedPath = path.join(here, 'expected.json');
const encoder = new TextEncoder();

const pack = await buildPack([
  { id: 'alpha', text: 'Alpha inspection of the valve passed on Monday.' },
  { id: 'beta', text: 'Beta inspection of the pump failed on Tuesday.' },
]);
const v5 = createKnowledgeImageV5({
  actor: 'cortex-conformance',
  sequence: 1,
  objects: [
    { kind: 'chunk', bytes: encoder.encode('The valve inspection passed.'), meta: { source: 'a.txt' } },
    { kind: 'chunk', bytes: encoder.encode('The pump was replaced.'), meta: { source: 'b.txt' } },
  ],
});

const v4Session = await createCortexSession({ image: pack });
const found = await askCortex(v4Session, { question: 'valve inspection', mode: 'find_relevant' });
const abstained = await askCortex(v4Session, { question: 'valve inspection', mode: 'evidence_answer' });
const v5Session = await createCortexSession({ image: v5.bytes });
const v5Found = await askCortex(v5Session, { question: 'valve', mode: 'find_relevant' });

const tampered = structuredClone(found);
tampered.answer.gaps.push({ subquestion: found.question, reason: 'tampered' });
const tamper = await verifyCortexAnswer({ image: pack, question: found.question, result: tampered });
const replay = await verifyCortexAnswer({ image: pack, question: found.question, result: found });
const v5Replay = await verifyCortexAnswer({ image: v5.bytes, question: v5Found.question, result: v5Found });

const actual = {
  v4Find: {
    status: found.answer.status,
    hitCount: found.selectedEvidence.length,
    receiptKind: found.rounds[0].queryReceipt.kind,
    traceRoot: found.receipt.traceRoot,
    answerRoot: found.receipt.answerRoot,
    evidenceRoot: found.receipt.evidenceRoot,
  },
  v4Abstain: {
    status: abstained.answer.status,
    gap: 'model-required',
    traceRoot: abstained.receipt.traceRoot,
  },
  v5Find: {
    status: v5Found.answer.status,
    receiptKind: v5Found.rounds[0].queryReceipt.kind,
    traceRoot: v5Found.receipt.traceRoot,
    answerRoot: v5Found.receipt.answerRoot,
    evidenceRoot: v5Found.receipt.evidenceRoot,
  },
  tamperCode: tamper.code,
};

assert.equal(replay.ok, true);
assert.equal(v5Replay.ok, true);
assert.equal(tamper.ok, false);
assert.equal(abstained.answer.gaps.some((gap) => gap.reason === 'model-required'), true);
assert.equal(found.answer.text, '');
assert.equal(JSON.stringify(found.answer).includes('proven'), false);

if (process.env.CORTEX_V1_ACCEPT === '1') {
  writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Wrote ${expectedPath}`);
} else {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  assert.deepEqual(actual, expected);
  console.log('cortex v1 conformance matched the locked roots.');
}
