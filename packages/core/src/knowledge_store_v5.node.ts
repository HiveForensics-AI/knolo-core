import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  KnowledgeImageStoreV5,
  KnowledgeTransactionV5,
  type KnowledgeSnapshotV5,
  type KnowledgeTransactionOptionsV5,
} from './knowledge_store_v5.js';
import type { KnowledgeImageV5 } from './knowledge_image_v5.js';
import type { Digest } from './knowledge_image_v5.js';
import type { KnowledgeSyncPlanV1 } from './knowledge_sync_v5.js';
import type { KnowledgeMergeApplyOptionsV1 } from './knowledge_merge_v5.js';

export class DurableKnowledgeImageStoreV5 {
  private readonly store: KnowledgeImageStoreV5;
  private readonly lockPath: string;
  private activeTransaction?: DurableKnowledgeTransactionV5;
  private closed = false;

  private constructor(private readonly filePath: string, initial: KnowledgeImageV5 | ArrayBufferLike | Uint8Array) {
    this.store = new KnowledgeImageStoreV5(initial);
    this.lockPath = `${filePath}.lock`;
  }

  static open(filePath: string, initial?: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): DurableKnowledgeImageStoreV5 {
    const lockPath = `${filePath}.lock`;
    mkdirSync(dirname(filePath), { recursive: true });
    let lockFd: number;
    try {
      lockFd = openSync(lockPath, 'wx');
      try {
        writeFileSync(lockFd, `${process.pid}\n`, 'utf8');
      } finally {
        closeSync(lockFd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`V5 store is already locked: ${filePath}.`);
      }
      rmSync(lockPath, { force: true });
      throw error;
    }

    try {
      const bytes = readFileSync(filePath);
      const store = new DurableKnowledgeImageStoreV5(filePath, new Uint8Array(bytes));
      return store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !initial) {
        rmSync(lockPath, { force: true });
        throw error;
      }
      try {
        const store = new DurableKnowledgeImageStoreV5(filePath, imageBytes(initial));
        store.persist(store.snapshot());
        return store;
      } catch (initialError) {
        rmSync(lockPath, { force: true });
        throw initialError;
      }
    }
  }

  snapshot(): KnowledgeSnapshotV5 {
    this.assertOpen();
    return this.store.snapshot();
  }

  get stateRoot(): string {
    this.assertOpen();
    return this.store.stateRoot;
  }

  syncPlan(remote: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, localKeyringRoot?: Digest, remoteKeyringRoot?: Digest): KnowledgeSyncPlanV1 {
    this.assertOpen();
    return this.store.syncPlan(remote, localKeyringRoot, remoteKeyringRoot);
  }

  fastForward(remote: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, localKeyringRoot?: Digest, remoteKeyringRoot?: Digest): KnowledgeSnapshotV5 {
    this.assertOpen();
    if (this.activeTransaction && !this.activeTransaction.closed) throw new Error('Cannot fast-forward a V5 store with an active writer transaction.');
    return this.store.fastForward(remote, localKeyringRoot, remoteKeyringRoot, (image) => this.persist(image));
  }

  merge(remote: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, ancestor: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, options: KnowledgeMergeApplyOptionsV1, localKeyringRoot?: Digest, remoteKeyringRoot?: Digest, ancestorKeyringRoot?: Digest): KnowledgeSnapshotV5 {
    this.assertOpen();
    if (this.activeTransaction && !this.activeTransaction.closed) throw new Error('Cannot merge a V5 durable store with an active writer transaction.');
    return this.store.merge(remote, ancestor, options, localKeyringRoot, remoteKeyringRoot, ancestorKeyringRoot, (image) => this.persist(image));
  }

  beginTransaction(options: KnowledgeTransactionOptionsV5 = {}): DurableKnowledgeTransactionV5 {
    this.assertOpen();
    const transaction = new DurableKnowledgeTransactionV5(this, this.store.beginTransaction(options));
    this.activeTransaction = transaction;
    return transaction;
  }

  close(): void {
    if (this.closed) return;
    if (this.activeTransaction && !this.activeTransaction.closed) {
      throw new Error('Cannot close V5 durable store with an active transaction.');
    }
    this.closed = true;
    rmSync(this.lockPath, { force: true });
  }

  commit(transaction: KnowledgeTransactionV5): KnowledgeSnapshotV5 {
    this.assertOpen();
    try {
      return transaction.commitWith((image) => this.persist(image));
    } finally {
      if (transaction.closed) this.activeTransaction = undefined;
    }
  }

  release(transaction: DurableKnowledgeTransactionV5): void {
    if (this.activeTransaction === transaction) this.activeTransaction = undefined;
  }

  private persist(image: KnowledgeSnapshotV5): void {
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(tempPath, image.bytes);
      const fd = openSync(tempPath, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tempPath, this.filePath);
      const dirFd = openSync(dir, 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('V5 durable store is closed.');
  }
}

function imageBytes(initial: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): ArrayBufferLike | Uint8Array {
  if (initial instanceof Uint8Array || initial instanceof ArrayBuffer) return initial;
  if (typeof initial === 'object' && initial !== null && 'bytes' in initial) {
    return (initial as KnowledgeImageV5).bytes;
  }
  return initial;
}

export class DurableKnowledgeTransactionV5 {
  readonly baseCommitDigest = this.inner.baseCommitDigest;
  readonly actor = this.inner.actor;

  get closed(): boolean {
    return this.inner.closed;
  }

  constructor(private readonly store: DurableKnowledgeImageStoreV5, private readonly inner: KnowledgeTransactionV5) {}

  addObject(object: Parameters<KnowledgeTransactionV5['addObject']>[0]): this {
    this.inner.addObject(object);
    return this;
  }

  addObjects(objects: Parameters<KnowledgeTransactionV5['addObjects']>[0]): this {
    this.inner.addObjects(objects);
    return this;
  }

  commit(): KnowledgeSnapshotV5 {
    return this.store.commit(this.inner);
  }

  rollback(): void {
    this.inner.rollback();
    this.store.release(this);
  }
}
