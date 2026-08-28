import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestDomain,
  type CborValue,
  type Digest,
} from './knowledge_image_v5.js';

export type KnowledgeAuthorityKeyV1 = {
  version: 1;
  principal: string;
  keyId: string;
  algorithm: string;
  publicKey: Uint8Array;
  notBefore?: number;
  notAfter?: number;
  revokedAt?: number;
};

export type KnowledgeKeyRotationRecordV1 = {
  version: 1;
  kind: 'key-rotation';
  issuer: string;
  issuerKeyId: string;
  principal: string;
  previousKeyId?: string;
  keyId: string;
  algorithm: string;
  publicKey: Uint8Array;
  notBefore: number;
  notAfter?: number;
  revokedAt?: number;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export type KnowledgeAuthorityKeyringV1 = {
  version: 1;
  sequence: number;
  keys: KnowledgeAuthorityKeyV1[];
  rotations: KnowledgeKeyRotationRecordV1[];
};

export type KnowledgeKeyRotationVerificationOptionsV1 = {
  now: number;
  resolveKey: (principal: string, algorithm: string, keyId?: string) => Uint8Array | undefined;
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
};

export type KnowledgeKeyRotationAsyncVerificationOptionsV1 = Omit<KnowledgeKeyRotationVerificationOptionsV1, 'verifySignature'> & {
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean | Promise<boolean>;
};

export function authorityKeyPayloadV1(key: KnowledgeAuthorityKeyV1): Uint8Array {
  validateKey(key);
  return canonicalCbor(keyToCbor(key));
}

export function keyRotationPayloadV1(record: KnowledgeKeyRotationRecordV1): Uint8Array {
  validateRotation(record);
  return canonicalCbor(rotationToCbor(record, false));
}

export function keyRotationRootV1(record: KnowledgeKeyRotationRecordV1): Digest {
  return digestDomain('key-rotation', canonicalCbor({
    payload: keyRotationPayloadV1(record),
    signature: record.signature,
  } as unknown as CborValue));
}

export function authorityKeyringRootV1(keyring: KnowledgeAuthorityKeyringV1): Digest {
  validateKeyring(keyring);
  const keys = [...keyring.keys].sort(compareKeys).map((key) => authorityKeyPayloadV1(key));
  const rotations = keyring.rotations.map((record) => keyRotationRootV1(record));
  return digestDomain('authority-keyring', canonicalCbor({
    keys,
    rotations,
    sequence: keyring.sequence,
    version: keyring.version,
  } as unknown as CborValue));
}

export function serializeAuthorityKeyringV1(keyring: KnowledgeAuthorityKeyringV1): Uint8Array {
  validateKeyring(keyring);
  return canonicalCbor({
    keys: [...keyring.keys].sort(compareKeys).map(keyToCbor),
    rotations: keyring.rotations.map((record) => rotationToCbor(record, true)),
    sequence: keyring.sequence,
    version: keyring.version,
  } as unknown as CborValue);
}

export function deserializeAuthorityKeyringV1(bytes: Uint8Array): KnowledgeAuthorityKeyringV1 {
  const value = asRecord(decodeCanonicalCbor(bytes));
  const keyring: KnowledgeAuthorityKeyringV1 = {
    version: asNumber(value.version) as 1,
    sequence: asNumber(value.sequence),
    keys: asArray(value.keys).map(decodeKey),
    rotations: asArray(value.rotations).map(decodeRotation),
  };
  validateKeyring(keyring);
  if (!bytesEqual(serializeAuthorityKeyringV1(keyring), bytes)) throw new Error('Non-canonical V5 authority keyring.');
  return keyring;
}

export function verifyKnowledgeKeyRotationV5(
  keyring: KnowledgeAuthorityKeyringV1,
  record: KnowledgeKeyRotationRecordV1,
  options: KnowledgeKeyRotationVerificationOptionsV1,
): void {
  validateKeyring(keyring);
  validateRotation(record);
  if (!Number.isSafeInteger(options.now) || record.issuedAt > options.now || options.now >= record.expiresAt) throw new Error('V5 key rotation is outside its validity window.');
  const issuerKey = keyring.keys.find((key) => key.principal === record.issuer && key.keyId === record.issuerKeyId);
  if (!issuerKey || issuerKey.algorithm !== record.algorithm || !isKeyValidAt(issuerKey, record.issuedAt)) throw new Error('V5 key rotation issuer key is unavailable.');
  if (record.previousKeyId !== undefined) {
    const previous = keyring.keys.find((key) => key.principal === record.principal && key.keyId === record.previousKeyId);
    if (!previous || previous.algorithm !== record.algorithm || record.notBefore < (previous.notBefore ?? 0)) throw new Error('V5 key rotation predecessor is invalid.');
  }
  const key = options.resolveKey(record.issuer, record.algorithm, record.issuerKeyId);
  if (!(key instanceof Uint8Array) || !options.verifySignature(record.algorithm, key, keyRotationPayloadV1(record), record.signature)) throw new Error('V5 key rotation signature verification failed.');
}

export async function verifyKnowledgeKeyRotationV5Async(
  keyring: KnowledgeAuthorityKeyringV1,
  record: KnowledgeKeyRotationRecordV1,
  options: KnowledgeKeyRotationAsyncVerificationOptionsV1,
): Promise<void> {
  validateKeyring(keyring);
  validateRotation(record);
  if (!Number.isSafeInteger(options.now) || record.issuedAt > options.now || options.now >= record.expiresAt) throw new Error('V5 key rotation is outside its validity window.');
  const issuerKey = keyring.keys.find((key) => key.principal === record.issuer && key.keyId === record.issuerKeyId);
  if (!issuerKey || issuerKey.algorithm !== record.algorithm || !isKeyValidAt(issuerKey, record.issuedAt)) throw new Error('V5 key rotation issuer key is unavailable.');
  if (record.previousKeyId !== undefined) {
    const previous = keyring.keys.find((key) => key.principal === record.principal && key.keyId === record.previousKeyId);
    if (!previous || previous.algorithm !== record.algorithm || record.notBefore < (previous.notBefore ?? 0)) throw new Error('V5 key rotation predecessor is invalid.');
  }
  const key = options.resolveKey(record.issuer, record.algorithm, record.issuerKeyId);
  if (!(key instanceof Uint8Array) || !await options.verifySignature(record.algorithm, key, keyRotationPayloadV1(record), record.signature)) throw new Error('V5 key rotation signature verification failed.');
}

export function applyKnowledgeKeyRotationV5(
  keyring: KnowledgeAuthorityKeyringV1,
  record: KnowledgeKeyRotationRecordV1,
  options: KnowledgeKeyRotationVerificationOptionsV1,
): KnowledgeAuthorityKeyringV1 {
  if (keyring.rotations.some((existing) => keyRotationRootV1(existing) === keyRotationRootV1(record))) throw new Error('V5 key rotation is already present.');
  verifyKnowledgeKeyRotationV5(keyring, record, options);
  return applyVerifiedKeyRotation(keyring, record);
}

export async function applyKnowledgeKeyRotationV5Async(
  keyring: KnowledgeAuthorityKeyringV1,
  record: KnowledgeKeyRotationRecordV1,
  options: KnowledgeKeyRotationAsyncVerificationOptionsV1,
): Promise<KnowledgeAuthorityKeyringV1> {
  if (keyring.rotations.some((existing) => keyRotationRootV1(existing) === keyRotationRootV1(record))) throw new Error('V5 key rotation is already present.');
  await verifyKnowledgeKeyRotationV5Async(keyring, record, options);
  return applyVerifiedKeyRotation(keyring, record);
}

function applyVerifiedKeyRotation(keyring: KnowledgeAuthorityKeyringV1, record: KnowledgeKeyRotationRecordV1): KnowledgeAuthorityKeyringV1 {
  if (keyring.rotations.some((existing) => keyRotationRootV1(existing) === keyRotationRootV1(record))) throw new Error('V5 key rotation is already present.');
  if (keyring.keys.some((key) => key.principal === record.principal && key.keyId === record.keyId)) throw new Error('V5 key rotation key ID already exists.');
  const keys = keyring.keys.map((key) => ({ ...key, publicKey: new Uint8Array(key.publicKey) }));
  if (record.previousKeyId !== undefined) {
    const previous = keys.find((key) => key.principal === record.principal && key.keyId === record.previousKeyId);
    if (previous && previous.revokedAt === undefined) previous.revokedAt = record.notBefore;
  }
  keys.push({
    version: 1,
    principal: record.principal,
    keyId: record.keyId,
    algorithm: record.algorithm,
    publicKey: new Uint8Array(record.publicKey),
    ...(record.notBefore === undefined ? {} : { notBefore: record.notBefore }),
    ...(record.notAfter === undefined ? {} : { notAfter: record.notAfter }),
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
  });
  return { version: 1, sequence: keyring.sequence + 1, keys, rotations: [...keyring.rotations, cloneRotation(record)] };
}

function validateKeyring(keyring: KnowledgeAuthorityKeyringV1): void {
  if (keyring.version !== 1 || !Number.isSafeInteger(keyring.sequence) || keyring.sequence < 0 || !Array.isArray(keyring.keys) || !Array.isArray(keyring.rotations)) throw new Error('Malformed V5 authority keyring.');
  const ids = new Set<string>();
  for (const key of keyring.keys) {
    validateKey(key);
    const id = `${key.principal}\0${key.keyId}`;
    if (ids.has(id)) throw new Error('Duplicate V5 authority key.');
    ids.add(id);
  }
  for (const record of keyring.rotations) validateRotation(record);
  if (keyring.sequence < keyring.rotations.length) throw new Error('V5 authority keyring sequence is behind its rotation history.');
}

function validateKey(key: KnowledgeAuthorityKeyV1): void {
  if (key.version !== 1 || !key.principal || !key.keyId || !key.algorithm || !(key.publicKey instanceof Uint8Array) || key.publicKey.length === 0) throw new Error('Malformed V5 authority key.');
  if (key.notBefore !== undefined && !Number.isSafeInteger(key.notBefore)) throw new Error('Invalid V5 authority key notBefore.');
  if (key.notAfter !== undefined && (!Number.isSafeInteger(key.notAfter) || (key.notBefore !== undefined && key.notAfter <= key.notBefore))) throw new Error('Invalid V5 authority key notAfter.');
  if (key.revokedAt !== undefined && !Number.isSafeInteger(key.revokedAt)) throw new Error('Invalid V5 authority key revokedAt.');
}

function validateRotation(record: KnowledgeKeyRotationRecordV1): void {
  if (record.version !== 1 || record.kind !== 'key-rotation' || !record.issuer || !record.issuerKeyId || !record.principal || !record.keyId || !record.algorithm || !(record.publicKey instanceof Uint8Array) || record.publicKey.length === 0 || !(record.signature instanceof Uint8Array) || record.signature.length === 0) throw new Error('Malformed V5 key rotation.');
  for (const value of [record.notBefore, record.issuedAt, record.expiresAt]) if (!Number.isSafeInteger(value)) throw new Error('Invalid V5 key rotation time.');
  if (record.issuedAt > record.expiresAt || record.notBefore < record.issuedAt || record.notBefore >= record.expiresAt) throw new Error('Invalid V5 key rotation validity window.');
  if (record.notAfter !== undefined && (!Number.isSafeInteger(record.notAfter) || record.notAfter <= record.notBefore)) throw new Error('Invalid V5 key rotation notAfter.');
  if (record.revokedAt !== undefined && (!Number.isSafeInteger(record.revokedAt) || record.revokedAt < record.notBefore)) throw new Error('Invalid V5 key rotation revokedAt.');
  if (record.previousKeyId === '') throw new Error('Invalid V5 key rotation predecessor.');
}

function isKeyValidAt(key: KnowledgeAuthorityKeyV1, at: number): boolean {
  return (key.notBefore === undefined || key.notBefore <= at) && (key.notAfter === undefined || at < key.notAfter) && (key.revokedAt === undefined || at < key.revokedAt);
}

function keyToCbor(key: KnowledgeAuthorityKeyV1): CborValue {
  return {
    algorithm: key.algorithm,
    keyId: key.keyId,
    principal: key.principal,
    publicKey: key.publicKey,
    version: key.version,
    ...(key.notAfter === undefined ? {} : { notAfter: key.notAfter }),
    ...(key.notBefore === undefined ? {} : { notBefore: key.notBefore }),
    ...(key.revokedAt === undefined ? {} : { revokedAt: key.revokedAt }),
  } as unknown as CborValue;
}

function rotationToCbor(record: KnowledgeKeyRotationRecordV1, includeSignature: boolean): CborValue {
  return {
    algorithm: record.algorithm,
    expiresAt: record.expiresAt,
    issuedAt: record.issuedAt,
    issuer: record.issuer,
    issuerKeyId: record.issuerKeyId,
    keyId: record.keyId,
    kind: record.kind,
    notBefore: record.notBefore,
    publicKey: record.publicKey,
    principal: record.principal,
    version: record.version,
    ...(includeSignature ? { signature: record.signature } : {}),
    ...(record.notAfter === undefined ? {} : { notAfter: record.notAfter }),
    ...(record.previousKeyId === undefined ? {} : { previousKeyId: record.previousKeyId }),
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
  } as unknown as CborValue;
}

function decodeKey(value: CborValue): KnowledgeAuthorityKeyV1 {
  const record = asRecord(value);
  return {
    version: asNumber(record.version) as 1,
    principal: asString(record.principal),
    keyId: asString(record.keyId),
    algorithm: asString(record.algorithm),
    publicKey: asBytes(record.publicKey),
    ...(record.notBefore === undefined ? {} : { notBefore: asNumber(record.notBefore) }),
    ...(record.notAfter === undefined ? {} : { notAfter: asNumber(record.notAfter) }),
    ...(record.revokedAt === undefined ? {} : { revokedAt: asNumber(record.revokedAt) }),
  };
}

function decodeRotation(value: CborValue): KnowledgeKeyRotationRecordV1 {
  const record = asRecord(value);
  return {
    version: asNumber(record.version) as 1,
    kind: asString(record.kind) as 'key-rotation',
    issuer: asString(record.issuer),
    issuerKeyId: asString(record.issuerKeyId),
    principal: asString(record.principal),
    keyId: asString(record.keyId),
    algorithm: asString(record.algorithm),
    publicKey: asBytes(record.publicKey),
    notBefore: asNumber(record.notBefore),
    ...(record.notAfter === undefined ? {} : { notAfter: asNumber(record.notAfter) }),
    ...(record.previousKeyId === undefined ? {} : { previousKeyId: asString(record.previousKeyId) }),
    ...(record.revokedAt === undefined ? {} : { revokedAt: asNumber(record.revokedAt) }),
    issuedAt: asNumber(record.issuedAt),
    expiresAt: asNumber(record.expiresAt),
    signature: asBytes(record.signature),
  };
}

function compareKeys(left: KnowledgeAuthorityKeyV1, right: KnowledgeAuthorityKeyV1): number {
  const leftBytes = new TextEncoder().encode(`${left.principal}\0${left.keyId}`);
  const rightBytes = new TextEncoder().encode(`${right.principal}\0${right.keyId}`);
  for (let i = 0; i < Math.min(leftBytes.length, rightBytes.length); i++) if (leftBytes[i] !== rightBytes[i]) return leftBytes[i] - rightBytes[i];
  return leftBytes.length - rightBytes.length;
}

function cloneRotation(record: KnowledgeKeyRotationRecordV1): KnowledgeKeyRotationRecordV1 {
  return { ...record, publicKey: new Uint8Array(record.publicKey), signature: new Uint8Array(record.signature) };
}

function asRecord(value: CborValue): Record<string, CborValue> { if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Expected V5 authority keyring map.'); return value as Record<string, CborValue>; }
function asArray(value: CborValue | undefined): CborValue[] { if (!Array.isArray(value)) throw new Error('Expected V5 authority keyring array.'); return value; }
function asString(value: CborValue | undefined): string { if (typeof value !== 'string') throw new Error('Expected V5 authority keyring text.'); return value; }
function asNumber(value: CborValue | undefined): number { if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Expected V5 authority keyring integer.'); const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error('V5 authority keyring integer exceeds safe range.'); return number; }
function asBytes(value: CborValue | undefined): Uint8Array { if (!(value instanceof Uint8Array)) throw new Error('Expected V5 authority keyring bytes.'); return value; }
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
