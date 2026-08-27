import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KnowledgeImageStoreV5,
  applyKnowledgeSyncMergeV5,
  compareKnowledgeSyncImagesV5,
  createKnowledgeImageV5,
  createKnowledgeSyncSummaryV1,
  fastForwardKnowledgeImageV5,
  planKnowledgeSyncMergeV5,
  verifyKnowledgeMergePlanV5,
  verifyKnowledgeSyncSummaryV5,
} from '../dist/index.js';

function imageWith(kind, text, baseImage) {
  return createKnowledgeImageV5({
    baseImage,
    actor: kind,
    objects: [{ kind: 'chunk', bytes: new TextEncoder().encode(text), meta: { branch: kind } }],
  });
}

test('V5 sync summaries and plans distinguish equality, fast-forward, and divergence', () => {
  const base = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
  const local = imageWith('local', 'local change', base);
  const remote = imageWith('remote', 'remote change', base);

  const equal = compareKnowledgeSyncImagesV5(base, base);
  assert.equal(equal.relation, 'equal');
  assert.deepEqual(equal.pullObjectIds, []);
  assert.deepEqual(equal.pullEventIds, []);

  const ahead = compareKnowledgeSyncImagesV5(base, local);
  assert.equal(ahead.relation, 'remote-ahead');
  assert.equal(ahead.commonAncestor, base.commitDigest);
  assert.equal(ahead.pullObjectIds.length, 1);
  assert.equal(ahead.pullEventIds.length, 1);

  const behind = compareKnowledgeSyncImagesV5(local, base);
  assert.equal(behind.relation, 'local-ahead');
  assert.deepEqual(behind.pullObjectIds, []);

  const adopted = fastForwardKnowledgeImageV5(base, local, 'sha256-' + 'a'.repeat(64), 'sha256-' + 'a'.repeat(64));
  assert.equal(adopted.image.commitDigest, local.commitDigest);
  assert.equal(adopted.plan.planRoot, compareKnowledgeSyncImagesV5(base, local, 'sha256-' + 'a'.repeat(64), 'sha256-' + 'a'.repeat(64)).planRoot);
  assert.throws(() => fastForwardKnowledgeImageV5(local, remote), /direct remote-ahead|diverged/i);
  assert.throws(() => fastForwardKnowledgeImageV5(base, local, 'sha256-' + 'a'.repeat(64), 'sha256-' + 'b'.repeat(64)), /keyring roots/i);

  const conflict = compareKnowledgeSyncImagesV5(local, remote);
  assert.equal(conflict.relation, 'diverged');
  assert.equal(conflict.commonAncestor, undefined);
  assert.deepEqual(conflict.pullObjectIds, []);
  assert.deepEqual(conflict.pullEventIds, []);
});

test('V5 sync summaries verify roots and stores expose read-only sync plans', () => {
  const base = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
  const child = imageWith('child', 'next', base);
  const summary = createKnowledgeSyncSummaryV1(child, 'sha256-' + 'a'.repeat(64));
  verifyKnowledgeSyncSummaryV5(child, summary);
  const tampered = { ...summary, sequence: summary.sequence + 1 };
  assert.throws(() => verifyKnowledgeSyncSummaryV5(child, tampered), /summary root mismatch/i);

  const store = new KnowledgeImageStoreV5(base);
  const plan = store.syncPlan(child, undefined, 'sha256-' + 'a'.repeat(64));
  assert.equal(plan.relation, 'remote-ahead');
  assert.equal(plan.remote.keyringRoot, 'sha256-' + 'a'.repeat(64));
  assert.match(plan.planRoot, /^sha256-[0-9a-f]{64}$/);
  const tx = store.beginTransaction({ actor: 'busy' });
  assert.throws(() => store.fastForward(child), /active writer/i);
  tx.rollback();
  assert.equal(store.fastForward(child).stateRoot, child.stateRoot);
});

test('V5 divergent merge planning is deterministic and identifies target conflicts', () => {
  const base = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('base'), meta: {} }] });
  const localBytes = new TextEncoder().encode('local');
  const remoteBytes = new TextEncoder().encode('remote');
  const localSeed = createKnowledgeImageV5({ baseImage: base, actor: 'local', objects: [{ kind: 'chunk', bytes: localBytes, meta: { branch: 'local' } }] });
  const remoteSeed = createKnowledgeImageV5({ baseImage: base, actor: 'remote', objects: [{ kind: 'chunk', bytes: remoteBytes, meta: { branch: 'remote' } }] });
  const localObject = localSeed.objects.find((object) => !base.objects.some((baseObject) => baseObject.id === object.id));
  const remoteObject = remoteSeed.objects.find((object) => !base.objects.some((baseObject) => baseObject.id === object.id));
  const local = createKnowledgeImageV5({
    baseImage: base,
    actor: 'local',
    objects: [{ kind: 'chunk', bytes: localBytes, meta: { branch: 'local' } }],
    events: [{ version: 1, parents: [base.commitDigest], actor: 'local', actorCounter: 1, kind: 'object.update', target: base.objects[0].id, payload: localObject.id, provenance: { branch: 'local' } }],
  });
  const remote = createKnowledgeImageV5({
    baseImage: base,
    actor: 'remote',
    objects: [{ kind: 'chunk', bytes: remoteBytes, meta: { branch: 'remote' } }],
    events: [{ version: 1, parents: [base.commitDigest], actor: 'remote', actorCounter: 1, kind: 'object.update', target: base.objects[0].id, payload: remoteObject.id, provenance: { branch: 'remote' } }],
  });
  const keyringRoot = 'sha256-' + 'a'.repeat(64);
  const plan = planKnowledgeSyncMergeV5(local, remote, base, keyringRoot, keyringRoot, keyringRoot);
  assert.equal(plan.relation, 'diverged');
  assert.deepEqual(plan.localOnlyObjectIds, [localObject.id]);
  assert.deepEqual(plan.remoteOnlyObjectIds, [remoteObject.id]);
  assert.equal(plan.localOnlyEventIds.length, 1);
  assert.equal(plan.remoteOnlyEventIds.length, 1);
  assert.deepEqual(plan.conflicts.map((conflict) => conflict.kind), ['event-target', 'view']);
  assert.equal(plan.conflicts[0].key, base.objects[0].id);
  verifyKnowledgeMergePlanV5(plan);
  const repeat = planKnowledgeSyncMergeV5(local.bytes, remote.bytes, base.bytes, keyringRoot, keyringRoot, keyringRoot);
  assert.equal(repeat.planRoot, plan.planRoot);
  assert.throws(() => verifyKnowledgeMergePlanV5({ ...plan, planRoot: 'sha256-' + 'b'.repeat(64) }), /plan root mismatch/i);
  assert.throws(() => planKnowledgeSyncMergeV5(local, remote, base, keyringRoot, 'sha256-' + 'b'.repeat(64), keyringRoot), /keyring roots/i);
  assert.throws(() => planKnowledgeSyncMergeV5(local, remote, remote), /directly descend/i);

  const resolution = { decisions: plan.conflicts.map((conflict) => ({ kind: conflict.kind, key: conflict.key, choice: conflict.kind === 'event-target' ? 'local' : 'remote' })) };
  let authorizationCalls = 0;
  const applied = applyKnowledgeSyncMergeV5(local, remote, base, {
    plan,
    resolution,
    actor: 'merge-authority',
    authorize: (authorizedPlan, authorizedResolution) => {
      authorizationCalls += 1;
      return authorizedPlan.planRoot === plan.planRoot && authorizedResolution.decisions.length === plan.conflicts.length;
    },
  }, keyringRoot, keyringRoot, keyringRoot);
  assert.equal(authorizationCalls, 1);
  assert.deepEqual(applied.image.commit.parents, [local.commitDigest, remote.commitDigest]);
  assert.equal(applied.image.objects.length, 3);
  assert.equal(applied.image.events.length, 2);
  assert.equal(applied.image.events.some((event) => event.id === plan.remoteOnlyEventIds[0]), false);
  assert.deepEqual(applied.resolution.decisions.map((decision) => `${decision.kind}\0${decision.key}`), plan.conflicts.map((conflict) => `${conflict.kind}\0${conflict.key}`));

  const remoteResolution = { decisions: plan.conflicts.map((conflict) => ({ kind: conflict.kind, key: conflict.key, choice: conflict.kind === 'event-target' ? 'remote' : 'local' })) };
  const remoteApplied = applyKnowledgeSyncMergeV5(local, remote, base, {
    plan,
    resolution: remoteResolution,
    authorize: () => true,
  }, keyringRoot, keyringRoot, keyringRoot);
  assert.equal(remoteApplied.image.events.some((event) => event.id === plan.localOnlyEventIds[0]), false);
  assert.equal(remoteApplied.image.events.some((event) => event.id === plan.remoteOnlyEventIds[0]), true);
  assert.deepEqual(remoteApplied.image.commit.parents, [local.commitDigest, remote.commitDigest]);

  const store = new KnowledgeImageStoreV5(local);
  const before = store.stateRoot;
  assert.throws(() => store.merge(remote, base, { plan, resolution, authorize: () => false }, keyringRoot, keyringRoot, keyringRoot), /authorization/i);
  assert.equal(store.stateRoot, before);
  assert.equal(store.merge(remote, base, { plan, resolution, authorize: () => true }, keyringRoot, keyringRoot, keyringRoot).commit.parents.length, 2);
  assert.throws(() => applyKnowledgeSyncMergeV5(local, remote, base, { plan, resolution: { decisions: [] }, authorize: () => true }, keyringRoot, keyringRoot, keyringRoot), /unresolved/i);
});
