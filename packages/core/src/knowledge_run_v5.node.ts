import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalCbor, type CborValue } from './knowledge_image_v5.js';
import {
  checkpointKnowledgeRunV1,
  completeKnowledgeRunV1,
  deserializeKnowledgeRunV1,
  failKnowledgeRunV1,
  resumeKnowledgeRunV1,
  serializeKnowledgeRunV1,
  startKnowledgeRunV1,
  verifyKnowledgeRunV1,
  type KnowledgeRunStateV1,
  type KnowledgeRunV1,
} from './knowledge_run_v5.js';

export class DurableKnowledgeRunStoreV5 {
  private readonly lockPath: string;
  private closed = false;

  private constructor(private readonly filePath: string, private current: KnowledgeRunV1) {
    this.lockPath = `${filePath}.lock`;
  }

  static open(filePath: string, initial?: KnowledgeRunV1): DurableKnowledgeRunStoreV5 {
    const lockPath = `${filePath}.lock`;
    mkdirSync(dirname(filePath), { recursive: true });
    let lockFd: number;
    try {
      lockFd = openSync(lockPath, 'wx');
      try { writeFileSync(lockFd, `${process.pid}\n`, 'utf8'); } finally { closeSync(lockFd); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`V5 run store is already locked: ${filePath}.`);
      rmSync(lockPath, { force: true });
      throw error;
    }
    try {
      const run = deserializeKnowledgeRunV1(new Uint8Array(readFileSync(filePath)));
      return new DurableKnowledgeRunStoreV5(filePath, run);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !initial) {
        rmSync(lockPath, { force: true });
        throw error;
      }
      try {
        verifyKnowledgeRunV1(initial);
        const store = new DurableKnowledgeRunStoreV5(filePath, cloneRun(initial));
        store.persist(store.current);
        return store;
      } catch (initialError) {
        rmSync(lockPath, { force: true });
        throw initialError;
      }
    }
  }

  snapshot(): KnowledgeRunV1 {
    this.assertOpen();
    return cloneRun(this.current);
  }

  get runId(): string { this.assertOpen(); return this.current.runId; }
  get runRoot(): string { this.assertOpen(); return this.current.runRoot; }

  update(next: KnowledgeRunV1): KnowledgeRunV1 {
    this.assertOpen();
    verifyKnowledgeRunV1(next);
    if (next.runId !== this.current.runId || next.sequence < this.current.sequence || !hasEventPrefix(this.current, next)) throw new Error('V5 durable run update does not extend the current run journal.');
    this.persist(next);
    this.current = cloneRun(next);
    return this.snapshot();
  }

  start(at: number): KnowledgeRunV1 { return this.update(startKnowledgeRunV1(this.current, at)); }
  checkpoint(state: KnowledgeRunStateV1, at: number): KnowledgeRunV1 { return this.update(checkpointKnowledgeRunV1(this.current, state, at)); }
  resume(at: number): KnowledgeRunV1 { return this.update(resumeKnowledgeRunV1(this.current, at)); }
  complete(result: KnowledgeRunStateV1 = {}, at: number): KnowledgeRunV1 { return this.update(completeKnowledgeRunV1(this.current, result, at)); }
  fail(error: string, at: number): KnowledgeRunV1 { return this.update(failKnowledgeRunV1(this.current, error, at)); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    rmSync(this.lockPath, { force: true });
  }

  private persist(run: KnowledgeRunV1): void {
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(tempPath, serializeKnowledgeRunV1(run));
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

  private assertOpen(): void { if (this.closed) throw new Error('V5 durable run store is closed.'); }
}

function cloneRun(run: KnowledgeRunV1): KnowledgeRunV1 { return deserializeKnowledgeRunV1(serializeKnowledgeRunV1(run)); }

function hasEventPrefix(current: KnowledgeRunV1, next: KnowledgeRunV1): boolean {
  return current.events.every((event, index) => bytesEqual(canonicalCbor(event as unknown as CborValue), canonicalCbor(next.events[index] as unknown as CborValue)));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((byte, index) => byte === right[index]); }
