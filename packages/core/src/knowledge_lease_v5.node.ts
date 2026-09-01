import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
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
    private readonly clock: () => number
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

    try {
      createLeaseFile(leasePath, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!options.recoverStale) {
        throw leaseConflict(leasePath, readLeaseRecord(leasePath), now);
      }
      recoverStaleWriterLeaseV5(leasePath, clock);
      createLeaseFile(leasePath, record);
    }

    return new DurableKnowledgeWriterLeaseV5(leasePath, record, clock);
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
    replaceLeaseFile(this.leasePath, next);
    this.record = next;
    return this.snapshot();
  }

  release(): void {
    if (this.released) return;
    const current = readLeaseRecord(this.leasePath);
    if (!sameLease(current, this.record)) {
      this.released = true;
      throw new Error('V5 writer lease ownership was lost.');
    }
    rmSync(this.leasePath, { force: true });
    this.released = true;
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

  // Re-read before unlinking so an intervening renewal or replacement is not
  // silently removed by the recovery caller.
  const confirmed = readLeaseRecord(leasePath);
  if (!sameLease(confirmed, record)) {
    throw new Error('V5 writer lease changed during stale recovery.');
  }
  rmSync(leasePath);
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

function createLeaseFile(
  leasePath: string,
  record: DurableKnowledgeWriterLeaseRecordV1
): void {
  const fd = openSync(leasePath, 'wx');
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    rmSync(leasePath, { force: true });
    throw error;
  } finally {
    closeSync(fd);
  }
}

function replaceLeaseFile(
  leasePath: string,
  record: DurableKnowledgeWriterLeaseRecordV1
): void {
  const tempPath = `${leasePath}.${process.pid}.${record.token}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(record)}\n`, 'utf8');
    renameSync(tempPath, leasePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
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
