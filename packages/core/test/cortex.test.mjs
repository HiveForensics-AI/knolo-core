import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { digest } from '../dist/experimental/kar/canonicalize.js';
import { buildPack, createCortex, createKnowledgeImageV5 } from '../dist/index.js';
import {
  CortexError,
  askCortex,
  cortexAnswerRoot,
  cortexEvidenceRoot,
  cortexTraceRoot,
  createCortexDossier,
  createCortexSession,
  explainCortexAnswer,
  verifyCortexAnswer,
  verifyCortexDossier,
} from '../dist/cortex/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();

async function packBytes() {
  return buildPack([
    { id: 'alpha', text: 'Alpha inspection of the valve passed on Monday.' },
    { id: 'beta', text: 'Beta inspection of the pump failed on Tuesday.' },
  ]);
}

test('policy rejects values outside the hard caps', async () => {
  const bytes = await packBytes();
  await assert.rejects(() => createCortexSession({ image: bytes, policy: { maxRounds: 0 } }), (error) => {
    assert.equal(error instanceof CortexError, true);
    assert.equal(error.code, 'CORTEX_POLICY_INVALID');
    return true;
  });
  await assert.rejects(() => createCortexSession({ image: bytes, policy: { maxCandidatesPerRound: 201 } }), (error) => {
    assert.equal(error.code, 'CORTEX_POLICY_INVALID');
    return true;
  });
});

test('find_relevant is deterministic and createdAt is outside the roots', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({ image: bytes });
  const first = await askCortex(session, { question: 'valve inspection', mode: 'find_relevant' });
  const second = await askCortex(session, { question: '  valve   inspection ', mode: 'find_relevant', createdAt: '2026-10-14T00:00:00Z' });
  assert.equal(first.receipt.traceRoot, second.receipt.traceRoot);
  assert.equal(first.receipt.answerRoot, second.receipt.answerRoot);
  assert.equal(first.receipt.evidenceRoot, second.receipt.evidenceRoot);
  assert.equal(second.receipt.createdAt, '2026-10-14T00:00:00Z');
  assert.equal(first.answer.status, 'ANSWERED');
  assert.equal(first.answer.text, '');
  assert.equal(first.selectedEvidence.length > 0, true);
  assert.equal(first.rounds[0].queryReceipt.kind, 'v4-receipt');
  const explained = explainCortexAnswer(first);
  assert.equal(explained.question, 'valve inspection');
  assert.equal(explained.finalAnswer.status, 'ANSWERED');
});

test('evidence_answer without a model abstains', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({ image: bytes });
  const trace = await askCortex(session, { question: 'valve inspection', mode: 'evidence_answer' });
  assert.equal(trace.answer.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(trace.answer.gaps.some((gap) => gap.reason === 'model-required'), true);
  assert.equal(trace.answer.text, '');
});

test('allowAbstain false requires a model', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({ image: bytes, policy: { allowAbstain: false } });
  await assert.rejects(() => askCortex(session, { question: 'valve inspection', mode: 'evidence_answer' }), (error) => {
    assert.equal(error.code, 'CORTEX_MODEL_REQUIRED');
    return true;
  });
});

test('a model cannot cite an id that was not retrieved', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({
    image: bytes,
    model: {
      selectEvidence() {
        return { selectedIds: ['block:99'], reason: 'invented' };
      },
      synthesizeAnswer() {
        return { text: 'no', citations: [] };
      },
    },
  });
  await assert.rejects(() => askCortex(session, { question: 'valve inspection', mode: 'evidence_answer' }), (error) => {
    assert.equal(error.code, 'CORTEX_MODEL_UNBOUND');
    return true;
  });
});

test('a model answer is cited only from selected evidence', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({
    image: bytes,
    model: {
      selectEvidence({ hits }) {
        return { selectedIds: hits.slice(0, 1).map((hit) => hit.id), reason: 'top' };
      },
      synthesizeAnswer({ evidence }) {
        return {
          text: 'The valve inspection passed.',
          claims: [{ text: 'The valve inspection passed.', evidenceIds: [evidence[0].id] }],
          citations: [{ evidenceId: evidence[0].id }],
        };
      },
    },
  });
  const trace = await askCortex(session, { question: 'valve inspection', mode: 'evidence_answer' });
  assert.equal(trace.answer.status, 'ANSWERED');
  assert.equal(trace.answer.citations.length, 1);
  assert.equal(trace.answer.citations[0].evidenceId, trace.selectedEvidence[0].id);
  const verified = await verifyCortexAnswer({ image: bytes, question: trace.question, result: trace });
  assert.equal(verified.ok, true, verified.message);
});

test('compare_sources with one source stays partial', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({ image: bytes });
  const trace = await askCortex(session, { question: 'valve', mode: 'compare_sources' });
  assert.equal(trace.answer.status === 'PARTIAL' || trace.answer.status === 'INSUFFICIENT_EVIDENCE', true);
  assert.equal(trace.answer.gaps.some((gap) => gap.reason === 'need-two-sources' || gap.reason === 'model-required'), true);
});

test('tampered citation and answer body fail verification', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({
    image: bytes,
    model: {
      selectEvidence({ hits }) {
        return { selectedIds: [hits[0].id], reason: 'top' };
      },
      synthesizeAnswer({ evidence }) {
        return {
          text: 'The valve inspection passed.',
          claims: [{ text: 'The valve inspection passed.', evidenceIds: [evidence[0].id] }],
          citations: [{ evidenceId: evidence[0].id }],
        };
      },
    },
  });
  const trace = await askCortex(session, { question: 'valve inspection', mode: 'evidence_answer' });
  const cited = structuredClone(trace);
  cited.answer.citations[0].excerpt = 'tampered excerpt';
  const citation = await verifyCortexAnswer({ image: bytes, question: trace.question, result: cited });
  assert.equal(citation.ok, false);
  assert.equal(citation.code, 'CORTEX_EVIDENCE_UNBOUND');
  const body = structuredClone(trace);
  body.answer.gaps.push({ subquestion: trace.question, reason: 'tampered' });
  const roots = await verifyCortexAnswer({ image: bytes, question: trace.question, result: body });
  assert.equal(roots.ok, false);
  assert.equal(roots.code, 'CORTEX_ROOT_MISMATCH');
});

test('host retriever ids must exist on the image', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({
    image: bytes,
    retriever() {
      return { hits: [{ id: 'block:99', score: 1 }] };
    },
  });
  await assert.rejects(() => askCortex(session, { question: 'valve', mode: 'find_relevant' }), (error) => {
    assert.equal(error.code, 'CORTEX_EVIDENCE_UNBOUND');
    return true;
  });
});

test('V5 search replays resultRoot', async () => {
  const image = createKnowledgeImageV5({
    actor: 'cortex-test',
    sequence: 1,
    objects: [
      { kind: 'chunk', bytes: encoder.encode('The valve inspection passed.'), meta: { source: 'a.txt' } },
      { kind: 'chunk', bytes: encoder.encode('The pump was replaced.'), meta: { source: 'b.txt' } },
    ],
  });
  const session = await createCortexSession({ image: image.bytes });
  const trace = await askCortex(session, { question: 'valve', mode: 'find_relevant' });
  assert.equal(trace.image.kind, 'v5-image');
  assert.equal(trace.rounds[0].queryReceipt.kind, 'v5-result');
  assert.equal(trace.selectedEvidence.length > 0, true);
  const verified = await verifyCortexAnswer({ image: image.bytes, question: trace.question, result: trace });
  assert.equal(verified.ok, true, verified.message);
});

test('prove_or_abstain cites KAR and does not call a gap false', async () => {
  const dir = path.resolve(here, '../../../examples/kar-v6/contracts');
  const image = readFileSync(path.join(dir, 'knowledge.knolo'));
  const graph = JSON.parse(readFileSync(path.join(dir, 'knowledge.kar.json'), 'utf8'));
  const plan = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf8'));
  const session = await createCortexSession({ image, graph, plan });
  const trace = await askCortex(session, { question: 'What evidence bears on customer cancellation?', mode: 'prove_or_abstain' });
  assert.equal(trace.karEvaluations?.length, 1);
  assert.equal(trace.karEvaluations[0].status, 'SATISFIED');
  assert.equal(trace.answer.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(trace.answer.text.includes('false'), false);
  assert.equal(trace.answer.gaps.some((gap) => gap.reason === 'model-required'), true);
  const verified = await verifyCortexAnswer({
    image,
    graph,
    question: trace.question,
    result: trace,
  });
  assert.equal(verified.ok, true, verified.message);

  const operations = path.resolve(here, '../../../examples/kar-v6/operations');
  const gapSession = await createCortexSession({
    image: readFileSync(path.join(operations, 'knowledge.knolo')),
    graph: JSON.parse(readFileSync(path.join(operations, 'knowledge.kar.json'), 'utf8')),
    plan: JSON.parse(readFileSync(path.join(operations, 'gap/plan.json'), 'utf8')),
  });
  const missed = await askCortex(gapSession, { question: 'What evidence shows the missing permit?', mode: 'prove_or_abstain' });
  assert.equal(missed.karEvaluations[0].status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  assert.equal(missed.answer.gaps.some((gap) => gap.reason === 'UNSATISFIED_EVIDENCE_REQUIREMENTS'), true);
  assert.equal(JSON.stringify(missed.answer).includes('false'), false);
  const coverage = await askCortex(gapSession, { question: 'What evidence shows the missing permit?', mode: 'coverage_review' });
  assert.equal(coverage.answer.status === 'PARTIAL' || coverage.answer.status === 'INSUFFICIENT_EVIDENCE', true);
  assert.equal(coverage.answer.gaps.some((gap) => gap.reason === 'UNSATISFIED_EVIDENCE_REQUIREMENTS'), true);
  assert.equal(coverage.answer.text, '');
});

test('verification rejects evidence that no replayed round selected', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({ image: bytes });
  const valve = await askCortex(session, { question: 'valve', mode: 'find_relevant' });
  const pump = await askCortex(session, { question: 'pump', mode: 'find_relevant' });
  const extra = pump.selectedEvidence.find((item) => !valve.selectedEvidence.some((kept) => kept.id === item.id));
  assert.ok(extra);
  const forged = resealTrace({ ...structuredClone(valve), selectedEvidence: [...valve.selectedEvidence, extra] });
  const unbound = await verifyCortexAnswer({ image: bytes, question: forged.question, result: forged });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.code, 'CORTEX_EVIDENCE_UNBOUND');

  const relabeled = structuredClone(valve);
  relabeled.selectedEvidence[0].source = 'forged.txt';
  const source = await verifyCortexAnswer({ image: bytes, question: relabeled.question, result: resealTrace(relabeled) });
  assert.equal(source.ok, false);
  assert.equal(source.code, 'CORTEX_EVIDENCE_UNBOUND');
});

test('planned subquestions continue after a round adds no evidence', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({
    image: bytes,
    model: {
      planQuestion() {
        return { subquestions: ['zebra habitat', 'valve inspection', 'pump failed'] };
      },
      refineQuery() {
        return { query: 'zzzz absent token' };
      },
    },
  });
  const trace = await askCortex(session, { question: 'cover the inspections', mode: 'coverage_review' });
  assert.deepEqual(trace.rounds.map((round) => round.query), ['zebra habitat', 'valve inspection', 'pump failed']);
  assert.equal(trace.rounds[0].lexicalHitIds.length, 0);
  assert.equal(trace.rounds[1].lexicalHitIds.length > 0, true);
  assert.equal(trace.rounds[2].lexicalHitIds.length > 0, true);
  assert.equal(trace.answer.gaps.some((gap) => gap.reason === 'no-evidence'), true);
  assert.equal(trace.answer.text, '');

  const answered = await askCortex(session, { question: 'cover the inspections', mode: 'evidence_answer' });
  assert.deepEqual(answered.rounds.map((round) => round.query), ['zebra habitat', 'valve inspection', 'zzzz absent token', 'pump failed']);
  assert.equal(answered.rounds[3].lexicalHitIds.length > 0, true);
});

test('dossier roots fail closed when the body changes', async () => {
  const bytes = await packBytes();
  const session = await createCortexSession({ image: bytes });
  const trace = await askCortex(session, { question: 'valve inspection', mode: 'find_relevant' });
  const dossier = createCortexDossier(trace);
  assert.equal(dossier.verified, true);
  assert.equal(verifyCortexDossier(dossier, trace).ok, true);
  const tampered = structuredClone(dossier);
  tampered.answer.text = 'changed';
  assert.equal(verifyCortexDossier(tampered, trace).ok, false);
  const forged = structuredClone(dossier);
  forged.answer = { ...forged.answer, text: 'The claim is proven.' };
  forged.question = 'A different question';
  const { dossierRoot: _ignored, ...body } = forged;
  forged.dossierRoot = digest(body);
  const resealed = verifyCortexDossier(forged, trace);
  assert.equal(resealed.ok, false);
  assert.equal(resealed.code, 'CORTEX_ROOT_MISMATCH');
});

function resealTrace(trace) {
  const answerRoot = cortexAnswerRoot(trace.answer);
  const evidenceRoot = cortexEvidenceRoot(trace.selectedEvidence);
  const traceRoot = cortexTraceRoot({
    questionDigest: trace.questionDigest,
    image: trace.image,
    policy: trace.policy,
    rounds: trace.rounds,
    selectedIds: trace.selectedEvidence.map((item) => item.id),
    karEvaluations: trace.karEvaluations,
    karPlan: trace.karPlan,
    answerRoot,
    evidenceRoot,
  });
  return { ...trace, receipt: { ...trace.receipt, traceRoot, answerRoot, evidenceRoot } };
}

test('root export keeps memory createCortex and does not load Knolo Cortex', () => {
  assert.equal(typeof createCortex, 'function');
  const bundle = readFileSync(path.resolve(here, '../dist/index.js'), 'utf8');
  assert.equal(bundle.includes('createCortexSession'), false);
  assert.equal(bundle.includes('knolo-cortex-trace-1'), false);
  const schema = JSON.parse(readFileSync(path.resolve(here, '../dist/schemas/cortex/cortex-trace-v1.schema.json'), 'utf8'));
  assert.equal(schema.properties.format.const, 'knolo-cortex-trace-1');
});
