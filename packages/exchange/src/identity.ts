import { readFileSync } from 'node:fs';
import type { Digest, Ed25519AuthorityKeyringV1 } from '@knolo/core';
import type { ExchangeConfig } from './config.js';

export type ExchangeIdentity = {
  privateKey: CryptoKey;
  keyring: Ed25519AuthorityKeyringV1;
};

export async function loadExchangeIdentity(
  config: ExchangeConfig
): Promise<ExchangeIdentity> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error(
      'WebCrypto SubtleCrypto is unavailable for Ed25519 signing.'
    );
  const keyring = readKeyring(config.identity.keyringPath);
  const match = keyring.keys.filter(
    (key) =>
      key.principal === config.identity.principal &&
      key.keyId === config.identity.keyId
  );
  if (match.length !== 1)
    throw new Error('V5 exchange identity key is missing from the keyring.');
  const pkcs8 = pemToDer(readFileSync(config.identity.privateKeyPath, 'utf8'));
  const privateKey = await subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  return { privateKey, keyring };
}

function readKeyring(filePath: string): Ed25519AuthorityKeyringV1 {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('V5 exchange keyring must be a JSON object.');
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.keys) || record.keys.length === 0)
    throw new Error('V5 exchange keyring has no keys.');
  const keyringRoot =
    record.keyringRoot === undefined ? undefined : asDigest(record.keyringRoot);
  const keys = record.keys.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('V5 exchange keyring key is malformed.');
    const key = entry as Record<string, unknown>;
    const publicKey = Buffer.from(asString(key.publicKey), 'base64');
    if (publicKey.length !== 32)
      throw new Error('V5 exchange keyring public key must be 32 bytes.');
    return {
      principal: asString(key.principal),
      keyId: asString(key.keyId),
      publicKey: new Uint8Array(publicKey),
      ...(typeof key.notBefore === 'number'
        ? { notBefore: key.notBefore }
        : {}),
      ...(typeof key.notAfter === 'number' ? { notAfter: key.notAfter } : {}),
      ...(typeof key.revokedAt === 'number'
        ? { revokedAt: key.revokedAt }
        : {}),
    };
  });
  return { ...(keyringRoot === undefined ? {} : { keyringRoot }), keys };
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('V5 exchange private key PEM is empty.');
  const bytes = Buffer.from(body, 'base64');
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function asString(value: unknown): string {
  if (typeof value !== 'string' || !value)
    throw new Error('V5 exchange keyring field is malformed.');
  return value;
}

function asDigest(value: unknown): Digest {
  if (typeof value !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(value))
    throw new Error('V5 exchange keyring root is malformed.');
  return value;
}
