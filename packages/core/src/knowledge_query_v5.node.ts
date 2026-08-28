import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mountKnowledgeImageV5, type KnowledgeImageV5 } from './knowledge_image_v5.js';
import {
  createKnowledgeQueryIndexV5,
  deserializeKnowledgeQueryIndexV1,
  serializeKnowledgeQueryIndexV1,
  verifyKnowledgeQueryIndexV5,
  type KnowledgeQueryIndexV1,
} from './knowledge_query_index_v5.js';
import {
  appendKnowledgeQueryHistoryV5,
  createKnowledgeQueryHistoryV5,
  deserializeKnowledgeQueryHistoryV1,
  serializeKnowledgeQueryHistoryV1,
  verifyKnowledgeQueryHistoryV5,
  type KnowledgeQueryHistoryV1,
} from './knowledge_query_history_v5.js';
import type { KnowledgeQueryResultV1 } from './knowledge_query_v5.js';

export class DurableKnowledgeQueryIndexStoreV5 {
  private closed = false;
  private constructor(private readonly filePath: string, private current: KnowledgeQueryIndexV1) {}

  static open(filePath: string, imageInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array, initial?: KnowledgeQueryIndexV1): DurableKnowledgeQueryIndexStoreV5 {
    const image = isImage(imageInput) ? imageInput : mountKnowledgeImageV5(imageInput);
    const lockPath = acquireLock(filePath);
    try {
      const bytes = readFileSync(filePath);
      const index = deserializeKnowledgeQueryIndexV1(new Uint8Array(bytes));
      verifyKnowledgeQueryIndexV5(image, index);
      return new DurableKnowledgeQueryIndexStoreV5(filePath, index);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { rmSync(lockPath, { force: true }); throw error; }
      const index = initial ?? createKnowledgeQueryIndexV5(image);
      verifyKnowledgeQueryIndexV5(image, index);
      try { const store = new DurableKnowledgeQueryIndexStoreV5(filePath, index); store.persist(index); return store; } catch (initialError) { rmSync(lockPath, { force: true }); throw initialError; }
    }
  }

  snapshot(): KnowledgeQueryIndexV1 { this.assertOpen(); return cloneIndex(this.current); }
  get indexRoot(): string { this.assertOpen(); return this.current.indexRoot; }

  refresh(imageInput: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): KnowledgeQueryIndexV1 {
    this.assertOpen();
    const image = isImage(imageInput) ? imageInput : mountKnowledgeImageV5(imageInput);
    if (image.stateRoot === this.current.stateRoot) return this.snapshot();
    const next = createKnowledgeQueryIndexV5(image);
    this.persist(next);
    this.current = next;
    return this.snapshot();
  }

  close(): void { if (this.closed) return; this.closed = true; rmSync(`${this.filePath}.lock`, { force: true }); }

  private persist(index: KnowledgeQueryIndexV1): void { atomicWrite(this.filePath, serializeKnowledgeQueryIndexV1(index)); }
  private assertOpen(): void { if (this.closed) throw new Error('V5 durable query index store is closed.'); }
}

export class DurableKnowledgeQueryHistoryStoreV5 {
  private closed = false;
  private constructor(private readonly filePath: string, private current: KnowledgeQueryHistoryV1) {}

  static open(filePath: string, initial?: KnowledgeQueryHistoryV1): DurableKnowledgeQueryHistoryStoreV5 {
    const lockPath = acquireLock(filePath);
    try {
      const bytes = readFileSync(filePath);
      const history = deserializeKnowledgeQueryHistoryV1(new Uint8Array(bytes));
      return new DurableKnowledgeQueryHistoryStoreV5(filePath, history);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { rmSync(lockPath, { force: true }); throw error; }
      const history = initial ?? createKnowledgeQueryHistoryV5();
      verifyKnowledgeQueryHistoryV5(history);
      try { const store = new DurableKnowledgeQueryHistoryStoreV5(filePath, history); store.persist(history); return store; } catch (initialError) { rmSync(lockPath, { force: true }); throw initialError; }
    }
  }

  snapshot(): KnowledgeQueryHistoryV1 { this.assertOpen(); return cloneHistory(this.current); }
  get historyRoot(): string { this.assertOpen(); return this.current.historyRoot; }

  append(result: KnowledgeQueryResultV1, at: number): KnowledgeQueryHistoryV1 {
    this.assertOpen();
    const next = appendKnowledgeQueryHistoryV5(this.current, result, at);
    this.persist(next);
    this.current = next;
    return this.snapshot();
  }

  close(): void { if (this.closed) return; this.closed = true; rmSync(`${this.filePath}.lock`, { force: true }); }

  private persist(history: KnowledgeQueryHistoryV1): void { atomicWrite(this.filePath, serializeKnowledgeQueryHistoryV1(history)); }
  private assertOpen(): void { if (this.closed) throw new Error('V5 durable query history store is closed.'); }
}

function acquireLock(filePath: string): string {
  const lockPath = `${filePath}.lock`;
  mkdirSync(dirname(filePath), { recursive: true });
  let fd: number;
  try { fd = openSync(lockPath, 'wx'); writeFileSync(fd, `${process.pid}\n`, 'utf8'); closeSync(fd); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`V5 query store is already locked: ${filePath}.`); rmSync(lockPath, { force: true }); throw error; }
  return lockPath;
}

function atomicWrite(filePath: string, bytes: Uint8Array): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    writeFileSync(tempPath, bytes);
    const fd = openSync(tempPath, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tempPath, filePath);
    const dirFd = openSync(dirname(filePath), 'r');
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (error) { rmSync(tempPath, { force: true }); throw error; }
}

function isImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 { return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input; }
function cloneIndex(index: KnowledgeQueryIndexV1): KnowledgeQueryIndexV1 { return deserializeKnowledgeQueryIndexV1(serializeKnowledgeQueryIndexV1(index)); }
function cloneHistory(history: KnowledgeQueryHistoryV1): KnowledgeQueryHistoryV1 { return deserializeKnowledgeQueryHistoryV1(serializeKnowledgeQueryHistoryV1(history)); }
