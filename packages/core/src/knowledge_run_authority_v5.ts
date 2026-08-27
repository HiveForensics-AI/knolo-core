import {
  canonicalCbor,
  digestBytes,
  digestDomain,
  type CborValue,
  type Digest,
} from './knowledge_image_v5.js';
import { verifyKnowledgeRunV1, type KnowledgeRunV1 } from './knowledge_run_v5.js';

export type KnowledgeRunAuthorityEnvelopeV1 = {
  version: 1;
  issuer: string;
  subject: string;
  runId: Digest;
  runRoot: Digest;
  imageStateRoot: Digest;
  keyringRoot?: Digest;
  issuedAt: number;
  expiresAt: number;
  algorithm: string;
  keyId?: string;
  signature: Uint8Array;
};

export type KnowledgeRunAuthorityVerificationV1 = {
  valid: true;
  envelopeRoot: Digest;
  issuer: string;
  subject: string;
  runId: Digest;
  runRoot: Digest;
  imageStateRoot: Digest;
  keyringRoot?: Digest;
};

export type KnowledgeRunAuthorityVerificationOptionsV1 = {
  now: number;
  resolveKey: (principal: string, algorithm: string, keyId?: string) => Uint8Array | undefined;
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
  expectedKeyringRoot?: Digest;
};

export type KnowledgeRunAuthorityAsyncVerificationOptionsV1 = Omit<KnowledgeRunAuthorityVerificationOptionsV1, 'verifySignature'> & {
  verifySignature: (algorithm: string, key: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean | Promise<boolean>;
};

export function runAuthorityPayloadV1(envelope: KnowledgeRunAuthorityEnvelopeV1): Uint8Array {
  return canonicalCbor({ algorithm: envelope.algorithm, expiresAt: envelope.expiresAt, imageStateRoot: envelope.imageStateRoot, issuedAt: envelope.issuedAt, issuer: envelope.issuer, keyId: envelope.keyId ?? null, keyringRoot: envelope.keyringRoot ?? null, runId: envelope.runId, runRoot: envelope.runRoot, subject: envelope.subject, version: envelope.version } as unknown as CborValue);
}

export function runAuthorityRootV1(envelope: KnowledgeRunAuthorityEnvelopeV1): Digest {
  return digestDomain('run-authority-envelope', canonicalCbor({ payload: runAuthorityPayloadV1(envelope), signature: envelope.signature } as unknown as CborValue));
}

export function verifyKnowledgeRunAuthorityV5(run: KnowledgeRunV1, envelope: KnowledgeRunAuthorityEnvelopeV1, options: KnowledgeRunAuthorityVerificationOptionsV1): KnowledgeRunAuthorityVerificationV1 {
  verifyKnowledgeRunV1(run);
  validateEnvelope(envelope, options.now);
  assertBinding(run, envelope, options.expectedKeyringRoot);
  const key = options.resolveKey(envelope.issuer, envelope.algorithm, envelope.keyId);
  if (!(key instanceof Uint8Array) || !options.verifySignature(envelope.algorithm, key, runAuthorityPayloadV1(envelope), envelope.signature)) throw new Error('V5 run authority signature verification failed.');
  return result(envelope);
}

export async function verifyKnowledgeRunAuthorityV5Async(run: KnowledgeRunV1, envelope: KnowledgeRunAuthorityEnvelopeV1, options: KnowledgeRunAuthorityAsyncVerificationOptionsV1): Promise<KnowledgeRunAuthorityVerificationV1> {
  verifyKnowledgeRunV1(run);
  validateEnvelope(envelope, options.now);
  assertBinding(run, envelope, options.expectedKeyringRoot);
  const key = options.resolveKey(envelope.issuer, envelope.algorithm, envelope.keyId);
  if (!(key instanceof Uint8Array) || !await options.verifySignature(envelope.algorithm, key, runAuthorityPayloadV1(envelope), envelope.signature)) throw new Error('V5 run authority signature verification failed.');
  return result(envelope);
}

function validateEnvelope(envelope: KnowledgeRunAuthorityEnvelopeV1, now: number): void {
  if (!envelope || envelope.version !== 1 || !envelope.issuer || !envelope.subject || !envelope.algorithm || !isDigest(envelope.runId) || !isDigest(envelope.runRoot) || !isDigest(envelope.imageStateRoot) || (envelope.keyringRoot !== undefined && !isDigest(envelope.keyringRoot)) || (envelope.keyId !== undefined && !envelope.keyId) || !(envelope.signature instanceof Uint8Array) || envelope.signature.length === 0 || !Number.isSafeInteger(now) || !Number.isSafeInteger(envelope.issuedAt) || !Number.isSafeInteger(envelope.expiresAt) || envelope.issuedAt > now || now >= envelope.expiresAt) throw new Error('Malformed or expired V5 run authority envelope.');
}

function assertBinding(run: KnowledgeRunV1, envelope: KnowledgeRunAuthorityEnvelopeV1, expectedKeyringRoot?: Digest): void {
  if (envelope.runId !== run.runId || envelope.runRoot !== run.runRoot || envelope.imageStateRoot !== run.imageStateRoot) throw new Error('V5 run authority binding mismatch.');
  if (envelope.keyringRoot !== undefined && expectedKeyringRoot !== envelope.keyringRoot) throw new Error('V5 run authority keyring root mismatch.');
}

function result(envelope: KnowledgeRunAuthorityEnvelopeV1): KnowledgeRunAuthorityVerificationV1 { return { valid: true, envelopeRoot: runAuthorityRootV1(envelope), issuer: envelope.issuer, subject: envelope.subject, runId: envelope.runId, runRoot: envelope.runRoot, imageStateRoot: envelope.imageStateRoot, ...(envelope.keyringRoot === undefined ? {} : { keyringRoot: envelope.keyringRoot }) }; }
function isDigest(value: unknown): value is Digest { if (typeof value !== 'string') return false; try { digestBytes(value); return true; } catch { return false; } }
