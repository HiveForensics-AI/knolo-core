import {
  closeSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type DurableKnowledgeWriterLeaseRecordV1 = {
  version: 1;
  ownerId: string;
  token: string;
  issuedAt: number;
  expiresAt: number;
};

export type DurableKnowledgeWriterLeaseOptionsV1 = {
  ownerId?: string;
  ttlMs: number;
  now?: () => number;
  token?: string;
  recoverStale?: boolean;
};

/**
 * A small, host-owned writer lease for a durable V5 image.
 *
 * Lease recovery is deliberately opt-in. A process must explicitly request
 * recovery after checking the expired record; a live lease is never removed
 * as part of normal open or close behavior.
 */
export class DurableKnowledgeWriterLeaseV5 {
  private released = false;

  private constructor(
    readonly leasePath: string,
    private record: DurableKnowledgeWriterLeaseRecordV1,
    private readonly clock: () => number,
    private readonly recordPath: string,
    private readonly recordFd: number
  ) {}

  static acquire(
    leasePath: string,
    options: DurableKnowledgeWriterLeaseOptionsV1
  ): DurableKnowledgeWriterLeaseV5 {
    validateOptions(options);
    const clock = options.now ?? Date.now;
    const now = validateNow(clock());
    const record = createRecord(options, now);
    mkdirSync(dirname(leasePath), { recursive: true });

    let leaseFile: LeaseFileHandle;
    try {
      leaseFile = createLeaseFile(leasePath, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!options.recoverStale) {
        throw leaseConflict(leasePath, readLeaseRecord(leasePath), now);
      }
      recoverStaleWriterLeaseV5(leasePath, clock);
      leaseFile = createLeaseFile(leasePath, record);
    }

    return new DurableKnowledgeWriterLeaseV5(
      leasePath,
      record,
      clock,
      leaseFile.recordPath,
      leaseFile.recordFd
    );
  }

  snapshot(): DurableKnowledgeWriterLeaseRecordV1 {
    return { ...this.record };
  }

  assertActive(): void {
    if (this.released) throw new Error('V5 writer lease has been released.');
    const current = readLeaseRecord(this.leasePath);
    if (!sameLease(current, this.record)) {
      throw new Error('V5 writer lease ownership was lost.');
    }
    if (validateNow(this.clock()) >= current.expiresAt) {
      throw new Error('V5 writer lease has expired.');
    }
  }

  renew(
    ttlMs = this.record.expiresAt - this.record.issuedAt
  ): DurableKnowledgeWriterLeaseRecordV1 {
    this.assertActive();
    validateTtl(ttlMs);
    const now = validateNow(this.clock());
    const expiresAt = safeAdd(now, ttlMs);
    const next = {
      ...this.record,
      issuedAt: now,
      expiresAt,
    };
    // Renew the immutable record selected at acquire time. The public lease
    // path is only a symlink to that record, so a successor can replace the
    // symlink without an old owner being able to overwrite the successor.
    writeLeaseRecord(this.recordFd, next);
    try {
      const current = readLeaseRecord(this.leasePath);
      const currentPath = currentLeaseRecordPath(this.leasePath);
      if (currentPath !== this.recordPath || !sameLease(current, next)) {
        throw new Error('V5 writer lease ownership was lost.');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'V5 writer lease ownership was lost.'
      ) {
        throw error;
      }
      throw new Error('V5 writer lease ownership was lost.');
    }
    this.record = next;
    return this.snapshot();
  }

  release(): void {
    if (this.released) return;
    try {
      const current = readLeaseRecord(this.leasePath);
      if (
        !sameLease(current, this.record) ||
        currentLeaseRecordPath(this.leasePath) !== this.recordPath
      ) {
        throw new Error('V5 writer lease ownership was lost.');
      }
      unlinkSync(this.leasePath);
      rmSync(this.recordPath, { force: true });
    } finally {
      closeSync(this.recordFd);
      this.released = true;
    }
  }
}

/** Remove one verified, expired lease record. Returns false when no record exists. */
export function recoverStaleWriterLeaseV5(
  leasePath: string,
  now: (() => number) | number = Date.now
): boolean {
  let record: DurableKnowledgeWriterLeaseRecordV1;
  try {
    record = readLeaseRecord(leasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const clock = typeof now === 'function' ? now : () => now;
  const currentNow = validateNow(clock());
  if (currentNow < record.expiresAt) {
    throw new Error(
      `V5 writer lease is still active until ${record.expiresAt}.`
    );
  }

  const recordPath = currentLeaseRecordPath(leasePath);

  // Re-read before unlinking so an intervening renewal or replacement is not
  // silently removed by the recovery caller. A lease acquired by this V5
  // implementation publishes a private record through a symlink. Removing
  // that symlink fences the old owner from the pathname before a successor
  // can publish its own record.
  const confirmed = readLeaseRecord(leasePath);
  if (
    !sameLease(confirmed, record) ||
    currentLeaseRecordPath(leasePath) !== recordPath
  ) {
    throw new Error('V5 writer lease changed during stale recovery.');
  }

  try {
    unlinkSync(leasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (recordPath) rmSync(recordPath, { force: true });
  return true;
}

function createRecord(
  options: DurableKnowledgeWriterLeaseOptionsV1,
  now: number
): DurableKnowledgeWriterLeaseRecordV1 {
  return {
    version: 1,
    ownerId: options.ownerId ?? `pid-${process.pid}`,
    token: options.token ?? randomUUID(),
    issuedAt: now,
    expiresAt: safeAdd(now, options.ttlMs),
  };
}

type LeaseFileHandle = {
  recordPath: string;
  recordFd: number;
};

function createLeaseFile(
  leasePath: string,
  record: DurableKnowledgeWriterLeaseRecordV1
): LeaseFileHandle {
  const recordPath = resolve(
    `${leasePath}.${process.pid}.${record.token}.record`
  );
  const recordFd = openSync(recordPath, 'wx');
  try {
    writeLeaseRecord(recordFd, record);
    symlinkSync(basename(recordPath), leasePath);
    return { recordPath, recordFd };
  } catch (error) {
    closeSync(recordFd);
    rmSync(recordPath, { force: true });
    throw error;
  }
}

function writeLeaseRecord(
  recordFd: number,
  record: DurableKnowledgeWriterLeaseRecordV1
): void {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  ftruncateSync(recordFd, 0);
  writeSync(recordFd, bytes, 0, bytes.length, 0);
  fsyncSync(recordFd);
}

function currentLeaseRecordPath(leasePath: string): string | undefined {
  let target: string;
  try {
    target = readlinkSync(leasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EINVAL') return undefined;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  const leaseDirectory = resolve(dirname(leasePath));
  const recordPath = resolve(leaseDirectory, target);
  if (
    dirname(recordPath) !== leaseDirectory ||
    basename(recordPath) !== target
  ) {
    throw new Error(`Malformed V5 writer lease: ${leasePath}.`);
  }
  return recordPath;
}

function readLeaseRecord(
  leasePath: string
): DurableKnowledgeWriterLeaseRecordV1 {
  const parsed: unknown = JSON.parse(readFileSync(leasePath, 'utf8'));
  if (!isRecord(parsed))
    throw new Error(`Malformed V5 writer lease: ${leasePath}.`);
  const version = parsed.version;
  const ownerId = parsed.ownerId;
  const token = parsed.token;
  const issuedAt = parsed.issuedAt;
  const expiresAt = parsed.expiresAt;
  if (
    version !== 1 ||
    typeof ownerId !== 'string' ||
    ownerId.length === 0 ||
    typeof token !== 'string' ||
    token.length === 0 ||
    typeof issuedAt !== 'number' ||
    !Number.isSafeInteger(issuedAt) ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt < 0 ||
    expiresAt <= issuedAt
  ) {
    throw new Error(`Malformed V5 writer lease: ${leasePath}.`);
  }
  return { version: 1, ownerId, token, issuedAt, expiresAt };
}

function validateOptions(options: DurableKnowledgeWriterLeaseOptionsV1): void {
  if (!options || typeof options !== 'object') {
    throw new Error('V5 writer lease options are required.');
  }
  validateTtl(options.ttlMs);
  if (options.ownerId !== undefined && !options.ownerId) {
    throw new Error('V5 writer lease owner ID must not be empty.');
  }
  if (options.token !== undefined && !options.token) {
    throw new Error('V5 writer lease token must not be empty.');
  }
}

function validateTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error('V5 writer lease TTL must be a positive safe integer.');
  }
}

function validateNow(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error(
      'V5 writer lease clock must return a non-negative safe integer.'
    );
  }
  return now;
}

function safeAdd(left: number, right: number): number {
  if (left > Number.MAX_SAFE_INTEGER - right) {
    throw new Error('V5 writer lease expiry exceeds the safe integer range.');
  }
  return left + right;
}

function sameLease(
  left: DurableKnowledgeWriterLeaseRecordV1,
  right: DurableKnowledgeWriterLeaseRecordV1
): boolean {
  return (
    left.version === right.version &&
    left.ownerId === right.ownerId &&
    left.token === right.token &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt
  );
}

function leaseConflict(
  leasePath: string,
  current: DurableKnowledgeWriterLeaseRecordV1,
  now: number
): Error {
  if (current.expiresAt <= now) {
    return new Error(
      `V5 writer lease is expired and requires explicit recovery: ${leasePath}.`
    );
  }
  return new Error(
    `V5 writer lease is already held by ${current.ownerId} until ${current.expiresAt}.`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
