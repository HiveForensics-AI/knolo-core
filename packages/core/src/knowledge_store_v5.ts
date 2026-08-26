import {
  createKnowledgeImageV5,
  mountKnowledgeImageV5,
  type Digest,
  type KnowledgeImageV5,
  type KnowledgeObjectInput,
} from './knowledge_image_v5.js';
import { compareKnowledgeSyncImagesV5, fastForwardKnowledgeImageV5, type KnowledgeSyncPlanV1 } from './knowledge_sync_v5.js';
import { applyKnowledgeSyncMergeV5, type KnowledgeMergeApplyOptionsV1, type KnowledgeMergeResultV1 } from './knowledge_merge_v5.js';

export type KnowledgeTransactionOptionsV5 = {
  actor?: string;
};

/** A read-only point-in-time view of the committed V5 image. */
export type KnowledgeSnapshotV5 = Readonly<KnowledgeImageV5>;

/**
 * Single-writer, append-only V5 store.
 *
 * Readers receive detached image instances. A transaction reserves the one
 * writer slot until commit or rollback, while its base commit digest provides
 * an optimistic conflict check at commit time.
 */
export class KnowledgeImageStoreV5 {
  private current: KnowledgeImageV5;
  private active?: KnowledgeTransactionV5;

  constructor(initial: KnowledgeImageV5 | ArrayBufferLike | Uint8Array) {
    this.current = cloneImage(initial);
  }

  snapshot(): KnowledgeSnapshotV5 {
    return cloneImage(this.current);
  }

  get stateRoot(): Digest {
    return this.current.stateRoot;
  }

  syncPlan(remote: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, localKeyringRoot?: Digest, remoteKeyringRoot?: Digest): KnowledgeSyncPlanV1 {
    return compareKnowledgeSyncImagesV5(this.current, remote, localKeyringRoot, remoteKeyringRoot);
  }

  fastForward(remote: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, localKeyringRoot?: Digest, remoteKeyringRoot?: Digest, persist?: (image: KnowledgeSnapshotV5) => void): KnowledgeSnapshotV5 {
    if (this.active) throw new Error('Cannot fast-forward a V5 store with an active writer transaction.');
    const next = fastForwardKnowledgeImageV5(this.current, remote, localKeyringRoot, remoteKeyringRoot).image;
    persist?.(next);
    this.current = next;
    return this.snapshot();
  }

  merge(
    remote: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
    ancestor: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
    options: KnowledgeMergeApplyOptionsV1,
    localKeyringRoot?: Digest,
    remoteKeyringRoot?: Digest,
    ancestorKeyringRoot?: Digest,
    persist?: (image: KnowledgeSnapshotV5) => void,
  ): KnowledgeSnapshotV5 {
    if (this.active) throw new Error('Cannot merge a V5 store with an active writer transaction.');
    const result: KnowledgeMergeResultV1 = applyKnowledgeSyncMergeV5(this.current, remote, ancestor, options, localKeyringRoot, remoteKeyringRoot, ancestorKeyringRoot);
    persist?.(result.image);
    this.current = result.image;
    return this.snapshot();
  }

  beginTransaction(options: KnowledgeTransactionOptionsV5 = {}): KnowledgeTransactionV5 {
    if (this.active) throw new Error('A V5 writer transaction is already active.');
    const tx = new KnowledgeTransactionV5(this, this.current, options.actor ?? 'knolo-transaction');
    this.active = tx;
    return tx;
  }

  commit(transaction: KnowledgeTransactionV5, persist?: (image: KnowledgeSnapshotV5) => void): KnowledgeSnapshotV5 {
    if (this.active !== transaction || transaction.closed) throw new Error('Transaction is not active on this store.');
    if (this.current.commitDigest !== transaction.baseCommitDigest) {
      this.active = undefined;
      transaction.closed = true;
      throw new Error('V5 transaction conflict: base commit is no longer current.');
    }
    const next = createKnowledgeImageV5({
      baseImage: this.current,
      objects: transaction.objects,
      actor: transaction.actor,
    });
    persist?.(next);
    this.current = next;
    this.active = undefined;
    transaction.closed = true;
    return this.snapshot();
  }

  rollback(transaction: KnowledgeTransactionV5): void {
    if (this.active !== transaction || transaction.closed) throw new Error('Transaction is not active on this store.');
    this.active = undefined;
    transaction.closed = true;
  }
}

export class KnowledgeTransactionV5 {
  readonly baseCommitDigest: Digest;
  readonly actor: string;
  readonly objects: KnowledgeObjectInput[] = [];
  closed = false;
  private readonly store: KnowledgeImageStoreV5;

  constructor(store: KnowledgeImageStoreV5, base: KnowledgeImageV5, actor: string) {
    this.store = store;
    this.baseCommitDigest = base.commitDigest;
    this.actor = actor;
  }

  addObject(object: KnowledgeObjectInput): this {
    this.assertOpen();
    this.objects.push({ ...object, bytes: new Uint8Array(object.bytes), meta: { ...object.meta } });
    return this;
  }

  addObjects(objects: KnowledgeObjectInput[]): this {
    for (const object of objects) this.addObject(object);
    return this;
  }

  commit(): KnowledgeSnapshotV5 {
    this.assertOpen();
    return this.store.commit(this);
  }

  commitWith(persist: (image: KnowledgeSnapshotV5) => void): KnowledgeSnapshotV5 {
    this.assertOpen();
    return this.store.commit(this, persist);
  }

  rollback(): void {
    this.assertOpen();
    this.store.rollback(this);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('V5 transaction is closed.');
  }
}

function cloneImage(image: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): KnowledgeImageV5 {
  return image instanceof Uint8Array || image instanceof ArrayBuffer || typeof image === 'object' && image !== null && 'bytes' in image
    ? mountKnowledgeImageV5(image instanceof Uint8Array || image instanceof ArrayBuffer ? image : (image as KnowledgeImageV5).bytes)
    : mountKnowledgeImageV5(image as ArrayBufferLike);
}
