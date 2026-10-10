import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { anchorRoot, resolveAnchor } from '../../dist/anchor.js';
import { canonicalize } from '../../dist/index.js';
import { explainKarResult } from '../explain.mjs';
import { fixtureRoot, frontierIds, runScenarioCase, selectedIds, writeFixtures } from '../materialize.mjs';
import { SCENARIOS } from '../scenarios.mjs';
import { verifyKnoloKar } from '../verify.mjs';
import { mountKnowledgeImageV5 } from '../../../../packages/core/dist/index.js';

const ROOTS = ['knowledgeRoot', 'semanticRoot', 'queryRoot', 'planRoot', 'anchorRoot', 'frontierRoot', 'frontierWitnessRoot', 'evidenceSetRoot', 'decisionRoot', 'karRoot'];

function claimOf(envelope) {
  return {
    kar: envelope.kar,
    image: { stateRoot: envelope.image.stateRoot },
    evidence: envelope.evidence,
    frontiers: envelope.frontiers,
  };
}

test('five V5 images preserve frontier identity, roots, and abstention', () => {
  const written = writeFixtures();
  const byName = new Map(written.map((row) => [row.caseSpec.name, row]));
  assert.equal(SCENARIOS.length, 5);
  assert.ok(written.length >= 12);

  for (const row of written) {
    const expectedIds = selectedIds(row.built, row.caseSpec.selection);
    const expectedFrontiers = frontierIds(row.built, row.caseSpec.frontiers);
    assert.equal(row.envelope.status, row.caseSpec.status, row.caseSpec.name);
    assert.equal(row.envelope.kar.status, row.caseSpec.status, row.caseSpec.name);
    assert.deepEqual(row.envelope.kar.evidenceIds, expectedIds, row.caseSpec.name);
    assert.deepEqual(row.envelope.frontiers, expectedFrontiers, row.caseSpec.name);
    assert.deepEqual(row.envelope.kar.frontiers, expectedFrontiers, row.caseSpec.name);
    assert.equal(row.envelope.hits, undefined);
    assert.equal(row.envelope.kar.hits, undefined);
    assert.equal(row.envelope.image.stateRoot, row.built.image.stateRoot);
    assert.equal(row.built.sidecar.stateRoot, row.built.image.stateRoot);
    assert.equal(row.built.graph.knowledgeRoot, row.built.projection.knowledgeRoot);
    assert.notEqual(row.built.sidecar.stateRoot, row.built.graph.knowledgeRoot);
    assert.equal(row.envelope.kar.roots.knowledgeRoot, row.built.projection.knowledgeRoot);
    for (const name of ROOTS) assert.match(row.envelope.kar.roots[name], /^sha256-[0-9a-f]{64}$/, name);
    for (const object of row.built.byLabel.values()) {
      assert.match(object.id, /^sha256-[0-9a-f]{64}$/);
      assert.notEqual(object.id, object.meta.label);
    }
    const mounted = mountKnowledgeImageV5(fs.readFileSync(path.join(fixtureRoot, row.built.spec.id, 'knowledge.knolo')));
    assert.equal(mounted.stateRoot, row.built.image.stateRoot);
    const verdict = verifyKnoloKar({
      imageBytes: row.built.image.bytes,
      sidecar: row.built.sidecar,
      query: row.built.spec.query,
      plan: row.plan,
      claimed: claimOf(row.envelope),
    });
    assert.equal(verdict.ok, true, `${row.caseSpec.name} ${verdict.reason}`);
    const container = Buffer.from(row.built.image.bytes);
    assert.equal(container.includes(Buffer.from('kar-sidecar:')), false);
    assert.equal(JSON.stringify(row.envelope.kar).includes(row.built.spec.documents[0].text), false);
  }

  const room = byName.get('support-opposition');
  const suite = byName.get('supplied-suite');
  const missed = byName.get('recompute-misses-room');
  assert.notEqual(room.envelope.kar.roots.anchorRoot, suite.envelope.kar.roots.anchorRoot);
  assert.deepEqual(room.envelope.kar.evidenceIds, suite.envelope.kar.evidenceIds);
  assert.notEqual(room.envelope.kar.roots.anchorRoot, missed.envelope.kar.roots.anchorRoot);
  assert.deepEqual(missed.envelope.kar.evidenceIds, []);
  assert.equal(room.envelope.anchor.mode, 'supplied');
  assert.equal(room.envelope.anchor.witness[0].nodeId, 'lodging');
  assert.equal(room.envelope.anchor.witness[0].queryTerm, 'room');
  const nodeIds = new Set(room.built.graph.nodes.map((node) => node.id));
  const resolved = resolveAnchor(room.built.spec.query, nodeIds, room.plan.anchor);
  assert.equal(anchorRoot(resolved.commitment), room.envelope.kar.roots.anchorRoot);
  assert.equal(resolved.commitment.witness[0].queryTerm, 'room');
  assert.equal(room.built.spec.query.includes('lodging'), false);

  const explained = explainKarResult(room.envelope, { query: room.built.spec.query, plan: room.plan, graph: room.built.graph });
  assert.equal(explained.lines.some((line) => line.startsWith('grounding supplied lodging:room')), true);
  for (const label of ['general-policy', 'enterprise-clause']) {
    const id = room.built.byLabel.get(label).id;
    const row = explained.evidence.find((item) => item.evidenceId === id);
    assert.equal(row.selected, true);
    assert.equal(row.anchorId, 'lodging');
    assert.equal(row.applicable, true);
    assert.ok(row.relations.length > 0);
  }
  assert.ok(explained.evidence.some((item) => item.requirements.some((hit) => hit.requirement === 'cancel-allowed' && hit.frontier === 'F_S')));
  assert.ok(explained.evidence.some((item) => item.requirements.some((hit) => hit.requirement === 'commitment-bars-cancel' && hit.frontier === 'F_O')));

  const qualifier = byName.get('support-opposition-qualifier');
  assert.equal(qualifier.envelope.kar.evidenceIds.length, 3);
  assert.equal(qualifier.envelope.kar.decision.cardinality, 3);
  assert.deepEqual(qualifier.envelope.kar.frontiers.F_Q.length, 1);

  const dates = ['temporal-2023-06-15', 'temporal-2024-01-01', 'temporal-2026-10-10', 'temporal-2027-03-01'];
  const chosen = dates.map((name) => byName.get(name).envelope.kar.evidenceIds);
  assert.notDeepEqual(chosen[0], chosen[1]);
  assert.deepEqual(chosen[1], chosen[2]);
  assert.notDeepEqual(chosen[2], chosen[3]);
  assert.notEqual(byName.get(dates[1]).envelope.kar.roots.planRoot, byName.get(dates[2]).envelope.kar.roots.planRoot);

  const anyAuthority = byName.get('authority-any');
  const midAuthority = byName.get('authority-50');
  const highAuthority = byName.get('authority-100');
  assert.deepEqual(midAuthority.envelope.kar.evidenceIds, [midAuthority.built.byLabel.get('statute').id]);
  assert.deepEqual(highAuthority.envelope.kar.evidenceIds, []);
  assert.equal(highAuthority.envelope.status, 'UNSATISFIED_EVIDENCE_REQUIREMENTS');
  const memoAtAny = explainKarResult(anyAuthority.envelope, { query: anyAuthority.built.spec.query, plan: anyAuthority.plan, graph: anyAuthority.built.graph });
  const memoAtMid = explainKarResult(midAuthority.envelope, { query: midAuthority.built.spec.query, plan: midAuthority.plan, graph: midAuthority.built.graph });
  const memoId = anyAuthority.built.byLabel.get('memo').id;
  assert.equal(memoAtAny.evidence.find((item) => item.evidenceId === memoId && item.frontier === 'F_O').applicable, true);
  assert.equal(memoAtMid.evidence.find((item) => item.evidenceId === memoId && item.frontier === 'F_O').applicable, false);

  const gap = byName.get('genuine-gap');
  assert.deepEqual(gap.envelope.kar.evidenceIds, []);
  assert.deepEqual(gap.envelope.evidence, []);
  assert.deepEqual(gap.envelope.kar.frontiers.F_O, []);
  assert.equal(gap.envelope.kar.frontiers.F_S.length, 1);
  const gapExplain = explainKarResult(gap.envelope, { query: gap.built.spec.query, plan: gap.plan, graph: gap.built.graph });
  assert.match(gapExplain.abstention.reason, /no top-k fallback/);
  assert.equal(gapExplain.abstention.evidenceIds.length, 0);
  assert.equal(gapExplain.evidence.some((item) => item.frontier === 'F_S' && item.selected === false), true);

  let repeat = canonicalize(room.envelope.kar);
  for (let index = 0; index < 25; index += 1) {
    const again = runScenarioCase(room.built, room.caseSpec);
    assert.equal(canonicalize(again.envelope.kar), repeat);
  }

  const examplesDir = fixtureRoot;
  fs.writeFileSync(path.join(examplesDir, 'examples.json'), `${JSON.stringify({
    satisfied: {
      scenario: 'support-opposition',
      stateRoot: room.envelope.image.stateRoot,
      knowledgeRoot: room.envelope.kar.roots.knowledgeRoot,
      anchor: room.envelope.anchor,
      evidence: room.envelope.evidence.map((row) => ({ id: row.id, source: row.source })),
      frontiers: room.envelope.frontiers,
      status: room.envelope.status,
      evidenceIds: room.envelope.kar.evidenceIds,
      roots: room.envelope.kar.roots,
      decision: room.envelope.kar.decision,
    },
    abstention: {
      scenario: 'genuine-gap',
      stateRoot: gap.envelope.image.stateRoot,
      status: gap.envelope.status,
      evidenceIds: gap.envelope.kar.evidenceIds,
      frontiers: gap.envelope.frontiers,
      decision: gap.envelope.kar.decision,
      roots: gap.envelope.kar.roots,
      explanation: gapExplain.abstention.reason,
    },
  }, null, 2)}\n`);
});

test('the public core barrel does not export KAR', () => {
  const source = fs.readFileSync(new URL('../../../../packages/core/src/index.ts', import.meta.url), 'utf8');
  assert.equal(source.includes("kar"), false);
});
