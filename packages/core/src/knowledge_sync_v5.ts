import {
  canonicalCbor,
  digestDomain,
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
} from './knowledge_image_v5.js';

export type KnowledgeSyncSummaryV1 = {
  version: 1;
  stateRoot: Digest;
  commitDigest: Digest;
  sequence: number;
  parents: Digest[];
  objectRoot: Digest;
  eventRoot: Digest;
  keyringRoot?: Digest;
  summaryRoot: Digest;
};

export type KnowledgeSyncRelationV1 = 'equal' | 'local-ahead' | 'remote-ahead' | 'diverged';

export type KnowledgeSyncPlanV1 = {
  version: 1;
  relation: KnowledgeSyncRelationV1;
  local: KnowledgeSyncSummaryV1;
  remote: KnowledgeSyncSummaryV1;
  commonAncestor?: Digest;
  pullObjectIds: Digest[];
  pullEventIds: Digest[];
  planRoot: Digest;
};

export type KnowledgeFastForwardResultV1 = {
  image: KnowledgeImageV5;
  plan: KnowledgeSyncPlanV1;
};

export function syncSummaryRootV1(summary: Omit<KnowledgeSyncSummaryV1, 'summaryRoot'>): Digest {
  return digestDomain('sync-summary', canonicalCbor({
    commitDigest: summary.commitDigest,
    eventRoot: summary.eventRoot,
    keyringRoot: summary.keyringRoot ?? null,
    objectRoot: summary.objectRoot,
    parents: summary.parents,
    sequence: summary.sequence,
    stateRoot: summary.stateRoot,
    version: summary.version,
  } as unknown as CborValue));
}

export function createKnowledgeSyncSummaryV1(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, keyringRoot?: Digest): KnowledgeSyncSummaryV1 {
  const image = isKnowledgeImage(input) ? input : mountKnowledgeImageV5(input);
  const summary = {
    version: 1 as const,
    stateRoot: image.stateRoot,
    commitDigest: image.commitDigest,
    sequence: image.commit.sequence,
    parents: [...image.commit.parents],
    objectRoot: image.commit.objectRoot,
    eventRoot: image.commit.eventRoot,
    ...(keyringRoot === undefined ? {} : { keyringRoot }),
  };
  return { ...summary, summaryRoot: syncSummaryRootV1(summary) };
}

export function verifyKnowledgeSyncSummaryV5(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, summary: KnowledgeSyncSummaryV1): void {
  const expected = createKnowledgeSyncSummaryV1(input, summary.keyringRoot);
  if (summary.version !== 1 || summary.summaryRoot !== expected.summaryRoot || summary.stateRoot !== expected.stateRoot || summary.commitDigest !== expected.commitDigest || summary.sequence !== expected.sequence || !sameStrings(summary.parents, expected.parents) || summary.objectRoot !== expected.objectRoot || summary.eventRoot !== expected.eventRoot) throw new Error('V5 sync summary root mismatch.');
}

export function compareKnowledgeSyncImagesV5(
  localInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  remoteInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  localKeyringRoot?: Digest,
  remoteKeyringRoot?: Digest,
): KnowledgeSyncPlanV1 {
  const localImage = isKnowledgeImage(localInput) ? localInput : mountKnowledgeImageV5(localInput);
  const remoteImage = isKnowledgeImage(remoteInput) ? remoteInput : mountKnowledgeImageV5(remoteInput);
  const local = createKnowledgeSyncSummaryV1(localImage, localKeyringRoot);
  const remote = createKnowledgeSyncSummaryV1(remoteImage, remoteKeyringRoot);
  let relation: KnowledgeSyncRelationV1 = 'diverged';
  let commonAncestor: Digest | undefined;
  if (local.commitDigest === remote.commitDigest && local.stateRoot === remote.stateRoot) relation = 'equal';
  else if (remote.parents.includes(local.commitDigest) && remote.sequence > local.sequence) { relation = 'remote-ahead'; commonAncestor = local.commitDigest; }
  else if (local.parents.includes(remote.commitDigest) && local.sequence > remote.sequence) { relation = 'local-ahead'; commonAncestor = remote.commitDigest; }
  const localObjectIds = new Set(localImage.objects.map((object) => object.id));
  const localEventIds = new Set(localImage.events.map((event) => event.id));
  const pullObjectIds = relation === 'remote-ahead' ? remoteImage.objects.map((object) => object.id).filter((id) => !localObjectIds.has(id)).sort(compareUtf8) : [];
  const pullEventIds = relation === 'remote-ahead' ? remoteImage.events.map((event) => event.id).filter((id) => !localEventIds.has(id)).sort(compareUtf8) : [];
  const planBody = { version: 1 as const, relation, local, remote, ...(commonAncestor === undefined ? {} : { commonAncestor }), pullObjectIds, pullEventIds };
  return { ...planBody, planRoot: digestDomain('sync-plan', canonicalCbor(planBody as unknown as CborValue)) };
}

export function fastForwardKnowledgeImageV5(
  localInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  remoteInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  localKeyringRoot?: Digest,
  remoteKeyringRoot?: Digest,
): KnowledgeFastForwardResultV1 {
  if ((localKeyringRoot !== undefined || remoteKeyringRoot !== undefined) && localKeyringRoot !== remoteKeyringRoot) throw new Error('V5 fast-forward keyring roots do not match.');
  const plan = compareKnowledgeSyncImagesV5(localInput, remoteInput, localKeyringRoot, remoteKeyringRoot);
  if (plan.relation !== 'remote-ahead') throw new Error(`V5 fast-forward requires a direct remote-ahead state, received ${plan.relation}.`);
  const remoteImage = isKnowledgeImage(remoteInput) ? remoteInput : mountKnowledgeImageV5(remoteInput);
  return { image: mountKnowledgeImageV5(remoteImage.bytes), plan };
}

function sameStrings(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function compareUtf8(left: string, right: string): number { const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
function isKnowledgeImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 { return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input; }
