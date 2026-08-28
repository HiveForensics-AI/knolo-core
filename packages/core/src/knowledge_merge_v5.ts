import {
  canonicalCbor,
  digestBytes,
  digestDomain,
  createKnowledgeImageV5,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeEventV1,
  type KnowledgeImageV5,
  type KnowledgeObjectInput,
} from './knowledge_image_v5.js';
import {
  createKnowledgeSyncSummaryV1,
  syncSummaryRootV1,
  type KnowledgeSyncSummaryV1,
} from './knowledge_sync_v5.js';

export type KnowledgeMergeConflictV1 = {
  kind: 'event-target' | 'commit-field' | 'view';
  key: string;
  ancestor: Digest | null;
  local: Digest[];
  remote: Digest[];
};

export type KnowledgeMergePlanV1 = {
  version: 1;
  relation: 'diverged';
  ancestor: KnowledgeSyncSummaryV1;
  local: KnowledgeSyncSummaryV1;
  remote: KnowledgeSyncSummaryV1;
  localOnlyObjectIds: Digest[];
  remoteOnlyObjectIds: Digest[];
  localOnlyEventIds: Digest[];
  remoteOnlyEventIds: Digest[];
  conflicts: KnowledgeMergeConflictV1[];
  planRoot: Digest;
};

export type KnowledgeMergeDecisionV1 = {
  kind: KnowledgeMergeConflictV1['kind'];
  key: string;
  choice: 'local' | 'remote';
};

export type KnowledgeMergeResolutionV1 = {
  decisions: KnowledgeMergeDecisionV1[];
};

export type KnowledgeMergeApplyOptionsV1 = {
  plan: KnowledgeMergePlanV1;
  resolution: KnowledgeMergeResolutionV1;
  authorize: (plan: KnowledgeMergePlanV1, resolution: KnowledgeMergeResolutionV1) => boolean;
  actor?: string;
};

export type KnowledgeMergeResultV1 = {
  image: KnowledgeImageV5;
  plan: KnowledgeMergePlanV1;
  resolution: KnowledgeMergeResolutionV1;
};

/**
 * Produce a deterministic, read-only merge plan for two direct child branches.
 * No object/event is copied and no branch is mutated.
 */
export function planKnowledgeSyncMergeV5(
  localInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  remoteInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  ancestorInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  localKeyringRoot?: Digest,
  remoteKeyringRoot?: Digest,
  ancestorKeyringRoot?: Digest,
): KnowledgeMergePlanV1 {
  const localImage = normalizeImage(localInput);
  const remoteImage = normalizeImage(remoteInput);
  const ancestorImage = normalizeImage(ancestorInput);
  const local = createKnowledgeSyncSummaryV1(localImage, localKeyringRoot);
  const remote = createKnowledgeSyncSummaryV1(remoteImage, remoteKeyringRoot);
  const ancestor = createKnowledgeSyncSummaryV1(ancestorImage, ancestorKeyringRoot);
  if (local.commitDigest === remote.commitDigest || local.stateRoot === remote.stateRoot) throw new Error('V5 merge planning requires divergent images.');
  if (!local.parents.includes(ancestor.commitDigest) || !remote.parents.includes(ancestor.commitDigest) || local.sequence <= ancestor.sequence || remote.sequence <= ancestor.sequence) throw new Error('V5 merge planning requires both images to directly descend from the supplied ancestor.');
  if (local.keyringRoot !== remote.keyringRoot || local.keyringRoot !== ancestor.keyringRoot) throw new Error('V5 merge planning requires matching keyring roots.');

  const ancestorObjectIds = new Set(ancestorImage.objects.map((object) => object.id));
  const ancestorEventIds = new Set(ancestorImage.events.map((event) => event.id));
  const localOnlyObjectIds = onlyIds(localImage.objects.map((object) => object.id), ancestorObjectIds);
  const remoteOnlyObjectIds = onlyIds(remoteImage.objects.map((object) => object.id), ancestorObjectIds);
  const localOnlyEventIds = onlyIds(localImage.events.map((event) => event.id), ancestorEventIds);
  const remoteOnlyEventIds = onlyIds(remoteImage.events.map((event) => event.id), ancestorEventIds);
  const conflicts = [...eventTargetConflicts(localImage, remoteImage, ancestorEventIds), ...commitFieldConflicts(localImage, remoteImage, ancestorImage), ...viewConflicts(localImage, remoteImage, ancestorImage)]
    .sort((left, right) => compareUtf8(`${left.kind}\0${left.key}`, `${right.kind}\0${right.key}`));
  const body = {
    version: 1 as const,
    relation: 'diverged' as const,
    ancestor,
    local,
    remote,
    localOnlyObjectIds,
    remoteOnlyObjectIds,
    localOnlyEventIds,
    remoteOnlyEventIds,
    conflicts,
  };
  return { ...body, planRoot: digestDomain('merge-plan', canonicalCbor(body as unknown as CborValue)) };
}

export function verifyKnowledgeMergePlanV5(plan: KnowledgeMergePlanV1): void {
  if (plan.version !== 1 || plan.relation !== 'diverged' || !plan.ancestor || !plan.local || !plan.remote || !Array.isArray(plan.conflicts) || plan.planRoot !== digestDomain('merge-plan', canonicalCbor({
    version: 1,
    relation: 'diverged',
    ancestor: plan.ancestor,
    local: plan.local,
    remote: plan.remote,
    localOnlyObjectIds: plan.localOnlyObjectIds,
    remoteOnlyObjectIds: plan.remoteOnlyObjectIds,
    localOnlyEventIds: plan.localOnlyEventIds,
    remoteOnlyEventIds: plan.remoteOnlyEventIds,
    conflicts: plan.conflicts,
  } as unknown as CborValue))) throw new Error('V5 merge plan root mismatch.');
  validateSummary(plan.ancestor);
  validateSummary(plan.local);
  validateSummary(plan.remote);
  validateIds(plan.localOnlyObjectIds);
  validateIds(plan.remoteOnlyObjectIds);
  validateIds(plan.localOnlyEventIds);
  validateIds(plan.remoteOnlyEventIds);
  for (const conflict of plan.conflicts) {
    if (!['event-target', 'commit-field', 'view'].includes(conflict.kind) || !conflict.key || !conflict.local.length || !conflict.remote.length || (conflict.ancestor !== null && !isDigest(conflict.ancestor))) throw new Error('Malformed V5 merge conflict.');
    validateIds(conflict.local);
    validateIds(conflict.remote);
  }
}

/**
 * Apply an explicitly authorized resolution as a new two-parent image.
 * Verification and authorization happen before image construction; the input
 * branches are never mutated.
 */
export function applyKnowledgeSyncMergeV5(
  localInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  remoteInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  ancestorInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  options: KnowledgeMergeApplyOptionsV1,
  localKeyringRoot?: Digest,
  remoteKeyringRoot?: Digest,
  ancestorKeyringRoot?: Digest,
): KnowledgeMergeResultV1 {
  const localImage = normalizeImage(localInput);
  const remoteImage = normalizeImage(remoteInput);
  const ancestorImage = normalizeImage(ancestorInput);
  verifyKnowledgeMergePlanV5(options.plan);
  const expectedPlan = planKnowledgeSyncMergeV5(localImage, remoteImage, ancestorImage, localKeyringRoot, remoteKeyringRoot, ancestorKeyringRoot);
  if (expectedPlan.planRoot !== options.plan.planRoot) throw new Error('V5 merge plan does not match the supplied images.');
  const resolution = normalizeResolution(options.plan, options.resolution);
  if (!options.authorize(options.plan, resolution)) throw new Error('V5 merge authorization rejected.');

  const decisions = new Map(resolution.decisions.map((decision) => [`${decision.kind}\0${decision.key}`, decision.choice]));
  const conflictingLocalEventIds = new Set(options.plan.conflicts.filter((conflict) => conflict.kind === 'event-target' && decisions.get(`event-target\0${conflict.key}`) === 'remote').flatMap((conflict) => conflict.local));
  const conflictingRemoteEventIds = new Set(options.plan.conflicts.filter((conflict) => conflict.kind === 'event-target' && decisions.get(`event-target\0${conflict.key}`) === 'local').flatMap((conflict) => conflict.remote));
  const localOnlyEventIds = new Set(options.plan.localOnlyEventIds);
  const remoteOnlyEventIds = new Set(options.plan.remoteOnlyEventIds);
  const preservedEvents = [
    ...localImage.events.filter((event) => localOnlyEventIds.has(event.id) && !conflictingLocalEventIds.has(event.id)),
    ...remoteImage.events.filter((event) => remoteOnlyEventIds.has(event.id) && !conflictingRemoteEventIds.has(event.id)),
  ];
  const localOnlyObjectIds = new Set(options.plan.localOnlyObjectIds);
  const remoteOnlyObjectIds = new Set(options.plan.remoteOnlyObjectIds);
  const objects: KnowledgeObjectInput[] = [...localImage.objects, ...remoteImage.objects]
    .filter((object) => localOnlyObjectIds.has(object.id) || remoteOnlyObjectIds.has(object.id))
    .map((object) => ({ id: object.id, kind: object.kind, bytes: new Uint8Array(object.bytes), meta: { ...object.meta } }));
  const views = resolveViews(localImage, remoteImage, ancestorImage, decisions);
  const commitOverrides = {
    views,
    schemaRoot: resolveCommitField('schemaRoot', localImage, remoteImage, ancestorImage, decisions),
    policyRoot: resolveCommitField('policyRoot', localImage, remoteImage, ancestorImage, decisions),
    runtimeContract: resolveCommitField('runtimeContract', localImage, remoteImage, ancestorImage, decisions),
  };
  const merged = createKnowledgeImageV5({
    baseImage: ancestorImage,
    parents: [localImage.commitDigest, remoteImage.commitDigest],
    objects,
    events: [],
    preservedEvents,
    actor: options.actor ?? 'knolo-merge',
    commitOverrides,
  });
  return { image: mountKnowledgeImageV5(merged.bytes), plan: options.plan, resolution };
}

function eventTargetConflicts(local: KnowledgeImageV5, remote: KnowledgeImageV5, ancestorEventIds: Set<Digest>): KnowledgeMergeConflictV1[] {
  const localByTarget = groupEventIds(local, ancestorEventIds);
  const remoteByTarget = groupEventIds(remote, ancestorEventIds);
  const targets = [...new Set([...localByTarget.keys(), ...remoteByTarget.keys()])].sort(compareUtf8);
  return targets.flatMap((target) => {
    const left = localByTarget.get(target) ?? [];
    const right = remoteByTarget.get(target) ?? [];
    if (!left.length || !right.length || sameIds(left, right)) return [];
    return [{ kind: 'event-target' as const, key: target, ancestor: null, local: left, remote: right }];
  });
}

function commitFieldConflicts(local: KnowledgeImageV5, remote: KnowledgeImageV5, ancestor: KnowledgeImageV5): KnowledgeMergeConflictV1[] {
  const fields: Array<keyof KnowledgeImageV5['commit']> = ['schemaRoot', 'policyRoot', 'runtimeContract'];
  return fields.flatMap((field) => {
    const base = ancestor.commit[field] as Digest;
    const left = local.commit[field] as Digest;
    const right = remote.commit[field] as Digest;
    return left !== base && right !== base && left !== right ? [{ kind: 'commit-field' as const, key: field, ancestor: base, local: [left], remote: [right] }] : [];
  });
}

function viewConflicts(local: KnowledgeImageV5, remote: KnowledgeImageV5, ancestor: KnowledgeImageV5): KnowledgeMergeConflictV1[] {
  const keys = [...new Set([...Object.keys(ancestor.commit.views), ...Object.keys(local.commit.views), ...Object.keys(remote.commit.views)])].sort(compareUtf8);
  return keys.flatMap((key) => {
    const base = ancestor.commit.views[key];
    const left = local.commit.views[key];
    const right = remote.commit.views[key];
    if (left === undefined || right === undefined || left === base || right === base || left === right) return [];
    return [{ kind: 'view' as const, key, ancestor: base ?? null, local: [left], remote: [right] }];
  });
}

function groupEventIds(image: KnowledgeImageV5, ancestorEventIds: Set<Digest>): Map<Digest, Digest[]> {
  const grouped = new Map<Digest, Digest[]>();
  for (const event of image.events) {
    if (ancestorEventIds.has(event.id)) continue;
    const ids = grouped.get(event.target) ?? [];
    ids.push(event.id);
    grouped.set(event.target, ids);
  }
  for (const ids of grouped.values()) ids.sort(compareUtf8);
  return grouped;
}

function normalizeResolution(plan: KnowledgeMergePlanV1, resolution: KnowledgeMergeResolutionV1): KnowledgeMergeResolutionV1 {
  if (!resolution || !Array.isArray(resolution.decisions)) throw new Error('Malformed V5 merge resolution.');
  const expected = new Set(plan.conflicts.map((conflict) => `${conflict.kind}\0${conflict.key}`));
  const seen = new Set<string>();
  for (const decision of resolution.decisions) {
    const key = `${decision?.kind}\0${decision?.key}`;
    if (!expected.has(key) || seen.has(key) || (decision.choice !== 'local' && decision.choice !== 'remote')) throw new Error('V5 merge resolution must decide every conflict exactly once.');
    seen.add(key);
  }
  if (seen.size !== expected.size) throw new Error('V5 merge resolution has unresolved conflicts.');
  return { decisions: [...resolution.decisions].sort((left, right) => compareUtf8(`${left.kind}\0${left.key}`, `${right.kind}\0${right.key}`)).map((decision) => ({ ...decision })) };
}

function resolveCommitField(field: 'schemaRoot' | 'policyRoot' | 'runtimeContract', local: KnowledgeImageV5, remote: KnowledgeImageV5, ancestor: KnowledgeImageV5, decisions: Map<string, 'local' | 'remote'>): Digest {
  const localValue = local.commit[field];
  const remoteValue = remote.commit[field];
  const ancestorValue = ancestor.commit[field];
  if (localValue === remoteValue) return localValue;
  if (localValue === ancestorValue) return remoteValue;
  if (remoteValue === ancestorValue) return localValue;
  return decisions.get(`commit-field\0${field}`) === 'remote' ? remoteValue : localValue;
}

function resolveViews(local: KnowledgeImageV5, remote: KnowledgeImageV5, ancestor: KnowledgeImageV5, decisions: Map<string, 'local' | 'remote'>): Record<string, Digest> {
  const keys = [...new Set([...Object.keys(local.commit.views), ...Object.keys(remote.commit.views), ...Object.keys(ancestor.commit.views)])].sort(compareUtf8);
  const views: Record<string, Digest> = {};
  for (const key of keys) {
    const localValue = local.commit.views[key];
    const remoteValue = remote.commit.views[key];
    const ancestorValue = ancestor.commit.views[key];
    let selected = localValue;
    if (localValue === undefined) selected = remoteValue;
    else if (remoteValue === undefined) selected = localValue;
    else if (localValue === ancestorValue) selected = remoteValue;
    else if (remoteValue === ancestorValue || localValue === remoteValue) selected = localValue;
    else if (decisions.get(`view\0${key}`) === 'remote') selected = remoteValue;
    if (selected !== undefined) views[key] = selected;
  }
  return views;
}

function onlyIds(ids: Digest[], excluded: Set<Digest>): Digest[] { return [...new Set(ids.filter((id) => !excluded.has(id)))].sort(compareUtf8); }
function sameIds(left: Digest[], right: Digest[]): boolean { return left.length === right.length && left.every((id, index) => id === right[index]); }
function validateIds(ids: Digest[]): void { if (!Array.isArray(ids) || ids.some((id) => !isDigest(id)) || ids.some((id, index) => index > 0 && compareUtf8(ids[index - 1], id) >= 0)) throw new Error('Invalid V5 merge digest list.'); }
function validateSummary(summary: KnowledgeSyncSummaryV1): void {
  if (!summary || summary.version !== 1 || !isDigest(summary.stateRoot) || !isDigest(summary.commitDigest) || !isDigest(summary.objectRoot) || !isDigest(summary.eventRoot) || !isDigest(summary.summaryRoot) || !Number.isSafeInteger(summary.sequence) || !Array.isArray(summary.parents) || summary.parents.some((parent) => !isDigest(parent)) || (summary.keyringRoot !== undefined && !isDigest(summary.keyringRoot)) || syncSummaryRootV1(summary) !== summary.summaryRoot) throw new Error('Malformed V5 merge summary.');
}
function isDigest(value: unknown): value is Digest { if (typeof value !== 'string') return false; try { digestBytes(value); return true; } catch { return false; } }
function normalizeImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): KnowledgeImageV5 { return isImage(input) ? mountKnowledgeImageV5(input.bytes) : mountKnowledgeImageV5(input); }
function isImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 { return typeof input === 'object' && input !== null && 'bytes' in input && 'commit' in input; }
function compareUtf8(left: string, right: string): number { const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
