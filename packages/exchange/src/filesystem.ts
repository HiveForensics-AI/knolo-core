import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  KnowledgeSyncReplayCacheV1,
  acceptKnowledgeExchangeTransferWithEd25519,
  createKnowledgeExchangeOfferV1,
  decodeKnowledgeExchangeOfferV1,
  describeKnowledgeExchangeArtifactV1,
  encodeKnowledgeExchangeOfferV1,
  signKnowledgeExchangeOfferWithEd25519,
  verifyKnowledgeExchangeOfferWithEd25519,
} from '@knolo/core';
import {
  abandonOfferClaim,
  assertOfferUnused,
  commitAcceptedExchange,
  type ExchangePullResult,
} from './client.js';
import { peerByName, type ExchangeConfig } from './config.js';
import { loadExchangeIdentity } from './identity.js';
import { knoloHome } from './paths.js';
import { evaluateReceivePolicy } from './policy.js';
import { writeBytesAtomic } from './store.js';

const SHA256 = /^[0-9a-f]{64}$/;

export type ExchangeExportResult = {
  directory: string;
  offerId: string;
  sha256: string;
  stateRoot: string;
};

export async function exportExchangeDirectory(
  config: ExchangeConfig,
  input: {
    imagePath: string;
    to: string;
    outDir: string;
    now: number;
    ttlMs?: number;
    namespace?: string;
  }
): Promise<ExchangeExportResult> {
  const identity = await loadExchangeIdentity(config);
  const peer = peerByName(config, input.to);
  const imageBytes = new Uint8Array(await readFile(input.imagePath));
  const described = describeKnowledgeExchangeArtifactV1(imageBytes);
  const ttl = input.ttlMs ?? 300_000;
  const offer = await signKnowledgeExchangeOfferWithEd25519(
    createKnowledgeExchangeOfferV1({
      sender: config.identity.principal,
      recipient: peer.principal,
      artifactKind: 'knowledge-image',
      sha256: described.sha256,
      stateRoot: described.stateRoot,
      sizeBytes: described.sizeBytes,
      ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
      algorithm: 'Ed25519',
      keyId: config.identity.keyId,
      ...(identity.keyring.keyringRoot === undefined
        ? {}
        : { keyringRoot: identity.keyring.keyringRoot }),
      nonce: randomNonce(),
      issuedAt: input.now,
      expiresAt: input.now + ttl,
    }),
    identity.privateKey,
    globalThis.crypto
  );
  const directory = path.resolve(input.outDir);
  await writeBytesAtomic(
    path.join(directory, 'offer.cbor'),
    encodeKnowledgeExchangeOfferV1(offer)
  );
  await writeBytesAtomic(
    path.join(directory, `${offer.sha256}.knolo`),
    imageBytes
  );
  return {
    directory,
    offerId: offer.offerId,
    sha256: offer.sha256,
    stateRoot: described.stateRoot,
  };
}

export async function importExchangeDirectory(
  config: ExchangeConfig,
  input: { directory: string; now: number; homeDir?: string }
): Promise<ExchangePullResult> {
  const identity = await loadExchangeIdentity(config);
  const homeDir = input.homeDir ?? knoloHome();
  const directory = path.resolve(input.directory);
  const offer = decodeKnowledgeExchangeOfferV1(
    new Uint8Array(await readFile(path.join(directory, 'offer.cbor')))
  );
  await assertOfferUnused(homeDir, offer.offerId);
  try {
    await verifyKnowledgeExchangeOfferWithEd25519(
      offer,
      identity.keyring,
      input.now,
      globalThis.crypto,
      config.identity.principal
    );
    const policy = evaluateReceivePolicy(config.policy.receive, offer);
    if (!policy.ok) throw new Error('V5 exchange policy denied.');
    if (!SHA256.test(offer.sha256))
      throw new Error('Malformed V5 exchange sha256.');
    const imagePath = path.join(directory, `${offer.sha256}.knolo`);
    const info = await stat(imagePath);
    if (info.size !== offer.sizeBytes)
      throw new Error('V5 exchange artifact size mismatch.');
    const imageBytes = new Uint8Array(await readFile(imagePath));
    const image = await acceptKnowledgeExchangeTransferWithEd25519(
      offer,
      imageBytes,
      identity.keyring,
      new KnowledgeSyncReplayCacheV1(),
      input.now,
      globalThis.crypto,
      config.identity.principal
    );
    return await commitAcceptedExchange(
      config,
      identity,
      offer,
      imageBytes,
      image.stateRoot,
      homeDir,
      input.now
    );
  } catch (error) {
    await abandonOfferClaim(homeDir, offer.offerId);
    throw error;
  }
}

function randomNonce(): Uint8Array {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
