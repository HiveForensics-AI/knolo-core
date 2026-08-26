import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  applyKnowledgeKeyRotationV5,
  applyKnowledgeKeyRotationV5Async,
  authorityKeyringRootV1,
  deserializeAuthorityKeyringV1,
  serializeAuthorityKeyringV1,
  type KnowledgeAuthorityKeyringV1,
  type KnowledgeKeyRotationRecordV1,
  type KnowledgeKeyRotationVerificationOptionsV1,
  type KnowledgeKeyRotationAsyncVerificationOptionsV1,
} from './knowledge_key_rotation_v5.js';

export class DurableAuthorityKeyringStoreV5 {
  private readonly lockPath: string;
  private closed = false;

  private constructor(private readonly filePath: string, private current: KnowledgeAuthorityKeyringV1) {
    this.lockPath = `${filePath}.lock`;
  }

  static open(filePath: string, initial?: KnowledgeAuthorityKeyringV1): DurableAuthorityKeyringStoreV5 {
    const lockPath = `${filePath}.lock`;
    mkdirSync(dirname(filePath), { recursive: true });
    let lockFd: number;
    try {
      lockFd = openSync(lockPath, 'wx');
      try { writeFileSync(lockFd, `${process.pid}\n`, 'utf8'); } finally { closeSync(lockFd); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`V5 authority keyring is already locked: ${filePath}.`);
      rmSync(lockPath, { force: true });
      throw error;
    }
    try {
      const keyring = deserializeAuthorityKeyringV1(new Uint8Array(readFileSync(filePath)));
      return new DurableAuthorityKeyringStoreV5(filePath, keyring);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !initial) {
        rmSync(lockPath, { force: true });
        throw error;
      }
      try {
        const store = new DurableAuthorityKeyringStoreV5(filePath, cloneKeyring(initial));
        store.persist();
        return store;
      } catch (initialError) {
        rmSync(lockPath, { force: true });
        throw initialError;
      }
    }
  }

  snapshot(): KnowledgeAuthorityKeyringV1 {
    this.assertOpen();
    return cloneKeyring(this.current);
  }

  get root(): string {
    this.assertOpen();
    return authorityKeyringRootV1(this.current);
  }

  appendRotation(record: KnowledgeKeyRotationRecordV1, options: KnowledgeKeyRotationVerificationOptionsV1): KnowledgeAuthorityKeyringV1 {
    this.assertOpen();
    const next = applyKnowledgeKeyRotationV5(this.current, record, options);
    this.current = next;
    this.persist();
    return this.snapshot();
  }

  async appendRotationAsync(record: KnowledgeKeyRotationRecordV1, options: KnowledgeKeyRotationAsyncVerificationOptionsV1): Promise<KnowledgeAuthorityKeyringV1> {
    this.assertOpen();
    const next = await applyKnowledgeKeyRotationV5Async(this.current, record, options);
    this.current = next;
    this.persist();
    return this.snapshot();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    rmSync(this.lockPath, { force: true });
  }

  private persist(): void {
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(tempPath, serializeAuthorityKeyringV1(this.current));
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
    if (this.closed) throw new Error('V5 authority keyring is closed.');
  }
}

function cloneKeyring(keyring: KnowledgeAuthorityKeyringV1): KnowledgeAuthorityKeyringV1 {
  return {
    version: 1,
    sequence: keyring.sequence,
    keys: keyring.keys.map((key) => ({ ...key, publicKey: new Uint8Array(key.publicKey) })),
    rotations: keyring.rotations.map((record) => ({ ...record, publicKey: new Uint8Array(record.publicKey), signature: new Uint8Array(record.signature) })),
  };
}
