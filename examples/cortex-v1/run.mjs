/**
 * Cortex product demo.
 *
 * Shows find_relevant, model-less abstention, and verifyCortexAnswer on a
 * real vs tampered trace. Verification is an integrity check. It does not
 * mean a claim is proven.
 *
 *   npm run build --workspace @knolo/core
 *   node examples/cortex-v1/run.mjs
 */
import assert from 'node:assert/strict';
import { buildPack } from '../../packages/core/dist/index.js';
import {
  askCortex,
  createCortexSession,
  verifyCortexAnswer,
} from '../../packages/core/dist/cortex/index.js';

const pack = await buildPack([
  { id: 'alpha', text: 'Alpha inspection of the valve passed on Monday.' },
  { id: 'beta', text: 'Beta inspection of the pump failed on Tuesday.' },
]);

const session = await createCortexSession({
  image: pack,
  policy: { maxRounds: 2, allowAbstain: true },
});

const found = await askCortex(session, {
  question: 'valve inspection',
  mode: 'find_relevant',
});
const abstained = await askCortex(session, {
  question: 'valve inspection',
  mode: 'evidence_answer',
});

const replay = await verifyCortexAnswer({
  image: pack,
  question: found.question,
  result: found,
});

const tampered = structuredClone(found);
tampered.answer.gaps.push({ subquestion: found.question, reason: 'tampered' });
const tamper = await verifyCortexAnswer({
  image: pack,
  question: found.question,
  result: tampered,
});

assert.equal(found.answer.status, 'ANSWERED');
assert.equal(found.answer.text, '');
assert.ok(found.selectedEvidence.length >= 1);
assert.equal(abstained.answer.status, 'INSUFFICIENT_EVIDENCE');
assert.ok(abstained.answer.gaps.some((gap) => gap.reason === 'model-required'));
assert.equal(replay.ok, true);
assert.equal(tamper.ok, false);
assert.equal(JSON.stringify(found.answer).includes('proven'), false);

console.log('cortex-v1 example ok');
console.log(
  JSON.stringify(
    {
      find_relevant: {
        status: found.answer.status,
        hitCount: found.selectedEvidence.length,
        prose: found.answer.text,
        verifiedOk: replay.ok,
      },
      evidence_answer_no_model: {
        status: abstained.answer.status,
        gaps: abstained.answer.gaps.map((gap) => gap.reason),
      },
      tampered_trace: {
        verifiedOk: tamper.ok,
        code: tamper.code,
      },
      note: 'verified.ok means the trace matches the image. It does not mean the claim is proven.',
    },
    null,
    2,
  ),
);
