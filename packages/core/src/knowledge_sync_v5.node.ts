import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  deserializeKnowledgeSyncReplayStateV1,
  KnowledgeSyncReplayCacheV1,
  serializeKnowledgeSyncReplayStateV1,
  type KnowledgeSyncReplayStateV1,
} from './knowledge_sync_exchange_v5.js';

export type DurableKnowledgeSyncReplayStoreOptionsV1 = { maxEntries?: number };

export class DurableKnowledgeSyncReplayStoreV5 {
  readonly replayCache: KnowledgeSyncReplayCacheV1;
  private closed = false;

  private constructor(private readonly filePath: string, replayCache: KnowledgeSyncReplayCacheV1) {
    this.replayCache = replayCache;
  }

  static open(filePath: string, options: DurableKnowledgeSyncReplayStoreOptionsV1 = {}): DurableKnowledgeSyncReplayStoreV5 {
    const lockPath = acquireLock(filePath);
    try {
      const state = deserializeKnowledgeSyncReplayStateV1(new Uint8Array(readFileSync(filePath)));
      if (options.maxEntries !== undefined && options.maxEntries !== state.maxEntries) throw new Error('V5 durable sync replay capacity mismatch.');
      const cache = KnowledgeSyncReplayCacheV1.fromState(state, { onChange: (next) => atomicWrite(filePath, serializeKnowledgeSyncReplayStateV1(next)) });
      return new DurableKnowledgeSyncReplayStoreV5(filePath, cache);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { rmSync(lockPath, { force: true }); throw error; }
      const maxEntries = options.maxEntries ?? 1024;
      const cache = new KnowledgeSyncReplayCacheV1({ maxEntries, onChange: (next) => atomicWrite(filePath, serializeKnowledgeSyncReplayStateV1(next)) });
      try { atomicWrite(filePath, serializeKnowledgeSyncReplayStateV1(cache.snapshot())); return new DurableKnowledgeSyncReplayStoreV5(filePath, cache); } catch (initialError) { rmSync(lockPath, { force: true }); throw initialError; }
    }
  }

  snapshot(): KnowledgeSyncReplayStateV1 { this.assertOpen(); return this.replayCache.snapshot(); }
  get size(): number { this.assertOpen(); return this.replayCache.size; }
  close(): void { if (this.closed) return; this.closed = true; rmSync(`${this.filePath}.lock`, { force: true }); }
  private assertOpen(): void { if (this.closed) throw new Error('V5 durable sync replay store is closed.'); }
}

function acquireLock(filePath: string): string {
  const lockPath = `${filePath}.lock`;
  mkdirSync(dirname(filePath), { recursive: true });
  let fd: number;
  try { fd = openSync(lockPath, 'wx'); writeFileSync(fd, `${process.pid}\n`, 'utf8'); closeSync(fd); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`V5 sync replay store is already locked: ${filePath}.`); rmSync(lockPath, { force: true }); throw error; }
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
