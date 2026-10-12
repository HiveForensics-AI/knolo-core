import { createKarSession, evaluateKar } from '../experimental/kar/session.js';
import { KarError } from '../experimental/kar/types.js';
import {
  authorityKeyringRootV1,
  type KnowledgeAuthorityKeyringV1,
} from '../knowledge_key_rotation_v5.js';
import { canonicalCbor, type CborValue, type Digest } from '../knowledge_image_v5.js';
import { ATTESTATION_DOMAIN, ATTESTATION_FORMAT, SIGNATURE_DOMAIN, SIGNATURE_FORMAT, STATEMENTS } from './constants.js';
import { decodeBase64, encodeBase64, exactKeys, isDigest, isRecord, requireDigest, requireToken, rooted } from './codec.js';
import { CompositionError } from './errors.js';
import { parseCompositionRecord, type CompositionRecord } from './record.js';

export type AttestationStatement = (typeof STATEMENTS)[number];

export type AttestationSubject =
  | { kind: 'composition'; compositionRoot: Digest }
  | { kind: 'v5-image'; stateRoot: Digest; objectRoot: Digest; commitDigest: Digest }
  | { kind: 'kar-result'; karRoot: Digest; knowledgeRoot: Digest; stateRoot: Digest }
  | { kind: 'excerpt'; excerptRoot: Digest };

export type AttestationSignature = {
  format: typeof SIGNATURE_FORMAT;
  version: 1;
  attestationRoot: Digest;
  algorithm: 'Ed25519';
  principal: string;
  keyId: string;
  keyringRoot?: Digest;
  issuedAt: number;
  expiresAt: number;
  signature: string;
  signatureRoot: Digest;
};

export type CompositionAttestation = {
  format: typeof ATTESTATION_FORMAT;
  version: 1;
  attestationRoot: Digest;
  compositionRoot: Digest;
  subject: AttestationSubject;
  statement: AttestationStatement;
  signature?: AttestationSignature;
};

export type AttestationVerification =
  | { ok: true; attestationRoot: Digest; signature: 'absent' | 'verified' | 'content-only'; usage: 'not-applicable' | 'not-rerun' | 'rerun' }
  | { ok: false; code: CompositionError['code']; path?: string };

export type SignatureInput = {
  principal: string;
  keyId: string;
  keyringRoot?: Digest;
  issuedAt: number;
  expiresAt: number;
  signature: Uint8Array;
};

export function createCompositionAttestation(input: {
  record: CompositionRecord;
  subject: AttestationSubject;
  statement: AttestationStatement;
}): { attestation: CompositionAttestation; attestationRoot: Digest } {
  const record = parseCompositionRecord(input.record);
  if (!STATEMENTS.includes(input.statement)) {
    throw new CompositionError('ATTESTATION_INVALID', 'statement must be mount, used, or cited.', 'statement');
  }
  const subject = normalizeSubject(input.subject, record, input.statement);
  const attestation = finish({ compositionRoot: record.compositionRoot, subject, statement: input.statement });
  return { attestation, attestationRoot: attestation.attestationRoot };
}

export function withCompositionSignature(attestation: CompositionAttestation, signature: SignatureInput): CompositionAttestation {
  const parsed = parseAttestation(attestation);
  if (parsed.signature) throw new CompositionError('ATTESTATION_INVALID', 'Attestation already has a signature.', 'signature');
  const principal = requireToken(signature.principal, 'signature.principal');
  const keyId = requireToken(signature.keyId, 'signature.keyId');
  const issuedAt = requireTime(signature.issuedAt, 'signature.issuedAt');
  const expiresAt = requireTime(signature.expiresAt, 'signature.expiresAt');
  if (expiresAt <= issuedAt) throw new CompositionError('ATTESTATION_INVALID', 'expiresAt must be after issuedAt.', 'signature.expiresAt');
  if (!(signature.signature instanceof Uint8Array) || signature.signature.length !== 64) {
    throw new CompositionError('ATTESTATION_INVALID', 'Ed25519 signatures are 64 bytes.', 'signature.signature');
  }
  const envelope: Omit<AttestationSignature, 'signature' | 'signatureRoot'> = {
    format: SIGNATURE_FORMAT,
    version: 1,
    attestationRoot: parsed.attestationRoot,
    algorithm: 'Ed25519',
    principal,
    keyId,
    issuedAt,
    expiresAt,
  };
  if (signature.keyringRoot) envelope.keyringRoot = requireDigest(signature.keyringRoot, 'signature.keyringRoot', 'ATTESTATION_INVALID');
  const payload = signaturePayload(envelope);
  return {
    ...parsed,
    signature: {
      ...envelope,
      signature: encodeBase64(signature.signature),
      signatureRoot: rooted(SIGNATURE_DOMAIN, { payload, signature: signature.signature } as unknown as CborValue),
    },
  };
}

export function attestationSignaturePayload(envelope: Omit<AttestationSignature, 'signature' | 'signatureRoot'>): Uint8Array {
  return signaturePayload(envelope);
}

export async function verifyCompositionAttestation(
  attestation: unknown,
  options: {
    now?: number;
    checkSignature?: boolean;
    publicKey?: Uint8Array;
    keyring?: KnowledgeAuthorityKeyringV1;
    verifySignature?: (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => Promise<boolean> | boolean;
    karMaterial?: { image: Uint8Array; graph: unknown; proposition: string; plan: unknown };
    requireUsage?: boolean;
  } = {},
): Promise<AttestationVerification> {
  try {
    const parsed = parseAttestation(attestation);
    if (attestationRootOf(parsed) !== parsed.attestationRoot) {
      return { ok: false, code: 'ATTESTATION_MISMATCH', path: 'attestationRoot' };
    }
    let signature: 'absent' | 'verified' | 'content-only' = 'absent';
    if (parsed.signature && options.checkSignature !== false) {
      await verifyEnvelope(parsed.signature, parsed.attestationRoot, options);
      signature = 'verified';
    } else if (parsed.signature) {
      signature = 'content-only';
    }
    const usage = confirmUsage(parsed, options);
    return { ok: true, attestationRoot: parsed.attestationRoot, signature, usage };
  } catch (error) {
    if (error instanceof CompositionError) return { ok: false, code: error.code, ...(error.path ? { path: error.path } : {}) };
    return { ok: false, code: 'ATTESTATION_INVALID' };
  }
}

function confirmUsage(attestation: CompositionAttestation, options: { karMaterial?: { image: Uint8Array; graph: unknown; proposition: string; plan: unknown }; requireUsage?: boolean }): 'not-applicable' | 'not-rerun' | 'rerun' {
  if (attestation.statement !== 'used' || attestation.subject.kind !== 'kar-result') return 'not-applicable';
  if (!options.karMaterial) {
    if (options.requireUsage) throw new CompositionError('COMPOSITION_MEMBER_MISSING', 'used attestation is missing KAR material.', 'subject');
    return 'not-rerun';
  }
  try {
    const session = createKarSession({ image: options.karMaterial.image, graph: options.karMaterial.graph });
    const evaluation = evaluateKar(session, { proposition: options.karMaterial.proposition, plan: options.karMaterial.plan });
    const subject = attestation.subject;
    if (evaluation.certificate.roots.karRoot !== subject.karRoot || evaluation.certificate.roots.knowledgeRoot !== subject.knowledgeRoot || session.image.stateRoot !== subject.stateRoot) {
      throw new CompositionError('ATTESTATION_MISMATCH', 'KAR rerun does not match the attestation subject.', 'subject');
    }
    return 'rerun';
  } catch (error) {
    if (error instanceof CompositionError) throw error;
    if (error instanceof KarError) throw new CompositionError('COMPOSITION_KAR_UNBOUND', error.message, 'subject', error);
    throw new CompositionError('ATTESTATION_INVALID', error instanceof Error ? error.message : String(error), 'subject', error);
  }
}

async function verifyEnvelope(
  signature: AttestationSignature,
  attestationRoot: Digest,
  options: { now?: number; publicKey?: Uint8Array; keyring?: KnowledgeAuthorityKeyringV1; verifySignature?: (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => Promise<boolean> | boolean },
): Promise<void> {
  if (!Number.isSafeInteger(options.now)) throw new CompositionError('ATTESTATION_INVALID', 'Signature verification requires now.', 'now');
  const now = options.now as number;
  if (now < signature.issuedAt || now >= signature.expiresAt) {
    throw new CompositionError('ATTESTATION_EXPIRED', 'Attestation signature is outside its validity window.', 'signature');
  }
  if (signature.attestationRoot !== attestationRoot) {
    throw new CompositionError('ATTESTATION_MISMATCH', 'Signature attestationRoot does not match.', 'signature.attestationRoot');
  }
  const payload = signaturePayload(signature);
  const bytes = decodeBase64(signature.signature, 'signature.signature');
  const expectedRoot = rooted(SIGNATURE_DOMAIN, { payload, signature: bytes } as unknown as CborValue);
  if (expectedRoot !== signature.signatureRoot) {
    throw new CompositionError('ATTESTATION_MISMATCH', 'signatureRoot does not match the envelope.', 'signature.signatureRoot');
  }
  if (signature.keyringRoot) {
    if (!options.keyring || authorityKeyringRootV1(options.keyring) !== signature.keyringRoot) {
      throw new CompositionError('ATTESTATION_KEY_MISMATCH', 'keyringRoot does not match the supplied keyring.', 'signature.keyringRoot');
    }
  }
  const publicKey = resolvePublicKey(signature, options.publicKey, options.keyring);
  const verify = options.verifySignature ?? verifyEd25519;
  const ok = await verify(payload, bytes, publicKey);
  if (!ok) throw new CompositionError('ATTESTATION_SIGNATURE_INVALID', 'Ed25519 signature did not verify.', 'signature.signature');
}

function resolvePublicKey(signature: AttestationSignature, publicKey: Uint8Array | undefined, keyring: KnowledgeAuthorityKeyringV1 | undefined): Uint8Array {
  if (publicKey) {
    if (publicKey.length !== 32) throw new CompositionError('ATTESTATION_KEY_MISMATCH', 'Ed25519 public keys are 32 bytes.', 'publicKey');
    return publicKey;
  }
  if (!keyring) throw new CompositionError('ATTESTATION_KEY_MISMATCH', 'Signature verification needs a public key or keyring.', 'signature');
  const matches = keyring.keys.filter((key) => key.principal === signature.principal && key.keyId === signature.keyId && key.algorithm === 'Ed25519' && key.publicKey.length === 32);
  if (matches.length !== 1) throw new CompositionError('ATTESTATION_KEY_MISMATCH', 'Keyring does not contain exactly one matching Ed25519 key.', 'signature.keyId');
  return matches[0].publicKey;
}

async function verifyEd25519(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new CompositionError('ATTESTATION_INVALID', 'WebCrypto SubtleCrypto is unavailable.', 'signature');
  try {
    const key = await subtle.importKey('raw', publicKey.slice().buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
    return subtle.verify({ name: 'Ed25519' }, key, signature.slice().buffer as ArrayBuffer, message.slice().buffer as ArrayBuffer);
  } catch {
    return false;
  }
}

function normalizeSubject(subject: AttestationSubject, record: CompositionRecord, statement: AttestationStatement): AttestationSubject {
  if (!isRecord(subject) || typeof subject.kind !== 'string') {
    throw new CompositionError('ATTESTATION_INVALID', 'Attestation subject is invalid.', 'subject');
  }
  if (subject.kind === 'composition') {
    exactKeys(subject, ['kind', 'compositionRoot'], 'subject', 'ATTESTATION_INVALID');
    const compositionRoot = requireDigest(subject.compositionRoot, 'subject.compositionRoot', 'ATTESTATION_INVALID');
    if (compositionRoot !== record.compositionRoot) {
      throw new CompositionError('ATTESTATION_MISMATCH', 'Composition subject does not match the record.', 'subject.compositionRoot');
    }
    return { kind: 'composition', compositionRoot };
  }
  if (subject.kind === 'v5-image') {
    exactKeys(subject, ['kind', 'stateRoot', 'objectRoot', 'commitDigest'], 'subject', 'ATTESTATION_INVALID');
    const image = {
      kind: 'v5-image' as const,
      stateRoot: requireDigest(subject.stateRoot, 'subject.stateRoot', 'ATTESTATION_INVALID'),
      objectRoot: requireDigest(subject.objectRoot, 'subject.objectRoot', 'ATTESTATION_INVALID'),
      commitDigest: requireDigest(subject.commitDigest, 'subject.commitDigest', 'ATTESTATION_INVALID'),
    };
    if (!imageListed(record, image.stateRoot, image.objectRoot, image.commitDigest)) {
      throw new CompositionError('ATTESTATION_MISMATCH', 'Image subject is not the host or a member.', 'subject');
    }
    return image;
  }
  if (subject.kind === 'kar-result') {
    exactKeys(subject, ['kind', 'karRoot', 'knowledgeRoot', 'stateRoot'], 'subject', 'ATTESTATION_INVALID');
    const result = {
      kind: 'kar-result' as const,
      karRoot: requireDigest(subject.karRoot, 'subject.karRoot', 'ATTESTATION_INVALID'),
      knowledgeRoot: requireDigest(subject.knowledgeRoot, 'subject.knowledgeRoot', 'ATTESTATION_INVALID'),
      stateRoot: requireDigest(subject.stateRoot, 'subject.stateRoot', 'ATTESTATION_INVALID'),
    };
    if (statement === 'used' && !stateListed(record, result.stateRoot)) {
      throw new CompositionError('ATTESTATION_MISMATCH', 'used KAR subject stateRoot is not in the composition.', 'subject.stateRoot');
    }
    return result;
  }
  if (subject.kind === 'excerpt') {
    exactKeys(subject, ['kind', 'excerptRoot'], 'subject', 'ATTESTATION_INVALID');
    const excerptRoot = requireDigest(subject.excerptRoot, 'subject.excerptRoot', 'ATTESTATION_INVALID');
    if (!record.members.some((member) => member.kind === 'excerpt' && member.excerptRoot === excerptRoot)) {
      throw new CompositionError('ATTESTATION_MISMATCH', 'Excerpt subject is not a member.', 'subject.excerptRoot');
    }
    return { kind: 'excerpt', excerptRoot };
  }
  throw new CompositionError('ATTESTATION_INVALID', 'Unknown attestation subject.', 'subject.kind');
}

function imageListed(record: CompositionRecord, stateRoot: Digest, objectRoot: Digest, commitDigest: Digest): boolean {
  if (record.host.kind === 'v5-image' && record.host.stateRoot === stateRoot && record.host.objectRoot === objectRoot && record.host.commitDigest === commitDigest) return true;
  return record.members.some((member) => member.kind === 'v5-image' && member.stateRoot === stateRoot && member.objectRoot === objectRoot && member.commitDigest === commitDigest);
}

function stateListed(record: CompositionRecord, stateRoot: Digest): boolean {
  if (record.host.kind === 'v5-image' && record.host.stateRoot === stateRoot) return true;
  return record.members.some((member) => member.kind === 'v5-image' && member.stateRoot === stateRoot);
}

export function parseAttestation(value: unknown): CompositionAttestation {
  if (!isRecord(value)) throw new CompositionError('ATTESTATION_INVALID', 'Attestation must be an object.');
  exactKeys(value, ['format', 'version', 'attestationRoot', 'compositionRoot', 'subject', 'statement', 'signature'], 'attestation', 'ATTESTATION_INVALID');
  if (value.format !== ATTESTATION_FORMAT || value.version !== 1) {
    throw new CompositionError('COMPOSITION_UNSUPPORTED', 'Unsupported attestation format.', 'format');
  }
  if (!STATEMENTS.includes(value.statement as AttestationStatement)) {
    throw new CompositionError('ATTESTATION_INVALID', 'statement must be mount, used, or cited.', 'statement');
  }
  if (!isRecord(value.subject)) throw new CompositionError('ATTESTATION_INVALID', 'Attestation subject is invalid.', 'subject');
  const attestation: CompositionAttestation = {
    format: ATTESTATION_FORMAT,
    version: 1,
    attestationRoot: requireDigest(value.attestationRoot, 'attestationRoot', 'ATTESTATION_INVALID'),
    compositionRoot: requireDigest(value.compositionRoot, 'compositionRoot', 'ATTESTATION_INVALID'),
    subject: subjectFromRecord(value.subject),
    statement: value.statement as AttestationStatement,
  };
  if (value.signature !== undefined) attestation.signature = parseSignature(value.signature, attestation.attestationRoot);
  if (attestationRootOf(attestation) !== attestation.attestationRoot) {
    throw new CompositionError('ATTESTATION_MISMATCH', 'attestationRoot does not match the body.', 'attestationRoot');
  }
  return attestation;
}

function subjectFromRecord(value: Record<string, unknown>): AttestationSubject {
  if (value.kind === 'composition') {
    exactKeys(value, ['kind', 'compositionRoot'], 'subject', 'ATTESTATION_INVALID');
    return { kind: 'composition', compositionRoot: requireDigest(value.compositionRoot, 'subject.compositionRoot', 'ATTESTATION_INVALID') };
  }
  if (value.kind === 'v5-image') {
    exactKeys(value, ['kind', 'stateRoot', 'objectRoot', 'commitDigest'], 'subject', 'ATTESTATION_INVALID');
    return {
      kind: 'v5-image',
      stateRoot: requireDigest(value.stateRoot, 'subject.stateRoot', 'ATTESTATION_INVALID'),
      objectRoot: requireDigest(value.objectRoot, 'subject.objectRoot', 'ATTESTATION_INVALID'),
      commitDigest: requireDigest(value.commitDigest, 'subject.commitDigest', 'ATTESTATION_INVALID'),
    };
  }
  if (value.kind === 'kar-result') {
    exactKeys(value, ['kind', 'karRoot', 'knowledgeRoot', 'stateRoot'], 'subject', 'ATTESTATION_INVALID');
    return {
      kind: 'kar-result',
      karRoot: requireDigest(value.karRoot, 'subject.karRoot', 'ATTESTATION_INVALID'),
      knowledgeRoot: requireDigest(value.knowledgeRoot, 'subject.knowledgeRoot', 'ATTESTATION_INVALID'),
      stateRoot: requireDigest(value.stateRoot, 'subject.stateRoot', 'ATTESTATION_INVALID'),
    };
  }
  if (value.kind === 'excerpt') {
    exactKeys(value, ['kind', 'excerptRoot'], 'subject', 'ATTESTATION_INVALID');
    return { kind: 'excerpt', excerptRoot: requireDigest(value.excerptRoot, 'subject.excerptRoot', 'ATTESTATION_INVALID') };
  }
  throw new CompositionError('ATTESTATION_INVALID', 'Unknown attestation subject.', 'subject.kind');
}

function parseSignature(value: unknown, attestationRoot: Digest): AttestationSignature {
  if (!isRecord(value)) throw new CompositionError('ATTESTATION_INVALID', 'Signature must be an object.', 'signature');
  exactKeys(value, ['format', 'version', 'attestationRoot', 'algorithm', 'principal', 'keyId', 'keyringRoot', 'issuedAt', 'expiresAt', 'signature', 'signatureRoot'], 'signature', 'ATTESTATION_INVALID');
  if (value.format !== SIGNATURE_FORMAT || value.version !== 1 || value.algorithm !== 'Ed25519') {
    throw new CompositionError('ATTESTATION_INVALID', 'Unsupported signature envelope.', 'signature');
  }
  const signature: AttestationSignature = {
    format: SIGNATURE_FORMAT,
    version: 1,
    attestationRoot: requireDigest(value.attestationRoot, 'signature.attestationRoot', 'ATTESTATION_INVALID'),
    algorithm: 'Ed25519',
    principal: requireToken(value.principal, 'signature.principal'),
    keyId: requireToken(value.keyId, 'signature.keyId'),
    issuedAt: requireTime(value.issuedAt, 'signature.issuedAt'),
    expiresAt: requireTime(value.expiresAt, 'signature.expiresAt'),
    signature: typeof value.signature === 'string' ? value.signature : '',
    signatureRoot: requireDigest(value.signatureRoot, 'signature.signatureRoot', 'ATTESTATION_INVALID'),
  };
  if (!signature.signature) throw new CompositionError('ATTESTATION_INVALID', 'Signature bytes are missing.', 'signature.signature');
  if (value.keyringRoot !== undefined) signature.keyringRoot = requireDigest(value.keyringRoot, 'signature.keyringRoot', 'ATTESTATION_INVALID');
  if (signature.expiresAt <= signature.issuedAt) throw new CompositionError('ATTESTATION_INVALID', 'expiresAt must be after issuedAt.', 'signature.expiresAt');
  if (signature.attestationRoot !== attestationRoot) throw new CompositionError('ATTESTATION_MISMATCH', 'Signature is bound to a different attestation.', 'signature.attestationRoot');
  if (!isDigest(signature.signatureRoot)) throw new CompositionError('ATTESTATION_INVALID', 'signatureRoot is invalid.', 'signature.signatureRoot');
  return signature;
}

function finish(parts: Omit<CompositionAttestation, 'format' | 'version' | 'attestationRoot' | 'signature'>): CompositionAttestation {
  return { format: ATTESTATION_FORMAT, version: 1, attestationRoot: rooted(ATTESTATION_DOMAIN, attestationBody(parts)), ...parts };
}

function attestationRootOf(attestation: CompositionAttestation): Digest {
  return rooted(ATTESTATION_DOMAIN, attestationBody(attestation));
}

function attestationBody(attestation: Pick<CompositionAttestation, 'compositionRoot' | 'subject' | 'statement'>): CborValue {
  return {
    version: 1,
    format: ATTESTATION_FORMAT,
    compositionRoot: attestation.compositionRoot,
    subject: attestation.subject,
    statement: attestation.statement,
  } as unknown as CborValue;
}

function signaturePayload(envelope: Omit<AttestationSignature, 'signature' | 'signatureRoot'>): Uint8Array {
  const body: Record<string, string | number> = {
    version: envelope.version,
    format: envelope.format,
    attestationRoot: envelope.attestationRoot,
    algorithm: envelope.algorithm,
    principal: envelope.principal,
    keyId: envelope.keyId,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
  };
  if (envelope.keyringRoot) body.keyringRoot = envelope.keyringRoot;
  return canonicalCbor(body as unknown as CborValue);
}

function requireTime(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CompositionError('ATTESTATION_INVALID', `${path} must be a safe integer.`, path);
  }
  return value;
}
