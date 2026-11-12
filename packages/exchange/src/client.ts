import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import * as path from 'node:path';
import {
  KnowledgeSyncReplayCacheV1,
  acceptKnowledgeExchangeTransferWithEd25519,
  createKnowledgeExchangeDecisionV1,
  createKnowledgeExchangeOfferV1,
  createKnowledgeExchangeReceiptV1,
  decodeKnowledgeExchangeOfferV1,
  decodeKnowledgeExchangeReceiptV1,
  describeKnowledgeExchangeArtifactV1,
  encodeKnowledgeExchangeDecisionV1,
  encodeKnowledgeExchangeOfferV1,
  encodeKnowledgeExchangeReceiptV1,
  signKnowledgeExchangeDecisionWithEd25519,
  signKnowledgeExchangeOfferWithEd25519,
  signKnowledgeExchangeReceiptWithEd25519,
  verifyKnowledgeExchangeOfferWithEd25519,
  verifyKnowledgeExchangeReceiptWithEd25519,
  type KnowledgeExchangeOfferV1,
  type KnowledgeExchangeReceiptV1,
} from '@knolo/core';
import { peerByName, type ExchangeConfig } from './config.js';
import {
  httpsJson,
  readLimitedBody,
  requestHostname,
  tlsServerName,
} from './http.js';
import { loadExchangeIdentity, type ExchangeIdentity } from './identity.js';
import { evaluateReceivePolicy } from './policy.js';
import {
  contentCachePath,
  knoloHome,
  offerClaimPath,
  partialPath,
  receiptPath,
} from './paths.js';
import {
  blobPath,
  offerPath,
  readEndpoint,
  writeBytesAtomic,
} from './store.js';

export type ExchangePullResult = {
  cachePath: string;
  sha256: string;
  stateRoot: string;
  receiptId: string;
};

export async function publishExchangeOffer(
  config: ExchangeConfig,
  input: {
    imagePath: string;
    to: string;
    now: number;
    ttlMs?: number;
    namespace?: string;
  }
): Promise<{ offerId: string }> {
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
  await writeBytesAtomic(blobPath(config.storePath, offer.sha256), imageBytes);
  const wire = encodeKnowledgeExchangeOfferV1(offer);
  await writeBytesAtomic(offerPath(config.storePath, offer.offerId), wire);
  const endpoint = await readEndpoint(config.storePath);
  const posted = await httpsJson(`${endpoint}/v1/offers`, {
    method: 'POST',
    body: wire,
    headers: {
      'content-type': 'application/cbor',
      ...(config.adminToken
        ? { authorization: `Bearer ${config.adminToken}` }
        : {}),
    },
    caPath: config.tls.caPath,
  });
  if (posted.status !== 201) throw httpFailure(posted.status, posted.body);
  return { offerId: offer.offerId };
}

export async function pullExchangeOffer(
  config: ExchangeConfig,
  input: {
    offerId: string;
    from: string;
    now: number;
    homeDir?: string;
    ttlMs?: number;
  }
): Promise<ExchangePullResult> {
  const identity = await loadExchangeIdentity(config);
  const homeDir = input.homeDir ?? knoloHome();
  const peer = peerByName(config, input.from);
  await assertOfferUnused(homeDir, input.offerId);
  try {
    const fetched = await httpsJson(
      `${peer.url}/v1/offers/${encodeURIComponent(input.offerId)}`,
      { method: 'GET', caPath: config.tls.caPath }
    );
    if (fetched.status !== 200) throw httpFailure(fetched.status, fetched.body);
    const offer = decodeKnowledgeExchangeOfferV1(fetched.body);
    if (offer.offerId !== input.offerId)
      throw new Error('V5 exchange offer ID mismatch.');
    await verifyKnowledgeExchangeOfferWithEd25519(
      offer,
      identity.keyring,
      input.now,
      globalThis.crypto,
      config.identity.principal
    );
    const policy = evaluateReceivePolicy(config.policy.receive, offer);
    if (!policy.ok) throw new Error('V5 exchange policy denied.');
    const decision = await acceptDecision(
      config,
      identity,
      offer,
      peer.url,
      input.now,
      input.ttlMs ?? 300_000
    );
    const cached = await readMatchingCache(homeDir, offer);
    const imageBytes =
      cached ??
      (await downloadBlob(config, peer.url, offer, decision, homeDir));
    const image = await acceptKnowledgeExchangeTransferWithEd25519(
      offer,
      imageBytes,
      identity.keyring,
      new KnowledgeSyncReplayCacheV1(),
      input.now,
      globalThis.crypto,
      config.identity.principal
    ).catch(async (error: unknown) => {
      await rm(partialPath(homeDir, offer.offerId), { force: true });
      throw error;
    });
    const committed = await commitAcceptedExchange(
      config,
      identity,
      offer,
      imageBytes,
      image.stateRoot,
      homeDir,
      input.now
    );
    await rm(partialPath(homeDir, offer.offerId), { force: true });
    return committed;
  } catch (error) {
    await abandonOfferClaim(homeDir, input.offerId);
    throw error;
  }
}

export async function assertOfferUnused(
  homeDir: string,
  offerId: string
): Promise<void> {
  await claimUnusedOffer(homeDir, offerId);
}

export async function abandonOfferClaim(
  homeDir: string,
  offerId: string
): Promise<void> {
  const removed = await withOfferIndexLock(homeDir, async () => {
    const index = await readOfferIndex(homeDir);
    if (typeof index[offerId] === 'string') return false;
    const claim = offerClaimPath(homeDir, offerId);
    await rm(claim, { force: true });
    await rmdir(path.dirname(claim)).catch(() => undefined);
    return true;
  });
  if (removed)
    await rmdir(path.join(homeDir, 'exchange')).catch(() => undefined);
}

export async function commitAcceptedExchange(
  config: ExchangeConfig,
  identity: ExchangeIdentity,
  offer: KnowledgeExchangeOfferV1,
  imageBytes: Uint8Array,
  stateRoot: string,
  homeDir: string,
  now: number
): Promise<ExchangePullResult> {
  const cachePath = contentCachePath(homeDir, offer.sha256);
  await writeBytesAtomic(cachePath, imageBytes);
  const receipt = await signKnowledgeExchangeReceiptWithEd25519(
    createKnowledgeExchangeReceiptV1({
      offer,
      role: 'recipient',
      decision: 'accept',
      verification: 'verified',
      policy: 'receive',
      algorithm: 'Ed25519',
      keyId: config.identity.keyId,
      ...(identity.keyring.keyringRoot === undefined
        ? {}
        : { keyringRoot: identity.keyring.keyringRoot }),
      nonce: randomNonce(),
      issuedAt: now,
      expiresAt: offer.expiresAt,
    }),
    identity.privateKey,
    globalThis.crypto
  );
  await writeBytesAtomic(
    receiptPath(homeDir, receipt.receiptId),
    encodeKnowledgeExchangeReceiptV1(receipt)
  );
  await rememberOffer(homeDir, offer.offerId, receipt.receiptId);
  return {
    cachePath,
    sha256: offer.sha256,
    stateRoot,
    receiptId: receipt.receiptId,
  };
}

export async function inspectExchangeReceipt(
  homeDir: string,
  receiptId: string,
  config?: ExchangeConfig,
  now = Date.now()
): Promise<KnowledgeExchangeReceiptV1> {
  const receipt = decodeKnowledgeExchangeReceiptV1(
    new Uint8Array(await readFile(receiptPath(homeDir, receiptId)))
  );
  if (config) {
    const identity = await loadExchangeIdentity(config);
    const offerBytes = await readFile(
      offerPath(config.storePath, receipt.offerId)
    ).catch(() => undefined);
    if (offerBytes) {
      await verifyKnowledgeExchangeReceiptWithEd25519(
        decodeKnowledgeExchangeOfferV1(new Uint8Array(offerBytes)),
        receipt,
        identity.keyring,
        now,
        globalThis.crypto
      );
    }
  }
  return receipt;
}

async function acceptDecision(
  config: ExchangeConfig,
  identity: ExchangeIdentity,
  offer: KnowledgeExchangeOfferV1,
  peerUrl: string,
  now: number,
  ttlMs: number
): Promise<Uint8Array> {
  const decision = await signKnowledgeExchangeDecisionWithEd25519(
    createKnowledgeExchangeDecisionV1({
      offer,
      decision: 'accept',
      algorithm: 'Ed25519',
      keyId: config.identity.keyId,
      ...(identity.keyring.keyringRoot === undefined
        ? {}
        : { keyringRoot: identity.keyring.keyringRoot }),
      nonce: randomNonce(),
      issuedAt: now,
      expiresAt: Math.min(offer.expiresAt, now + ttlMs),
    }),
    identity.privateKey,
    globalThis.crypto
  );
  const wire = encodeKnowledgeExchangeDecisionV1(decision);
  const posted = await httpsJson(
    `${peerUrl}/v1/offers/${encodeURIComponent(offer.offerId)}/decision`,
    {
      method: 'POST',
      body: wire,
      headers: { 'content-type': 'application/cbor' },
      caPath: config.tls.caPath,
    }
  );
  if (posted.status !== 200) throw httpFailure(posted.status, posted.body);
  return wire;
}

async function downloadBlob(
  config: ExchangeConfig,
  peerUrl: string,
  offer: KnowledgeExchangeOfferV1,
  decision: Uint8Array,
  homeDir: string
): Promise<Uint8Array> {
  if (offer.sizeBytes > config.policy.receive.maxBytes)
    throw new Error('V5 exchange policy denied.');
  const partial = partialPath(homeDir, offer.offerId);
  await mkdir(path.dirname(partial), { recursive: true });
  let existing = 0;
  try {
    existing = (await stat(partial)).size;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (existing > offer.sizeBytes) {
    await rm(partial, { force: true });
    existing = 0;
  }
  if (existing === offer.sizeBytes)
    return new Uint8Array(await readFile(partial));
  const ca = config.tls.caPath ? readFileSync(config.tls.caPath) : undefined;
  const target = new URL(`${peerUrl}/v1/blobs/${offer.sha256}`);
  const hostname = requestHostname(target.hostname);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let limited = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const req = httpsRequest(
      {
        protocol: target.protocol,
        hostname,
        port: target.port,
        path: target.pathname,
        method: 'GET',
        headers: {
          'knolo-decision': Buffer.from(decision).toString('base64url'),
          ...(existing > 0 ? { range: `bytes=${existing}-` } : {}),
        },
        ...(ca ? { ca } : {}),
        ...tlsServerName(hostname),
        agent: false,
      },
      (response) => {
        if ((response.statusCode ?? 0) >= 400) {
          void readLimitedBody(response, undefined, () => {
            limited = true;
          }).then(
            (body) => fail(httpFailure(response.statusCode ?? 0, body)),
            (error: unknown) => {
              limited = true;
              fail(
                error instanceof Error
                  ? error
                  : new Error('V5 exchange transfer interrupted.')
              );
            }
          );
          return;
        }
        const offset = response.statusCode === 206 ? existing : 0;
        const writer = createWriteAt(
          partial,
          offset,
          response.statusCode !== 206
        );
        let received = offset;
        response.on('data', (chunk: Buffer) => {
          if (received + chunk.length > offer.sizeBytes) {
            response.destroy();
            fail(new Error('V5 exchange transfer interrupted.'));
            return;
          }
          received += chunk.length;
          writer.write(chunk);
        });
        response.on('end', () => {
          void writer.done().then(succeed, fail);
        });
        response.on('error', () =>
          fail(new Error('V5 exchange transfer interrupted.'))
        );
      }
    );
    req.on('error', () => {
      if (limited) return;
      fail(new Error('V5 exchange transfer interrupted.'));
    });
    req.end();
  });
  let imageBytes: Uint8Array;
  try {
    imageBytes = new Uint8Array(await readFile(partial));
  } catch (error) {
    if (isNotFound(error)) throw new Error('V5 exchange transfer interrupted.');
    throw error;
  }
  if (imageBytes.length !== offer.sizeBytes)
    throw new Error('V5 exchange transfer interrupted.');
  return imageBytes;
}

function createWriteAt(
  file: string,
  offset: number,
  replace: boolean
): { write: (chunk: Buffer) => void; done: () => Promise<void> } {
  let position = offset;
  let chain = replace
    ? truncate(file, 0)
        .catch(() => undefined)
        .then(() => undefined)
    : Promise.resolve();
  return {
    write(chunk: Buffer) {
      const start = position;
      position += chunk.length;
      chain = chain.then(async () => {
        const handle = await open(file, 'r+').catch(() => open(file, 'w+'));
        try {
          await handle.write(chunk, 0, chunk.length, start);
        } finally {
          await handle.close();
        }
      });
    },
    done: () => chain,
  };
}

async function readMatchingCache(
  homeDir: string,
  offer: KnowledgeExchangeOfferV1
): Promise<Uint8Array | undefined> {
  const file = contentCachePath(homeDir, offer.sha256);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  if (
    bytes.length === offer.sizeBytes &&
    createHash('sha256').update(bytes).digest('hex') === offer.sha256
  ) {
    return bytes;
  }
  return undefined;
}

const OFFER_INDEX_LOCK_WAIT_MS = 10_000;
const OFFER_INDEX_LOCK_STALE_MS = 30_000;

async function claimUnusedOffer(
  homeDir: string,
  offerId: string
): Promise<void> {
  const claim = offerClaimPath(homeDir, offerId);
  await mkdir(path.dirname(claim), { recursive: true });
  await withOfferIndexLock(homeDir, async () => {
    const index = await readOfferIndex(homeDir);
    if (typeof index[offerId] === 'string' || (await claimIsLive(claim))) {
      throw new Error('V5 exchange replay detected.');
    }
    await rm(claim, { force: true });
    const handle = await open(claim, 'wx');
    try {
      await handle.writeFile(`${process.pid}\n`);
    } finally {
      await handle.close();
    }
  });
}

async function rememberOffer(
  homeDir: string,
  offerId: string,
  receiptId: string
): Promise<void> {
  await withOfferIndexLock(homeDir, async () => {
    const file = indexPath(homeDir);
    const index = await readOfferIndex(homeDir);
    index[offerId] = receiptId;
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temp, JSON.stringify(index));
    await rename(temp, file);
  });
}

async function withOfferIndexLock<T>(
  homeDir: string,
  body: () => Promise<T>
): Promise<T> {
  const directory = path.join(homeDir, 'exchange');
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, 'offers.json.lock');
  const handle = await acquireOfferLock(lockPath);
  try {
    return await body();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function acquireOfferLock(lockPath: string) {
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${process.pid}\n`);
      } catch (error) {
        await handle.close();
        await rm(lockPath, { force: true });
        throw error;
      }
      return handle;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await lockIsStale(lockPath)) {
        await rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - started > OFFER_INDEX_LOCK_WAIT_MS) {
        throw new Error('V5 exchange offer index is locked.');
      }
      await delay(25);
    }
  }
}

async function lockIsStale(lockPath: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(lockPath, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > OFFER_INDEX_LOCK_STALE_MS;
  } catch (error) {
    return isNotFound(error);
  }
}

async function claimIsLive(claim: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(claim, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 && pidAlive(pid);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function readOfferIndex(
  homeDir: string
): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(indexPath(homeDir), 'utf8')) as Record<
      string,
      string
    >;
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
}

function indexPath(homeDir: string): string {
  return path.join(homeDir, 'exchange', 'offers.json');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorCode(error, 'EPERM');
  }
}

function httpFailure(status: number, body: Uint8Array): Error {
  try {
    const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as {
      error?: string;
    };
    if (parsed.error) return new Error(parsed.error);
  } catch {
    // The body was not the JSON error envelope.
  }
  return new Error(`V5 exchange request failed with status ${status}.`);
}

function randomNonce(): Uint8Array {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function isNotFound(error: unknown): boolean {
  return isErrorCode(error, 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return isErrorCode(error, 'EEXIST');
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === code
  );
}
